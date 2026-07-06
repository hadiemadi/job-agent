'use strict';
const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { findUserByEmail, findUserByGoogleId, createUser, verifyPassword } = require('../services/auth');

// ── Local strategy (email + password) ─────────────────────────────────────────
passport.use(new LocalStrategy(
  { usernameField: 'email', passwordField: 'password', session: false },
  async (email, password, done) => {
    try {
      const user = await findUserByEmail(email);
      if (!user) return done(null, false, { message: 'Invalid email or password.' });
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) return done(null, false, { message: 'Invalid email or password.' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// ── Google OAuth2 strategy ─────────────────────────────────────────────────────
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL must be set in the
// environment (Render dashboard). If not set, the strategy is registered with placeholder
// values — the routes are mounted but will fail gracefully at runtime with a 500 error
// rather than crashing the process at startup.
passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID     || 'GOOGLE_CLIENT_ID_NOT_SET',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET_NOT_SET',
    callbackURL:  process.env.GOOGLE_CALLBACK_URL  || '/auth/google/callback',
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      // Look up by Google ID first; fall back to email if the account pre-dates OAuth sign-in.
      let user = await findUserByGoogleId(profile.id);
      if (!user && email) user = await findUserByEmail(email);
      if (!user) {
        // First-time Google sign-in — create the account.
        user = await createUser({ email, googleId: profile.id });
      } else if (!user.google_id) {
        // Email account exists but was never linked to Google — link it now.
        // (No-op in this pass; a /auth/link route can handle this explicitly in Part 2.)
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// No serializeUser / deserializeUser — we use our own session store (services/session.js),
// not express-session. Passport is used only for strategy-based credential validation;
// session persistence is handled manually (appSession.userId).

module.exports = passport;
