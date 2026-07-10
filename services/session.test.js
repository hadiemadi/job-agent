'use strict';

// Item 6 — idle session timeout (originally 60 min; item 13 raised to 180 min)
// Tests that sessions idle longer than IDLE_LIMIT_MS are dropped by the sweep,
// and that the limit is now 180 minutes.
// Item 8 — AI cost/token tracker: per-session token accumulation and snapshot helpers.

const { als, getSession, IDLE_LIMIT_MS, sweepSessions,
  addSessionTokens, getSessionUsage, resetSessionUsage, snapshotSessionUsage,
  generateTailoringRunId } = require('./session');

describe('Item 6/13 — idle session timeout', () => {
  test('IDLE_LIMIT_MS is exactly 180 minutes (item 13: raised from 60)', () => {
    expect(IDLE_LIMIT_MS).toBe(180 * 60 * 1000);
  });

  test('session idle past 180 minutes is dropped by sweepSessions and treated as fresh on next access', done => {
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

describe('Item 8 — AI cost/token tracker', () => {
  test('addSessionTokens accumulates token counts across multiple calls', done => {
    const sid = 'test-tok-' + Date.now();
    als.run(sid, () => {
      addSessionTokens(100, 50);
      addSessionTokens(200, 80);
      const u = getSessionUsage();
      expect(u.tokIn).toBe(300);
      expect(u.tokOut).toBe(130);
      done();
    });
  });

  test('resetSessionUsage zeroes out usd, tokIn, tokOut', done => {
    const sid = 'test-reset-' + Date.now();
    als.run(sid, () => {
      addSessionTokens(500, 200);
      resetSessionUsage();
      const u = getSessionUsage();
      expect(u.usd).toBe(0);
      expect(u.tokIn).toBe(0);
      expect(u.tokOut).toBe(0);
      done();
    });
  });

  test('snapshotSessionUsage returns a plain copy that does not update when tokens are added later', done => {
    const sid = 'test-snap-' + Date.now();
    als.run(sid, () => {
      addSessionTokens(100, 40);
      const snap = snapshotSessionUsage();
      addSessionTokens(999, 999); // added AFTER snapshot
      expect(snap.tokIn).toBe(100);
      expect(snap.tokOut).toBe(40);
      done();
    });
  });

  test('getSessionUsage returns usd, tokIn, tokOut keys', done => {
    const sid = 'test-keys-' + Date.now();
    als.run(sid, () => {
      const u = getSessionUsage();
      expect(u).toHaveProperty('usd');
      expect(u).toHaveProperty('tokIn');
      expect(u).toHaveProperty('tokOut');
      done();
    });
  });
});

describe('generateTailoringRunId', () => {
  test('format is YYYYMMDD#### (12 chars, date prefix, 4-digit suffix)', () => {
    const id = generateTailoringRunId();
    expect(id).toMatch(/^\d{8}\d{4}$/);   // 8-digit date + 4-digit seq
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(id.slice(0, 8)).toBe(today);    // date prefix is today
    const seq = Number(id.slice(8));
    expect(seq).toBeGreaterThan(0);
    expect(seq).toBeLessThanOrEqual(9999);
  });

  test('successive calls within the same day produce strictly increasing sequence numbers', () => {
    const a = generateTailoringRunId();
    const b = generateTailoringRunId();
    const seqA = Number(a.slice(8));
    const seqB = Number(b.slice(8));
    expect(seqB).toBe(seqA + 1);
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
  });

  test('tailoringRunId field is present (null before first tailor) in a fresh session', done => {
    const sid = 'test-runid-' + Date.now();
    als.run(sid, () => {
      const session = getSession();
      expect(Object.prototype.hasOwnProperty.call(session, 'tailoringRunId')).toBe(true);
      expect(session.tailoringRunId).toBeNull();
      done();
    });
  });
});
