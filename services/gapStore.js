'use strict';
const crypto = require('crypto');
const { getSession } = require('./session');

// Server-side, per-session store for HR-review gaps (the "Your input needed" cards) — replaces
// the old design where accept/skip status and the per-gap coach conversation lived only in the
// browser tab (public/app.js's _hrReview/_cardChats/_refinedChanges) and were only ever sent to
// the server, wholesale, in the final /rewrite call. Gaps are addressed by a stable `id` instead
// of an array index, since index-based lookups (the old gapIndex param on /hr/refine and
// /coach/discuss) silently break the moment the gap list is re-filtered or re-ordered.

// Corrected lifecycle (#21): a gap moves open -> [discussing] -> proposed -> accepted|declined.
// HR may draft a statement from 'open' OR 'discussing' (coach discussion is optional) — but
// nothing can be accepted until HR has actually proposed a concrete sentence. HR's own "this
// is weakly evidenced" judgment lives in hrConclusion (rationale/verdict metadata) — it no
// longer auto-resolves the gap; only the candidate's explicit accept/decline does that.
const VALID_STATUSES = ['open', 'discussing', 'proposed', 'accepted', 'declined'];
const VALID_SEVERITIES = ['major', 'mild', 'minor'];
const TERMINAL_STATUSES = ['accepted', 'declined'];

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

// HR drafts ONE concrete CV-ready sentence, after refineWithHR(). Succeeds from 'open' or
// 'discussing' (coach discussion is optional) and from 'proposed' itself (re-drafting after
// further discussion) — never from a terminal status, since accepted/declined are final.
// Always lands on 'proposed' unconditionally: HR's "this is weakly evidenced" judgment lives
// in hrConclusion, not in an auto-resolution — only the candidate's own accept/decline (below)
// ever moves a gap to a terminal state.
function proposeStatement(id, statement, hrConclusion) {
  const gap = getGap(id);
  if (!gap || TERMINAL_STATUSES.includes(gap.status)) return null;
  gap.proposedStatement = statement;
  gap.hrConclusion = hrConclusion || null;
  gap.status = 'proposed';
  return gap;
}

// Accept — only valid once HR has actually drafted something. Accepting a slogan with no
// proposed sentence behind it is exactly the bug this lifecycle exists to close.
function acceptGap(id) {
  const gap = getGap(id);
  if (!gap || gap.status !== 'proposed') return null;
  gap.status = 'accepted';
  return gap;
}

// Decline — the "early skip" path included: valid from 'open', 'discussing', or 'proposed'.
// The candidate can walk away from a gap at any point before accepting it.
function declineGap(id) {
  const gap = getGap(id);
  if (!gap || TERMINAL_STATUSES.includes(gap.status)) return null;
  gap.status = 'declined';
  return gap;
}

module.exports = {
  setGaps, getGaps, getGap, appendGapMessage, proposeStatement, acceptGap, declineGap,
  VALID_STATUSES, VALID_SEVERITIES,
};
