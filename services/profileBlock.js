'use strict';

// Formats a stored user profile into a text block for injection into HR/Coach prompts.
// maxPerCategory controls how many bullets per category flow into the prompt (default 8);
// the profile itself may store up to 20 per category — injection cap is independent.
// Returns empty string when profile is null, empty, or has no bullets — safe to append.
function buildProfileBlock(profile, maxPerCategory = 8) {
  if (!profile || !profile.categories) return '';
  const lines = Object.entries(profile.categories)
    .filter(([, bullets]) => Array.isArray(bullets) && bullets.length > 0)
    .map(([cat, bullets]) => `${cat}: ${bullets.slice(0, maxPerCategory).join(' | ')}`);
  if (!lines.length) return '';
  return [
    'CANDIDATE PROFILE — additional background (may extend beyond the current CV):',
    'Some of these facts are already in the CV; others are not. For each section you',
    'write, actively decide which profile facts strengthen the fit for THIS specific role.',
    'Use what is relevant. Skip what is not. Do not force-fit everything.',
    '',
    ...lines,
  ].join('\n');
}

module.exports = { buildProfileBlock };
