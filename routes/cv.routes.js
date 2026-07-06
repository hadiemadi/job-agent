const express = require('express');
const path = require('path');
const fse = require('fs-extra');
const PizZip = require('pizzip');
const { readCV, parseCVStructure, adjustLanguageLevel, classify, generateComparisonTemplate, draftFromSidebarDiscussion } = require('../agent');
const { generateWordCV, generateWordCVAlt } = require('../src/wordExport');
const { generateWordFromTemplate } = require('../src/wordTemplateExport');
const { upload, templateUpload } = require('../services/uploads');
const { getSession, setSession, registerOutputFile, purgeSessionData, als } = require('../services/session');
const { getGaps } = require('../services/gapStore');
const { tailorCvWithReview } = require('../services/workflows');
const { createJob, updateJob, getJob } = require('../services/jobQueue');
const { sendError } = require('../core/respondError');
const { logEvent } = require('../core/logger');

// Shared by /rewrite and /regenerate-cv (#29/#31) — derives the gap-sourced inputs to the CV
// writer from the server-side gap store, instead of trusting a client-submitted list. Only a
// gap's HR-drafted, candidate-accepted proposedStatement is ever inserted — never the raw
// slogan (g.description). A gap with userDecision==='added' but no proposedStatement would be
// a logic error elsewhere in the lifecycle (setUserDecision guards 'added' to gaps that already
// have a draft) — skip it defensively rather than insert the unverified slogan or throw and
// block the whole tailoring step over one bad record.
function buildGapInputs(gaps) {
  const confirmedChanges = gaps
    .filter(g => g.userDecision === 'added')
    .map(g => {
      if (!g.proposedStatement) {
        console.warn('[gap] added gap has no proposedStatement — skipping it, not inserting the slogan. id:', g.id);
        return null;
      }
      return { description: g.proposedStatement, rationale: g.rationale };
    })
    .filter(Boolean);
  const gapDiscussions = gaps.map(g => ({
    description: g.description,
    rationale: g.rationale,
    status: g.userDecision === 'added' ? 'accepted' : 'skipped',
    coachConversation: g.coachConversation,
    refinedDescription: g.proposedStatement || null,
  }));
  return { confirmedChanges, gapDiscussions };
}

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
    logEvent('cv_uploaded', { route: '/upload-cv', outcome: 'ok' });
    res.json({ cvPath, cvData });
  } catch (err) {
    await fse.remove(cvPath).catch(() => {}); // still scrub it even on a parse failure
    sendError(res, '/upload-cv', 'ERR-CV-002', err);
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
    const cvText = appSession.cvText;
    const recommendedSections = (appSession.hrReview || {}).recommended_sections;
    const originalName = (appSession.cvData || {}).name;
    const autoChanges = (appSession.hrReview || {}).auto_changes || [];
    const { confirmedChanges, gapDiscussions } = buildGapInputs(getGaps());

    // Snapshot all pipeline inputs from session NOW (before response ends the request scope).
    const jobParams = {
      cvText, job, autoChanges, confirmedChanges,
      recommendedSections, originalName,
      confirmedContact: appSession.confirmedContact,
      thread: appSession.hrThread,
      preferences: appSession.clientPreferences,
      hrDisplayHistory: appSession.hrDisplayHistory,
      originalCvData: appSession.cvData,
      gapDiscussions,
    };

    const jobId = await createJob();
    // Capture the session ID so the background task can re-establish the ALS context —
    // registerOutputFile() inside the pipeline uses als.getStore() to name the output file,
    // and that context is gone once the response is sent. als.run(sid, fn) re-pins it.
    const sid = als.getStore();

    res.json({ jobId });

    // Background pipeline — runs after response; re-establishes session context so file
    // registration and session writes land on the correct per-browser session.
    als.run(sid, async () => {
      try {
        await updateJob(jobId, { status: 'running', current_step: 'Writing CV' });
        const { filePath, cvData, modified_sections, thread, hrDisplayHistory, review } = await tailorCvWithReview(jobParams);
        const reviewIssues = review && review.verdict === 'FIX_REQUIRED' ? review.required_edits : [];
        // Store session-updatable fields in the job result — the GET /job/:id/status route
        // applies them to the session when the client polls and gets status === 'done', so
        // downstream routes (/regenerate-cv, /export-word) see the correct state.
        await updateJob(jobId, {
          status: 'done',
          current_step: '',
          result: {
            filePath, reviewIssues,
            hrThread: thread,
            hrDisplayHistory,
            lastGenHrCount: hrDisplayHistory.length,
            lastTailoredCvData: cvData,
            lastModifiedSections: modified_sections,
            lastTailoredJob: job,
          },
        });
        logEvent('cv_tailored', { route: '/rewrite', outcome: 'ok' });
      } catch (err) {
        await updateJob(jobId, {
          status: 'failed',
          current_step: '',
          result: { error: err.message, code: (err.code) || 'ERR-CV-004' },
        }).catch(() => {});
      }
    });
  } catch (err) {
    sendError(res, '/rewrite', 'ERR-CV-004', err);
  }
});

