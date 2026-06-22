const Anthropic = require('@anthropic-ai/sdk');
const { extractJSON } = require('./json');

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
    // routes/ catch errors generically today and respond 500 JSON with err.message — that's
    // an acceptable v1 behavior (per the task this was built against), so this isn't wired
    // through to an actual 429 response without touching route files. The .status is set
    // anyway in case a future, allowed change (e.g. a global Express error handler that
    // routes opt into via next(err)) wants to honor it.
    const err = new Error('AI budget for today reached — please try again tomorrow.');
    err.status = 429;
    throw err;
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
  console.log(`[ai-spend] ${model || MODEL}: ~$${costUsd.toFixed(4)} this call — $${spendTodayUsd.toFixed(4)} / $${DAILY_AI_BUDGET_USD} today`);
}

const rawMessagesCreate = client.messages.create.bind(client.messages);

async function meteredCreate(params) {
  checkBudget();
  const response = await rawMessagesCreate(params);
  recordUsage(response.usage, params.model);
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
  let text = response.content[0].text;
  try {
    extractJSON(text);
  } catch (err) {
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: 'Your previous reply did not contain the requested JSON object. Reply again with ONLY the JSON object — no prose, no explanation, nothing before or after it.' },
    ];
    response = await client.messages.create({ ...params, messages });
    text = response.content[0].text;
  }
  return { text, messages, raw: extractJSON(text) };
}

module.exports = { client, MODEL, createJsonCompletion, meteredCreate, DAILY_AI_BUDGET_USD };
