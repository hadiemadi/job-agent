'use strict';
const { client } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');

const PROFILE_CATEGORIES = ['TechnicalSkills', 'Certifications', 'Experience', 'DomainKnowledge', 'Leadership', 'Education', 'Projects'];

// Builds a compact structured career profile from a CV text. Cheap extraction task —
// uses Haiku. Returns a versioned profile object, or null if parsing fails.
// Never stores PII (no names, DOB, salary, contact details — those stay in user_preferences).
async function buildProfileFromCv(cvText) {
  let message;
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Extract a structured career profile from this CV. Return JSON exactly:
{
  "version": 1,
  "categories": {
    "TechnicalSkills": [],
    "Certifications": [],
    "Experience": [],
    "DomainKnowledge": [],
    "Leadership": [],
    "Education": [],
    "Projects": []
  }
}
Rules: max 8 bullets per category, max 15 words per bullet, no PII (no person names, DOB, salary, phone, email, address).

CV:
${cvText.slice(0, 3000)}`,
      }],
    });
  } catch (e) {
    return null;
  }
  try {
    const raw = extractJSON(firstText(message));
    const parsed = JSON.parse(raw);
    // Enforce caps: max 8 bullets per category
    for (const cat of PROFILE_CATEGORIES) {
      if (Array.isArray(parsed.categories?.[cat])) {
        parsed.categories[cat] = parsed.categories[cat].slice(0, 8);
      }
    }
    parsed.updatedAt = new Date().toISOString();
    return parsed;
  } catch (e) {
    return null;
  }
}

// Checks which of the provided gaps are already evidenced by the candidate's profile.
// Returns an array of { index, evidence } for covered gaps only — never stretches:
// only returns gaps where the profile contains a specific fact that directly addresses it.
// Uses Haiku (cheap, fast) since this is a pattern-matching task, not creative reasoning.
async function checkGapsAgainstProfile(profile, gaps) {
  if (!profile || !profile.categories || !gaps || gaps.length === 0) return [];
  const profileSummary = Object.entries(profile.categories)
    .filter(([, bullets]) => Array.isArray(bullets) && bullets.length > 0)
    .map(([cat, bullets]) => `${cat}: ${bullets.join('; ')}`)
    .join('\n');
  let message;
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Given a candidate's confirmed profile and a list of CV gaps identified by HR, identify which gaps the profile already provides direct evidence for.
Only include a gap if the profile contains a SPECIFIC fact that directly addresses it. Do not stretch — vague or indirect coverage is not enough.

CANDIDATE PROFILE:
${profileSummary}

GAPS (index: description — rationale):
${gaps.map((g, i) => `${i}: "${g.description}" — ${g.rationale}`).join('\n')}

Return JSON only:
{"covered":[{"index":0,"evidence":"one specific profile fact that covers this gap"}]}
Return an empty covered array if nothing is strongly evidenced.`,
      }],
    });
  } catch (e) {
    return [];
  }
  try {
    const raw = extractJSON(firstText(message));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.covered) ? parsed.covered : [];
  } catch (e) {
    return [];
  }
}

module.exports = { buildProfileFromCv, checkGapsAgainstProfile, PROFILE_CATEGORIES };
