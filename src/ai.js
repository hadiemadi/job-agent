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

async function analyzeJobFit(cvText, jobs) {
  const jobList = jobs.map((job, i) =>
    `${i+1}. ${job.job_title} at ${job.employer_name} (${job.job_country || 'Remote'}) - ${job.job_description?.slice(0, 200)}...`
  ).join('\n');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Here is my CV:\n${cvText}\n\nHere are the jobs found:\n${jobList}\n\nPlease rank these jobs by fit. Prioritize remote-friendly and Sweden-based roles. Return a JSON array with this exact structure, no explanation:
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
    return JSON.parse(raw);
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

module.exports = { extractJobTitles, analyzeJobFit, rewriteCV };
