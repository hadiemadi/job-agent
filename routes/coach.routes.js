const express = require('express');
const { chatWithCoach, analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('../agent');
const { getSession } = require('../services/session');
const { getGap, appendGapMessage } = require('../services/gapStore');
const { loadDiscipline } = require('../core/knowledge');

const router = express.Router();

router.post('/coach/discuss', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { message, gapId } = req.body;
    const gap = getGap(gapId);
    // Grounds the coach's reasoning in this candidate's discipline rubric (skills/keywords/
    // red flags a great recruiter in this field would check) instead of just the gap slogan —
    // a cheap sync file read (core/knowledge.js), no extra AI call.
    const disciplineStore = appSession.field ? loadDiscipline(appSession.field.field) : null;
    const { reply, history } = await chatWithCoach(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      appSession.coachHistory, message, gap?.description, appSession.clientPreferences,
      appSession.field, disciplineStore
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
    res.status(500).json({ error: err.message });
  }
});

router.post('/coach/analyze', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { direction } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction is required.' });
    const result = await analyzeAndSuggestRoles(appSession.cvText, direction);
    if (!result) return res.status(500).json({ error: 'Analysis failed.' });
    const rankedJobs = appSession.rankedJobs || [];
    const marketMatches = rankedJobs.length > 0 ? await matchRolesToMarket(result.suggested_roles, rankedJobs) : [];
    res.json({ profile: result.profile, suggestedRoles: result.suggested_roles, marketMatches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/coach/path', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { roleTitle } = req.body;
    const path = await buildCareerPath(roleTitle, appSession.cvText);
    if (!path) return res.status(500).json({ error: 'Path analysis failed.' });
    res.json(path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