// Polling endpoint — returns status, current_step, and (when done) the result for display.
// On status === 'done': applies stored session data back onto the current session so later
// routes (/regenerate-cv, /export-word, /build-comparison) work correctly after a reload.
router.get('/job/:id/status', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found', error_code: 'ERR-CV-004', kind: 'error' });

    if (job.status === 'done') {
      const r = job.result || {};
      if (!r.error) {
        // Restore session state from the job result — safe to do on every poll because
        // assignment is idempotent and the values don't change once the job is done.
        const appSession = getSession();
        if (r.hrThread)             appSession.hrThread           = r.hrThread;
        if (r.hrDisplayHistory)     appSession.hrDisplayHistory   = r.hrDisplayHistory;
        if (r.lastGenHrCount != null) appSession.lastGenHrCount   = r.lastGenHrCount;
        if (r.lastTailoredCvData)   appSession.lastTailoredCvData = r.lastTailoredCvData;
        if (r.lastModifiedSections) appSession.lastModifiedSections = r.lastModifiedSections;
        if (r.lastTailoredJob)      appSession.lastTailoredJob    = r.lastTailoredJob;
      }
    }

    res.json({
      status: job.status,
      current_step: job.current_step || '',
      result: (job.status === 'done' || job.status === 'failed')
        ? { filePath: job.result && job.result.filePath, reviewIssues: job.result && job.result.reviewIssues, error: job.result && job.result.error, code: job.result && job.result.code }
        : null,
    });
  } catch (err) {
    sendError(res, '/job/:id/status', 'ERR-CV-004', err);
  }
});

// #29/#31: full CV regeneration from the Tailored-CV page — distinct from /adjust-language
// (which only rewords whatever is already on screen, never adding/removing content). This
// rebuilds the tailored CV from the ORIGINAL CV + job + the LATEST state of every input:
// (1) USER INPUT — current clientPreferences (tone/wording level/instructions) and each gap's
//     userDecision; (2) HR INPUT — HR's drafted gap statements (confirmedChanges, same as
//     /rewrite); (3) SIDEBAR HR INPUT — gated: only pulled if there's been new Tailored-CV
//     sidebar conversation since the last full generation (appSession.lastGenHrCount), so HR
//     never re-states discussion already incorporated into the CV that's currently on screen.
router.post('/regenerate-cv', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/regenerate-cv', 'ERR-GEN-001');
    const { job, languageLevel } = req.body;
    const targetJob = job || appSession.lastTailoredJob || appSession.currentJob;
    if (!targetJob) return sendError(res, '/regenerate-cv', 'ERR-GEN-002');
    if (languageLevel) {
      appSession.clientPreferences = { ...appSession.clientPreferences, languageLevel };
    }

    const cvText = appSession.cvText;
    const recommendedSections = (appSession.hrReview || {}).recommended_sections;
    const originalName = (appSession.cvData || {}).name;
    const autoChanges = (appSession.hrReview || {}).auto_changes || [];
    const { confirmedChanges, gapDiscussions } = buildGapInputs(getGaps());

    // Gate: only call HR about sidebar discussion if something genuinely new happened since
    // the last full generation — otherwise this step makes zero extra AI calls.
    const newSidebarMessages = (appSession.hrDisplayHistory || []).slice(appSession.lastGenHrCount || 0);
    let sidebarChange = null;
    try {
      sidebarChange = await draftFromSidebarDiscussion(cvText, targetJob, newSidebarMessages, appSession.clientPreferences);
    } catch (e) { /* best-effort — a failed sidebar-drafting call should not block the regeneration itself */ }
    const allConfirmedChanges = sidebarChange ? [...confirmedChanges, sidebarChange] : confirmedChanges;

    const { filePath, cvData, modified_sections, thread, hrDisplayHistory, review } = await tailorCvWithReview({
      cvText, job: targetJob, autoChanges, confirmedChanges: allConfirmedChanges,
      recommendedSections, originalName, confirmedContact: appSession.confirmedContact,
      thread: appSession.hrThread, preferences: appSession.clientPreferences,
      hrDisplayHistory: appSession.hrDisplayHistory, originalCvData: appSession.cvData,
      gapDiscussions,
    });
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    appSession.lastGenHrCount = hrDisplayHistory.length;
    appSession.lastTailoredCvData   = cvData;
    appSession.lastModifiedSections = modified_sections;
    appSession.lastTailoredJob      = targetJob;
    const reviewIssues = review && review.verdict === 'FIX_REQUIRED' ? review.required_edits : [];
    logEvent('cv_regenerated', { route: '/regenerate-cv', outcome: 'ok' });
    res.json({ filePath, reviewIssues });
  } catch (err) {
    sendError(res, '/regenerate-cv', 'ERR-GEN-003', err);
  }
});

