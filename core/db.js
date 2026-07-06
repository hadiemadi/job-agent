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
// work. user_id is nullable (Phase 2 login placeholder). result holds the full pipeline
// output (filePath, session data to restore) so the status-poll route can apply it to the
// correct session when the client comes back. id is a Node-generated UUID (TEXT, not the
// Postgres uuid type, so no extension needed).
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
