'use strict';
const crypto = require('crypto');
const { getSession } = require('./session');

// Server-side, per-session store for HR-review gaps (the "Your input needed" cards) — replaces
// the old design where accept/skip status and the per-gap coach conversation lived only in the
// browser tab (public/app.js's _hrReview/_cardChats/_refinedChanges) and were only ever sent to
// the server, wholesale, in the final /rewrite call. Gaps are addressed by a stable `id` instead
// of an array index, since index-based lookups (the old gapIndex param on /hr/refine and
// /coach/discuss) silently break the moment the gap list is re-filtered or re-ordered.

const VALID_STATUSES = ['open', 'accepted', 'skipped', 'hr-concluded'];
const VALID_SEVERITIES = ['major', 'mild', 'minor'];

function createGap(raw) {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    description: raw.description || '',
    rationale: raw.rationale || '',
    severity: VALID_SEVERITIES.includes(raw.severity) ? raw.severity : 'major',
    status: 'open',
    userResponse: null,
    coachConversation: [],
    hrConclusion: null,
  };
}

// Replaces the session's entire gap list — called once per /review-cv, the same "this job's
// review is recomputed from scratch" semantics appSession.hrReview already follows elsewhere.
function setGaps(rawGaps) {
  const session = getSession();
  session.gaps = (rawGaps || []).map(createGap);
  return session.gaps;
}

function getGaps() {
  return getSession().gaps || [];
}

function getGap(id) {
  if (!id) return null;
  return getGaps().find(g => g.id === id) || null;
}

// The Accept/Skip buttons — the only way a gap's status becomes 'accepted' or 'skipped'.
function updateGapStatus(id, status) {
  if (!['accepted', 'skipped'].includes(status)) return null;
  const gap = getGap(id);
  if (!gap) return null;
  gap.status = status;
  return gap;
}

// One turn of the gap-specific coach conversation — the server-side record refineWithHR reads
// from, instead of trusting a client-submitted transcript.
function appendGapMessage(id, role, content) {
  const gap = getGap(id);
  if (!gap) return null;
  gap.coachConversation.push({ role, content });
  return gap;
}

// HR's refined take on a gap, after refineWithHR(). If HR's OWN verdict is "skip", the gap
// resolves to the terminal 'hr-concluded' status automatically — but only while still 'open':
// an explicit accept/skip the candidate already made via updateGapStatus is never overridden.
function setGapConclusion(id, hrConclusion) {
  const gap = getGap(id);
  if (!gap) return null;
  gap.hrConclusion = hrConclusion;
  if (hrConclusion && hrConclusion.verdict === 'skip' && gap.status === 'open') {
    gap.status = 'hr-concluded';
  }
  return gap;
}

module.exports = {
  setGaps, getGaps, getGap, updateGapStatus, appendGapMessage, setGapConclusion,
  VALID_STATUSES, VALID_SEVERITIES,
};
