'use strict';
const { Pool } = require('pg');

// Render Postgres connection pool — lazily created on first use, not at module load, so
// requiring this file never throws even when DATABASE_URL is unset (local dev, tests). Every
// caller goes through getPool(); a missing/unreachable database means getPool() returns null
// and callers (core/logger.js) no-op rather than throw — a logging/DB failure must never break
// a request or take down the site.
let pool = null;
let warnedMissingUrl = false;
let triedWithSsl = false;
let tablesReady = null; // a Promise once CREATE TABLE IF NOT EXISTS has been kicked off

const EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id_hash TEXT,
  event_type TEXT NOT NULL,
  meta_json JSONB
)`;

const ERRORS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS errors (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id_hash TEXT,
  error_code TEXT NOT NULL,
  route TEXT,
  sanitized_context_json JSONB
)`;

// Async job table — persists CV-tailoring pipeline state so a tab-close/idle doesn't lose
// work. user_id is nullable (links to users.id for logged-in users; null for guests).
// result holds the full pipeline output (filePath, session data to restore) so the
// status-poll route can apply it to the correct session when the client comes back.
// id is a Node-generated UUID (TEXT, not the Postgres uuid type, so no extension needed).
const JOBS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'cv_tailor',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

// ── Auth / user-account tables ─────────────────────────────────────────────────

const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  google_id TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const SAVED_CVS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS saved_cvs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cv_text TEXT,
  file_ref TEXT,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const USER_PREFERENCES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
)`;

// Hybrid digest+raw conversation store designed so #43 (Coach long-term memory) can slot
// in without a migration. gap_topic and relevance_score support per-gap and cross-session
// relevance queries.
const CONVERSATION_HISTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS conversation_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  session_id_hash TEXT,
  digest_summary TEXT,
  raw_log JSONB,
  relevance_score FLOAT NOT NULL DEFAULT 1.0,
  gap_topic TEXT,
  last_referenced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

// Coach's per-user long-term learning store — separate from conversation_history because
// it evolves over many sessions (the "you mentioned earlier…" callback pattern for #43).
// HR long-term memory (#43b) is explicitly NOT stored here — use a separate table when
// that feature is built so the tables stay cleanly separated.
const COACH_MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS coach_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_topic TEXT NOT NULL,
  digest_summary TEXT NOT NULL DEFAULT '',
  raw_log JSONB,
  relevance_score FLOAT NOT NULL DEFAULT 1.0,
  last_referenced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

// Per-user, per-gap persistent memory — accumulates coach conversation, HR statement, and
// user decision across multiple CV-tailor sessions for the same account.
// ⚠ Known future concern: no row-count cap per user. A highly active user who reviews many
// different jobs with large gap lists could accumulate many rows. Retention/pruning strategy
// (e.g. keep last N rows per user, or prune rows older than X days) deferred — track this
// before real-user traffic is significant.
const GAP_MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS gap_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_slogan TEXT NOT NULL,
  coach_conversation JSONB NOT NULL DEFAULT '[]',
  coach_verdict TEXT,
  hr_statement TEXT,
  user_decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, gap_slogan)
)`;

// User-submitted error feedback — message + optional contact email, linked to the session
// that submitted it. No user_id FK: feedback can come from guests and must survive account
// deletion (it's operational/bug data, not personal). GDPR: contact_email is optional and
// the submitter is told "no personal data" — it is never displayed or used beyond support.
const FEEDBACK_TABLE_SQL = `CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id_hash TEXT,
  error_code TEXT,
  route TEXT,
  message TEXT NOT NULL DEFAULT '',
  contact_email TEXT
)`;

function buildPool(useSsl) {
  const config = { connectionString: process.env.DATABASE_URL };
  if (useSsl) config.ssl = { rejectUnauthorized: false };
  const p = new Pool(config);
  // Without this listener, an idle-connection error (network blip, DB restart) would surface
  // as an uncaught 'error' event on the pool and crash the whole process — exactly what this
  // feature must never do.
  p.on('error', (err) => console.warn('[db] pool error (ignored):', err.message));
  return p;
}

async function ensureTables(p) {
  await p.query(EVENTS_TABLE_SQL);
  await p.query(ERRORS_TABLE_SQL);
  await p.query(JOBS_TABLE_SQL);
  // Idempotent column add for existing live DBs that pre-date this commit.
  await p.query(`ALTER TABLE IF EXISTS jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'cv_tailor'`);
  // Auth / user-account tables — users must exist before tables that FK into it.
  await p.query(USERS_TABLE_SQL);
  await p.query(SAVED_CVS_TABLE_SQL);
  await p.query(USER_PREFERENCES_TABLE_SQL);
  await p.query(CONVERSATION_HISTORY_TABLE_SQL);
  await p.query(COACH_MEMORY_TABLE_SQL);
  await p.query(GAP_MEMORY_TABLE_SQL);
  await p.query(`CREATE INDEX IF NOT EXISTS gap_memory_user_id_idx ON gap_memory(user_id)`);
  await p.query(FEEDBACK_TABLE_SQL);
}

// Returns the shared pool, creating + bootstrapping it on first call. Returns null (and warns
// exactly once) when DATABASE_URL isn't set, so callers can cheaply no-op every time after.
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    if (!warnedMissingUrl) {
      console.warn('[db] DATABASE_URL is not set — event/error logging is disabled.');
      warnedMissingUrl = true;
    }
    return null;
  }
  pool = buildPool(false);
  tablesReady = ensureTables(pool).catch((err) => {
    // Same region, internal URL — SSL usually isn't needed (per the deploy notes), but if pg
    // complains about it, retry once with a permissive SSL config instead of giving up.
    if (!triedWithSsl && /ssl/i.test(err.message)) {
      triedWithSsl = true;
      console.warn('[db] retrying connection with ssl: { rejectUnauthorized: false } after:', err.message);
      pool = buildPool(true);
      tablesReady = ensureTables(pool).catch((err2) => {
        console.warn('[db] failed to ensure tables even with SSL fallback — logging disabled:', err2.message);
        pool = null;
      });
      return;
    }
    console.warn('[db] failed to ensure tables — logging disabled:', err.message);
    pool = null;
  });
  return pool;
}

// Exposed for callers that need to know table creation has settled (mainly tests) — never
// required on the hot path, since every query already tolerates the tables not existing yet
// for the few milliseconds after boot.
function whenTablesReady() {
  return tablesReady || Promise.resolve();
}

module.exports = { getPool, whenTablesReady };
