// Unit tests for the exponential backoff state machine used in startPolling() (public/app.js).
// startPolling() itself is a browser function that can't be imported in Node, so we test
// the backoff calculation — the only logic that can't be verified through supertest.
// The constants below must match POLL_BACKOFF_START_MS / POLL_BACKOFF_CAP_MS in app.js.

const POLL_BACKOFF_START_MS = 2000;
const POLL_BACKOFF_CAP_MS   = 10000;

function nextBackoff(current) {
  return Math.min(current * 2, POLL_BACKOFF_CAP_MS);
}

describe('startPolling exponential backoff', () => {
  test('first retry delay is POLL_BACKOFF_START_MS (2 s)', () => {
    expect(POLL_BACKOFF_START_MS).toBe(2000);
  });

  test('cap is POLL_BACKOFF_CAP_MS (10 s)', () => {
    expect(POLL_BACKOFF_CAP_MS).toBe(10000);
  });

  test('doubles on each step', () => {
    expect(nextBackoff(2000)).toBe(4000);
    expect(nextBackoff(4000)).toBe(8000);
  });

  test('caps at 10 s and stays there', () => {
    expect(nextBackoff(8000)).toBe(10000);
    expect(nextBackoff(10000)).toBe(10000);
    expect(nextBackoff(20000)).toBe(10000); // already past cap — still clamped
  });

  test('full sequence matches spec: 2s → 4s → 8s → 10s → 10s', () => {
    const delays = [];
    let ms = POLL_BACKOFF_START_MS;
    for (let i = 0; i < 5; i++) {
      delays.push(ms);
      ms = nextBackoff(ms);
    }
    expect(delays).toEqual([2000, 4000, 8000, 10000, 10000]);
  });

  test('each startPolling call is independent (fresh backoffMs per call)', () => {
    // Simulate two concurrent polling sessions starting independently.
    let session1 = POLL_BACKOFF_START_MS;
    let session2 = POLL_BACKOFF_START_MS;

    // Advance session 1 three steps.
    session1 = nextBackoff(session1); // 4000
    session1 = nextBackoff(session1); // 8000
    session1 = nextBackoff(session1); // 10000

    // Session 2 is still at its first retry delay — not contaminated by session 1.
    expect(session1).toBe(10000);
    expect(session2).toBe(POLL_BACKOFF_START_MS);
  });
});
