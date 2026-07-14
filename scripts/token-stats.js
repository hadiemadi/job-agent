'use strict';
/**
 * token-stats.js — anonymous per-step token usage across recent jobs
 *
 * Usage: node scripts/token-stats.js [--limit 20]
 *
 * Queries the jobs table for the N most recent completed/failed rows per step
 * (kind), extracts stageUsage from the result JSON, and prints a summary table.
 * Cancelled / failed jobs with no stageUsage are counted as 0 tokens for that step.
 * No user data is read — session_id_hash is ignored; output is aggregate only.
 */

require('dotenv').config();
const { Pool } = require('pg');

const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 20 : 20;
})();

const KINDS = ['reading_cv', 'parsing_job', 'hr_review', 'cv_tailor'];

const LABELS = {
  reading_cv:  'Read CV',
  parsing_job: 'Parse job',
  hr_review:   'HR review',
  cv_tailor:   'Tailor CV',
};

function stats(values) {
  const n = values.length;
  if (n === 0) return { n: 0, min: 0, max: 0, avg: 0, p50: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / n),
    p50: sorted[Math.floor(n / 2)],
  };
}

function fmtK(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function row(label, s, pad) {
  return [
    label.padEnd(pad),
    String(s.n).padStart(4),
    fmtK(s.min).padStart(7),
    fmtK(s.max).padStart(7),
    fmtK(s.avg).padStart(7),
    fmtK(s.p50).padStart(7),
  ].join('  ');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run: DATABASE_URL=<url> node scripts/token-stats.js');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log(`\nAnonymous token usage stats — last ${LIMIT} jobs per step\n`);
  console.log('Note: cancelled / failed jobs with no stageUsage count as 0 tokens.\n');

  const pad = Math.max(...KINDS.map(k => LABELS[k].length));
  const header = [
    'Step'.padEnd(pad),
    '   N',
    '    min',
    '    max',
    '    avg',
    '    p50',
  ].join('  ');
  const sep = '-'.repeat(header.length);

  for (const section of ['Input tokens (tokIn)', 'Output tokens (tokOut)', 'Total tokens (in+out)']) {
    console.log(section);
    console.log(header);
    console.log(sep);

    for (const kind of KINDS) {
      const res = await pool.query(
        `SELECT result FROM jobs WHERE kind = $1 ORDER BY updated_at DESC LIMIT $2`,
        [kind, LIMIT]
      );

      const values = res.rows.map(r => {
        const u = r.result && r.result.stageUsage;
        if (!u) return 0;
        if (section.startsWith('Input'))  return u.tokIn  || 0;
        if (section.startsWith('Output')) return u.tokOut || 0;
        return (u.tokIn || 0) + (u.tokOut || 0);
      });

      console.log(row(LABELS[kind], stats(values), pad));
    }
    console.log();
  }

  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
