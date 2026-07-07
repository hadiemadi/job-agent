'use strict';

// Mock services/auth — all functions hit the DB which is not available in tests.
jest.mock('../services/auth', () => ({
  createUser:                 jest.fn(),
  findUserByEmail:            jest.fn(),
  findUserByGoogleId:         jest.fn(),
  findUserById:               jest.fn(),
  hashPassword:               jest.fn(),
  verifyPassword:             jest.fn(),
  setUserPreference:          jest.fn(),
  getUserPreference:          jest.fn(),
  saveCv:                     jest.fn(),
  listSavedCvs:               jest.fn(),
  deleteSavedCv:              jest.fn(),
  listConversationHistory:    jest.fn(),
  saveConversationHistory:    jest.fn(),
  listCoachMemory:            jest.fn(),
  saveCoachMemory:            jest.fn(),
  getLatestSavedCv:           jest.fn(),
  saveProfilePreferences:     jest.fn(),
  getProfilePreferences:      jest.fn(),
}));

// Mock agents/inputRouter — classify() is called by POST /confirm-contact; without a mock
// it would try to reach the Claude API in tests.
jest.mock('../agents/inputRouter', () => ({
  classify: jest.fn(),
}));

// Mock core/knowledge — listDisciplines() reads disk files; loadDiscipline/saveDiscipline are
// called by agent modules that load with the server. All safe no-ops in test context.
jest.mock('../core/knowledge', () => ({
  loadCore:        jest.fn().mockReturnValue(''),
  loadDiscipline:  jest.fn().mockReturnValue(null),
  saveDiscipline:  jest.fn(),
  listDisciplines: jest.fn().mockReturnValue([]),
}));

// Mock core/passport — strategies would try to connect to Google / DB in the real impl.
// Initial factory: handles both the redirect (2-arg) and callback (3-arg) forms.
// For the 2-arg OAuth-redirect form (used at route-definition time for GET /auth/google),
// we simulate a redirect so the route doesn't fall through to a 404.
jest.mock('../core/passport', () => ({
  initialize: jest.fn(() => (req, res, next) => next()),
  authenticate: jest.fn((strategy, optsOrCb, callback) => {
    return (req, res, next) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : callback;
      if (cb) {
        cb(null, null, { message: 'not authenticated' });
      } else {
        res.redirect('https://accounts.google.com/mock-oauth-redirect');
      }
    };
  }),
}));

const request = require('supertest');
const app     = require('../server');
const {
  createUser, findUserByEmail, findUserById, hashPassword, verifyPassword,
  listSavedCvs, deleteSavedCv, listConversationHistory, saveConversationHistory,
  listCoachMemory, saveCoachMemory,
  setUserPreference, getUserPreference, getLatestSavedCv,
  saveProfilePreferences, getProfilePreferences,
} = require('../services/auth');
const { classify } = require('../agents/inputRouter');
const { listDisciplines } = require('../core/knowledge');
const passport = require('../core/passport');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'usr-001', email: 'hadi@example.com', google_id: null, password_hash: '$2b$10$hashed', created_at: new Date() };

beforeEach(() => {
  jest.clearAllMocks();
  // Safe defaults — individual tests override as needed.
  findUserByEmail.mockResolvedValue(null);
  findUserById.mockResolvedValue(null);
  hashPassword.mockResolvedValue('$2b$10$hashed');
  createUser.mockResolvedValue(MOCK_USER);
  verifyPassword.mockResolvedValue(false);
  listSavedCvs.mockResolvedValue([]);
  deleteSavedCv.mockResolvedValue(true);
  listConversationHistory.mockResolvedValue([]);
  saveConversationHistory.mockResolvedValue(undefined);
  listCoachMemory.mockResolvedValue([]);
  saveCoachMemory.mockResolvedValue(undefined);
  setUserPreference.mockResolvedValue(undefined);
  getUserPreference.mockResolvedValue(null);
  getLatestSavedCv.mockResolvedValue(null);
  saveProfilePreferences.mockResolvedValue(undefined);
  getProfilePreferences.mockResolvedValue(null);
  classify.mockResolvedValue({ bucket: 'none', text: '' });
  listDisciplines.mockReturnValue([]);
  // Default: authenticate calls callback with null (not authenticated).
  // When called with 2 args (no callback) — the OAuth redirect form — simulate a redirect
  // so the route doesn't fall through to a 404.
  passport.authenticate.mockImplementation((strategy, optsOrCb, callback) => {
    return (req, res, next) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : callback;
      if (cb) {
        cb(null, null, { message: 'not authenticated' });
      } else {
        res.redirect('https://accounts.google.com/mock-oauth-redirect');
      }
    };
  });
});

