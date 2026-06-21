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

// Extracts the first complete JSON object or array from a model response,
// ignoring any preamble or postamble text the model may have added.
function extractJSON(text) {
  text = text.replace(/```json|```/g, '').trim();
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const openChar  = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = text.lastIndexOf(closeChar);
  if (end === -1) throw new Error('Unclosed JSON in model response');
  return sanitizeJsonControlChars(text.slice(start, end + 1));
}

module.exports = { extractJSON, sanitizeJsonControlChars };
