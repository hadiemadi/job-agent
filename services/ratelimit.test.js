// Unit tests for services/ratelimit.js: stageTag (pure function) and tooManyRequests
// (diagnostic logging + response shape). The limiter objects themselves are
// integration-tested by test.ui.js (skip: true in NODE_ENV=test).
const { stageTag, tooManyRequests } = require('./ratelimit');

// --- stageTag ---

test('stageTag maps /upload-cv to -UPLOAD', () => {
  expect(stageTag('/upload-cv')).toBe('-UPLOAD');
});

test('stageTag maps /fetch-job to -PARSE', () => {
  expect(stageTag('/fetch-job')).toBe('-PARSE');
});

test('stageTag maps /review-cv to -HR', () => {
  expect(stageTag('/review-cv')).toBe('-HR');
});

test('stageTag maps /rewrite to -REWRITE', () => {
  expect(stageTag('/rewrite')).toBe('-REWRITE');
});

test('stageTag maps /job/:id/status to -POLL', () => {
  expect(stageTag('/job/abc-123/status')).toBe('-POLL');
  expect(stageTag('/job/00000000-0000-0000-0000-000000000000/status')).toBe('-POLL');
});

test('stageTag returns empty string for unrecognised paths', () => {
  expect(stageTag('/confirm-contact')).toBe('');
  expect(stageTag('/search/jobs')).toBe('');
  expect(stageTag('/coach/analyze')).toBe('');
  expect(stageTag('/gap-decision')).toBe('');
});

test('stageTag does not match partial path prefixes (e.g. /rewrite-cv is not /rewrite)', () => {
  expect(stageTag('/rewrite-cv')).toBe('');
});

// --- tooManyRequests diagnostic logging ---

function makeReqRes(path, rlCount, rlLimit) {
  const req = {
    path,
    cookies: { sid: 'test-sid' },
    ip: '127.0.0.1',
    rateLimit: { current: rlCount, limit: rlLimit, remaining: 0 },
  };
  const captured = {};
  const res = {
    status: jest.fn(() => res),
    json:   jest.fn(body => { Object.assign(captured, body); }),
  };
  return { req, res, captured };
}

test('tooManyRequests logs count/limit/window/route to console on every trip', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res } = makeReqRes('/upload-cv', 14, 100);

  tooManyRequests(req, res, null, { windowMs: 900000, max: 100 });

  const line = spy.mock.calls.find(args => String(args[0]).includes('[RATE-LIMIT]'))?.[0];
  expect(line).toBeDefined();
  expect(line).toContain('ERR-RATE-002-UPLOAD'); // stage tag
  expect(line).toContain('14/100');               // count/limit
  expect(line).toContain('900');                  // window in seconds
  expect(line).toContain('/upload-cv');           // route

  spy.mockRestore();
});

test('tooManyRequests includes rl_count, rl_limit, rl_window_ms in the 429 JSON body', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res, captured } = makeReqRes('/rewrite', 5, 20);

  tooManyRequests(req, res, null, { windowMs: 3600000, max: 20 });

  expect(res.status).toHaveBeenCalledWith(429);
  expect(captured.kind).toBe('rate');
  expect(captured.rl_count).toBe(5);
  expect(captured.rl_limit).toBe(20);
  expect(captured.rl_window_ms).toBe(3600000);
  expect(captured.error_code).toBe('ERR-RATE-002-REWRITE');

  spy.mockRestore();
});

test('tooManyRequests falls back gracefully when req.rateLimit is absent', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const req = { path: '/confirm-contact', cookies: {}, ip: '127.0.0.1' }; // no req.rateLimit
  const res = { status: jest.fn(() => res), json: jest.fn() };

  expect(() => tooManyRequests(req, res, null, { windowMs: 60000, max: 10 })).not.toThrow();
  const line = spy.mock.calls.find(args => String(args[0]).includes('[RATE-LIMIT]'))?.[0];
  expect(line).toContain('?/10'); // count falls back to '?', limit from optionsUsed

  spy.mockRestore();
});
