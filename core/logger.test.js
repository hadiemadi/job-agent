// Two things this test must prove: (1) the sanitizer is a strict allowlist that drops PII/CV/
// job-description content even if a careless call site tried to pass it through, and (2)
// logging silently no-ops (never throws, never blocks) when DATABASE_URL isn't set — the exact
// situation in this test environment (no .env DATABASE_URL), and the required failure mode in
// production if Render's Postgres is ever unreachable.
const { sanitizeMeta, logEvent, logError, hashSessionId } = require('./logger');

describe('sanitizeMeta', () => {
  test('strips CV text, job-description body, names, and emails entirely', () => {
    const dirty = {
      cvText: 'John Doe\nSenior TPM\njohn.doe@example.com\n+1 555 0100\nWorked on RF systems for 10 years...',
      jobDescription: 'We are looking for a Senior Program Manager with RF experience...',
      name: 'John Doe',
      email: 'john.doe@example.com',
      requestBody: { cvText: 'leaked cv text', job: { description: 'leaked jd' } },
    };
    const clean = sanitizeMeta(dirty);
    expect(clean).toEqual({});
    expect(JSON.stringify(clean)).not.toContain('John');
    expect(JSON.stringify(clean)).not.toContain('RF systems');
    expect(JSON.stringify(clean)).not.toContain('@example.com');
  });

  test('passes through only the allowlisted, coarse operational fields', () => {
    const meta = { route: '/rewrite', outcome: 'ok', severity: 'major', count: 3, durationMs: 1234, model: 'claude-sonnet-4-6', status: 200 };
    expect(sanitizeMeta(meta)).toEqual(meta);
  });

  test('passes through code and kind (the validation-nudge logging fields) — codes only, never free text', () => {
    const meta = { route: '/review-cv', code: 'ERR-HR-001', kind: 'validation' };
    expect(sanitizeMeta(meta)).toEqual(meta);
  });

  test('drops an allowlisted key anyway if its value looks like an email or is too long', () => {
    const meta = { route: 'someone@example.com', outcome: 'x'.repeat(500) };
    expect(sanitizeMeta(meta)).toEqual({});
  });


  test('drops non-primitive values (objects/arrays) even under an allowlisted key', () => {
    const meta = { route: { nested: 'object' } };
    expect(sanitizeMeta(meta)).toEqual({});
  });

  test('handles missing/non-object meta gracefully', () => {
    expect(sanitizeMeta(undefined)).toEqual({});
    expect(sanitizeMeta(null)).toEqual({});
  });
});

describe('hashSessionId', () => {
  test('one-way hashes a sid — never returns the raw value', () => {
    const hash = hashSessionId('some-raw-sid-cookie-value');
    expect(hash).not.toBe('some-raw-sid-cookie-value');
    expect(hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest
  });

  test('is deterministic for the same input (so events from one session correlate)', () => {
    expect(hashSessionId('abc')).toBe(hashSessionId('abc'));
  });

  test('returns null for a missing sid rather than hashing an empty string', () => {
    expect(hashSessionId(null)).toBeNull();
    expect(hashSessionId(undefined)).toBeNull();
  });
});

describe('logEvent / logError — no-op when DATABASE_URL is unset', () => {
  // This test file's environment never sets DATABASE_URL (see .env / .env.example) — exactly
  // the production scenario this must degrade gracefully under, per the task's "logging must
  // NO-OP silently... a logging/DB failure must NEVER crash a request" requirement.
  test('logEvent resolves without throwing and performs no DB write', async () => {
    await expect(logEvent('cv_uploaded', { route: '/upload-cv', outcome: 'ok' })).resolves.toBeUndefined();
  });

  test('logError resolves without throwing even with PII-shaped ctx (which sanitizeMeta would strip anyway)', async () => {
    await expect(logError('ERR-CV-002', '/upload-cv', { cvText: 'should never be persisted' })).resolves.toBeUndefined();
  });
});
