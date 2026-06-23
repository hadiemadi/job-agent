const express = require('express');
const path = require('path');
const fse = require('fs-extra');
const PizZip = require('pizzip');
const { readCV, parseCVStructure, adjustLanguageLevel, classify, generateComparisonTemplate } = require('../agent');
const { generateWordCV, generateWordCVAlt } = require('../src/wordExport');
const { generateWordFromTemplate } = require('../src/wordTemplateExport');
const { upload, templateUpload } = require('../services/uploads');
const { getSession, setSession, registerOutputFile, purgeSessionData } = require('../services/session');
const { getGaps } = require('../services/gapStore');
const { tailorCvWithReview } = require('../services/workflows');

const router = express.Router();

router.post('/upload-cv', upload.single('cv'), async (req, res) => {
  const cvPath = req.file.path;
  try {
    const cvText = await readCV(cvPath);
    const cvData = await parseCVStructure(cvText);
    // We only need the file long enough to extract its text — keeping the parsed CV text
    // in-session is enough for every downstream step (tailoring re-reads appSession.cvText
    // now, not the file). The consent notice on the upload screen promises the CV is
    // "auto-deleted after your session" — this is the first half of making that true: the
    // source file never lingers on disk past this one request.
    await fse.remove(cvPath);
    setSession({ ...getSession(), cvText, cvPath: null, cvData });
    res.json({ cvPath, cvData });
  } catch (err) {
    await fse.remove(cvPath).catch(() => {}); // still scrub it even on a parse failure
    res.status(500).json({ error: err.message });
  }
});

// "Delete my data now" — wipes this session's CV text, parsed data, HR/coach history, and
// any generated output files (from disk too), then starts it fresh. Same sid/cookie, blank
// session behind it.
router.post('/delete-my-data', (req, res) => {
  purgeSessionData();
  res.json({ ok: true });
});

router.post('/confirm-contact', async (req, res) => {
  const appSession = getSession();
  const { name, title, email, phone, location, linkedin, customInstructions, tone, extensiveSearch, refreshDiscipline, gapSeverities } = req.body;
  appSession.confirmedContact = { name, title, email, phone, location, linkedin };
  const validSeverities = Array.isArray(gapSeverities) ? gapSeverities.filter(s => ['major', 'mild', 'minor'].includes(s)) : [];
  // The Input Router decides whether this free-text comment is a field-agnostic instruction
  // (already flows into every prompt via customInstructions below — no extra plumbing) or a
  // discipline-specific skill claim (pinned into that field's knowledge store once the field
  // is known — see /review-cv). Best-effort: classification failure just falls back to
  // treating the comment as a plain general instruction.
  let routedInstruction = null;
  try {
    routedInstruction = await classify(customInstructions || '');
  } catch (e) { /* best-effort — comment still flows via customInstructions either way */ }
  appSession.clientPreferences = {
    tone: tone || 4, customInstructions: customInstructions || '', languageLevel: 2,
    extensiveSearch: !!extensiveSearch, conventionsResearch: '',
    // "Refresh discipline knowledge from web" — wired through but currently a no-op: the
    // Researcher (agents/researcher.js) is a deliberate stub until live search is enabled.
    refreshDiscipline: !!refreshDiscipline,
    gapSeverities: validSeverities.length ? validSeverities : ['major'],
    routedInstruction, routedInstructionApplied: false,
  };
  if (appSession.cvData) Object.assign(appSession.cvData, appSession.confirmedContact);
  res.json({ ok: true });
});

