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

function tooManyRequests(req, res) {
  res.status(429).json({ error: ERROR_CODES['ERR-RATE-002'].message, error_code: 'ERR-RATE-002' });
  logEvent('rate_limit_hit', { route: req.path });
  logError('ERR-RATE-002', req.path, {});
}

// test.ui.js drives dozens of requests per test file through one shared supertest agent
// (one sid) — real per-user limits would start 429-ing the test suite itself well before
// any test intends to exercise that behavior. Disabled under NODE_ENV==='test' (which Jest
// sets by default) rather than loosening the real, production limits.
const skip = () => process.env.NODE_ENV === 'test';

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

module.exports = { globalLimiter, aiLimiter };
