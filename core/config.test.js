// Confirms TRIAL_MODE is a one-flag switch: defaults to true (trial period), and reading the
// env var is the only thing that changes it — no code edit required either way.
describe('core/config TRIAL_MODE', () => {
  const ORIGINAL = process.env.TRIAL_MODE;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TRIAL_MODE;
    else process.env.TRIAL_MODE = ORIGINAL;
    jest.resetModules();
  });

  test('defaults to true when TRIAL_MODE is unset', () => {
    delete process.env.TRIAL_MODE;
    jest.resetModules();
    const { TRIAL_MODE } = require('./config');
    expect(TRIAL_MODE).toBe(true);
  });

  test('is false only when explicitly set to the string "false"', () => {
    process.env.TRIAL_MODE = 'false';
    jest.resetModules();
    const { TRIAL_MODE } = require('./config');
    expect(TRIAL_MODE).toBe(false);
  });

  test('any other value (e.g. "true") keeps it true', () => {
    process.env.TRIAL_MODE = 'true';
    jest.resetModules();
    const { TRIAL_MODE } = require('./config');
    expect(TRIAL_MODE).toBe(true);
  });
});
