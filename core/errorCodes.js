'use strict';

// Central catalog of stable, support-facing error codes. Each code maps to a human message
// (shown to the candidate), an HTTP status, an area (which part of the app it came from), and
// a `kind`:
//   - 'error'      a real failure (agent call rejected, DB/network issue, bug) — shown as the
//                   full "Something went wrong" dialog with the technical/copyable block.
//   - 'validation' the app is just missing an input or being called out of order (no CV yet,
//                   no job chosen, gap not drafted yet) — shown as a friendly, non-alarming
//                   nudge instead (see public/app.js's showValidationNudge). These are
//                   expected, recoverable, and not worth a support-style error report.
//   - 'rate'       a real operating constraint was hit (burst limiter or daily budget) — shown
//                   as a calm "wait and retry" overlay (burst) or "try tomorrow" note (daily
//                   cap). Not a bug, not missing input — no red, no support line.
// Routes attach a code to every error response (see core/respondError.js's sendError) so a
// candidate can report "ERR-CV-004" to support instead of a screenshot of a stack trace.
//
// Judgment call: the spec named ERR-CV/HR/COACH/GAP/GEN/RATE/SYS areas explicitly. Job search/
// job-description fetching (routes/jobs.routes.js) didn't fit any of those cleanly, so a
// matching ERR-JOB-### area was added rather than mis-filing job-search errors under ERR-CV.
const ERROR_CODES = {
  // ERR-CV-### — CV upload, parsing, tailoring, export (routes/cv.routes.js)
  'ERR-CV-001': { area: 'CV', status: 400, kind: 'validation', message: 'Please upload your CV before continuing.' },
  'ERR-CV-002': { area: 'CV', status: 500, kind: 'error', message: 'We could not read your CV file. Please try a different file.' },
  'ERR-CV-003': { area: 'CV', status: 400, kind: 'validation', message: 'CV data and job details are required for this step.' },
  'ERR-CV-004': { area: 'CV', status: 500, kind: 'error', message: 'Tailoring your CV failed. Please try again.' },
  'ERR-CV-005': { area: 'CV', status: 400, kind: 'validation', message: 'There is no tailored CV yet to compare against.' },
  'ERR-CV-006': { area: 'CV', status: 400, kind: 'error', message: 'That Word template could not be found.' },
  'ERR-CV-007': { area: 'CV', status: 400, kind: 'validation', message: 'That file is not a valid Word (.docx) template.' },
  'ERR-CV-008': { area: 'CV', status: 500, kind: 'error', message: 'Exporting your CV to Word failed. Please try again.' },
  'ERR-CV-009': { area: 'CV', status: 501, kind: 'validation', message: "Style mimicry from your original CV isn't available yet — your CV was read as a PDF. Use 'Upload your own template' instead." },
  'ERR-CV-010': { area: 'CV', status: 500, kind: 'error', message: 'Adjusting the wording level failed. Please try again.' },
  'ERR-CV-011': { area: 'CV', status: 500, kind: 'error', message: 'Building the comparison view failed. Please try again.' },
  'ERR-CV-012': { area: 'CV', status: 400, kind: 'validation', message: 'Your session may have expired. Please restart the CV tailoring process.' },

  // ERR-HR-### — HR review/refine/chat routes + agents/recruiter.js
  'ERR-HR-001': { area: 'HR', status: 400, kind: 'validation', message: 'Please upload your CV before requesting an HR review.' },
  'ERR-HR-002': { area: 'HR', status: 400, kind: 'validation', message: 'A job is required for the HR review.' },
  'ERR-HR-003': { area: 'HR', status: 500, kind: 'error', message: 'The HR review failed. Please try again.' },
  'ERR-HR-004': { area: 'HR', status: 400, kind: 'validation', message: 'That gap could not be found — try refreshing the review.' },
  'ERR-HR-005': { area: 'HR', status: 500, kind: 'error', message: 'HR could not draft a statement for that gap. Please try again.' },
  'ERR-HR-006': { area: 'HR', status: 400, kind: 'validation', message: 'A message is required to chat with HR.' },
  'ERR-HR-007': { area: 'HR', status: 500, kind: 'error', message: 'The HR chat failed. Please try again.' },
  'ERR-HR-008': { area: 'HR', status: 500, kind: 'error', message: 'Applying that HR suggestion failed. Please try again.' },
  'ERR-HR-009': { area: 'HR', status: 500, kind: 'error', message: 'Generating the cover letter failed. Please try again.' },
  'ERR-HR-010': { area: 'HR', status: 500, kind: 'error', message: 'Generating interview questions failed. Please try again.' },
  'ERR-HR-011': { area: 'HR', status: 400, kind: 'validation', message: 'Some required information is missing for that HR action.' },

  // ERR-GAP-### — gap accept/decline lifecycle (routes/hr.routes.js's /gap-decision, services/gapStore.js)
  'ERR-GAP-001': { area: 'GAP', status: 400, kind: 'validation', message: 'That decision is not valid — choose Add or Leave out.' },
  'ERR-GAP-002': { area: 'GAP', status: 400, kind: 'validation', message: 'Ask HR to draft a statement for this gap before adding it.' },
  'ERR-GAP-003': { area: 'GAP', status: 400, kind: 'validation', message: 'That gap could not be found — try refreshing the review.' },

  // ERR-COACH-### — Career Coach routes/agents/coach.js
  'ERR-COACH-001': { area: 'COACH', status: 400, kind: 'validation', message: 'Please upload your CV before talking with the Career Coach.' },
  'ERR-COACH-002': { area: 'COACH', status: 400, kind: 'validation', message: 'Please choose a career direction first.' },
  'ERR-COACH-003': { area: 'COACH', status: 500, kind: 'error', message: 'The Career Coach could not analyze your profile. Please try again.' },
  'ERR-COACH-004': { area: 'COACH', status: 500, kind: 'error', message: 'The Career Coach could not build a path for that role. Please try again.' },
  'ERR-COACH-005': { area: 'COACH', status: 500, kind: 'error', message: 'The conversation with the Career Coach failed. Please try again.' },

  // ERR-GEN-### — full CV regeneration (routes/cv.routes.js's /regenerate-cv)
  'ERR-GEN-001': { area: 'GEN', status: 400, kind: 'validation', message: 'Please upload your CV before regenerating it.' },
  'ERR-GEN-002': { area: 'GEN', status: 400, kind: 'validation', message: 'There is no job to regenerate your CV against.' },
  'ERR-GEN-003': { area: 'GEN', status: 500, kind: 'error', message: 'Regenerating your CV failed. Please try again.' },

  // ERR-RATE-### — rate limiting and cost-cap guards. Kind is 'rate' (not 'error', not
  // 'validation'): a real operating constraint that clears on its own — no bug, no missing
  // input. Cause (b) daily-cap codes (001, 003) reset overnight; cause (a) burst code (002)
  // clears in seconds/minutes. public/app.js renders each with the calm rate-limit overlay.
  'ERR-RATE-001': { area: 'RATE', status: 429, kind: 'rate', message: "Today's AI budget has been reached — please try again tomorrow." },
  'ERR-RATE-002': { area: 'RATE', status: 429, kind: 'rate', message: 'Too many requests — slow down and try again shortly.' },
  'ERR-RATE-003': { area: 'RATE', status: 429, kind: 'rate', message: 'The daily job-search limit has been reached — please try again tomorrow.' },

  // ERR-JOB-### — job search + job-description fetch (routes/jobs.routes.js) — added area, see note above.
  'ERR-JOB-001': { area: 'JOB', status: 500, kind: 'error', message: 'Searching for jobs failed. Please try again.' },
  'ERR-JOB-002': { area: 'JOB', status: 400, kind: 'validation', message: 'No search results to analyze yet — run a job search first.' },
  'ERR-JOB-003': { area: 'JOB', status: 500, kind: 'error', message: 'Analyzing job fit failed. Please try again.' },
  'ERR-JOB-004': { area: 'JOB', status: 422, kind: 'validation', message: 'That site requires logging in, so it cannot be read automatically — please paste the job description text instead.' },
  'ERR-JOB-005': { area: 'JOB', status: 422, kind: 'validation', message: 'Reading job pages from a URL is turned off — please paste the job description text instead.' },
  'ERR-JOB-006': { area: 'JOB', status: 400, kind: 'validation', message: 'Please provide a job URL or paste the job description text.' },
  'ERR-JOB-007': { area: 'JOB', status: 500, kind: 'error', message: 'Reading that job posting failed. Please try again.' },

  // ERR-AUTH-### — user accounts, registration, login (routes/auth.routes.js)
  'ERR-AUTH-001': { area: 'AUTH', status: 400, kind: 'validation', message: 'Email and password are required.' },
  'ERR-AUTH-002': { area: 'AUTH', status: 409, kind: 'validation', message: 'An account with that email already exists.' },
  'ERR-AUTH-003': { area: 'AUTH', status: 400, kind: 'validation', message: 'Password must be at least 8 characters.' },
  'ERR-AUTH-004': { area: 'AUTH', status: 500, kind: 'error',      message: 'Authentication failed. Please try again.' },
  'ERR-AUTH-005': { area: 'AUTH', status: 401, kind: 'validation', message: 'Invalid email or password.' },
  'ERR-AUTH-006': { area: 'AUTH', status: 503, kind: 'error',      message: 'User accounts are not available right now — database is unreachable.' },
  'ERR-AUTH-007': { area: 'AUTH', status: 401, kind: 'validation', message: 'You must be signed in to view your data.' },
  'ERR-AUTH-008': { area: 'AUTH', status: 404, kind: 'validation', message: 'That saved CV could not be found.' },

  // ERR-SYS-### — uncaught / process-level errors that escape a route's own try/catch
  'ERR-SYS-001': { area: 'SYS', status: 500, kind: 'error', message: 'Something unexpected went wrong. Please try again.' },
  'ERR-SYS-002': { area: 'SYS', status: 500, kind: 'error', message: 'An internal error occurred and was logged for review.' },
};

// Creates an Error tagged with a catalog code/status, so it can be thrown deep inside an
// agent/service call and still carry its code+status all the way up to the route's catch
// block (see core/respondError.js's sendError, which prefers err.code over its own default).
function taggedError(code, overrideMessage) {
  const entry = ERROR_CODES[code];
  const err = new Error(overrideMessage || (entry && entry.message) || 'Unexpected error.');
  err.code = code;
  err.status = (entry && entry.status) || 500;
  return err;
}

module.exports = { ERROR_CODES, taggedError };
