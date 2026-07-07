const { client, MODEL } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');
const { logDiagnostic } = require('../core/logger');

async function extractJobTitles(cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 100,
    messages: [{ role: 'user', content: `Based on this CV, return ONLY the 3 most suitable job search queries as a comma-separated list. No explanation, just the queries.\n\nCV:\n${cvText}` }]
  });
  return firstText(message).split(',').map(t => t.trim());
}

async function parseJobFromText(rawText, sourceUrl) {
  if (!rawText || !rawText.trim()) throw new Error('Job text is empty — nothing to parse');
  // Guard against extremely long pastes that inflate cost without improving extraction.
  const text = rawText.slice(0, 14000);
  const userContent = `Extract the job posting details from this text. Return JSON only:
{
  "job_title": "",
  "employer_name": "",
  "job_city": "",
  "job_employment_type": "",
  "job_description": ""
}
For job_description include the full responsibilities and requirements. Leave unknown fields as empty string.

Text:
${text}`;

  // Retry once if the model returns prose instead of JSON (ERR-JOB-007 root cause).
  let message, raw;
  for (let attempt = 0; attempt <= 1; attempt++) {
    const msgs = attempt === 0
      ? [{ role: 'user', content: userContent }]
      : [
          { role: 'user', content: userContent },
          { role: 'assistant', content: firstText(message) },
          { role: 'user', content: 'Reply with ONLY the JSON object — no prose before or after it.' },
        ];
    message = await client.messages.create({ model: MODEL, max_tokens: 1000, messages: msgs });
    try {
      raw = extractJSON(firstText(message));
      if (attempt === 1) logDiagnostic('extractor.parseJobFromText', { outcome: 'retry_succeeded' });
      break;
    } catch (e) {
      let excerpt = '[no-text-block]';
      try { excerpt = (firstText(message) || '').slice(0, 200); } catch (_) {}
      logDiagnostic('extractor.parseJobFromText', { outcome: attempt === 0 ? 'retry_triggered' : 'both_failed', attempt, excerpt });
      if (attempt === 1) throw e;
    }
  }
  const parsed = JSON.parse(raw);
  return {
    job_id: 'imported-' + Date.now(),
    job_title:           parsed.job_title || '',
    employer_name:       parsed.employer_name || '',
    job_city:            parsed.job_city || '',
    job_country:         '',
    job_description:     parsed.job_description || '',
    job_employment_type: parsed.job_employment_type || '',
    job_apply_link:      sourceUrl || '',
    job_is_remote:       /remote/i.test(rawText),
  };
}

// Detects the candidate's professional field/discipline and seniority from their CV — this
// is what lets the HR reviewer apply field-specific judgment (Phase 5: looking up
// knowledge/disciplines/<field>.json) instead of one-size-fits-all advice. `field` is a
// short canonical name (e.g. "RF/Hardware Engineering"), used both as prompt context and,
// from Phase 5 onward, as the discipline store's lookup key — keep it stable and general
// rather than overly specific, so near-duplicate CVs in the same discipline share one store.
async function detectField(cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    messages: [{ role: 'user', content: `Based on this CV, identify the candidate's professional field/discipline and seniority level.

CV:
${cvText}

Return JSON only:
{
  "field": "a short, general, canonical field name (e.g. 'RF/Hardware Engineering', 'Embedded Software', 'Product Management', 'Data Science') — general enough that similar CVs in the same discipline resolve to the exact same string",
  "seniority": "junior|mid|senior|principal|executive"
}` }]
  });
  const raw = extractJSON(firstText(message));
  return JSON.parse(raw);
}

module.exports = { extractJobTitles, parseJobFromText, detectField };
