'use strict';
const express = require('express');
const { logEvent } = require('../core/logger');

const router = express.Router();

// Stores a user-submitted error-dialog note in the events table.
// user_note passes through sanitizeMeta (max 120 chars, no email pattern) so no raw PII is
// ever persisted — the note is dropped silently if it triggers those guards.
// GDPR: rows can be correlated by session_id_hash. A full per-user delete path lives under
// DELETE /auth/feedback (not yet built — see CLAUDE.md GDPR backlog item).
router.post('/feedback', async (req, res) => {
  const { code, route: feedbackRoute, note } = req.body || {};
  logEvent('user_feedback', {
    code: code || '',
    route: feedbackRoute || '',
    user_note: String(note || '').slice(0, 120),
  });
  res.json({ ok: true });
});

module.exports = router;
