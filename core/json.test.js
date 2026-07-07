const { extractJSON, sanitizeJsonControlChars, firstText } = require('./json');

describe('extractJSON', () => {
  test('extracts a JSON object wrapped in a ```json fenced code block', () => {
    const response = '```json\n{"a": 1, "b": "two"}\n```';
    expect(JSON.parse(extractJSON(response))).toEqual({ a: 1, b: 'two' });
  });

  test('extracts a bare JSON object with preamble/postamble text', () => {
    const response = 'Sure, here you go:\n{"ok": true}\nLet me know if you need anything else.';
    expect(JSON.parse(extractJSON(response))).toEqual({ ok: true });
  });

  test('extracts a JSON array', () => {
    const response = '```json\n[1, 2, 3]\n```';
    expect(JSON.parse(extractJSON(response))).toEqual([1, 2, 3]);
  });

  test('sanitizes a raw newline placed inside a JSON string value', () => {
    // This is exactly the bug sanitizeJsonControlChars exists for: Claude sometimes emits a
    // literal newline inside a string value instead of escaping it as \n, which breaks
    // JSON.parse with "Expected ',' or '}'" — extractJSON must repair it before parsing.
    const broken = '{"letter": "Dear Hiring Manager,\nI am excited to apply."}';
    const fixed = extractJSON(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed).letter).toBe('Dear Hiring Manager,\nI am excited to apply.');
  });

  test('throws when no JSON is present', () => {
    expect(() => extractJSON('no json here at all')).toThrow('No JSON found in model response');
  });

  test('throws a clear error (not a TypeError) when called with undefined — regression for ERR-JOB-007', () => {
    // Triggered when message.content[0].text is undefined (non-text block returned by Claude).
    // Previously crashed as "Cannot read properties of undefined (reading 'replace')".
    expect(() => extractJSON(undefined)).toThrow('No text content returned by model');
  });

  test('throws a clear error when called with null', () => {
    expect(() => extractJSON(null)).toThrow('No text content returned by model');
  });

  test('repairs an unescaped double-quote inside an array element (the "Expected \',\' or \']\'" bug)', () => {
    // Mimics the production failure: the model wrote a bullet point with an unescaped
    // quoted program name, breaking the string mid-array-element. extractJSON used to
    // return this candidate as-is (only slicing + control-char sanitizing, never actually
    // validating), so the caller's JSON.parse blew up downstream with a confusing
    // "Expected ',' or ']' after array element" position error.
    const broken = '{"cv": {"bullets": ["Led the "Atlas" program to deliver 5G radios on time", "Cut costs by 20%"]}}';
    expect(() => JSON.parse(broken)).toThrow();

    const fixed = extractJSON(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect(JSON.parse(fixed)).toEqual({
      cv: { bullets: ['Led the "Atlas" program to deliver 5G radios on time', 'Cut costs by 20%'] },
    });
  });

  test('throws a clear error when even jsonrepair cannot fix the candidate', () => {
    // "{[}..." slices to the candidate "{[}" — mismatched bracket types that jsonrepair
    // itself cannot resolve, not just a missing-bracket case extractJSON's own slicing logic
    // already catches (that's "Unclosed JSON in model response", a different message).
    expect(() => extractJSON('prefix {[} suffix')).toThrow('Model JSON could not be parsed or repaired:');
  });
});

describe('firstText', () => {
  test('returns the text of the first text block', () => {
    const response = { content: [{ type: 'text', text: 'hello world' }] };
    expect(firstText(response)).toBe('hello world');
  });

  test('skips a leading thinking block and returns the text block — regression for ERR-HR-003', () => {
    // Newer models (Opus 4.8, Sonnet 5) prepend a thinking block before the text block.
    // content[0].text is undefined on a thinking block, triggering "No text content returned".
    const response = {
      content: [
        { type: 'thinking', thinking: 'internal reasoning...' },
        { type: 'text', text: '{"ok": true}' },
      ],
    };
    expect(firstText(response)).toBe('{"ok": true}');
  });

  test('throws a clear error when no text block is present', () => {
    const response = { content: [{ type: 'tool_use', id: 'x', name: 'fn', input: {} }] };
    expect(() => firstText(response)).toThrow('No text content returned by model');
  });

  test('throws when content is empty', () => {
    expect(() => firstText({ content: [] })).toThrow('No text content returned by model');
  });
});

describe('sanitizeJsonControlChars', () => {
  test('leaves structural whitespace between tokens untouched', () => {
    const input = '{\n  "a": 1\n}';
    expect(sanitizeJsonControlChars(input)).toBe(input);
  });

  test('escapes raw tab and carriage return inside string literals', () => {
    const input = '{"x": "a\tb\rc"}';
    expect(sanitizeJsonControlChars(input)).toBe('{"x": "a\\tb\\rc"}');
  });
});
