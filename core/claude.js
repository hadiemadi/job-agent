const Anthropic = require('@anthropic-ai/sdk');
const { extractJSON } = require('./json');

// The one Anthropic client + model constant for the whole app — both src/ai.js and
// src/coach.js used to instantiate their own copy of this; centralizing it here means a
// model swap or API-key change is a one-line edit instead of a two-file edit.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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

module.exports = { client, MODEL, createJsonCompletion };