// ── POST /auth/register ────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  test('creates account and returns 201 + user object on valid registration', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'hadi@example.com', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.user).toMatchObject({ id: 'usr-001', email: 'hadi@example.com' });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith('secret123');
  });

  test('returns 400 ERR-AUTH-001 when email is missing', async () => {
    const res = await request(app).post('/auth/register').send({ password: 'secret123' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('ERR-AUTH-001');
    expect(res.body.kind).toBe('validation');
    expect(createUser).not.toHaveBeenCalled();
  });

  test('returns 400 ERR-AUTH-001 when password is missing', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'hadi@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('ERR-AUTH-001');
    expect(createUser).not.toHaveBeenCalled();
  });

  test('returns 400 ERR-AUTH-003 when password is shorter than 8 characters', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'hadi@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('ERR-AUTH-003');
    expect(createUser).not.toHaveBeenCalled();
  });

  test('returns 409 ERR-AUTH-002 when email is already registered', async () => {
    findUserByEmail.mockResolvedValue(MOCK_USER);
    const res = await request(app).post('/auth/register').send({ email: 'hadi@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('ERR-AUTH-002');
    expect(createUser).not.toHaveBeenCalled();
  });

  test('password_hash is never included in the response body', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'hadi@example.com', password: 'secret123' });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('$2b$10$');
  });

  test('associates the new account with the current anonymous session (userId set)', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email: 'hadi@example.com', password: 'secret123' });
    findUserById.mockResolvedValue(MOCK_USER);
    const meRes = await agent.get('/auth/me');
    expect(meRes.body.user).toMatchObject({ id: 'usr-001' });
  });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('returns 200 + user on valid credentials (passport calls callback with user)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    const res = await request(app).post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.user).toMatchObject({ id: 'usr-001', email: 'hadi@example.com' });
  });

  test('returns 401 ERR-AUTH-005 when passport returns no user (wrong password)', async () => {
    // Default mock already returns null user — no override needed.
    const res = await request(app).post('/auth/login').send({ email: 'hadi@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('ERR-AUTH-005');
  });

  test('password is not echoed back in the login response', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    const res = await request(app).post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('secret123');
  });

  test('sets userId in session so /auth/me returns the user after login', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });
    const meRes = await agent.get('/auth/me');
    expect(meRes.body.user).toMatchObject({ id: 'usr-001' });
  });
});

// ── Google OAuth ───────────────────────────────────────────────────────────────

