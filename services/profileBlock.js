'use strict';

// Formats a stored user profile into a compact text block for injection into HR/Coach
// system prompts. Returns empty string when profile is null, empty, or has no bullets —
// safe to append unconditionally.
function buildProfileBlock(profile) {
  if (!profile || !profile.categories) return '';
  const lines = Object.entries(profile.categories)
    .filter(([, bullets]) => Array.isArray(bullets) && bullets.length > 0)
    .map(([cat, bullets]) => `${cat}: ${bullets.join(' | ')}`);
  if (!lines.length) return '';
  return `CANDIDATE PROFILE (confirmed facts across sessions):\n${lines.join('\n')}`;
}

module.exports = { buildProfileBlock };
