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

// ── User profile — persistent career profile for cross-session agent context ──
// One row per user, JSONB schema versioned (profile.version). Agents inject a
// compact formatted block from this instead of replaying raw conversation turns.

async function saveUserProfile(userId, profile) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_profiles (user_id, profile, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET profile = $2, updated_at = now()`,
    [userId, JSON.stringify(profile)]
  );
}

async function getUserProfile(userId) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT profile FROM user_profiles WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.profile ?? null;
}

// ── Gap memory — per user, per gap slogan ─────────────────────────────────────
// Accumulates across CV-tailor sessions: coach conversation is APPENDED (never replaced),
// other fields use latest non-null value. Linked by gap_slogan so the same gap topic is
// recognised across different job applications for the same user.

async function upsertGapMemory(userId, { gapSlogan, coachConversation, coachVerdict, hrStatement, userDecision, tailoringRunId = 'legacy' }) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  const id = genId();
  const runId = tailoringRunId || 'legacy';
  await pool.query(
    `INSERT INTO gap_memory (id, user_id, gap_slogan, tailoring_run_id, coach_conversation, coach_verdict, hr_statement, user_decision)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     ON CONFLICT (user_id, gap_slogan, tailoring_run_id) DO UPDATE SET
       coach_conversation = gap_memory.coach_conversation || EXCLUDED.coach_conversation,
       coach_verdict      = COALESCE(EXCLUDED.coach_verdict,   gap_memory.coach_verdict),
       hr_statement       = COALESCE(EXCLUDED.hr_statement,    gap_memory.hr_statement),
       user_decision      = COALESCE(EXCLUDED.user_decision,   gap_memory.user_decision),
       updated_at         = now()`,
    [
      id, userId, gapSlogan, runId,
      JSON.stringify(coachConversation || []),
      coachVerdict || null,
      hrStatement  || null,
      userDecision || null,
    ]
  );
}

// Returns the most recent prior-run row for this gap (excludes the current run so Coach
// only sees history, not the empty row that would exist if the current run wrote first).
async function findGapMemoryBySlogan(userId, gapSlogan, excludeRunId = null) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT gap_slogan, coach_conversation, coach_verdict
     FROM gap_memory
     WHERE user_id = $1 AND gap_slogan = $2
       AND ($3::text IS NULL OR tailoring_run_id IS DISTINCT FROM $3)
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, gapSlogan, excludeRunId || null]
  );
  return rows[0] || null;
}

async function listGapMemory(userId) {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, gap_slogan, tailoring_run_id, coach_verdict, hr_statement, user_decision, updated_at
     FROM gap_memory WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows;
}

// Hard-deletes the user row. All child tables (saved_cvs, user_preferences, gap_memory)
// have ON DELETE CASCADE, so one DELETE clears the full account.
async function deleteUserAccount(userId) {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

module.exports = {
  createUser, findUserByEmail, findUserByGoogleId, findUserById,
  hashPassword, verifyPassword,
  setUserPreference, getUserPreference,
  saveCv, listSavedCvs, deleteSavedCv,
  getLatestSavedCv,
  saveProfilePreferences, getProfilePreferences,
  saveUserProfile, getUserProfile,
  upsertGapMemory, findGapMemoryBySlogan, listGapMemory,
  deleteUserAccount,
};