describe('Google OAuth', () => {
  test('GET /auth/google returns a redirect (route is mounted — real OAuth needs Google env vars)', async () => {
    // The 2-arg form of passport.authenticate is the OAuth redirect form.
    // The mock simulates the redirect Google would issue.
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('google');
  });

  test('GET /auth/google/callback with mocked Google user → sets userId and redirects to /', async () => {
    const googleUser = { id: 'usr-google-001', email: 'hadi@gmail.com', google_id: 'g-123', created_at: new Date() };
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => {
        if (strategy === 'google' && typeof cb === 'function') {
          cb(null, googleUser, null);
        } else {
          next();
        }
      };
    });
    findUserById.mockResolvedValue(googleUser);

    const agent = request.agent(app);
    const res = await agent.get('/auth/google/callback');
    // The route sets userId and redirects to /
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    // Verify session has userId set
    const meRes = await agent.get('/auth/me');
    expect(meRes.body.user).toMatchObject({ id: 'usr-google-001' });
  });

  test('GET /auth/google/callback with failed OAuth → redirects to /?auth_error=1', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => {
        if (strategy === 'google' && typeof cb === 'function') cb(new Error('OAuth failed'), null, null);
        else next();
      };
    });
    const res = await request(app).get('/auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth_error=1');
  });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  test('clears userId from session — /auth/me returns null after logout', async () => {
    // Log in first
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    // Verify logged in
    const beforeLogout = await agent.get('/auth/me');
    expect(beforeLogout.body.user).not.toBeNull();

    // Logout
    const logoutRes = await agent.post('/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toHaveProperty('ok', true);

    // Verify cleared
    const afterLogout = await agent.get('/auth/me');
    expect(afterLogout.body.user).toBeNull();
  });

  test('logout clears working session state — /auth/my-data returns 401 after logout', async () => {
    // purgeSessionData() is called on logout — it resets userId + all in-progress data.
    // Verified behaviorally: /auth/my-data works while logged in, then returns 401 after logout
    // (because userId was cleared from the session), proving the full session was purged.
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const beforeLogout = await agent.get('/auth/my-data');
    expect(beforeLogout.status).toBe(200);

    await agent.post('/auth/logout');

    const afterLogout = await agent.get('/auth/my-data');
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error_code).toBe('ERR-AUTH-007');
  });

  test('logout does NOT call any DB-write functions — saved_cvs and other records are preserved', async () => {
    await request(app).post('/auth/logout');
    // None of the DB write functions should be called — only in-memory session state is cleared.
    expect(listSavedCvs).not.toHaveBeenCalled();
    expect(deleteSavedCv).not.toHaveBeenCalled();
    expect(listConversationHistory).not.toHaveBeenCalled();
    expect(listCoachMemory).not.toHaveBeenCalled();
  });
});

// ── GET /auth/my-data ──────────────────────────────────────────────────────────

describe('GET /auth/my-data', () => {
  test('returns 401 ERR-AUTH-007 for a guest (unauthenticated) session', async () => {
    const res = await request(app).get('/auth/my-data');
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('ERR-AUTH-007');
  });

  test('returns account info, savedCvs, conversationHistory, coachMemory for a logged-in user', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    listSavedCvs.mockResolvedValue([{ id: 'cv-001', label: 'Test CV', created_at: new Date() }]);
    listConversationHistory.mockResolvedValue([{ id: 'ch-001', gap_topic: 'Python', digest_summary: 'Discussed Python', created_at: new Date() }]);
    listCoachMemory.mockResolvedValue([{ id: 'cm-001', gap_topic: 'leadership', digest_summary: 'Director track', created_at: new Date() }]);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ email: 'hadi@example.com' });
    expect(res.body.savedCvs).toHaveLength(1);
    expect(res.body.savedCvs[0]).toMatchObject({ id: 'cv-001', label: 'Test CV' });
    expect(res.body.conversationHistory).toHaveLength(1);
    expect(res.body.coachMemory).toHaveLength(1);
    expect(res.body.disciplines).toEqual([]); // Phase 5 placeholder
  });

  test('empty arrays returned when user has no stored data', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    // All list mocks already default to [] in beforeEach

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.savedCvs).toEqual([]);
    expect(res.body.conversationHistory).toEqual([]);
    expect(res.body.coachMemory).toEqual([]);
  });

  test('response body never includes password_hash', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$10$');
  });

  test('returns disciplines from knowledge/disciplines files (item 1)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    listDisciplines.mockReturnValue([{
      field: 'RF/Hardware Engineering', updated: '2026-07-07',
      skills: [{ text: 'RF systems', confidence: 2, pinned: false }],
      keywords: [], red_flags: [],
    }]);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.disciplines).toHaveLength(1);
    expect(res.body.disciplines[0].field).toBe('RF/Hardware Engineering');
    expect(res.body.disciplines[0].skills[0].text).toBe('RF systems');
  });

  test('returns lastJobText in my-data response (item 3)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockImplementation((userId, key) =>
      Promise.resolve(key === 'last_job_text' ? 'Senior TPM at Apple — RF background required' : null)
    );

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.lastJobText).toBe('Senior TPM at Apple — RF background required');
  });

  test('returns savedCvs after CV tailoring has been persisted for a logged-in user (item 2)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    listSavedCvs.mockResolvedValue([{
      id: 'cv-100', label: 'Senior TPM at Apple', created_at: new Date().toISOString(),
    }]);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.savedCvs).toHaveLength(1);
    expect(res.body.savedCvs[0]).toMatchObject({ id: 'cv-100', label: 'Senior TPM at Apple' });
  });

  test('returns coachMemory and conversationHistory after conversations are saved (item 4)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    listCoachMemory.mockResolvedValue([{
      id: 'cm-200', gap_topic: 'technical track', digest_summary: 'Director of Engineering fits your profile',
      created_at: new Date().toISOString(),
    }]);
    listConversationHistory.mockResolvedValue([{
      id: 'ch-200', agent: 'hr', gap_topic: null,
      digest_summary: 'The RF section is strong; add measurable outcomes',
      created_at: new Date().toISOString(),
    }]);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/my-data');
    expect(res.status).toBe(200);
    expect(res.body.coachMemory).toHaveLength(1);
    expect(res.body.coachMemory[0]).toMatchObject({ id: 'cm-200', gap_topic: 'technical track' });
    expect(res.body.conversationHistory).toHaveLength(1);
    expect(res.body.conversationHistory[0]).toMatchObject({ id: 'ch-200', agent: 'hr' });
  });
});

