const { client, MODEL } = require('../core/claude');
const { extractJSON } = require('../core/json');

async function extractJobTitles(cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 100,
    messages: [{ role: 'user', content: `Based on this CV, return ONLY the 3 most suitable job search queries as a comma-separated list. No explanation, just the queries.\n\nCV:\n${cvText}` }]
  });
  return message.content[0].text.split(',').map(t => t.trim());
}

async function parseJobFromText(rawText, sourceUrl) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: `Extract the job posting details from this text. Return JSON only:
{
  "job_title": "",
  "employer_name": "",
  "job_city": "",
  "job_employment_type": "",
  "job_description": ""
}
For job_description include the full responsibilities and requirements. Leave unknown fields as empty string.

Text:
${rawText}` }]
  });
  const raw = extractJSON(message.content[0].text);
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

module.exports = { extractJobTitles, parseJobFromText };
