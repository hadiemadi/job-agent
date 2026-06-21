// The app has exactly one in-memory session (single-user, no accounts yet — see CLAUDE.md
// Phase 5 roadmap for multi-user/database work). Originally `server.js` held this as a
// module-level `let appSession`, reassigned wholesale by some routes (e.g. /upload-cv) and
// mutated in place by others. Splitting routes into routes/*.js means that mutable variable
// can no longer just be a top-level `let` in one file — `getSession`/`setSession` give every
// route module access to the SAME object, in a way that survives both styles: call
// `getSession().field = x` for an in-place mutation, or `setSession({...})` for a full
// replacement (exactly matching what the route did before the split).
let appSession = {
  cvText: null, cvPath: null, cvData: null,
  jobs: null, rankedJobs: null,
  currentJob: null, hrReview: null,
  coachHistory: [], hrThread: [], hrDisplayHistory: [],
  confirmedContact: null,
  clientPreferences: {
    tone: 4, customInstructions: '', languageLevel: 2, extensiveSearch: false, conventionsResearch: '',
    gapSeverities: ['major', 'mild', 'minor'], refreshDiscipline: false, routedInstruction: null, routedInstructionApplied: false,
  },
};

function getSession() {
  return appSession;
}

function setSession(next) {
  appSession = next;
  return appSession;
}

module.exports = { getSession, setSession };