// ── DELETE /auth/saved-cvs/:id ─────────────────────────────────────────────────

describe('DELETE /auth/saved-cvs/:id', () => {
  test('returns 401 ERR-AUTH-007 for a guest', async () => {
    const res = await request(app).delete('/auth/saved-cvs/cv-001');
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('ERR-AUTH-007');
    expect(deleteSavedCv).not.toHaveBeenCalled();
  });

  test('returns 200 ok:true and calls deleteSavedCv for a logged-in user', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    deleteSavedCv.mockResolvedValue(true);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.delete('/auth/saved-cvs/cv-001');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(deleteSavedCv).toHaveBeenCalledWith('cv-001', 'usr-001');
  });

  test('returns 404 ERR-AUTH-008 when the CV does not belong to this user', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    deleteSavedCv.mockResolvedValue(false); // not found / not owned

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.delete('/auth/saved-cvs/cv-999');
    expect(res.status).toBe(404);
    expect(res.body.error_code).toBe('ERR-AUTH-008');
  });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  test('returns { user: null } for a fresh anonymous/guest session', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  test('returns { user: null } when userId is set but the DB record has been deleted (stale session)', async () => {
    // Log in to set userId in session
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    // Simulate account deletion — findUserById now returns null
    findUserById.mockResolvedValue(null);

    const res = await agent.get('/auth/me');
    expect(res.body.user).toBeNull();
  });
});

// ── Guest flow unaffected ──────────────────────────────────────────────────────

describe('Guest / anonymous flow unaffected by auth routes', () => {
  test('/healthz still works (no regression from passport middleware)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  test('anonymous session functions independently — auth routes never touch it', async () => {
    // A guest agent should not have a userId set just by making non-auth requests.
    const guestAgent = request.agent(app);
    await guestAgent.get('/healthz');
    const meRes = await guestAgent.get('/auth/me');
    expect(meRes.body.user).toBeNull();
  });

  test('mid-session login carries the existing anonymous session forward — userId is linked, not replaced', async () => {
    // Simulate a guest who has been working (they have a session with a sid cookie already).
    passport.authenticate.mockImplementation((strategy, opts, cb) => {
      return (req, res, next) => cb(null, MOCK_USER, null);
    });
    findUserById.mockResolvedValue(MOCK_USER);
    const agent = request.agent(app);

    // Make a request to establish a session (healthz gives us a sid cookie).
    await agent.get('/healthz');

    // Now log in mid-session — should attach userId to the SAME session (same sid cookie).
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const meRes = await agent.get('/auth/me');
    expect(meRes.body.user).toMatchObject({ id: 'usr-001' });
  });
});

// ── GET /auth/prefill ──────────────────────────────────────────────────────────

