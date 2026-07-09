const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ERROR_CODES } = require('../core/errorCodes');
const { logEvent, logError } = require('../core/logger');

// See core/claude.js for why this isn't `Number(process.env.X) || fallback` — a legitimate
// "0" would silently fall back to the default with that pattern.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

const RATE_LIMIT_WINDOW_MIN = envNumber('RATE_LIMIT_WINDOW_MIN', 15);
// Raised 100 → 300: a full pipeline run with HR review generates ~42-50 HTTP requests
// in 15 min; 300/15min gives 6× headroom above that worst case.
const RATE_LIMIT_MAX        = envNumber('RATE_LIMIT_MAX', 300);

// Raised 20→60→150: spend cap ($5/day) is the real cost control — rate limit should only
// catch scripted abuse, never a real user doing thorough work. Realistic worst case: 10 gaps
// × 5 AI actions each (HR draft + 2 coach turns + redraft + review) = 50 calls; add initial
// HR review + CV tailoring ≈ 60 total. 150/hr is 2.5× that headroom. Math: 150 calls ×
// ~$0.014/call (Sonnet avg) = $2.10/hr — safely under the $5/day cap even in a max burst.
const AI_RATE_LIMIT_MAX     = envNumber('AI_RATE_LIMIT_MAX', 150);

// Polling (/job/:id/status) costs nothing — no Claude API calls. 300/hr = 1 poll every 12s;
// the backoff cap is 10s so this only catches truly runaway loops (thousands of req/min).
// Deliberately generous: a single HR review (several minutes) with 10s backoff generates
// ~18 polls/3 min ≈ 360/hr at steady state — so this limiter is set to be permissive.
// Use POLL_RATE_LIMIT_MAX=600 (or higher) in env if you need more headroom.
const POLL_RATE_LIMIT_MAX   = envNumber('POLL_RATE_LIMIT_MAX', 600);

// Same identity model as services/session.js: key by the "sid" cookie (one bucket per
// browser) and fall back to IP only for the rare first-ever request, before
// sessionMiddleware has had a chance to set that cookie. express-rate-limit v8 requires the
// IP fallback to go through its own ipKeyGenerator helper (it normalizes IPv6 addresses to a
// /56 subnet so one IPv6 user can't get a fresh bucket per address) — it actually throws a
// ValidationError at limiter-creation time if it detects `req.ip` used without it.
function keyBySession(req) {
  return (req.cookies && req.cookies.sid) || ipKeyGenerator(req.ip);
}

// Maps the route path to a stage suffix so ERR-RATE-002 errors are traceable to
// the exact pipeline step (UPLOAD, PARSE, HR, REWRITE, POLL) instead of one generic
// code. Unrecognised paths get no suffix; the base code ERR-RATE-002 is used.
function stageTag(path) {
  if (path === '/upload-cv')                         return '-UPLOAD';
  if (path === '/fetch-job')                         return '-PARSE';
  if (path === '/review-cv')                         return '-HR';
  if (path === '/rewrite')                           return '-REWRITE';
  if (/^\/job\/[^/]+\/status$/.test(path))           return '-POLL';
  return '';
}

// When the frontend passes ?k=<kind> on poll calls we can split -POLL further:
//   hr_review   → -POLL-HR      (polling the HR-review background job)
//   cv_tailor   → -POLL-REWRITE (polling the CV-tailoring background job)
//   reading_cv  → -POLL-UPLOAD  (polling the CV-reading/upload background job)
//   parsing_job → -POLL-PARSE   (polling the job-description parsing background job)
// Falls back to -POLL for unknown or absent kind.
const POLL_KIND_TAG = {
  hr_review:   '-POLL-HR',
  cv_tailor:   '-POLL-REWRITE',
  reading_cv:  '-POLL-UPLOAD',
  parsing_job: '-POLL-PARSE',
};