router.post('/build-comparison', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.lastTailoredCvData) return sendError(res, '/build-comparison', 'ERR-CV-005');
    const job = req.body.job || appSession.lastTailoredJob;
    const comparisonHtml = generateComparisonTemplate(appSession.cvData, appSession.lastTailoredCvData, job, appSession.lastModifiedSections);
    const comparisonPath = registerOutputFile('html'); // unguessable, session-scoped — see services/session.js
    await fse.outputFile(comparisonPath, comparisonHtml);
    res.json({ comparisonPath });
  } catch (err) {
    sendError(res, '/build-comparison', 'ERR-CV-011', err);
  }
});

router.post('/export-word', async (req, res) => {
  try {
    const appSession = getSession();
    const { cvData, job, templatePath, templateStyle } = req.body;
    if (!cvData || !job) return sendError(res, '/export-word', 'ERR-CV-003');

    if (templateStyle === 'alternate') {
      const wordPath = await generateWordCVAlt(cvData, job);
      return res.json({ wordPath });
    }
    if (templateStyle === 'original') {
      return sendError(res, '/export-word', 'ERR-CV-009');
    }
    if (templatePath) {
      const resolved = path.resolve(templatePath);
      const templatesDir = path.resolve('uploads/templates');
      if (!resolved.startsWith(templatesDir)) return sendError(res, '/export-word', 'ERR-CV-006');
      const { wordPath, thread } = await generateWordFromTemplate(cvData, job, resolved, appSession.cvText, appSession.hrThread, appSession.clientPreferences);
      appSession.hrThread = thread;
      return res.json({ wordPath });
    }
    const wordPath = await generateWordCV(cvData, job);
    res.json({ wordPath });
  } catch (err) {
    sendError(res, '/export-word', 'ERR-CV-008', err);
  }
});

router.post('/adjust-language', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/adjust-language', 'ERR-CV-001');
    const { cvData, job, languageLevel } = req.body;
    if (!cvData || !job) return sendError(res, '/adjust-language', 'ERR-CV-003');
    const level = languageLevel || 2;
    const { cvData: updatedCv, templateSuggestion, filePath, thread, hrDisplayHistory } = await adjustLanguageLevel(
      appSession.cvText, job, cvData, level, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    appSession.clientPreferences = { ...appSession.clientPreferences, languageLevel: level };
    res.json({ cvData: updatedCv, templateSuggestion, filePath });
  } catch (err) {
    sendError(res, '/adjust-language', 'ERR-CV-010', err);
  }
});

router.post('/upload-template', templateUpload.single('template'), async (req, res) => {
  try {
    if (!req.file) return sendError(res, '/upload-template', 'ERR-CV-007');
    new PizZip(await fse.readFile(req.file.path));
    res.json({ templatePath: req.file.path.replace(/\\/g, '/') });
  } catch (err) {
    sendError(res, '/upload-template', 'ERR-CV-007', err);
  }
});

module.exports = router;
