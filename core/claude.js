const Anthropic = require('@anthropic-ai/sdk');

// The one Anthropic client + model constant for the whole app — both src/ai.js and
// src/coach.js used to instantiate their own copy of this; centralizing it here means a
// model swap or API-key change is a one-line edit instead of a two-file edit.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

module.exports = { client, MODEL };
