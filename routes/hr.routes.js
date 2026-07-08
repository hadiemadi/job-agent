const express = require('express');
const {
  reviewCV, analyzeGaps, selectTopGaps, researchCvConventions, pinDisciplineSkill,
  generateCoverLetter, generateInterviewQuestions, refineWithHR, chatWithHRExpert, applyConcernChange,
} = require('../agent');
const { generateCoverLetterWord } = require('../src/wordExport');
const { getSession, als } = require('../services/session');
const { setGaps, getGap, proposeStatement, setUserDecision, buildSharedGapContext } = require('../services/gapStore');
const { createJob, updateJob } = require('../services/jobQueue');
const { sendError } = require('../core/respondError');
const { logEvent, logDiagnostic } = require('../core/logger');
const { saveProfilePreferences, getProfilePreferences, saveConversationHistory, upsertGapMemory } = require('../services/auth');

// Builds the profile-preferences snapshot from the current session state — used by both the
// confirm-contact save and the HR-completion safety upsert to guarantee they write the same shape.
function buildProfilePrefs(session) {
  const c = session.confirmedContact || {};
  const p = session.clientPreferences || {};
  return {
    name: c.name || '', title: c.title || '', phone: c.phone || '',
    location: c.location || '', linkedin: c.linkedin || '',
    customInstructions: p.customInstructions || '',
    tone: p.tone || 4,
    gapSeverities: p.gapSeverities || ['major'],
    extensiveSearch: !!p.extensiveSearch,
    refreshDiscipline: !!p.refreshDiscipline,
  };
}

const router = express.Router();