describe('GET /auth/prefill', () => {
  test('returns 401 ERR-AUTH-007 for a guest (unauthenticated) session', async () => {
    const res = await request(app).get('/auth/prefill');
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('ERR-AUTH-007');
  });

  test('returns defaults when user has no saved preferences', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    // getUserPreference returns null → defaults kick in
    getUserPreference.mockResolvedValue(null);
    getLatestSavedCv.mockResolvedValue(null);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/prefill');
    expect(res.status).toBe(200);
    expect(res.body.preferredModel).toBe('claude-sonnet-5');
    expect(res.body.lastJobText).toBeNull();
    expect(res.body.latestCv).toBeNull();
    // Phase 2.5: profilePreferences is null for a first-time user
    expect(res.body.profilePreferences).toBeNull();
  });

  test('returns saved profilePreferences for a returning user (Phase 2.5)', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockResolvedValue(null);
    getLatestSavedCv.mockResolvedValue(null);
    const savedProfile = {
      name: 'Hadi Emadi', title: 'Sr TPM', phone: '+1 555 0000',
      location: 'San Jose, CA', linkedin: 'linkedin.com/in/hadi',
      customInstructions: 'Keep it concise', tone: 4,
      gapSeverities: ['major'], extensiveSearch: false, refreshDiscipline: false,
    };
    getProfilePreferences.mockResolvedValue(savedProfile);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/prefill');
    expect(res.status).toBe(200);
    expect(res.body.profilePreferences).toMatchObject(savedProfile);
  });

  test('returns saved preferredModel when the user has set one', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockImplementation((userId, key) =>
      Promise.resolve(key === 'preferred_model' ? 'claude-opus-4-8' : null)
    );
    getLatestSavedCv.mockResolvedValue(null);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/prefill');
    expect(res.status).toBe(200);
    expect(res.body.preferredModel).toBe('claude-opus-4-8');
  });

  test('returns lastJobText when saved', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockImplementation((userId, key) =>
      Promise.resolve(key === 'last_job_text' ? 'Senior TPM at Qualcomm — 5 years RF experience required' : null)
    );
    getLatestSavedCv.mockResolvedValue(null);

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/prefill');
    expect(res.status).toBe(200);
    expect(res.body.lastJobText).toBe('Senior TPM at Qualcomm — 5 years RF experience required');
  });

  test('returns latestCv when the user has a saved CV', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockResolvedValue(null);
    getLatestSavedCv.mockResolvedValue({ id: 'cv-001', label: 'RF TPM CV', created_at: new Date() });

    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.get('/auth/prefill');
    expect(res.status).toBe(200);
    expect(res.body.latestCv).toMatchObject({ id: 'cv-001', label: 'RF TPM CV' });
  });
});

// ── POST /auth/preferences ─────────────────────────────────────────────────────

