// sendError is the single choke point that decides BOTH the client-facing kind (so
// public/app.js renders the right popup) and which table a case is logged to: 'validation'
// goes to the events table (logEvent), real 'error' cases go to the errors table (logError).
jest.mock('./logger', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
}));

const { logEvent, logError } = require('./logger');
const { sendError } = require('./respondError');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  logEvent.mockClear();
  logError.mockClear();
});

test('a validation code responds with kind: "validation" and logs via logEvent, not logError', () => {
  const res = mockRes();
  sendError(res, '/review-cv', 'ERR-HR-001');
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'ERR-HR-001', kind: 'validation' }));
  expect(logEvent).toHaveBeenCalledWith('validation_nudge', { route: '/review-cv', code: 'ERR-HR-001', kind: 'validation' });
  expect(logError).not.toHaveBeenCalled();
});

test('an error code responds with kind: "error" and logs via logError, not logEvent', () => {
  const res = mockRes();
  sendError(res, '/review-cv', 'ERR-HR-003', new Error('boom'));
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'ERR-HR-003', kind: 'error' }));
  expect(logError).toHaveBeenCalledWith('ERR-HR-003', '/review-cv', { errName: 'Error' });
  expect(logEvent).not.toHaveBeenCalled();
});

test('a thrown error tagged with its own code/status (e.g. the budget-cap error) overrides the route default', () => {
  const res = mockRes();
  const tagged = new Error('budget reached');
  tagged.code = 'ERR-RATE-001';
  tagged.status = 429;
  sendError(res, '/hr/refine', 'ERR-HR-005', tagged);
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'ERR-RATE-001', kind: 'rate' }));
  // rate kind: not a bug, not missing input — no logError, no logEvent
  expect(logError).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
});

test('a rate code responds with kind: "rate" and logs via neither logEvent nor logError', () => {
  const res = mockRes();
  sendError(res, '/review-cv', 'ERR-RATE-002');
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'ERR-RATE-002', kind: 'rate' }));
  expect(logEvent).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
});
