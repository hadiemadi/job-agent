// List stored user feedback rows — run with: node scripts/list-feedback.js
// Reads DATABASE_URL from .env (or environment). Shows the 50 most recent rows.
// Usage: node scripts/list-feedback.js [--limit N] [--since YYYY-MM-DD]
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — cannot query. Check your .env file.');
  process.exit(1);
}

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const sinceIdx = args.indexOf('--since');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 50 : 50;
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  let query = 'SELECT id, ts, error_code, route, message, contact_email FROM feedback';
  const params = [];
  if (since) {
    params.push(since);
    query += ` WHERE ts >= $${params.length}`;
  }
  query += ' ORDER BY ts DESC';
  params.push(limit);
  query += ` LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);
  if (rows.length === 0) {
    console.log('No feedback rows found.');
    return;
  }
  console.log(`Found ${rows.length} row(s):\n`);
  rows.forEach((r, i) => {
    console.log(`── #${i + 1} ──────────────────────────────`);
    console.log(`  Time:    ${r.ts}`);
    console.log(`  Code:    ${r.error_code || '(none)'}`);
    console.log(`  Route:   ${r.route || '(none)'}`);
    console.log(`  Message: ${r.message || '(empty)'}`);
    console.log(`  Email:   ${r.contact_email || '(none)'}`);
    console.log(`  ID:      ${r.id}`);
  });
}

main()
  .catch(e => { console.error('Query failed:', e.message); process.exit(1); })
  .finally(() => pool.end());
