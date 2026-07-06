const { client, MODEL } = require('../core/claude');
const { extractJSON } = require('../core/json');

// Classifies a client's free-text comment (from the contact page's "Anything you'd like the
// AI to know?" box) into the bucket it should influence:
// - "general": a field-agnostic instruction about HOW to write/format the CV (e.g. "prefer
//   one-page", "don't mention my current employer") — already flows into every prompt via
//   clientPreferences.customInstructions; no extra plumbing needed, just classification.
// - "discipline": a concrete skill/experience claim specific to the candidate's field (e.g.
//   "I have hands-on GaN PA tuning experience") — gets pinned into that field's discipline
//   knowledge store (Phase 5) so it's trusted as fact for this and future reviews.
// - "ambiguous": doesn't clearly fit either — left as a general instruction; never guessed
//   into the discipline store, since polluting that store with a misclassified item is worse
//   than under-using it.
async function classify(comment) {
  if (!comment || !comment.trim()) return { bucket: 'none', text: '' };
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    messages: [{ role: 'user', content: `Classify this comment a CV candidate left for their HR reviewer.

COMMENT: "${comment}"

Decide which bucket it belongs to:
- "general": a field-agnostic instruction about how to write, format, or handle the CV (tone, length, what to omit, structure preferences) — true for any candidate in any field.
- "discipline": a concrete skill, tool, technology, or experience claim specific to the candidate's professional field — a fact about THEM that should be trusted and remembered.
- "ambiguous": doesn't clearly fit either case.

Return JSON only:
{ "bucket": "general|discipline|ambiguous" }` }]
  });
  const raw = extractJSON(message.content[0].text);
  const { bucket } = JSON.parse(raw);
  return { bucket: ['general', 'discipline', 'ambiguous'].includes(bucket) ? bucket : 'ambiguous', text: comment.trim() };
}

module.exports = { classify };
