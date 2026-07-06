// Unit tests for the stageTag helper in services/ratelimit.js.
// The limiter objects themselves are integration-tested by test.ui.js (skip: true in
// NODE_ENV=test). This file only exercises the pure stageTag function, which maps
// route paths to ERR-RATE-002 stage suffixes so failures are traceable per step.
const { stageTag } = require('./ratelimit');

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
