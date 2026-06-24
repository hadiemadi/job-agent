// DATABASE_URL is intentionally unset in this test environment — confirms getPool() degrades
// to null (instead of throwing) so every caller in core/logger.js can cheaply no-op.
describe('core/db getPool — DATABASE_URL unset', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.DATABASE_URL;
  });

  test('returns null and never throws when DATABASE_URL is missing', () => {
    const { getPool } = require('./db');
    expect(() => getPool()).not.toThrow();
    expect(getPool()).toBeNull();
  });

  test('warns at most once across repeated calls, not once per call', () => {
    const { getPool } = require('./db');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getPool(); getPool(); getPool();
    const dbWarnings = warnSpy.mock.calls.filter(args => /DATABASE_URL/.test(args[0]));
    expect(dbWarnings.length).toBe(1);
    warnSpy.mockRestore();
  });
});
