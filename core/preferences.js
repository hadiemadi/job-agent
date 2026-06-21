// Renders the client's chosen tone (1=neutral/diplomatic .. 5=blunt), CV wording level
// (1=match original .. 5=senior expert), and any free-text instructions they gave on the
// contact page into a directive block every persona appends. Pure formatting of
// clientPreferences data — not "expertise" — so it lives in core/, shared by agents/recruiter
// (via hrSystemPrompt) and agents/coach (chatWithCoach) without either importing the other.
function preferencesBlock(preferences) {
  const { tone = 4, customInstructions = '', languageLevel = 2 } = preferences || {};
  const toneLabel = ['very neutral and diplomatic', 'calm and measured', 'balanced and professional', 'direct and frank', 'very blunt and brutally honest'][tone - 1] || 'direct and frank';
  const langLabel = [
    "match the candidate's original CV wording level exactly — do not elevate vocabulary or sophistication beyond what they already wrote",
    "lightly polish word choice above the original while staying close to the candidate's natural register",
    'use clearly professional CV language, moderately elevated above the original',
    'use highly professional, polished language typical of strong corporate CVs',
    'use the language level of a senior expert professional — sophisticated, precise, executive-caliber wording',
  ][languageLevel - 1] || "match the candidate's original CV wording level exactly";
  return `\n\nTONE: Be ${toneLabel} (client-selected ${tone}/5) in how you phrase feedback and suggestions.` +
    `\n\nCV WORDING LEVEL: When writing or rewriting CV content, ${langLabel} (client-selected level ${languageLevel}/5).` +
    `\n\nFORMAT (for any free-text reply you write, e.g. chat answers — not for CV content itself, and not for JSON structure): use short, crisp, clear sentences. When you have more than one point to make, put each on its own line starting with "- ", with NO blank line between consecutive bullets (only put a blank line between separate paragraphs/sections, never between bullets in the same list). Use **double asterisks** around a word or short phrase only when you genuinely need to emphasize it — that is the only markdown you may use. Do NOT use markdown headers (#), numbered lists, or blockquotes (>).` +
    (customInstructions ? `\n\nCLIENT'S OWN INSTRUCTIONS — follow these unless they conflict with honesty/accuracy:\n${customInstructions}` : '');
}

module.exports = { preferencesBlock };