router.post('/review-cv', async (req, res) => {
  try {
    const appSession = getSession();
    logDiagnostic('/review-cv.session_check', {
      hasCvText: !!(appSession && appSession.cvText),
      hasCurrentJob: !!(appSession && appSession.currentJob),
      hasHrReview: !!(appSession && appSession.hrReview),
      hasStepTimestamps: !!(appSession && appSession.stepTimestamps && Object.keys(appSession.stepTimestamps).length > 0),
    });
    if (!appSession.cvText) return sendError(res, '/review-cv', 'ERR-HR-001');
    const { job } = req.body;
    if (!job) return sendError(res, '/review-cv', 'ERR-HR-002');

    // Snapshot immutable inputs before response ends the request scope.
    const cvText = appSession.cvText;
    // #29/#31: lastGenHrCount tracks sidebar entries as of the last full generation — capture
    // the current length now so a later /rewrite knows which sidebar exchanges are new.
    const initialLastGenHrCount = (appSession.hrDisplayHistory || []).length;

    const jobId = await createJob('hr_review');
    // Capture the session id before res.json() so the background task can re-pin it via
    // als.run(sid, fn) — same pattern as /rewrite.
    const sid = als.getStore();
    res.json({ jobId });

    als.run(sid, async () => {
      try {
        await updateJob(jobId, { status: 'running', current_step: 'HR Review' });

        // Opt-in live research — mutates appSession.clientPreferences in place so the
        // subsequent reviewCV call picks it up via the live session reference.
        if (appSession.clientPreferences?.extensiveSearch && !appSession.clientPreferences.conventionsResearch) {
          try {
            const conventionsResearch = await researchCvConventions(job, cvText);
            appSession.clientPreferences = { ...appSession.clientPreferences, conventionsResearch };
          } catch (e) { /* best-effort — fall back to the model's own knowledge */ }
        }

        // HR review and gap analysis run in parallel (same logic as the old sync route).
        const [{ review, field, thread }, gaps] = await Promise.all([
          reviewCV(cvText, job, [], appSession.clientPreferences),
          analyzeGaps(cvText, job),
        ]);

        // Apply discipline-bucket comment from the contact page once the field is known.
        const { routedInstruction, routedInstructionApplied } = appSession.clientPreferences || {};
        if (field?.field && routedInstruction?.bucket === 'discipline' && routedInstruction.text && !routedInstructionApplied) {
          pinDisciplineSkill(field, routedInstruction.text);
          appSession.clientPreferences = { ...appSession.clientPreferences, routedInstructionApplied: true };
        }

        const selected = selectTopGaps(gaps, (appSession.clientPreferences || {}).gapSeverities);
        // setGaps writes to appSession.gaps (via getSession() in the als context) and returns
        // the created gap objects with their stable server-assigned ids.
        const gapRecords = setGaps(selected);
        const fullReview = {
          ...review,
          confirm_changes: gapRecords.map(g => ({
            id: g.id, description: g.description, rationale: g.rationale, severity: g.severity,
            status: g.status, proposedStatement: g.proposedStatement,
            userDecision: g.userDecision, hrConclusion: g.hrConclusion,
            targetSection: g.hrConclusion ? g.hrConclusion.targetSection : null,
            hrStatement: g.hrConclusion ? g.hrConclusion.statement : null,
          })),
        };

        appSession.currentJob = job;
        appSession.hrReview = fullReview;
        appSession.hrThread = thread;
        appSession.lastGenHrCount = initialLastGenHrCount;
        appSession.field = field || null;

        // Store everything needed to restore state after a tab-close/reload — the
        // GET /job/:id/status handler applies these to the session on each poll so
        // downstream routes (/rewrite, /hr/refine, /gap-decision) still work correctly.
        // gapRecords carries the gap objects with their already-assigned ids so the
        // status handler can restore them directly without calling setGaps (which would
        // create new ids and break any gap-id references the frontend already holds).
        await updateJob(jobId, {
          status: 'done', current_step: '',
          result: {
            hrReview: fullReview,
            hrThread: thread,
            currentJob: job,
            field: field || null,
            lastGenHrCount: initialLastGenHrCount,
            gapRecords: appSession.gaps,
          },
        });

        appSession.stepTimestamps = { ...(appSession.stepTimestamps || {}), hrReviewCompletedAt: Date.now() };
        logEvent('hr_review_run', { route: '/review-cv', outcome: 'ok' });

        // Safety upsert: keep profile preferences in sync with whatever the user confirmed this
        // session. Runs after every HR review so the DB stays current even in edge cases (e.g.
        // mid-session login after confirm-contact, or a DB hiccup during the confirm-contact save).
        // Guards on confirmedContact being present — if the user somehow reached HR review without
        // going through confirm-contact (shouldn't happen in normal flow), skip silently.
        if (appSession.userId && appSession.confirmedContact) {
          const sessionPrefs = buildProfilePrefs(appSession);
          const existingPrefs = await getProfilePreferences(appSession.userId).catch(() => null);
          if (existingPrefs) {
            const differs = Object.keys(sessionPrefs).some(
              k => JSON.stringify(existingPrefs[k]) !== JSON.stringify(sessionPrefs[k])
            );
            if (differs) {
              console.warn('[profile-prefs] HR-completion upsert: session differs from DB — last write wins (session)', { userId: appSession.userId });
            }
          }
          saveProfilePreferences(appSession.userId, sessionPrefs).catch(() => {});
        }
      } catch (err) {
        await updateJob(jobId, {
          status: 'failed', current_step: '',
          result: { error: err.message, code: (err.code) || 'ERR-HR-003' },
        }).catch(() => {});
      }
    });
  } catch (err) {
    sendError(res, '/review-cv', 'ERR-HR-003', err);
  }
});

router.post('/generate-cover-letter', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/generate-cover-letter', 'ERR-HR-001');
    const { cvData, job } = req.body;
    if (!cvData || !job) return sendError(res, '/generate-cover-letter', 'ERR-CV-003');
    const { coverLetter, thread, hrDisplayHistory } = await generateCoverLetter(
      appSession.cvText, job, cvData, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    res.json({ coverLetter });
  } catch (err) {
    sendError(res, '/generate-cover-letter', 'ERR-HR-009', err);
  }
});

router.post('/export-cover-letter-word', async (req, res) => {
  try {
    const { coverLetter, cvData, job } = req.body;
    if (!coverLetter || !cvData || !job) return sendError(res, '/export-cover-letter-word', 'ERR-CV-003');
    const wordPath = await generateCoverLetterWord(coverLetter, cvData, job);
    res.json({ wordPath });
  } catch (err) {
    sendError(res, '/export-cover-letter-word', 'ERR-CV-008', err);
  }
});

