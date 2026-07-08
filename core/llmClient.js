'use strict';

const { taggedError } = require('./errorCodes');
const { logDiagnostic } = require('./logger');

// Normalizes a DeepSeek/OpenAI-compatible response to the Anthropic response shape that
// firstText() and extractJSON() expect: { content:[{type:'text',text:'...'}], usage:{...} }
function normalizeDeepseekResponse(raw) {
  const choice = (raw.choices || [])[0] || {};
  const text = (choice.message && choice.message.content) || '';
  return {
    id: raw.id || '',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : (choice.finish_reason || 'end_turn'),
    usage: {
      input_tokens:  (raw.usage && raw.usage.prompt_tokens)     || 0,
      output_tokens: (raw.usage && raw.usage.completion_tokens) || 0,
    },
  };
}

// Translates Anthropic-format params to the OpenAI-compatible format DeepSeek uses:
// the Anthropic `system` string becomes messages[0] with role:'system'.
function toDeepseekParams(params) {
  const messages = [];
  if (params.system) messages.push({ role: 'system', content: String(params.system) });
  if (params.messages) messages.push(...params.messages);
  const body = { model: params.model, messages, max_tokens: params.max_tokens || 1024 };
  if (params.stop && params.stop.length) body.stop = params.stop;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  return body;
}

// Calls DeepSeek's OpenAI-compatible chat/completions endpoint and returns an Anthropic-shaped
// response. Uses the global fetch available in Node.js 18+. Throws a tagged ERR-* error on
// any failure so route catch blocks (core/respondError.js) return the right status + code.
async function callDeepseek(params) {
  if (!process.env.DEEPSEEK_API_KEY) {
    logDiagnostic('llmClient.callDeepseek', { outcome: 'missing_key' });
    const err = new Error('DeepSeek is not configured — set DEEPSEEK_API_KEY in .env or Render environment.');
    err.status = 503;
    err.code   = 'ERR-SYS-001';
    throw err;
  }

  let res;
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(toDeepseekParams(params)),
    });
  } catch (networkErr) {
    logDiagnostic('llmClient.callDeepseek', { outcome: 'network_error', message: networkErr.message });
    throw taggedError('ERR-SYS-001');
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    logDiagnostic('llmClient.callDeepseek', { outcome: 'api_error', status: res.status, body: body.slice(0, 300) });
    throw taggedError(res.status === 429 ? 'ERR-RATE-001' : 'ERR-SYS-001');
  }

  const data = await res.json();
  return normalizeDeepseekResponse(data);
}

module.exports = { callDeepseek, normalizeDeepseekResponse, toDeepseekParams };
