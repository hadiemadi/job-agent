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
const RATE_LIMIT_MAX        = envNumber('RATE_LIMIT_MAX', 100);
const AI_RATE_LIMIT_MAX     = envNumber('AI_RATE_LIMIT_MAX', 20);

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

// Handler receives (req, res, next, optionsUsed) from express-rate-limit v6+.
// req.rateLimit is populated by the limiter before this is called:
//   { current, limit, remaining, resetTime }
// optionsUsed carries { windowMs, max, ... } from the limiter config.
function tooManyRequests(req, res, _next, optionsUsed) {
  const errorCode = 'ERR-RATE-002' + stageTag(req.path);
  const rl        = req.rateLimit || {};
  const count     = rl.current  != null ? rl.current  : '?';
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

// test.ui.js drives dozens of requests per test file through one shared supertest agent
// (one sid) — real per-user limits would start 429-ing the test suite itself well before
// any test intends to exercise that behavior. Disabled under NODE_ENV==='test' (which Jest
// sets by default) rather than loosening the real, production limits.
const skip = () => process.env.NODE_ENV === 'test';

// Print config once at startup so limits are visible in Render logs from the first request.
if (process.env.NODE_ENV !== 'test') {
  console.log(
    `[RATE-LIMIT] config | globalLimiter: ${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW_MIN}min` +
    ` | aiLimiter: ${AI_RATE_LIMIT_MAX} req/60min`
  );
}

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: tooManyRequests,
  skip,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour — stricter window than globalLimiter, for AI/job-search-heavy routes
  max: AI_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: tooManyRequests,
  skip,
});

module.exports = { globalLimiter, aiLimiter, stageTag, tooManyRequests };