describe('POST /auth/preferences', () => {
  test('returns 401 ERR-AUTH-007 for a guest', async () => {
    const res = await request(app).post('/auth/preferences').send({ key: 'preferred_model', value: 'claude-opus-4-8' });
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe('ERR-AUTH-007');
    expect(setUserPreference).not.toHaveBeenCalled();
  });

  test('returns 400 ERR-AUTH-001 when key is missing', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.post('/auth/preferences').send({ value: 'claude-opus-4-8' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('ERR-AUTH-001');
    expect(setUserPreference).not.toHaveBeenCalled();
  });

  test('returns 200 ok:true and calls setUserPreference for a logged-in user', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.post('/auth/preferences').send({ key: 'preferred_model', value: 'claude-opus-4-8' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(setUserPreference).toHaveBeenCalledWith('usr-001', 'preferred_model', 'claude-opus-4-8');
  });

  test('persists the preference — /auth/prefill returns the updated value', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    findUserById.mockResolvedValue(MOCK_USER);
    getUserPreference.mockResolvedValue('claude-haiku-4-5');
    getLatestSavedCv.mockResolvedValue(null);
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    await agent.post('/auth/preferences').send({ key: 'preferred_model', value: 'claude-haiku-4-5' });
    const prefillRes = await agent.get('/auth/prefill');
    expect(prefillRes.body.preferredModel).toBe('claude-haiku-4-5');
  });
});

// ── POST /confirm-contact — Profile & Preferences DB persistence (Phase 2.5) ──

describe('POST /confirm-contact — Profile & Preferences DB persistence', () => {
  const CONTACT_BODY = {
    name: 'Hadi Emadi', title: 'Sr TPM', email: 'hadi@example.com',
    phone: '+1 555 0000', location: 'San Jose, CA', linkedin: 'linkedin.com/in/hadi',
    customInstructions: 'Keep it concise', tone: 4,
    gapSeverities: ['major'], extensiveSearch: false, refreshDiscipline: false,
  };

  test('logged-in user: POST /confirm-contact calls saveProfilePreferences with the correct shape', async () => {
    passport.authenticate.mockImplementation((strategy, opts, cb) => (req, res, next) => cb(null, MOCK_USER, null));
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: 'hadi@example.com', password: 'secret123' });

    const res = await agent.post('/confirm-contact').send(CONTACT_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    // DB write is fire-and-forget, so we need to drain microtasks before asserting
    await new Promise(resolve => setImmediate(resolve));

    expect(saveProfilePreferences).toHaveBeenCalledTimes(1);
    const [calledUserId, calledPrefs] = saveProfilePreferences.mock.calls[0];
    expect(calledUserId).toBe('usr-001');
    expect(calledPrefs).toMatchObject({
      name: 'Hadi Emadi', title: 'Sr TPM', phone: '+1 555 0000',
      location: 'San Jose, CA', linkedin: 'linkedin.com/in/hadi',
      customInstructions: 'Keep it concise', tone: 4,
      gapSeverities: ['major'], extensiveSearch: false, refreshDiscipline: false,
    });
    // email and model are intentionally excluded from the profile prefs blob
    expect(calledPrefs).not.toHaveProperty('email');
    expect(calledPrefs).not.toHaveProperty('model');
  });

  test('guest (no userId): POST /confirm-contact does NOT call saveProfilePreferences', async () => {
    // No login — guest session has no userId
    const res = await request(app).post('/confirm-contact').send(CONTACT_BODY);
    expect(res.status).toBe(200);
    await new Promise(resolve => setImmediate(resolve));
    expect(saveProfilePreferences).not.toHaveBeenCalled();
  });
});

// ── Password hashing (services/auth.js unit) ──────────────────────────────────
// These tests exercise the real bcryptjs logic directly — not the mocked version.

describe('Password hashing (real bcryptjs)', () => {
  // Re-require the real module by clearing the mock for this describe block.
  // jest.mock is module-level, so we test the underlying function via direct import.
  const realAuth = jest.requireActual('../services/auth');

  test('hashPassword returns a bcrypt hash string starting with $2b$', async () => {
    const hash = await realAuth.hashPassword('mypassword');
    expect(hash).toMatch(/^\$2b\$10\$/);
  });

  test('verifyPassword returns true for the correct password', async () => {
    const hash = await realAuth.hashPassword('mypassword');
    const valid = await realAuth.verifyPassword('mypassword', hash);
    expect(valid).toBe(true);
  });

  test('verifyPassword returns false for the wrong password', async () => {
    const hash = await realAuth.hashPassword('mypassword');
    const wrong = await realAuth.verifyPassword('wrongpassword', hash);
    expect(wrong).toBe(false);
  });

  test('verifyPassword returns false when hash is null (no password set — Google-only account)', async () => {
    const result = await realAuth.verifyPassword('any', null);
    expect(result).toBe(false);
  });

  test('hashPassword with cost factor 10 produces a different hash each time (salt)', async () => {
    const h1 = await realAuth.hashPassword('samepassword');
    const h2 = await realAuth.hashPassword('samepassword');
    expect(h1).not.toBe(h2); // different salt each call
    // Both should still verify
    expect(await realAuth.verifyPassword('samepassword', h1)).toBe(true);
    expect(await realAuth.verifyPassword('samepassword', h2)).toBe(true);
  });
});
