'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool } = require('../core/db');

const BCRYPT_ROUNDS = 10;

function genId() {
  return crypto.randomUUID();
}

// ── User CRUD ──────────────────────────────────────────────────────────────────

async function createUser({ email, googleId, passwordHash }) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  const id = genId();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, google_id, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id, email, google_id, created_at`,
    [id, email || null, googleId || null, passwordHash || null]
  );
  return rows[0];
}

async function findUserByEmail(email) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT id, email, google_id, password_hash, created_at FROM users WHERE email = $1',
    [email]
  );
  return rows[0] || null;
}

async function findUserByGoogleId(googleId) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT id, email, google_id, created_at FROM users WHERE google_id = $1',
    [googleId]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT id, email, google_id, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// ── Password helpers ───────────────────────────────────────────────────────────

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

async function verifyPassword(plaintext, hash) {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

// ── User preferences ───────────────────────────────────────────────────────────

async function setUserPreference(userId, key, value) {
  const pool = getPool();
  if (!pool) return;
  const id = genId();
  await pool.query(
    `INSERT INTO user_preferences (id, user_id, key, value, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [id, userId, key, JSON.stringify(value)]
  );
}

async function getUserPreference(userId, key) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT value FROM user_preferences WHERE user_id = $1 AND key = $2',
    [userId, key]
  );
  return rows[0] ? rows[0].value : null;
}

// ── Saved CVs ──────────────────────────────────────────────────────────────────

async function saveCv(userId, { cvText, fileRef, label }) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  const id = genId();
  const { rows } = await pool.query(
    `INSERT INTO saved_cvs (id, user_id, cv_text, file_ref, label)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, label, created_at`,
    [id, userId, cvText || null, fileRef || null, label || '']
  );
  return rows[0];
}

async function listSavedCvs(userId) {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    'SELECT id, label, created_at FROM saved_cvs WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

async function deleteSavedCv(cvId, userId) {
  const pool = getPool();
  if (!pool) return false;
  const { rowCount } = await pool.query(
    'DELETE FROM saved_cvs WHERE id = $1 AND user_id = $2',
    [cvId, userId]
  );
  return rowCount > 0;
}

async function listConversationHistory(userId) {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, agent, gap_topic, digest_summary, created_at
     FROM conversation_history WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function saveConversationHistory(userId, { agent, gapTopic, digestSummary, rawLog }) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  const id = genId();
  await pool.query(
    `INSERT INTO conversation_history (id, user_id, agent, gap_topic, digest_summary, raw_log)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, agent || 'hr', gapTopic || null, digestSummary || '', JSON.stringify(rawLog || null)]
  );
}

async function listCoachMemory(userId) {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    'SELECT id, gap_topic, digest_summary, created_at FROM coach_memory WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

async function saveCoachMemory(userId, { gapTopic, digestSummary, rawLog }) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  const id = genId();
  await pool.query(
    `INSERT INTO coach_memory (id, user_id, gap_topic, digest_summary, raw_log)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, gapTopic || 'general', digestSummary || '', JSON.stringify(rawLog || null)]
  );
}

async function getLatestSavedCv(userId) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT id, label, created_at FROM saved_cvs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

// ── Profile & Preferences persistence ─────────────────────────────────────────
// Stores the full Profile & Preferences form submission as a single JSON blob
// under key 'profile_preferences' in user_preferences, so returning users skip
// CV re-extraction on login and see their own confirmed data in the form.

async function saveProfilePreferences(userId, prefs) {
  return setUserPreference(userId, 'profile_preferences', prefs);
}

async function getProfilePreferences(userId) {
  return getUserPreference(userId, 'profile_preferences');
}

module.exports = {
  createUser, findUserByEmail, findUserByGoogleId, findUserById,
  hashPassword, verifyPassword,
  setUserPreference, getUserPreference,
  saveCv, listSavedCvs, deleteSavedCv,
  listConversationHistory, saveConversationHistory,
  listCoachMemory, saveCoachMemory,
  getLatestSavedCv,
  saveProfilePreferences, getProfilePreferences,
};
