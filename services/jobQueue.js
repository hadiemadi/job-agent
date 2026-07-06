'use strict';
const crypto = require('crypto');
const { getPool } = require('../core/db');

// In-memory fallback when DATABASE_URL is not set (local dev / tests). Jobs survive until
// process restart — enough for dev, but not for tab-close recovery (which needs the DB).
const _memJobs = new Map();

async function createJob() {
  const id = crypto.randomUUID();
  const pool = getPool();
  if (pool) {
    await pool.query(
      `INSERT INTO jobs (id, status, current_step) VALUES ($1, 'pending', '')`,
      [id]
    );
  } else {
    _memJobs.set(id, { id, status: 'pending', current_step: '', result: null });
  }
  return id;
}

async function updateJob(id, updates) {
  const pool = getPool();
  if (pool) {
    const parts = [];
    const vals = [];
    let i = 1;
    if ('status' in updates)       { parts.push(`status = $${i++}`);       vals.push(updates.status); }
    if ('current_step' in updates) { parts.push(`current_step = $${i++}`); vals.push(updates.current_step); }
    if ('result' in updates)       { parts.push(`result = $${i++}`);       vals.push(JSON.stringify(updates.result)); }
    parts.push('updated_at = now()');
    vals.push(id);
    await pool.query(`UPDATE jobs SET ${parts.join(', ')} WHERE id = $${i}`, vals);
  } else {
    const job = _memJobs.get(id);
    if (job) Object.assign(job, updates);
  }
}

async function getJob(id) {
  const pool = getPool();
  if (pool) {
    const r = await pool.query('SELECT id, status, current_step, result FROM jobs WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return _memJobs.get(id) || null;
}

// Exposed for tests to reset in-memory state between cases.
function _resetMemJobs() { _memJobs.clear(); }

module.exports = { createJob, updateJob, getJob, _resetMemJobs };
