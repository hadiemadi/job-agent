const { rewriteCVWithChanges } = require('../agents/cvWriter');
const { reviewTailoredCV } = require('../agents/recruiter');

// At most two revise+review cycles after the first draft — matches the LOOP rule in
// knowledge/recruiter-core.md's PRE-RELEASE REVIEW section: "Repeat at most twice; if issues
// remain after that, surface them plainly to the candidate rather than shipping silently."
const MAX_REVISION_PASSES = 2;

// The writer (agents/cvWriter.js) and the independent reviewer (agents/recruiter.js's
// reviewTailoredCV) are now genuinely separate prompts/calls — see Task 1/2. This is the gate
// that makes that separation actually matter: every tailored CV must pass reviewTailoredCV
// before it's considered done. If the reviewer finds something (e.g. the target company name
// leaked into the summary), the required_edits are sent back to the writer as a normal
// "apply these specific changes" pass — the SAME path rewriteCVWithChanges already exposes for
// applying HR-confirmed changes — rather than a full from-scratch regeneration. If two revision
// passes still don't clear the review, the CV is returned anyway along with the unresolved
// review so the caller can surface it, rather than silently shipping or silently blocking.
async function tailorCvWithReview({
  cvText, job, autoChanges, confirmedChanges, recommendedSections, originalName,
  confirmedContact, thread, preferences, hrDisplayHistory, originalCvData, gapDiscussions, agentDecideStatements = [],
}) {
  let writerResult;
  try {
    writerResult = await rewriteCVWithChanges(
      cvText, job, autoChanges, confirmedChanges, recommendedSections, originalName,
      confirmedContact, thread, preferences, hrDisplayHistory, originalCvData, gapDiscussions, agentDecideStatements
    );
  } catch (err) { err.code = 'ERR-CV-004a'; err.stage = 'initial_draft'; throw err; }

  // Test mode: skip the review+revision loop entirely — avoids up to 5 extra API calls.
  // A truncated 600-token CV would always fail the reviewer's check, triggering all 3 passes.
  if (preferences && preferences.testMode) return { ...writerResult, review: null };

  let review;
  try {
    review = await reviewTailoredCV({ tailoredCv: writerResult.cvData, job, sourceCvText: cvText });
  } catch (err) { err.code = 'ERR-CV-004b'; err.stage = 'initial_review'; throw err; }

  let passes = 0;
  while (review.verdict === 'FIX_REQUIRED' && passes < MAX_REVISION_PASSES) {
    const requiredEditChanges = (review.required_edits || []).map(description => ({ description }));
    try {
      writerResult = await rewriteCVWithChanges(
        cvText, job, [], requiredEditChanges, recommendedSections, originalName,
        confirmedContact, writerResult.thread, preferences, writerResult.hrDisplayHistory,
        originalCvData, gapDiscussions, []
      );
    } catch (err) { err.code = 'ERR-CV-004c'; err.stage = `revision_draft_${passes + 1}`; throw err; }
    try {
      review = await reviewTailoredCV({ tailoredCv: writerResult.cvData, job, sourceCvText: cvText });
    } catch (err) { err.code = 'ERR-CV-004d'; err.stage = `revision_review_${passes + 1}`; throw err; }
    passes += 1;
  }

  return { ...writerResult, review };
}

module.exports = { tailorCvWithReview };
