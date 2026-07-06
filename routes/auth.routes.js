'use strict';
const express = require('express');
const passport = require('../core/passport');
const { getSession } = require('../services/session');
const { createUser, findUserByEmail, findUserById, hashPassword } = require('../services/auth');
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

// ── POST /auth/logout — clear the user ID from the current session ─────────────
router.post('/auth/logout', (req, res) => {
  const appSession = getSession();
  appSession.userId = null;
  logEvent('user_logged_out', { route: '/auth/logout' });
  res.json({ ok: true });
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

module.exports = router;
