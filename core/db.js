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

// conversation_history and coach_memory were write-only (display-only in My Data UI) and
// were never injected into any agent prompt. Dropped in Phase 0c — user_profiles (Phase 1)
// owns cross-session agent context instead.

// Compact, categorized career profile — built once from the CV, updated each tailoring run.
// HR and Coach inject the profile block into their system prompt instead of replaying raw
// conversation turns. One row per user; JSONB schema versioned (profile.version).
const USER_PROFILES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile    JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

// Per-user, per-gap persistent memory — accumulates coach conversation, HR statement, and
// user decision across multiple CV-tailor sessions for the same account.
// tailoring_run_id (YYYYMMDD####) scopes each row to one "Tailor my CV" run so the HR
// Expert sidebar only receives cross-session history, not the current run's own data.
// Rows from before this column was added carry tailoring_run_id = 'legacy' (see migration
// in ensureTables) and are treated as historical context, not the current run.
// ⚠ Known future concern: no row-count cap per user. Retention/pruning is simple once the
// date prefix exists — WHERE tailoring_run_id < 'YYYYMMDD' drops everything before that day.
const GAP_MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS gap_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_slogan TEXT NOT NULL,
  tailoring_run_id TEXT NOT NULL DEFAULT 'legacy',
  coach_conversation JSONB NOT NULL DEFAULT '[]',
  coach_verdict TEXT,
  hr_statement TEXT,
  user_decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, gap_slogan, tailoring_run_id)
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

// Richer failure-context table for isolating root causes of ERR-*-0XX model-call failures.
// Unlike events/errors (ALLOWED_META_KEYS allowlist), this stores structured operational data:
// input state flags (booleans/lengths), timing between pipeline steps, retry outcomes, and
// a short excerpt from the model's raw response on failure — all non-personal, non-CV content.
const DIAGNOSTIC_LOG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS diagnostic_log (
  id        SERIAL      PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id_hash TEXT,
  label     TEXT        NOT NULL,
  data_json JSONB
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
  // Phase 0c: drop the write-only audit tables (never injected into prompts).
  await p.query('DROP TABLE IF EXISTS conversation_history CASCADE');
  await p.query('DROP TABLE IF EXISTS coach_memory CASCADE');
  await p.query(GAP_MEMORY_TABLE_SQL);
  // Phase 1: persistent career profile — one row per user, injected into agent prompts.
  await p.query(USER_PROFILES_TABLE_SQL);
  await p.query(`CREATE INDEX IF NOT EXISTS gap_memory_user_id_idx ON gap_memory(user_id)`);
  // Migration: add tailoring_run_id to existing live tables (NOT NULL DEFAULT 'legacy' fills
  // old rows atomically so cross-session history is preserved as 'legacy'-tagged rows).
  await p.query(`ALTER TABLE IF EXISTS gap_memory ADD COLUMN IF NOT EXISTS tailoring_run_id TEXT NOT NULL DEFAULT 'legacy'`);
  // Drop the old 2-col unique constraint; the new 3-col one (below) replaces it.
  await p.query(`ALTER TABLE IF EXISTS gap_memory DROP CONSTRAINT IF EXISTS gap_memory_user_id_gap_slogan_key`);
  // Add 3-col unique constraint (idempotent: skip if already present).
  await p.query(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'gap_memory_user_gap_run_key'
        AND conrelid = 'gap_memory'::regclass
    ) THEN
      ALTER TABLE gap_memory ADD CONSTRAINT gap_memory_user_gap_run_key
        UNIQUE (user_id, gap_slogan, tailoring_run_id);
    END IF;
  END $$`);
  await p.query(`CREATE INDEX IF NOT EXISTS gap_memory_run_idx ON gap_memory(user_id, tailoring_run_id)`);
  await p.query(FEEDBACK_TABLE_SQL);
  await p.query(DIAGNOSTIC_LOG_TABLE_SQL);
  await p.query(`CREATE INDEX IF NOT EXISTS diagnostic_log_label_idx ON diagnostic_log(label)`);
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
