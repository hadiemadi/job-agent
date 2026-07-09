'use strict';

// Item 6 — idle session timeout (60 minutes)
// Tests that sessions idle longer than IDLE_LIMIT_MS are dropped by the sweep,
// and that the limit itself is 60 minutes.

const { als, getSession, IDLE_LIMIT_MS, sweepSessions } = require('./session');

describe('Item 6 — idle session timeout', () => {
  test('IDLE_LIMIT_MS is exactly 60 minutes', () => {
    expect(IDLE_LIMIT_MS).toBe(60 * 60 * 1000);
  });

  test('session idle past 60 minutes is dropped by sweepSessions and treated as fresh on next access', done => {
    // Run inside ALS so getSession() has a stable session ID to work with.
    const sid = 'test-idle-' + Date.now();
    als.run(sid, () => {
      // Create the session and write some state into it.
      const session = getSession();
      session.cvText = 'some old CV text';

      // Artificially age the session past the idle limit.
      session.lastSeen = Date.now() - (IDLE_LIMIT_MS + 1000);

      // Run the sweep — this should delete the aged session from the map.
      sweepSessions();

      // On next access within the same ALS context, getSession() creates a fresh session
      // (the old entry was deleted so sessions.get(sid) returns undefined → createSession).
      const fresh = getSession();
      expect(fresh.cvText).toBeNull(); // fresh session: cvText starts as null (see createSession)
      done();
    });
  });
});
