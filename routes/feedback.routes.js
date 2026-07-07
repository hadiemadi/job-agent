'use strict';
const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../core/db');
const { als } = require('../services/session');

const router = express.Router();

function genId() { return crypto.randomUUID(); }
function hashSid(sid) {
  if (!sid) return null;
  return crypto.createHash('sha256').update(sid).digest('hex');
}

// Stores user-submitted error-dialog feedback in the dedicated `feedback` table.
// contact_email is optional and stored verbatim — the UI warns the user not to include
// personal data; the field exists only so a support contact can follow up if explicitly
// provided. No user_id FK: feedback survives account deletion (it's bug/ops data).
// Fire-and-forget: DB failures are caught and swallowed — a logging write must never
// surface as an error to the user.
router.post('/feedback', async (req, res) => {
  const { code, route: feedbackRoute, message, contact_email } = req.body || {};
  const pool = getPool();
  if (pool) {
    const sid = als.getStore();
    pool.query(
      `INSERT INTO feedback (id, session_id_hash, error_code, route, message, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        genId(),
        hashSid(sid),
        (code || '').slice(0, 60),
        (feedbackRoute || '').slice(0, 120),
        (message || '').slice(0, 500),
        contact_email ? (contact_email + '').slice(0, 254) : null,
      ]
    ).catch(err => console.warn('[feedback] write failed:', err.message));
  }
  res.json({ ok: true });
});

module.exports = router;
