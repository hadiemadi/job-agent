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

module.exports = { buildProfileFromCv, PROFILE_CATEGORIES };
