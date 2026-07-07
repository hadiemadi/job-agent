// jsonrepair's package.json declares "type": "module" but ships an explicit "require"
// condition in its exports map pointing at a CommonJS build (lib/cjs/index.js) — Node
// honors that condition for require() regardless of the package's own declared type, so a
// plain top-level require() here works and stays synchronous. Confirmed at runtime: do NOT
// switch this to a dynamic import()/await — every extractJSON call site relies on it being
// synchronous, and the CJS build doesn't need one.
const { jsonrepair } = require('jsonrepair');

// Claude sometimes writes a real newline/tab inside a JSON string value (e.g. a multi-
// paragraph cover letter or a multi-sentence answer) instead of escaping it as \n — that's
// invalid JSON and makes JSON.parse fail mid-string with a confusing "Expected ',' or ']'"
// error. Walk the text tracking string/escape state and escape any raw control character
// found inside a string literal, leaving structural whitespace (between tokens) untouched.
function sanitizeJsonControlChars(raw) {
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { result += ch; escapeNext = false; continue; }
    if (ch === '\\' && inString) { result += ch; escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    result += ch;
  }
  return result;
}

// Extracts the first complete JSON object or array from a model response, ignoring any
// preamble or postamble text the model may have added. The slice + control-char sanitize
// alone don't GUARANTEE valid JSON — an unescaped quote (or any other malformation) inside
// a string value still produces text that JSON.parse chokes on mid-string (the classic
// "Expected ',' or ']' after array element" error). So before returning, actually try
// JSON.parse on the candidate; if that fails, run it through jsonrepair (which fixes
// unescaped quotes, trailing commas, single-quoted strings/keys, etc.) and re-validate with
// JSON.parse again. Only ever returns a string that is confirmed to parse — callers can
// trust JSON.parse(extractJSON(text)) to either succeed or throw a clear error, never to
// throw the original confusing low-level JSON.parse position error.
function extractJSON(text) {
  if (typeof text !== 'string') throw new Error('No text content returned by model');
  text = text.replace(/```json|```/g, '').trim();
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const openChar  = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = text.lastIndexOf(closeChar);
  if (end === -1) throw new Error('Unclosed JSON in model response');
  const candidate = sanitizeJsonControlChars(text.slice(start, end + 1));

  try {
    JSON.parse(candidate);
    return candidate;
  } catch (parseErr) {
    try {
      const repaired = jsonrepair(candidate);
      JSON.parse(repaired); // re-validate — jsonrepair can itself produce invalid output on pathological input
      return repaired;
    } catch (repairErr) {
      throw new Error(`Model JSON could not be parsed or repaired: ${repairErr.message}`);
    }
  }
}

// Finds the first text block in a Claude API response, skipping thinking/tool_use blocks
// that newer models (Opus 4.8, Sonnet 5) may prepend before the actual text response.
// Using message.content[0].text directly crashes when content[0] is a thinking block.
function firstText(response) {
  const block = (response.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('No text content returned by model');
  return block.text;
}

module.exports = { extractJSON, sanitizeJsonControlChars, firstText };
