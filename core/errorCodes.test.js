// Confirms the catalog's `kind` classification is complete and a few representative codes
// landed on the right side of the error/validation split (build.txt's ERR-HR-001 fix).
const { ERROR_CODES, taggedError } = require('./errorCodes');

test('every catalog entry has a kind of "error", "validation", or "rate"', () => {
  for (const [code, entry] of Object.entries(ERROR_CODES)) {
    expect(['error', 'validation', 'rate']).toContain(entry.kind);
  }
});

describe('representative classifications', () => {
  test.each([
    ['ERR-HR-001', 'validation'], // missing CV before HR review — the case build.txt named directly
    ['ERR-CV-001', 'validation'],
    ['ERR-COACH-001', 'validation'],
    ['ERR-GEN-001', 'validation'],
    ['ERR-GAP-002', 'validation'], // ask HR to draft first — wrong-order, not a failure
    ['ERR-JOB-006', 'validation'], // provide url or jobText — missing input
  ])('%s is kind: %s', (code, kind) => {
    expect(ERROR_CODES[code].kind).toBe(kind);
  });

  test.each([
    ['ERR-HR-003', 'error'],   // HR review agent call failed — a real failure
    ['ERR-CV-004', 'error'],
    ['ERR-SYS-001', 'error'],
  ])('%s is kind: %s', (code, kind) => {
    expect(ERROR_CODES[code].kind).toBe(kind);
  });

  test.each([
    ['ERR-RATE-001', 'rate'], // daily AI budget cap — clears overnight, not a bug
    ['ERR-RATE-002', 'rate'], // burst limiter — clears in seconds
    ['ERR-RATE-003', 'rate'], // daily job-search cap — clears overnight
  ])('%s is kind: %s', (code, kind) => {
    expect(ERROR_CODES[code].kind).toBe(kind);
  });
});

test('taggedError carries the catalog kind implicitly via its code (kind is read from the catalog at response time, not duplicated on the Error)', () => {
  const err = taggedError('ERR-RATE-001');
  expect(err.code).toBe('ERR-RATE-001');
  expect(ERROR_CODES[err.code].kind).toBe('rate');
});
