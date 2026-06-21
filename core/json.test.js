const { extractJSON, sanitizeJsonControlChars } = require('./json');

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