router.post('/generate-interview-questions', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/generate-interview-questions', 'ERR-HR-001');
    const { cvData, job } = req.body;
    if (!cvData || !job) return sendError(res, '/generate-interview-questions', 'ERR-CV-003');
    const { questions, hrMessage, thread, hrDisplayHistory } = await generateInterviewQuestions(
      appSession.cvText, job, cvData, appSession.hrThread, appSession.clientPreferences, appSession.hrDisplayHistory
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = hrDisplayHistory;
    res.json({ questions, hrMessage });
  } catch (err) {
    sendError(res, '/generate-interview-questions', 'ERR-HR-010', err);
  }
});

// HR drafts ONE concrete CV-ready sentence for this gap — allowed whether or not the candidate
// discussed it with the coach first (coach discussion is optional, see agents/coach.js), and
// re-askable any time, including after a decision has already been made (the card v2 "re-ask
// HR pulls latest coach chat" flow — gap.coachConversation is always read fresh here, so a
// re-draft naturally reflects whatever was discussed since the last draft). HR only ever
// receives Coach's FINAL takeaway for this gap (#26) — never the raw conversation — plus a
// compact cross-gap summary (buildSharedGapContext) so HR stays consistent with what's already
// been decided elsewhere in this review. HR leans 'add' or 'leave-out' with one reason — that
// lean is informational only, stored in hrConclusion; it never sets the candidate's own
// userDecision (services/gapStore.js's proposeStatement always resets userDecision to
// 'undecided' on a fresh draft, since a prior decision was made against a now-superseded
// sentence).
router.post('/hr/refine', async (req, res) => {
  try {
    const appSession = getSession();
    logDiagnostic('/hr/refine.session_check', {
      hasCvText: !!(appSession && appSession.cvText),
      hasCurrentJob: !!(appSession && appSession.currentJob),
      hasHrReview: !!(appSession && appSession.hrReview),
      hasStepTimestamps: !!(appSession && appSession.stepTimestamps && Object.keys(appSession.stepTimestamps).length > 0),
      gapsCount: (appSession && appSession.gaps || []).length,
    });
    if (!appSession.cvText) return sendError(res, '/hr/refine', 'ERR-HR-001');
    const { gapId } = req.body;
    const gap = getGap(gapId);
    if (!gap) return sendError(res, '/hr/refine', 'ERR-HR-004');
    // HR only ever sees Coach's FINAL takeaway for this gap (the last assistant turn) — never
    // the raw back-and-forth. Coach's own full conversation stays visible to Coach only.
    const lastCoachTurn = [...(gap.coachConversation || [])].reverse().find(m => m.role === 'assistant');
    const coachFinalStatement = lastCoachTurn ? lastCoachTurn.content : null;
    const sharedContext = buildSharedGapContext(gapId);
    // Diagnostic: capture input state at /hr/refine call time to isolate ERR-HR-005 root causes.
    logDiagnostic('/hr/refine.pre_call', {
      hasCvText: !!appSession.cvText,
      hasCurrentJob: !!(appSession.currentJob),
      hasHrReview: !!(appSession.hrReview),
      gapPresent: !!gap,
      gapHasDescription: !!(gap && gap.description),
      coachStatementPresent: !!coachFinalStatement,
      timeSinceHrReviewMs: appSession.stepTimestamps?.hrReviewCompletedAt
        ? Date.now() - appSession.stepTimestamps.hrReviewCompletedAt : null,
    });
    const { result, thread } = await refineWithHR(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      gap, coachFinalStatement, appSession.hrThread, appSession.clientPreferences, sharedContext
    );
    appSession.hrThread = thread;
    // #30: the candidate-facing advice line is always this fixed 1-2 line shape — built here,
    // deterministically, from the model's own structured fields, rather than trusting the model
    // to format it consistently itself.
    const hrStatement = result.lean === 'add'
      ? `Add to your ${result.targetSection || 'CV'} section: ${result.refined_description}`
      : `Leave this out — ${result.rationale}`;
    const updated = proposeStatement(gapId, result.refined_description, {
      rationale: result.rationale, lean: result.lean, targetSection: result.targetSection || null, statement: hrStatement,
    });
    if (!updated) return sendError(res, '/hr/refine', 'ERR-HR-004');
    if (appSession.userId) {
      upsertGapMemory(appSession.userId, {
        gapSlogan: gap.description,
        coachConversation: [],
        coachVerdict: null,
        hrStatement,
        userDecision: null,
      }).catch(e => console.warn('[upsertGapMemory/hr] write failed:', e.message));
    }
    res.json({
      proposedStatement: updated.proposedStatement, rationale: result.rationale, lean: result.lean,
      targetSection: result.targetSection || null, hrStatement, status: updated.status,
    });
  } catch (err) {
    sendError(res, '/hr/refine', 'ERR-HR-005', err);
  }
});

