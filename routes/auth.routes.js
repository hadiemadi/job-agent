'use strict';
const express = require('express');
const passport = require('../core/passport');
const { getSession, purgeSessionData } = require('../services/session');
const {
  createUser, findUserByEmail, findUserById, hashPassword,
  listSavedCvs, deleteSavedCv,
  setUserPreference, getUserPreference, getLatestSavedCv,
  getProfilePreferences, deleteUserAccount,
} = require('../services/auth');
const { listDisciplines } = require('../core/knowledge');
const { sendError } = require('../core/respondError');
const { logEvent } = require('../core/logger');

const router = express.Router();

// Minimum password length — 8 chars (bcryptjs can handle any length beyond this)
const MIN_PASSWORD_LENGTH = 8;

// ── POST /auth/register — email + password account creation ───────────────────
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) return sendError(res, '/auth/register', 'ERR-AUTH-001');
    if (password.length < MIN_PASSWORD_LENGTH) return sendError(res, '/auth/register', 'ERR-AUTH-003');

    const existing = await findUserByEmail(email);
    if (existing) return sendError(res, '/auth/register', 'ERR-AUTH-002');

    const passwordHash = await hashPassword(password);
    const user = await createUser({ email: email.toLowerCase().trim(), passwordHash });

    // Associate the new account with the current (possibly in-progress) anonymous session
    // so any work done before registering (uploaded CV, ongoing HR review) is preserved.
    const appSession = getSession();
    appSession.userId = user.id;

    logEvent('user_registered', { route: '/auth/register' });
    res.status(201).json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    if (err.message === 'Database unavailable') return sendError(res, '/auth/register', 'ERR-AUTH-006', err);
    sendError(res, '/auth/register', 'ERR-AUTH-004', err);
  }
});

// ── POST /auth/login — email + password sign-in ────────────────────────────────
router.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user) => {
    if (err) return sendError(res, '/auth/login', 'ERR-AUTH-004', err);
    if (!user) return sendError(res, '/auth/login', 'ERR-AUTH-005');

    // Link the authenticated user to the existing anonymous session — in-progress work
    // (job search, HR gaps, etc.) stays intact.
    const appSession = getSession();
    appSession.userId = user.id;

    logEvent('user_logged_in', { route: '/auth/login' });
    res.json({ ok: true, user: { id: user.id, email: user.email } });
  })(req, res, next);
});

// ── GET /auth/google — redirect to Google OAuth consent screen ─────────────────
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// ── GET /auth/google/callback — Google redirects back here with an auth code ──
router.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      // OAuth failed — redirect to the main page with a query flag the frontend can read.
      return res.redirect('/?auth_error=1');
    }
    const appSession = getSession();
    appSession.userId = user.id;

    logEvent('user_logged_in_google', { route: '/auth/google/callback' });
    res.redirect('/');
  })(req, res, next);
});

// ── POST /auth/logout — clear auth state AND all in-progress working data ──────
// purgeSessionData() resets the session to a blank createSession() state (userId=null,
// cvText=null, etc.) so the next person using the browser sees nothing from the previous
// user's session. DB records (saved_cvs, gap_memory, etc.) are left intact — those
// belong to the account and persist across logins by design.
router.post('/auth/logout', (req, res) => {
  purgeSessionData();
  logEvent('user_logged_out', { route: '/auth/logout' });
  res.json({ ok: true });
});

// ── GET /auth/my-data — return all stored data for the current logged-in user ──
router.get('/auth/my-data', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return sendError(res, '/auth/my-data', 'ERR-AUTH-007');

    const user = await findUserById(appSession.userId);
    if (!user) {
      appSession.userId = null;
      return sendError(res, '/auth/my-data', 'ERR-AUTH-007');
    }

    const [savedCvs, lastJobText] = await Promise.all([
      listSavedCvs(appSession.userId),
      getUserPreference(appSession.userId, 'last_job_text'),
    ]);

    res.json({
      account: { email: user.email, created_at: user.created_at },
      savedCvs,
      lastJobText: lastJobText || null,
      disciplines: listDisciplines(),
    });
  } catch (err) {
    sendError(res, '/auth/my-data', 'ERR-AUTH-004', err);
  }
});

// ── DELETE /auth/saved-cvs/:id — delete a saved CV (ownership-verified) ────────
router.delete('/auth/saved-cvs/:id', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return sendError(res, '/auth/saved-cvs/:id', 'ERR-AUTH-007');

    const deleted = await deleteSavedCv(req.params.id, appSession.userId);
    if (!deleted) return sendError(res, '/auth/saved-cvs/:id', 'ERR-AUTH-008');

    res.json({ ok: true });
  } catch (err) {
    sendError(res, '/auth/saved-cvs/:id', 'ERR-AUTH-004', err);
  }
});

// ── GET /auth/prefill — return saved preferences for pre-filling the form ────────
// Returns preferredModel (string), lastJobText (string|null), latestCv ({id,label,created_at}|null),
// profilePreferences (object|null — the full Profile & Preferences form snapshot, or null for
// first-time users who have never confirmed a session).
// 401 for guests — only meaningful for authenticated users.
router.get('/auth/prefill', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return sendError(res, '/auth/prefill', 'ERR-AUTH-007');

    const user = await findUserById(appSession.userId);
    if (!user) { appSession.userId = null; return sendError(res, '/auth/prefill', 'ERR-AUTH-007'); }

    const [preferredModel, lastJobText, latestCv, profilePreferences] = await Promise.all([
      getUserPreference(appSession.userId, 'preferred_model'),
      getUserPreference(appSession.userId, 'last_job_text'),
      getLatestSavedCv(appSession.userId),
      getProfilePreferences(appSession.userId),
    ]);

    res.json({
      preferredModel: preferredModel || 'claude-sonnet-4-6',
      lastJobText: lastJobText || null,
      latestCv: latestCv || null,
      profilePreferences: profilePreferences || null,
    });
  } catch (err) {
    sendError(res, '/auth/prefill', 'ERR-AUTH-004', err);
  }
});

// ── POST /auth/preferences — save a single user preference key/value ─────────────
// Used by the model picker and other per-user settings. Persists to user_preferences table.
router.post('/auth/preferences', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return sendError(res, '/auth/preferences', 'ERR-AUTH-007');

    const { key, value } = req.body || {};
    if (!key) return sendError(res, '/auth/preferences', 'ERR-AUTH-001');

    await setUserPreference(appSession.userId, key, value);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, '/auth/preferences', 'ERR-AUTH-004', err);
  }
});

// ── GET /auth/me — return the current user or null (for guest sessions) ────────
router.get('/auth/me', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return res.json({ user: null });

    // Re-fetch from DB on every call rather than trusting the session cache — the
    // account might have been deleted between sessions (e.g. account closure).
    const user = await findUserById(appSession.userId);
    if (!user) {
      appSession.userId = null; // stale reference — clear it
      return res.json({ user: null });
    }
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    sendError(res, '/auth/me', 'ERR-AUTH-004', err);
  }
});

// Hard-deletes the authenticated user's account and all associated data (saved_cvs,
// user_preferences, gap_memory — cascade from users row).
// Also purges the current session so the browser is immediately in a clean guest state.
router.delete('/auth/account', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.userId) return sendError(res, '/auth/account', 'ERR-AUTH-007');
    await deleteUserAccount(appSession.userId);
    purgeSessionData();
    logEvent('account_deleted', { route: '/auth/account', outcome: 'ok' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, '/auth/account', 'ERR-AUTH-004', err);
  }
});

module.exports = router;
