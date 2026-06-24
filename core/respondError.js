'use strict';
const { ERROR_CODES } = require('./errorCodes');
const { logError } = require('./logger');

// Single choke point for every error response the app sends to the client — same idea as
// core/claude.js centralizing the Anthropic call. Every route catch site (and validation
// check) calls this instead of hand-rolling res.status(...).json({error: ...}): it guarantees
// every error response carries an error_code, and that every such response is also logged
// (sanitized, fire-and-forget) without each call site having to remember to do both.
//
// `err` may be a real Error (from a catch block — prefers err.code/err.status if the throw
// site already tagged them, e.g. core/claude.js's budget-cap error) or omitted entirely for a
// plain validation failure where there's no Error object, just a known code.
function sendError(res, route, code, err, extra) {
  const entry = ERROR_CODES[code] || ERROR_CODES['ERR-SYS-001'];
  const finalCode = (err && err.code) || code;
  const finalEntry = ERROR_CODES[finalCode] || entry;
  const status = (err && err.status) || finalEntry.status || 500;
  res.status(status).json({ error: finalEntry.message, error_code: finalCode, ...extra });
  // Never log err.message/stack here — it can originate from model output that itself echoed
  // CV/job text (e.g. a JSON-parse failure on a response derived from the candidate's CV).
  // errName is a safe, coarse exception class name (e.g. "TypeError"), nothing content-bearing.
  logError(finalCode, route, err && err.name ? { errName: err.name } : {});
}

module.exports = { sendError };
