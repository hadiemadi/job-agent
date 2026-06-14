require('dotenv').config();
const fs = require('fs');
const fse = require('fs-extra');
const PDFParser = require('pdf2json');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function readCV(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const text = pdfData.Pages.map(page =>
        page.Texts.map(t => decodeURIComponent(t.R[0].T)).join(' ')
      ).join('\n');
      resolve(text);
    });
    pdfParser.on('pdfParser_dataError', (error) => reject(error));
    pdfParser.loadPDF(filePath);
  });
}

async function extractJobTitles(cvText) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `Based on this CV, return ONLY the 3 most suitable job search queries as a comma-separated list. No explanation, just the queries.\n\nCV:\n${cvText}`
    }]
  });
  const titles = message.content[0].text.split(',').map(t => t.trim());
  console.log('🎯 Extracted job titles:', titles);
  return titles;
}

async function searchJobs(query, location, country) {
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&country=${encodeURIComponent(country)}&num_pages=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-rapidapi-host': 'jsearch.p.rapidapi.com',
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
  });
  const data = await response.json();
  return data.data || [];
}

async function searchAllLocations(jobTitle) {
  const [stockholmJobs, remoteJobs, londonJobs] = await Promise.all([
    searchJobs(jobTitle, 'Stockholm', 'SE'),
    searchJobs(jobTitle, 'Remote', ''),
    searchJobs(jobTitle, 'London', 'GB'),
  ]);
  console.log(`   📍 Stockholm: ${stockholmJobs.length} jobs`);
  console.log(`   🌍 Remote: ${remoteJobs.length} jobs`);
  console.log(`   🇬🇧 London: ${londonJobs.length} jobs`);
  return [...stockholmJobs, ...remoteJobs, ...londonJobs];
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
      content: `Here is my CV:\n${cvText}\n\nHere are the jobs found:\n${jobList}\n\nPlease rank these jobs by fit. Prioritize remote-friendly and Sweden-based roles. Explain why in a table format.`
    }]
  });
  return message.content[0].text;
}

async function rewriteCV(cvText, job) {
  console.log(`\n✍️  Rewriting CV for: ${job.job_title} at ${job.employer_name}...`);

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
COMPANY: ${job.employer_name}
JOB DESCRIPTION: ${job.job_description?.slice(0, 1000)}

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
    console.error('❌ Failed to parse CV JSON:', e.message);
    return;
  }

  const html = generateExecutiveTemplate(cvData, job);
  const fileName = `output/cv_${job.employer_name.replace(/\s+/g, '_')}.html`;
  await fse.outputFile(fileName, html);
  console.log(`✅ CV saved as: ${fileName}`);
}

function generateExecutiveTemplate(cv, job) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cv.name} — CV for ${job.job_title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #f4f4f4; }
  .page { max-width: 860px; margin: 40px auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  
  /* Header */
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.7); }
  .contact-bar a { color: #4A9FE0; text-decoration: none; font-size: 13px; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }

  /* Body */
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  
  /* Left column */
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year { font-size: 11px; color: #185FA5; margin-top: 2px; }

  /* Right column */
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  
  /* Footer */
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }

  @media print {
    body { background: white; }
    .page { box-shadow: none; margin: 0; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>${cv.name || 'Your Name'}</h1>
    <div class="job-title">${cv.title || job.job_title}</div>
    <div class="accent-line"></div>
    <div class="contact-bar">
      ${cv.email ? `<span>✉ ${cv.email}</span>` : ''}
      ${cv.phone ? `<span>✆ ${cv.phone}</span>` : ''}
      ${cv.location ? `<span>📍 ${cv.location}</span>` : ''}
      ${cv.linkedin ? `<a href="${cv.linkedin}">LinkedIn</a>` : ''}
    </div>
  </div>

  <div class="body">
    <div class="left">
      <div class="section-title">Skills</div>
      ${(cv.skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('')}
      
      <div class="section-title">Education</div>
      ${(cv.education || []).map(e => `
        <div class="edu-item">
          <div class="degree">${e.degree}</div>
          <div class="school">${e.school}</div>
          <div class="year">${e.year}</div>
        </div>
      `).join('')}
    </div>

    <div class="right">
      <div class="section-title">Profile</div>
      <div class="summary">${cv.summary || ''}</div>

      <div class="section-title">Experience</div>
      ${(cv.experience || []).map(exp => `
        <div class="exp-item">
          <div class="exp-header">
            <div class="exp-role">${exp.role}</div>
            <div class="exp-period">${exp.period}</div>
          </div>
          <div class="exp-company">${exp.company}</div>
          <ul class="exp-bullets">
            ${(exp.bullets || []).map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    <span>Tailored for ${job.job_title} at ${job.employer_name}</span>
  </div>
</div>
</body>
</html>`;
}

async function main() {
  console.log('📄 Reading CV...');
  const cvText = await readCV('./cv.pdf');
  console.log('✅ CV loaded successfully\n');

  console.log('🤖 Extracting job titles from CV...');
  const jobTitles = await extractJobTitles(cvText);

  let allJobs = [];
  for (const title of jobTitles) {
    console.log(`\n🔍 Searching for: ${title}`);
    const jobs = await searchAllLocations(title);
    allJobs = [...allJobs, ...jobs];
  }

  const uniqueJobs = [...new Map(allJobs.map(job => [job.job_id, job])).entries()].map(([, job]) => job);

  console.log(`\n✅ Found ${uniqueJobs.length} unique jobs. Analyzing fit with Claude...`);
  const analysis = await analyzeJobFit(cvText, uniqueJobs);

  console.log('\n📊 Job Analysis Result:\n');
  console.log(analysis);

  // Rewrite CV for top 3 jobs
  console.log('\n✍️  Rewriting CV for top 3 jobs...');
  for (const job of uniqueJobs.slice(0, 3)) {
    await rewriteCV(cvText, job);
  }
}

main().catch(console.error);