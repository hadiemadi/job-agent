'use strict';
const { ERROR_CODES } = require('./errorCodes');
const { logEvent, logError } = require('./logger');

// Single choke point for every error response the app sends to the client — same idea as
// core/claude.js centralizing the Anthropic call. Every route catch site (and validation
// check) calls this instead of hand-rolling res.status(...).json({error: ...}): it guarantees
// every error response carries an error_code + kind, and that every such response is also
// logged (sanitized, fire-and-forget) without each call site having to remember to do both.
//
// `err` may be a real Error (from a catch block — prefers err.code/err.status if the throw
// site already tagged them, e.g. core/claude.js's budget-cap error) or omitted entirely for a
// plain validation failure where there's no Error object, just a known code.
//
// `kind` (from the catalog entry) decides BOTH how the client renders this (public/app.js
// branches the popup on it: a friendly nudge for 'validation', the full technical dialog for
// 'error') and where it's logged: a 'validation' case is expected/recoverable — not worth a
// row in the errors table — so it goes through logEvent (the events table) instead.
function sendError(res, route, code, err, extra) {
  const entry = ERROR_CODES[code] || ERROR_CODES['ERR-SYS-001'];
  const finalCode = (err && err.code) || code;
  const finalEntry = ERROR_CODES[finalCode] || entry;
  const status = (err && err.status) || finalEntry.status || 500;
  const kind = finalEntry.kind || 'error';
  res.status(status).json({ error: finalEntry.message, error_code: finalCode, kind, ...extra });
  if (kind === 'validation') {
    logEvent('validation_nudge', { route, code: finalCode, kind });
  } else {
    // Never log err.message/stack here — it can originate from model output that itself
    // echoed CV/job text (e.g. a JSON-parse failure on a response derived from the
    // candidate's CV). errName is a safe, coarse exception class name, nothing content-bearing.
    logError(finalCode, route, err && err.name ? { errName: err.name } : {});
  }
}

module.exports = { sendError };
