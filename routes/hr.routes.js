const express = require('express');
const {
  reviewCV, analyzeGaps, selectTopGaps, researchCvConventions, pinDisciplineSkill,
  generateCoverLetter, generateInterviewQuestions, refineWithHR, chatWithHRExpert, applyConcernChange,
} = require('../agent');
const { generateCoverLetterWord } = require('../src/wordExport');
const { getSession } = require('../services/session');
const { setGaps, getGap, proposeStatement, setUserDecision } = require('../services/gapStore');

const router = express.Router();

router.post('/review-cv', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { job } = req.body;
    if (!job) return res.status(400).json({ error: 'job is required.' });
    // Opt-in live research into this job's country/industry-specific CV conventions — runs
    // once per job, then cached on clientPreferences so every later HR-thread call (rewrite,
    // refine, sidebar chat, Word placement) reuses it without re-searching.
    if (appSession.clientPreferences?.extensiveSearch && !appSession.clientPreferences.conventionsResearch) {
      try {
        const conventionsResearch = await researchCvConventions(job, appSession.cvText);
        appSession.clientPreferences = { ...appSession.clientPreferences, conventionsResearch };
      } catch (e) { /* research is best-effort — fall back to the model's own knowledge */ }
    }
    // HR review (auto_changes + section decisions) and the Coach's gap analysis run in
    // parallel — gap-finding is the Coach's job (analyzeGaps casts wide, up to 20 candidates,
    // severity-scored); selectTopGaps then picks at least 5 worth actually asking the
    // candidate about, instead of HR trying to do both jobs in one pass.
    const [{ review, field, thread }, gaps] = await Promise.all([
      reviewCV(appSession.cvText, job, [], appSession.clientPreferences),
      analyzeGaps(appSession.cvText, job),
    ]);
    // Once the candidate's field is known, apply any discipline-bucket comment from the
    // contact page — pinned in as a trusted fact for this and future reviews. Applied once
    // per contact confirmation (routedInstructionApplied), not on every repeated review.
    const { routedInstruction, routedInstructionApplied } = appSession.clientPreferences;
    if (field?.field && routedInstruction?.bucket === 'discipline' && routedInstruction.text && !routedInstructionApplied) {
      pinDisciplineSkill(field, routedInstruction.text);
      appSession.clientPreferences = { ...appSession.clientPreferences, routedInstructionApplied: true };
    }
    // Gaps are persisted server-side (services/gapStore.js) with a stable id each — replaces
    // the old design where accept/skip/discuss state lived only in the browser until /rewrite.
    const selected = selectTopGaps(gaps, appSession.clientPreferences.gapSeverities);
    const gapRecords = setGaps(selected);
    const fullReview = {
      ...review,
      confirm_changes: gapRecords.map(g => ({
        id: g.id, description: g.description, rationale: g.rationale, severity: g.severity,
        status: g.status, proposedStatement: g.proposedStatement,
        userDecision: g.userDecision, hrConclusion: g.hrConclusion,
      })),
    };
    appSession.currentJob = job;
    appSession.hrReview = fullReview;
    appSession.hrThread = thread;
    // Persisted so /coach/discuss can ground its reasoning in this candidate's discipline
    // rubric (services/curator.js's knowledge store) instead of just the gap slogan — see
    // agents/coach.js's chatWithCoach.
    appSession.field = field || null;
    res.json(fullReview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate-cover-letter', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { cvData, job } = req.body;
    if (!cvData || !job) return res.status(400).json({ error: 'cvData and job are required.' });
    const { coverLetter, thread, hrDisplayHistory } = await generateCoverLetter(
      appSession.cvText, job, cvData, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    res.json({ coverLetter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/export-cover-letter-word', async (req, res) => {
  try {
    const { coverLetter, cvData, job } = req.body;
    if (!coverLetter || !cvData || !job) return res.status(400).json({ error: 'coverLetter, cvData and job are required.' });
    const wordPath = await generateCoverLetterWord(coverLetter, cvData, job);
    res.json({ wordPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate-interview-questions', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { cvData, job } = req.body;
    if (!cvData || !job) return res.status(400).json({ error: 'cvData and job are required.' });
    const { questions, hrMessage, thread, hrDisplayHistory } = await generateInterviewQuestions(
      appSession.cvText, job, cvData, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    res.json({ questions, hrMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HR drafts ONE concrete CV-ready sentence for this gap — allowed whether or not the candidate
// discussed it with the coach first (coach discussion is optional, see agents/coach.js), and
// re-askable any time, including after a decision has already been made (the card v2 "re-ask
// HR pulls latest coach chat" flow — gap.coachConversation is always read fresh here, so a
// re-draft naturally reflects whatever was discussed since the last draft). HR leans 'add' or
// 'leave-out' with one reason — that lean is informational only, stored in hrConclusion; it
// never sets the candidate's own userDecision (services/gapStore.js's proposeStatement always
// resets userDecision to 'undecided' on a fresh draft, since a prior decision was made against
// a now-superseded sentence).
router.post('/hr/refine', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { gapId } = req.body;
    const gap = getGap(gapId);
    if (!gap) return res.status(400).json({ error: 'Gap not found.' });
    const { result, thread } = await refineWithHR(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      gap, gap.coachConversation, appSession.hrThread, appSession.clientPreferences
    );
    appSession.hrThread = thread;
    const updated = proposeStatement(gapId, result.refined_description, { rationale: result.rationale, lean: result.lean });
    if (!updated) return res.status(400).json({ error: 'Gap not found.' });
    res.json({ proposedStatement: updated.proposedStatement, rationale: result.rationale, lean: result.lean, status: updated.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The Add-to-CV / Leave-out buttons on a gap card — the only way a gap's userDecision changes
// server-side. /rewrite reads this directly instead of trusting a client-submitted decision
// list. 'added' is guarded to gaps that actually have a drafted statement — there must be
// something concrete to add. 'left-out' is always available (the candidate can walk away from
// a gap at any point, with or without ever asking HR to draft anything). Neither is terminal —
// changing (overriding) an existing decision is allowed and expected.
router.post('/gap-decision', (req, res) => {
  const { gapId, decision } = req.body;
  if (!['added', 'left-out'].includes(decision)) return res.status(400).json({ error: 'decision must be "added" or "left-out".' });
  const gap = setUserDecision(gapId, decision);
  if (!gap) {
    return res.status(400).json({
      error: decision === 'added'
        ? 'This gap has no drafted statement yet — ask HR to draft one first.'
        : 'Gap not found.',
    });
  }
  res.json({ ok: true, userDecision: gap.userDecision });
});

router.post('/hr/chat', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { message, model, concern } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required.' });
    // When the candidate selected a CV snippet to discuss, ground every turn in that exact
    // text and — on the first turn only — instruct HR to quote it back, confirming it
    // understood what's being raised before responding.
    let finalMessage = message;
    if (concern && concern.selectedText) {
      finalMessage = `[Discussing this CV excerpt: "${concern.selectedText}"]\n\n${message}` +
        (concern.isFirst ? '\n\n(This is the start of this discussion — first briefly quote or restate the excerpt above to confirm you understood what they\'re referring to, then respond to their point.)' : '');
    }
    const { reply, thread } = await chatWithHRExpert(
      appSession.cvText, appSession.currentJob, appSession.hrThread, finalMessage, model, appSession.clientPreferences
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = [...appSession.hrDisplayHistory, { role: 'user', text: message }, { role: 'expert', text: reply }];
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/hr/apply-concern', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { job, fieldText, selectedText } = req.body;
    if (!fieldText || !selectedText) return res.status(400).json({ error: 'fieldText and selectedText are required.' });
    const { revisedText, changed, thread } = await applyConcernChange(
      appSession.cvText, job || appSession.currentJob, fieldText, selectedText, appSession.hrThread, appSession.clientPreferences
    );
    appSession.hrThread = thread;
    res.json({ revisedText, changed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