// The Add-to-CV / Leave-out buttons on a gap card — the only way a gap's userDecision changes
// server-side. /rewrite reads this directly instead of trusting a client-submitted decision
// list. 'added' is guarded to gaps that actually have a drafted statement — there must be
// something concrete to add. 'left-out' is always available (the candidate can walk away from
// a gap at any point, with or without ever asking HR to draft anything). Neither is terminal —
// changing (overriding) an existing decision is allowed and expected.
router.post('/gap-decision', (req, res) => {
  const appSession = getSession();
  const { gapId, decision } = req.body;
  if (!['added', 'left-out'].includes(decision)) return sendError(res, '/gap-decision', 'ERR-GAP-001');
  const gap = setUserDecision(gapId, decision);
  if (!gap) return sendError(res, '/gap-decision', decision === 'added' ? 'ERR-GAP-002' : 'ERR-GAP-003');
  logEvent('gap_decided', { route: '/gap-decision', outcome: 'ok' });
  if (appSession.userId) {
    upsertGapMemory(appSession.userId, {
      gapSlogan: gap.description,
      coachConversation: [],
      coachVerdict: null,
      hrStatement: null,
      userDecision: gap.userDecision,
    }).catch(e => console.warn('[upsertGapMemory/decision] write failed:', e.message));
  }
  res.json({ ok: true, userDecision: gap.userDecision });
});

router.post('/hr/chat', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/hr/chat', 'ERR-HR-001');
    const { message, model, concern } = req.body;
    if (!message) return sendError(res, '/hr/chat', 'ERR-HR-006');
    // When the candidate selected a CV snippet to discuss, ground every turn in that exact
    // text and — on the first turn only — instruct HR to quote it back, confirming it
    // understood what's being raised before responding.
    let finalMessage = message;
    if (concern && concern.selectedText) {
      finalMessage = `[Discussing this CV excerpt: "${concern.selectedText}"]\n\n${message}` +
        (concern.isFirst ? '\n\n(This is the start of this discussion — first briefly quote or restate the excerpt above to confirm you understood what they\'re referring to, then respond to their point.)' : '');
    }
    const { reply, thread } = await chatWithHRExpert(
      appSession.cvText, appSession.currentJob, appSession.hrThread, finalMessage, model, appSession.clientPreferences,
      buildSharedGapContext(null)
    );
    appSession.hrThread = thread;
    appSession.hrDisplayHistory = [...appSession.hrDisplayHistory, { role: 'user', text: message }, { role: 'expert', text: reply }];
    if (appSession.userId) {
      saveConversationHistory(appSession.userId, {
        agent: 'hr',
        gapTopic: concern?.selectedText?.slice(0, 100) || null,
        digestSummary: reply.slice(0, 300),
        rawLog: { message, reply },
      }).catch(e => console.warn('[saveConversationHistory] write failed:', e.message));
    }
    res.json({ reply });
  } catch (err) {
    sendError(res, '/hr/chat', 'ERR-HR-007', err);
  }
});

router.post('/hr/apply-concern', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.cvText) return sendError(res, '/hr/apply-concern', 'ERR-HR-001');
    const { job, fieldText, selectedText } = req.body;
    if (!fieldText || !selectedText) return sendError(res, '/hr/apply-concern', 'ERR-HR-011');
    const { revisedText, changed, thread } = await applyConcernChange(
      appSession.cvText, job || appSession.currentJob, fieldText, selectedText, appSession.hrThread, appSession.clientPreferences,
      buildSharedGapContext(null)
    );
    appSession.hrThread = thread;
    res.json({ revisedText, changed });
  } catch (err) {
    sendError(res, '/hr/apply-concern', 'ERR-HR-008', err);
  }
});

module.exports = router;
