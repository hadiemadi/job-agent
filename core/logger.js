'use strict';
const crypto = require('crypto');
const { getPool } = require('./db');
const { als, getTraceId } = require('../services/session');

// GDPR-driven allowlist: only these meta keys are ever written to the events/errors tables.
// Everything else (cv text, job-description body, names, emails, file contents, request
// bodies — anything that could be personal data) is silently dropped, never persisted. See
// CLAUDE.md's GDPR backlog item — this logger is operational/stats data only, never content.
const ALLOWED_META_KEYS = new Set([
  'route', 'outcome', 'severity', 'count', 'durationMs', 'model', 'status', 'errName',
  'code', 'kind',
]);

// A crude but cheap guard against accidentally-allowlisted free text: even an allowed key
// (e.g. a future "title" field) is dropped if its value is long or looks like an email,
// rather than trusting every call site to pre-sanitize perfectly.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_STRING_LEN = 120;

function isSafePrimitive(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  if (value.length > MAX_STRING_LEN) return false;
  if (EMAIL_RE.test(value)) return false;
  return true;
}

// Strips meta down to the allowlisted, coarse, non-personal fields only. Exported on its own
// (not just used internally) so it can be unit-tested directly against PII/CV-shaped input.
function sanitizeMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  for (const key of ALLOWED_META_KEYS) {
    if (!(key in meta)) continue;
    const value = meta[key];
    if (isSafePrimitive(value)) out[key] = value;
  }
  return out;
}

// One-way hash — never store the raw "sid" cookie value itself, just enough to correlate
// events from the same browser session without being able to recover the cookie from the DB.
function hashSessionId(sid) {
  if (!sid) return null;
  return crypto.createHash('sha256').update(sid).digest('hex');
}

// Fire-and-forget by design: callers never `await` these (a slow/unreachable DB must not add
// latency to the request, let alone fail it). Every failure is caught here and only ever
// reaches console.warn — it can never bubble into an unhandled rejection or crash a request.
async function logEvent(eventType, meta) {
  try {
    const pool = getPool();
    if (!pool) return;
    const sessionIdHash = hashSessionId(als.getStore());
    await pool.query(
      'INSERT INTO events (session_id_hash, event_type, meta_json) VALUES ($1, $2, $3)',
      [sessionIdHash, eventType, JSON.stringify(sanitizeMeta(meta))]
    );
  } catch (err) {
    console.warn('[logger] logEvent failed (non-fatal):', err.message);
  }
}

async function logError(errorCode, route, ctx) {
  try {
    const pool = getPool();
    if (!pool) return;
    const sessionIdHash = hashSessionId(als.getStore());
    await pool.query(
      'INSERT INTO errors (session_id_hash, error_code, route, sanitized_context_json) VALUES ($1, $2, $3, $4)',
      [sessionIdHash, errorCode, route, JSON.stringify(sanitizeMeta(ctx))]
    );
  } catch (err) {
    console.warn('[logger] logError failed (non-fatal):', err.message);
  }
}

// Richer diagnostic logging for isolating ERR-*-0XX model-call root causes.
// Bypasses the ALLOWED_META_KEYS allowlist intentionally — diagnostic data is structured
// operational data (booleans, counts, timing, short response excerpts), not free-text PII.
// Same fire-and-forget guarantee: a DB failure never throws, never blocks a request.
async function logDiagnostic(label, data) {
  try {
    const pool = getPool();
    let traceId = null;
    try { traceId = getTraceId(); } catch (_) {}
    const payload = { traceId, ...data };
    // Always mirror to stdout so diagnostics are visible in Render logs even without DB access.
    console.log('[diagnostic]', String(label).slice(0, 100), JSON.stringify(payload));
    if (!pool) return;
    const sessionIdHash = hashSessionId(als.getStore());
    await pool.query(
      'INSERT INTO diagnostic_log (session_id_hash, label, data_json) VALUES ($1, $2, $3)',
      [sessionIdHash, String(label).slice(0, 100), JSON.stringify(payload)]
    );
  } catch (err) {
    console.warn('[logger] logDiagnostic failed (non-fatal):', err.message);
  }
}

module.exports = { logEvent, logError, logDiagnostic, sanitizeMeta, hashSessionId };
