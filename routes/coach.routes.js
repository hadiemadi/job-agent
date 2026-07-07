const express = require('express');
const { chatWithCoach, analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('../agent');
const { getSession } = require('../services/session');
const { getGap, appendGapMessage, buildSharedGapContext } = require('../services/gapStore');
const { loadDiscipline } = require('../core/knowledge');
const { sendError } = require('../core/respondError');
const { saveCoachMemory, upsertGapMemory, findGapMemoryBySlogan } = require('../services/auth');

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
    // Before the first coach reply in a NEW gap chat, check for prior history from previous
    // sessions. The coach agent itself judges relevance — no hardcoded template forces a reference.
    let priorGapHistory = null;
    if (appSession.userId && gap && gap.coachConversation.length === 0) {
      try {
        const prior = await findGapMemoryBySlogan(appSession.userId, gap.description);
        if (prior && (
          (Array.isArray(prior.coach_conversation) && prior.coach_conversation.length > 0) ||
          prior.hr_statement || prior.user_decision
        )) {
          priorGapHistory = prior;
        }
      } catch (e) { /* best-effort — never block coach chat on DB errors */ }
    }
    const { reply, history } = await chatWithCoach(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      appSession.coachHistory, message, gap?.description, appSession.clientPreferences,
      appSession.field, disciplineStore, sharedContext, priorGapHistory
    );
    appSession.coachHistory = history;
    // Persisted server-side (services/gapStore.js) so /hr/refine can read this conversation
    // directly, instead of trusting a client-resubmitted transcript.
    if (gap) {
      appendGapMessage(gapId, 'user', message);
      appendGapMessage(gapId, 'assistant', reply);
    }
    // Persist the new turns to gap_memory (fire-and-forget — never blocks the response).
    // Only the 2 new turns are written; the upsert APPENDS them to the stored conversation.
    if (appSession.userId && gap) {
      const lastCoachTurn = gap.coachConversation.slice().reverse().find(m => m.role === 'assistant');
      upsertGapMemory(appSession.userId, {
        gapSlogan: gap.description,
        coachConversation: [{ role: 'user', content: message }, { role: 'assistant', content: reply }],
        coachVerdict: lastCoachTurn ? lastCoachTurn.content : null,
        hrStatement: null,
        userDecision: null,
      }).catch(e => console.warn('[upsertGapMemory/coach] write failed:', e.message));
    }
    if (appSession.userId) {
      saveCoachMemory(appSession.userId, {
        gapTopic: gap?.description || 'coach',
        digestSummary: reply.slice(0, 300),
        rawLog: { message, reply },
      }).catch(e => console.warn('[saveCoachMemory] write failed:', e.message));
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
    if (appSession.userId) {
      const topRole = (result.suggested_roles || [])[0];
      saveCoachMemory(appSession.userId, {
        gapTopic: direction,
        digestSummary: topRole ? topRole.title : direction,
        rawLog: { direction, suggestedRoles: result.suggested_roles },
      }).catch(e => console.warn('[saveCoachMemory] write failed:', e.message));
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
    const path = await buildCareerPath(roleTitle, appSession.cvText);
    if (!path) return sendError(res, '/coach/path', 'ERR-COACH-004');
    res.json(path);
  } catch (err) {
    sendError(res, '/coach/path', 'ERR-COACH-004', err);
  }
});

module.exports = router;
