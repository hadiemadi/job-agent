'use strict';
const express = require('express');
const { coachAgent } = require('../agent');
const { getSession } = require('../services/session');
const { getGap, appendGapMessage, buildSharedGapContext } = require('../services/gapStore');
const { loadDiscipline } = require('../core/knowledge');
const { sendError } = require('../core/respondError');
const { upsertGapMemory, findGapMemoryBySlogan } = require('../services/auth');

const router = express.Router();

router.post('/coach/discuss', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/coach/discuss', 'ERR-COACH-001');
    const { message, gapId } = req.body;
    const gap = getGap(gapId);
    const disciplineStore = appSession.field ? loadDiscipline(appSession.field.field) : null;
    const sharedContext = buildSharedGapContext(gapId);
    // On the first coach turn for a new gap, check for prior history from previous sessions.
    let priorGapHistory = null;
    if (appSession.userId && gap && gap.coachConversation.length === 0) {
      try {
        const prior = await findGapMemoryBySlogan(appSession.userId, gap.description, appSession.tailoringRunId);
        if (prior && (
          (Array.isArray(prior.coach_conversation) && prior.coach_conversation.length > 0) ||
          prior.hr_statement || prior.user_decision
        )) {
          priorGapHistory = prior;
        }
      } catch (e) { /* best-effort — never block coach chat on DB errors */ }
    }
    const { reply, thread } = await coachAgent('chat', {
      cvText: appSession.cvText,
      job: appSession.currentJob,
      hrReview: appSession.hrReview,
      coachThread: appSession.coachHistory,
      userMessage: message,
      gapDescription: gap?.description,
      preferences: appSession.clientPreferences,
      field: appSession.field,
      disciplineStore,
      sharedContext,
      priorGapHistory,
    });
    appSession.coachHistory = thread;
    if (gap) {
      appendGapMessage(gapId, 'user', message);
      appendGapMessage(gapId, 'assistant', reply);
    }
    if (appSession.userId && gap) {
      const lastCoachTurn = gap.coachConversation.slice().reverse().find(m => m.role === 'assistant');
      upsertGapMemory(appSession.userId, {
        gapSlogan: gap.description,
        coachConversation: [{ role: 'user', content: message }, { role: 'assistant', content: reply }],
        coachVerdict: lastCoachTurn ? lastCoachTurn.content : null,
        hrStatement: null,
        userDecision: null,
        tailoringRunId: appSession.tailoringRunId,
      }).catch(e => console.warn('[upsertGapMemory/coach] write failed:', e.message));
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

    const rolesResult = await coachAgent('suggest-roles', {
      cvText: appSession.cvText,
      coachThread: appSession.coachHistory,
      direction,
    });
    if (!rolesResult.structured) return sendError(res, '/coach/analyze', 'ERR-COACH-003');
    appSession.coachHistory = rolesResult.thread;
    const result = rolesResult.structured;

    const rankedJobs = appSession.rankedJobs || [];
    let marketMatches = [];
    if (rankedJobs.length > 0) {
      const matchResult = await coachAgent('match-market', {
        coachThread: appSession.coachHistory,
        suggestedRoles: result.suggested_roles,
        rankedJobs,
      });
      appSession.coachHistory = matchResult.thread;
      marketMatches = matchResult.structured || [];
    }

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
    const pathResult = await coachAgent('build-path', {
      cvText: appSession.cvText,
      coachThread: appSession.coachHistory,
      roleTitle,
    });
    if (!pathResult.structured) return sendError(res, '/coach/path', 'ERR-COACH-004');
    appSession.coachHistory = pathResult.thread;
    res.json(pathResult.structured);
  } catch (err) {
    sendError(res, '/coach/path', 'ERR-COACH-004', err);
  }
});

module.exports = router;
