const express = require('express');
const path = require('path');
const fse = require('fs-extra');
const PizZip = require('pizzip');
const { readCV, parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, classify, generateComparisonTemplate } = require('../agent');
const { generateWordCV, generateWordCVAlt } = require('../src/wordExport');
const { generateWordFromTemplate } = require('../src/wordTemplateExport');
const { upload, templateUpload } = require('../services/uploads');
const { getSession, setSession } = require('../services/session');

const router = express.Router();

router.post('/upload-cv', upload.single('cv'), async (req, res) => {
  try {
    const cvPath = req.file.path;
    const cvText = await readCV(cvPath);
    const cvData = await parseCVStructure(cvText);
    setSession({ ...getSession(), cvText, cvPath, cvData });
    res.json({ cvPath, cvData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    gapSeverities: validSeverities.length ? validSeverities : ['major', 'mild', 'minor'],
    routedInstruction, routedInstructionApplied: false,
  };
  if (appSession.cvData) Object.assign(appSession.cvData, appSession.confirmedContact);
  res.json({ ok: true });
});

router.post('/rewrite', async (req, res) => {
  try {
    const appSession = getSession();
    const { job, cvPath, autoChanges, confirmedChanges, gapDiscussions } = req.body;
    const cvText = await readCV(cvPath || appSession.cvPath);
    const recommendedSections = (appSession.hrReview || {}).recommended_sections;
    const originalName = (appSession.cvData || {}).name;
    const { filePath, cvData, modified_sections, thread, hrDisplayHistory } = await rewriteCVWithChanges(cvText, job, autoChanges || [], confirmedChanges || [], recommendedSections, originalName, appSession.confirmedContact, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory, appSession.cvData, gapDiscussions || []);
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    // Comparison page is NOT built here — it's a side artifact most clients never open, and
    // building it eagerly only slows down the main path (getting the tailored CV). Stash what
    // /build-comparison needs and build it lazily, only if the client actually asks for it.
    appSession.lastTailoredCvData     = cvData;
    appSession.lastModifiedSections   = modified_sections;
    appSession.lastTailoredJob        = job;
    res.json({ filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/build-comparison', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.lastTailoredCvData) return res.status(400).json({ error: 'No tailored CV yet.' });
    const job = req.body.job || appSession.lastTailoredJob;
    const company = (job.employer_name || job.company || 'Company').replace(/\s+/g, '_');
    const comparisonHtml = generateComparisonTemplate(appSession.cvData, appSession.lastTailoredCvData, job, appSession.lastModifiedSections);
    const comparisonPath = `output/comparison_${company}.html`;
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
