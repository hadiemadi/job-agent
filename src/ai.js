const Anthropic = require('@anthropic-ai/sdk');
const fse = require('fs-extra');
const { generateExecutiveTemplate } = require('./templates');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function extractJobTitles(cvText) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Based on this CV, return ONLY the 3 most suitable job search queries as a comma-separated list. No explanation, just the queries.\n\nCV:\n${cvText}`
    }]
  });
  return message.content[0].text.split(',').map(t => t.trim());
}

async function analyzeJobFit(cvText, jobs, countryCode = 'GB') {
  const countryNames = { GB: 'United Kingdom', SE: 'Sweden', US: 'United States', DE: 'Germany', NL: 'Netherlands' };
  const preferredCountry = countryNames[countryCode] || 'United Kingdom';

  const topJobs = jobs.slice(0, 30);
  const jobList = topJobs.map((job, i) =>
    `${i+1}. ${job.job_title} at ${job.employer_name} (${job.job_city || job.job_country || 'Remote'}) - ${(job.job_description || '').slice(0, 300)}`
  ).join('\n');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: `Here is my CV:\n${cvText}\n\nHere are the jobs found:\n${jobList}\n\nPlease rank these jobs by fit. Prioritize jobs based in ${preferredCountry} or Remote. Deprioritize jobs in other countries. Return a JSON array with this exact structure, no explanation:
[{
  "rank": 1,
  "job_title": "",
  "company": "",
  "location": "",
  "fit_score": 5,
  "reasons_for": "",
  "reasons_against": "",
  "apply_link": ""
}]`
    }]
  });
  try {
    const raw = message.content[0].text.replace(/```json|```/g, '').trim();
    const ranked = JSON.parse(raw);
    // Inject apply links from source data since Claude can't reliably reproduce URLs
    return ranked.map((r, i) => ({
      ...r,
      apply_link: r.apply_link || topJobs[r.rank - 1]?.job_apply_link || '',
    }));
  } catch (e) {
    return [];
  }
}

async function rewriteCV(cvText, job) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are an expert CV writer. Rewrite this CV to match the job below.
- Keep all facts accurate, do NOT invent experience
- Emphasize relevant skills using keywords from the job description
- Return the CV as structured JSON with these exact fields:
{
  "name": "",
  "title": "",
  "email": "",
  "phone": "",
  "location": "",
  "linkedin": "",
  "summary": "",
  "experience": [{ "role": "", "company": "", "period": "", "bullets": [""] }],
  "education": [{ "degree": "", "school": "", "year": "" }],
  "skills": [""]
}

JOB TITLE: ${job.job_title}
COMPANY: ${job.company}
JOB DESCRIPTION: ${job.description?.slice(0, 1000)}

ORIGINAL CV:
${cvText}

Return ONLY the JSON, no explanation.`
    }]
  });

  let cvData;
  try {
    const raw = message.content[0].text.replace(/```json|```/g, '').trim();
    cvData = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  const html = generateExecutiveTemplate(cvData, job);
  const fileName = `output/cv_${job.company.replace(/\s+/g, '_')}.html`;
  await fse.outputFile(fileName, html);
  return fileName;
}

async function parseJobFromText(rawText, sourceUrl) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Extract the job posting details from this web page text. Return JSON only, no explanation:
{
  "job_title": "",
  "employer_name": "",
  "job_city": "",
  "job_employment_type": "",
  "job_description": ""
}

For job_description include the full responsibilities and requirements.
If a field is not found leave it as an empty string.

Page text:
${rawText}`
    }]
  });

  const raw = message.content[0].text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(raw);
  return {
    job_id: 'imported-' + Date.now(),
    job_title:           parsed.job_title || '',
    employer_name:       parsed.employer_name || '',
    job_city:            parsed.job_city || '',
    job_country:         '',
    job_description:     parsed.job_description || '',
    job_employment_type: parsed.job_employment_type || '',
    job_apply_link:      sourceUrl,
    job_is_remote:       /remote/i.test(rawText),
  };
}

module.exports = { extractJobTitles, analyzeJobFit, rewriteCV, parseJobFromText };
