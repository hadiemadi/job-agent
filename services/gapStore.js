'use strict';
const crypto = require('crypto');
const { getSession } = require('./session');

// Server-side, per-session store for HR-review gaps (the "Your input needed" cards) — replaces
// the old design where accept/skip status and the per-gap coach conversation lived only in the
// browser tab (public/app.js's _hrReview/_cardChats/_refinedChanges) and were only ever sent to
// the server, wholesale, in the final /rewrite call. Gaps are addressed by a stable `id` instead
// of an array index, since index-based lookups (the old gapIndex param on /hr/refine and
// /coach/discuss) silently break the moment the gap list is re-filtered or re-ordered.

// Corrected lifecycle (#21) + card v2 (#25): `status` tracks discuss/draft PROGRESS only
// (open -> [discussing] -> proposed) — it is never terminal. The candidate's actual decision
// lives in the separate `userDecision` field (undecided|added|left-out), which can be set,
// changed, or overridden at any time, independently of HR's own lean. This split is what lets
// a candidate re-ask HR for a fresh draft or override their own prior decision without the
// lifecycle blocking them.
const VALID_STATUSES = ['open', 'discussing', 'proposed'];
const VALID_SEVERITIES = ['major', 'mild', 'minor'];
const VALID_DECISIONS = ['added', 'left-out'];

function createGap(raw) {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    description: raw.description || '',
    rationale: raw.rationale || '',
    severity: VALID_SEVERITIES.includes(raw.severity) ? raw.severity : 'major',
    status: 'open',
    userResponse: null,
    coachConversation: [],
    proposedStatement: null,
    hrConclusion: null, // { rationale, lean: 'add'|'leave-out' } once HR has drafted
    userDecision: 'undecided',
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

// One turn of the gap-specific coach conversation — the server-side record refineWithHR reads
// from, instead of trusting a client-submitted transcript. The first message moves the gap
// from 'open' to 'discussing'; discussion is optional, so this is purely informational and
// never required before HR can draft a statement (see proposeStatement below).
function appendGapMessage(id, role, content) {
  const gap = getGap(id);
  if (!gap) return null;
  gap.coachConversation.push({ role, content });
  if (gap.status === 'open') gap.status = 'discussing';
  return gap;
}

// HR drafts ONE concrete CV-ready sentence, after refineWithHR(). Succeeds from any status —
// re-drafting (e.g. after further discussion, or after the candidate re-opens a decided card)
// always works, never blocked. Every successful draft resets userDecision back to 'undecided':
// a prior decision was made against a DIFFERENT sentence, so it can't silently carry forward
// onto a new one — the candidate must explicitly re-decide on whatever HR just drafted.
function proposeStatement(id, statement, hrConclusion) {
  const gap = getGap(id);
  if (!gap) return null;
  gap.proposedStatement = statement;
  gap.hrConclusion = hrConclusion || null;
  gap.status = 'proposed';
  gap.userDecision = 'undecided';
  return gap;
}

// The candidate's own Add-to-CV / Leave-out decision — independent of HR's lean (hrConclusion),
// and never terminal: it can be changed (overridden) at any time, including after HR's lean
// disagreed with it. 'added' requires an actual drafted sentence to exist — there must be
// something concrete to add; 'left-out' is always available (the candidate can walk away from
// a gap at any point, with or without ever asking HR to draft anything).
function setUserDecision(id, decision) {
  if (!VALID_DECISIONS.includes(decision)) return null;
  const gap = getGap(id);
  if (!gap) return null;
  if (decision === 'added' && !gap.proposedStatement) return null;
  gap.userDecision = decision;
  return gap;
}

module.exports = {
  setGaps, getGaps, getGap, appendGapMessage, proposeStatement, setUserDecision,
  VALID_STATUSES, VALID_SEVERITIES, VALID_DECISIONS,
};
