const express = require('express');
const { chatWithCoach, analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('../agent');
const { getSession } = require('../services/session');
const { getGap, appendGapMessage, buildSharedGapContext } = require('../services/gapStore');
const { loadDiscipline } = require('../core/knowledge');
const { sendError } = require('../core/respondError');

const router = express.Router();

router.post('/coach/discuss', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/coach/discuss', 'ERR-COACH-001');
    const { message, gapId } = req.body;
    const gap = getGap(gapId);
    // Grounds the coach's reasoning in this candidate's discipline rubric (skills/keywords/
    // red flags a great recruiter in this field would check) instead of just the gap slogan —
    // a cheap sync file read (core/knowledge.js), no extra AI call.
    const disciplineStore = appSession.field ? loadDiscipline(appSession.field.field) : null;
    const sharedContext = buildSharedGapContext(gapId);
    const { reply, history } = await chatWithCoach(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      appSession.coachHistory, message, gap?.description, appSession.clientPreferences,
      appSession.field, disciplineStore, sharedContext
    );
    appSession.coachHistory = history;
    // Persisted server-side (services/gapStore.js) so /hr/refine can read this conversation
    // directly, instead of trusting a client-resubmitted transcript.
    if (gap) {
      appendGapMessage(gapId, 'user', message);
      appendGapMessage(gapId, 'assistant', reply);
    }
    res.json({ reply });
  } catch (err) {
    sendError(res, '/coach/discuss', 'ERR-COACH-005', err);
  }
});

router.post('/coach/analyze', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/coach/analyze', 'ERR-COACH-001');
    const { direction } = req.body;
    if (!direction) return sendError(res, '/coach/analyze', 'ERR-COACH-002');
    const result = await analyzeAndSuggestRoles(appSession.cvText, direction);
    if (!result) return sendError(res, '/coach/analyze', 'ERR-COACH-003');
    const rankedJobs = appSession.rankedJobs || [];
    const marketMatches = rankedJobs.length > 0 ? await matchRolesToMarket(result.suggested_roles, rankedJobs) : [];
    res.json({ profile: result.profile, suggestedRoles: result.suggested_roles, marketMatches });
  } catch (err) {
    sendError(res, '/coach/analyze', 'ERR-COACH-003', err);
  }
});

router.post('/coach/path', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/coach/path', 'ERR-COACH-001');
    const { roleTitle } = req.body;
    const path = await buildCareerPath(roleTitle, appSession.cvText);
    if (!path) return sendError(res, '/coach/path', 'ERR-COACH-004');
    res.json(path);
  } catch (err) {
    sendError(res, '/coach/path', 'ERR-COACH-004', err);
  }
});

module.exports = router;