// Handler receives (req, res, next, optionsUsed) from express-rate-limit v6+.
// req.rateLimit is populated by the limiter before this is called.
// NOTE: express-rate-limit v8 uses `used` not `current` for the request count —
//       req.rateLimit.current is undefined in v8; use req.rateLimit.used.
function tooManyRequests(req, res, _next, optionsUsed) {
  let tag = stageTag(req.path);
  // Refine the generic -POLL tag using the ?k=<kind> query param the frontend passes
  if (tag === '-POLL' && req.query && req.query.k) {
    tag = POLL_KIND_TAG[req.query.k] || tag;
  }
  const errorCode = 'ERR-RATE-002' + tag;

  const rl        = req.rateLimit || {};
  // express-rate-limit v8: the count field is `used`, not `current`
  const count     = rl.used     != null ? rl.used     : '?';
  const limit     = rl.limit    != null ? rl.limit    : (optionsUsed && optionsUsed.max) || '?';
  const windowMs  = (optionsUsed && optionsUsed.windowMs) != null ? optionsUsed.windowMs : '?';
  const windowSec = typeof windowMs === 'number' ? windowMs / 1000 : windowMs;
  const key       = keyBySession(req);

  // Diagnostic line always visible in Render/server logs — real numbers so we can
  // tune the threshold without guessing.
  console.log(`[RATE-LIMIT] ${errorCode} | key=${key} | ${count}/${limit} in ${windowSec}s window | route=${req.path}`);

  // kind:'rate' is required so public/app.js routes this to the calm showRatePopup
  // overlay instead of the red showTechnicalErrorDialog — omitting it was a bug.
  // rl_count/rl_limit/rl_window_ms are exposed so the TRIAL_MODE popup can show real numbers.
  res.status(429).json({
    error: ERROR_CODES['ERR-RATE-002'].message,
    error_code: errorCode,
    kind: 'rate',
    rl_count:     count,
    rl_limit:     limit,
    rl_window_ms: windowMs,
  });
  logEvent('rate_limit_hit', { route: req.path, code: errorCode, count, limit, windowMs, key });
  logError('ERR-RATE-002', req.path, { count, limit, windowMs });
}

// API paths worth tracking in per-request count logs — skip static assets and healthz.
const TRACKED_PREFIXES = ['/job/', '/upload-cv', '/fetch-job', '/review-cv', '/rewrite', '/coach', '/hr/'];

// Middleware to log the RUNNING count on every non-tripped, API-bound request so we can
// see ramp-up in Render logs BEFORE the trip fires, not just at the moment it fails.
// Mount after globalLimiter — req.rateLimit is only set once the limiter has run.
function rateLimitLogger(req, res, next) {
  const rl = req.rateLimit;
  if (rl && rl.used != null && TRACKED_PREFIXES.some(p => req.path.startsWith(p))) {
    console.log(`[RATE-LIMIT-RAMP] ${req.method} ${req.path} | used=${rl.used}/${rl.limit} remaining=${rl.remaining}`);
  }
  next();
}

// Skip helpers — passed to each limiter's `skip` option.
// `skipInTest` disables all limiters during Jest runs (test.ui.js makes many rapid requests
// through one shared supertest agent and would start 429-ing itself without this).
// `skipAIForPollRoutes` additionally lets aiLimiter pass through /job/:id/status requests —
// polling has no AI cost and must not share the AI bucket.
const skipInTest         = () => process.env.NODE_ENV === 'test';
const skipAIForPollRoutes = (req) =>
  process.env.NODE_ENV === 'test' || /^\/job\/[^/]+\/status$/.test(req.path);

// Print config once at startup so limits are visible in Render logs from the first request.
if (process.env.NODE_ENV !== 'test') {
  console.log(
    `[RATE-LIMIT] config` +
    ` | globalLimiter: ${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW_MIN}min` +
    ` | aiLimiter: ${AI_RATE_LIMIT_MAX} req/60min (skips poll routes)` +
    ` | pollLimiter: ${POLL_RATE_LIMIT_MAX} req/60min (poll routes only)`
  );
}

// Broad, app-wide cap — every HTTP request (including static files) counts.
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: tooManyRequests,
  skip: skipInTest,
});

// Stricter cap for routes that trigger real Claude API calls.
// Excludes /job/:id/status — polling has no AI cost and was falsely tripping this limiter
// when aiLimiter was set to 20/hr and status-polls were counted against it.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: AI_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: tooManyRequests,
  skip: skipAIForPollRoutes,
});

// Generous cap for /job/:id/status polling only — polling costs nothing (no API calls).
// Applied at the route level in cv.routes.js, not app-wide.
const pollLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: POLL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: tooManyRequests,
  skip: skipInTest,
});

module.exports = {
  globalLimiter, aiLimiter, pollLimiter, stageTag, tooManyRequests, rateLimitLogger,
  // Export constants for tests and observability
  RATE_LIMIT_MAX, AI_RATE_LIMIT_MAX, POLL_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MIN,
};