router.post('/rewrite', async (req, res) => {
  try {
    const appSession = getSession();
    const { job } = req.body;
    // The uploaded file is deleted right after /upload-cv extracts its text (see above) —
    // appSession.cvText is the one source of truth from here on, not a re-read from disk.
    const cvText = appSession.cvText;
    const recommendedSections = (appSession.hrReview || {}).recommended_sections;
    const originalName = (appSession.cvData || {}).name;
    const autoChanges = (appSession.hrReview || {}).auto_changes || [];
    // Gap accept/skip/discuss state is now server-side (services/gapStore.js, via the
    // /gap-decision and /coach/discuss routes) — derived here instead of trusting a
    // client-submitted confirmedChanges/gapDiscussions list. Any gap not explicitly
    // 'accepted' (open, skipped, or hr-concluded) resolves to skipped: the candidate gave no
    // real signal either way for anything else, so nothing unconfirmed is ever added to the CV.
    const gaps = getGaps();
    const confirmedChanges = gaps
      .filter(g => g.status === 'accepted')
      .map(g => ({ description: (g.hrConclusion && g.hrConclusion.refinedDescription) || g.description, rationale: g.rationale }));
    const gapDiscussions = gaps.map(g => ({
      description: g.description,
      rationale: g.rationale,
      status: g.status === 'accepted' ? 'accepted' : 'skipped',
      coachConversation: g.coachConversation,
      refinedDescription: g.hrConclusion ? g.hrConclusion.refinedDescription : null,
    }));
    const { filePath, cvData, modified_sections, thread, hrDisplayHistory, review } = await tailorCvWithReview({
      cvText, job, autoChanges, confirmedChanges,
      recommendedSections, originalName, confirmedContact: appSession.confirmedContact,
      thread: appSession.hrThread, preferences: appSession.clientPreferences,
      hrDisplayHistory: appSession.hrDisplayHistory, originalCvData: appSession.cvData,
      gapDiscussions,
    });
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    // Comparison page is NOT built here — it's a side artifact most clients never open, and
    // building it eagerly only slows down the main path (getting the tailored CV). Stash what
    // /build-comparison needs and build it lazily, only if the client actually asks for it.
    appSession.lastTailoredCvData     = cvData;
    appSession.lastModifiedSections   = modified_sections;
    appSession.lastTailoredJob        = job;
    // The independent pre-release review (services/workflows.js) gets up to 2 revision passes.
    // If it still isn't SHIP after that, surface the remaining issues rather than hide them.
    const reviewIssues = review && review.verdict === 'FIX_REQUIRED' ? review.required_edits : [];
    res.json({ filePath, reviewIssues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/build-comparison', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.lastTailoredCvData) return res.status(400).json({ error: 'No tailored CV yet.' });
    const job = req.body.job || appSession.lastTailoredJob;
    const comparisonHtml = generateComparisonTemplate(appSession.cvData, appSession.lastTailoredCvData, job, appSession.lastModifiedSections);
    const comparisonPath = registerOutputFile('html'); // unguessable, session-scoped — see services/session.js
    await fse.outputFile(comparisonPath, comparisonHtml);
    res.json({ comparisonPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/export-word', async (req, res) => {
  try {
    const appSession = getSession();
    const { cvData, job, templatePath, templateStyle } = req.body;
    if (!cvData || !job) return res.status(400).json({ error: 'cvData and job are required.' });

    if (templateStyle === 'alternate') {
      const wordPath = await generateWordCVAlt(cvData, job);
      return res.json({ wordPath });
    }
    if (templateStyle === 'original') {
      return res.status(501).json({ error: "Style mimicry from your original CV isn't available yet — your CV was read as a PDF, and this feature needs a Word-format source. Use 'Upload your own template' instead." });
    }
    if (templatePath) {
      const resolved = path.resolve(templatePath);
      const templatesDir = path.resolve('uploads/templates');
      if (!resolved.startsWith(templatesDir)) return res.status(400).json({ error: 'Invalid template path.' });
      const { wordPath, thread } = await generateWordFromTemplate(cvData, job, resolved, appSession.cvText, appSession.hrThread, appSession.clientPreferences);
      appSession.hrThread = thread;
      return res.json({ wordPath });
    }
    const wordPath = await generateWordCV(cvData, job);
    res.json({ wordPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/adjust-language', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { cvData, job, languageLevel } = req.body;
    if (!cvData || !job) return res.status(400).json({ error: 'cvData and job are required.' });
    const level = languageLevel || 2;
    const { cvData: updatedCv, templateSuggestion, filePath, thread, hrDisplayHistory } = await adjustLanguageLevel(
      appSession.cvText, job, cvData, level, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    appSession.clientPreferences = { ...appSession.clientPreferences, languageLevel: level };
    res.json({ cvData: updatedCv, templateSuggestion, filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-template', templateUpload.single('template'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No .docx template file uploaded.' });
    new PizZip(await fse.readFile(req.file.path));
    res.json({ templatePath: req.file.path.replace(/\\/g, '/') });
  } catch (err) {
    res.status(400).json({ error: 'Invalid Word template file.' });
  }
});

module.exports = router;
