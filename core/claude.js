const Anthropic = require('@anthropic-ai/sdk');
const { extractJSON, firstText } = require('./json');
const { addSessionSpend, getSession } = require('../services/session');
const { taggedError } = require('./errorCodes');
const { logEvent, logDiagnostic } = require('./logger');

// The one Anthropic client + model constant for the whole app — both src/ai.js and
// src/coach.js used to instantiate their own copy of this; centralizing it here means a
// model swap or API-key change is a one-line edit instead of a two-file edit.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ── Daily Anthropic spend cap ────────────────────────────────────────────────────────────
// `client` is the ONE choke point every Anthropic call in the app goes through (agents/*,
// tasks/*, and createJsonCompletion below all call client.messages.create) — so instead of
// asking every one of those call sites to call a differently-named wrapper, we replace
// client.messages.create itself with a metered version. Every existing caller keeps calling
// client.messages.create exactly as before and gets metered for free.
//
// In-memory only for v1 — resets on server restart as well as at UTC midnight. The future
// hardening step, before this matters at any real scale, is a DB-backed counter that
// survives restarts and is shared across multiple server processes.
// Number(process.env.X) || fallback would silently discard a legitimate "0" (falsy), which
// matters here since DAILY_AI_BUDGET_USD=0 is a real, meaningful value (block all spend).
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

const DAILY_AI_BUDGET_USD     = envNumber('DAILY_AI_BUDGET_USD', 5);
const PRICE_INPUT_PER_MTOK    = envNumber('ANTHROPIC_PRICE_INPUT_PER_MTOK', 3);
const PRICE_OUTPUT_PER_MTOK   = envNumber('ANTHROPIC_PRICE_OUTPUT_PER_MTOK', 15);

function utcDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC by construction
}

let spendDate = utcDateString();
let spendTodayUsd = 0;

function rolloverIfNewUtcDay() {
  const today = utcDateString();
  if (today !== spendDate) { spendDate = today; spendTodayUsd = 0; }
}

function checkBudget() {
  rolloverIfNewUtcDay();
  if (spendTodayUsd >= DAILY_AI_BUDGET_USD) {
    // Tagged with .status/.code (ERR-RATE-001) so core/respondError.js's sendError, in
    // whichever route's catch block this bubbles up to, returns 429 with that code instead of
    // a generic 500 — it prefers err.code/err.status over the route's own default code.
    logEvent('cost_cap_hit', { route: 'core/claude' });
    throw taggedError('ERR-RATE-001');
  }
}

// Approximates cache_creation_input_tokens and cache_read_input_tokens at the plain input
// rate. Real Anthropic pricing charges cache writes a premium and cache reads a steep
// discount versus base input — folding both into the input rate slightly overstates cache
// reads and slightly understates cache writes, but for a SPEND CAP (a safety backstop, not
// an invoice), erring toward overstating cost is the safer direction.
function recordUsage(usage, model) {
  if (!usage) return;
  rolloverIfNewUtcDay();
  const inputTokens = (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  const costUsd = (inputTokens / 1e6) * PRICE_INPUT_PER_MTOK + (outputTokens / 1e6) * PRICE_OUTPUT_PER_MTOK;
  spendTodayUsd += costUsd;
  addSessionSpend(costUsd); // per-session running total — see services/session.js, surfaced as "AI cost for this CV"
  console.log(`[ai-spend] ${model || MODEL}: ~$${costUsd.toFixed(4)} this call — $${spendTodayUsd.toFixed(4)} / $${DAILY_AI_BUDGET_USD} today`);
}

const rawMessagesCreate = client.messages.create.bind(client.messages);

async function meteredCreate(params) {
  checkBudget();
  // Per-session model override: if clientPreferences.model is set (model picker), use it.
  // Wrapped in try/catch so missing ALS context (startup, tests without session) is silent.
  let effectiveParams = params;
  try {
    const sess = getSession();
    if (sess && sess.clientPreferences && sess.clientPreferences.model) {
      effectiveParams = { ...params, model: sess.clientPreferences.model };
    }
  } catch (e) { /* no session context — use params.model */ }
  const response = await rawMessagesCreate(effectiveParams);
  recordUsage(response.usage, effectiveParams.model);
  return response;
}

client.messages.create = meteredCreate;

// Several agent calls share appSession.hrThread with free-form HR-sidebar chat
// (chatWithHRExpert), whose replies are prose, not JSON. When a JSON-only call (e.g.
// "regenerate wording") is sent on top of a thread that ends in prose, the model sometimes
// continues in chat style and ignores the trailing "Return JSON only" instruction, so the
// response has no JSON at all. Retry once with an explicit corrective turn before giving up.
async function createJsonCompletion(params) {
  let messages = params.messages;
  let response = await client.messages.create({ ...params, messages });
  let text = firstText(response);
  let retried = false;
  try {
    extractJSON(text);
  } catch (err) {
    retried = true;
    let excerpt = '';
    try { excerpt = (text || '').slice(0, 200); } catch (_) {}
    logDiagnostic('core.createJsonCompletion', { outcome: 'retry_triggered', excerpt }); // fire-and-forget
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: 'Your previous reply did not contain the requested JSON object. Reply again with ONLY the JSON object — no prose, no explanation, nothing before or after it.' },
    ];
    response = await client.messages.create({ ...params, messages });
    text = firstText(response);
  }
  try {
    const raw = extractJSON(text);
    if (retried) logDiagnostic('core.createJsonCompletion', { outcome: 'retry_succeeded' }); // fire-and-forget
    return { text, messages, raw };
  } catch (e) {
    if (retried) {
      let excerpt = '';
      try { excerpt = (text || '').slice(0, 200); } catch (_) {}
      logDiagnostic('core.createJsonCompletion', { outcome: 'both_failed', excerpt }); // fire-and-forget
    }
    throw e;
  }
}

// Exposes the in-memory daily spend so callers (startup log, /cost endpoint, tests) can
// read the current value without importing the private variable directly.
function getSpendToday() {
  rolloverIfNewUtcDay();
  return { spendTodayUsd, DAILY_AI_BUDGET_USD };
}

// Log budget cap + today's running total at startup so Render/server logs always show the
// safety margin from the first request. In-memory: value is 0 after every restart.
if (process.env.NODE_ENV !== 'test') {
  console.log(`[AI-SPEND] startup | cap=$${DAILY_AI_BUDGET_USD}/day | today_so_far=$${spendTodayUsd.toFixed(4)} (in-memory, resets on restart)`);
}

module.exports = { client, MODEL, createJsonCompletion, meteredCreate, DAILY_AI_BUDGET_USD, getSpendToday };
