// Unit tests for services/ratelimit.js: stageTag (pure function), tooManyRequests
// (diagnostic logging + response shape), and rateLimitLogger (per-request ramp log).
const { stageTag, tooManyRequests, rateLimitLogger } = require('./ratelimit');

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

// express-rate-limit v8 uses `used`, not `current`, for the request count.
function makeReqRes(path, rlUsed, rlLimit, queryK) {
  const req = {
    path,
    query: queryK ? { k: queryK } : {},
    cookies: { sid: 'test-sid' },
    ip: '127.0.0.1',
    rateLimit: { used: rlUsed, limit: rlLimit, remaining: Math.max(0, rlLimit - rlUsed) },
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
  expect(line).toContain('14/100');               // count/limit (now uses rl.used)
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
  const req = { path: '/confirm-contact', query: {}, cookies: {}, ip: '127.0.0.1' };
  const res = { status: jest.fn(() => res), json: jest.fn() };

  expect(() => tooManyRequests(req, res, null, { windowMs: 60000, max: 10 })).not.toThrow();
  const line = spy.mock.calls.find(args => String(args[0]).includes('[RATE-LIMIT]'))?.[0];
  expect(line).toContain('?/10'); // count falls back to '?', limit from optionsUsed

  spy.mockRestore();
});

// --- poll kind splitting ---

test('tooManyRequests splits -POLL to -POLL-HR when ?k=hr_review', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res, captured } = makeReqRes('/job/abc/status', 8, 20, 'hr_review');

  tooManyRequests(req, res, null, { windowMs: 3600000, max: 20 });

  expect(captured.error_code).toBe('ERR-RATE-002-POLL-HR');
  spy.mockRestore();
});

test('tooManyRequests splits -POLL to -POLL-REWRITE when ?k=cv_tailor', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res, captured } = makeReqRes('/job/abc/status', 8, 20, 'cv_tailor');

  tooManyRequests(req, res, null, { windowMs: 3600000, max: 20 });

  expect(captured.error_code).toBe('ERR-RATE-002-POLL-REWRITE');
  spy.mockRestore();
});

test('tooManyRequests splits -POLL to -POLL-UPLOAD when ?k=reading_cv', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res, captured } = makeReqRes('/job/abc/status', 8, 20, 'reading_cv');

  tooManyRequests(req, res, null, { windowMs: 3600000, max: 20 });

  expect(captured.error_code).toBe('ERR-RATE-002-POLL-UPLOAD');
  spy.mockRestore();
});

test('tooManyRequests splits -POLL to -POLL-PARSE when ?k=parsing_job', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req, res, captured } = makeReqRes('/job/abc/status', 8, 20, 'parsing_job');

  tooManyRequests(req, res, null, { windowMs: 3600000, max: 20 });

  expect(captured.error_code).toBe('ERR-RATE-002-POLL-PARSE');
  spy.mockRestore();
});

test('tooManyRequests keeps -POLL when ?k is absent or unknown', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { req: req1, res: res1, captured: cap1 } = makeReqRes('/job/abc/status', 8, 20);
  tooManyRequests(req1, res1, null, { windowMs: 3600000, max: 20 });
  expect(cap1.error_code).toBe('ERR-RATE-002-POLL');

  const { req: req2, res: res2, captured: cap2 } = makeReqRes('/job/abc/status', 8, 20, 'unknown_kind');
  tooManyRequests(req2, res2, null, { windowMs: 3600000, max: 20 });
  expect(cap2.error_code).toBe('ERR-RATE-002-POLL');

  spy.mockRestore();
});

// --- rateLimitLogger ---

test('rateLimitLogger logs ramp line for tracked API paths', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const next = jest.fn();
  const req = {
    method: 'GET', path: '/job/abc/status',
    rateLimit: { used: 7, limit: 20, remaining: 13 },
  };

  rateLimitLogger(req, {}, next);

  expect(next).toHaveBeenCalled();
  const line = spy.mock.calls.find(args => String(args[0]).includes('[RATE-LIMIT-RAMP]'))?.[0];
  expect(line).toContain('/job/abc/status');
  expect(line).toContain('7/20');

  spy.mockRestore();
});

test('rateLimitLogger does not log for static asset paths', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const next = jest.fn();
  const req = {
    method: 'GET', path: '/style.css',
    rateLimit: { used: 5, limit: 100, remaining: 95 },
  };

  rateLimitLogger(req, {}, next);

  expect(next).toHaveBeenCalled();
  const line = spy.mock.calls.find(args => String(args[0]).includes('[RATE-LIMIT-RAMP]'));
  expect(line).toBeUndefined();

  spy.mockRestore();
});
