const Anthropic = require('@anthropic-ai/sdk');
const fse = require('fs-extra');
const { generateExecutiveTemplate } = require('./templates');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Extracts the first complete JSON object or array from a model response,
// ignoring any preamble or postamble text the model may have added.
function extractJSON(text) {
  text = text.replace(/```json|```/g, '').trim();
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const openChar  = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = text.lastIndexOf(closeChar);
  if (end === -1) throw new Error('Unclosed JSON in model response');
  return text.slice(start, end + 1);
}

// Extract contact info directly from raw CV text via regex — never trust the LLM
// to transcribe sensitive identifiers verbatim (it can silently alter dots, hyphens, etc.)
function extractContactInfo(cvText) {
  // pdf2json can split a token at underscores or other chars, inserting a spurious space
  // (e.g. "hadi_ emadi@yahoo.com" instead of "hadi_emadi@yahoo.com").
  // Collapse spaces adjacent to _ and @ before applying the email regex.
  const forEmail = cvText
    .replace(/([A-Za-z0-9._%+\-])\s+@/g, '$1@')  // "addr @host" → "addr@host"
    .replace(/@\s+([A-Za-z])/g,           '@$1')  // "name@ host" → "name@host"
    .replace(/_\s+([A-Za-z0-9])/g,        '_$1')  // "hadi_ emadi" → "hadi_emadi"
    .replace(/([A-Za-z0-9])\s+_/g,        '$1_'); // "hadi _emadi" → "hadi_emadi"

  const emailMatch    = forEmail.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const phoneMatch    = cvText.match(/\+?\d[\d\s().-]{6,}\d/);
  const linkedinMatch = cvText.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[A-Za-z0-9\-_/%]+/i);
  return {
    email:    emailMatch    ? emailMatch[0] : null,
    phone:    phoneMatch    ? phoneMatch[0].trim() : null,
    linkedin: linkedinMatch ? linkedinMatch[0] : null,
  };
}

// Ensures a LinkedIn value is always a full URL.
// Handles: full URL, missing scheme, bare username, "in/username" path.
function normalizeLinkedin(raw) {
  if (!raw) return raw;
  raw = raw.trim().replace(/\/$/, '');
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/linkedin\.com/i.test(raw)) return 'https://' + raw.replace(/^\/\//, '');
  // bare username or "in/username"
  const username = raw.replace(/^in\//, '').replace(/^\//, '');
  return `https://www.linkedin.com/in/${username}`;
}

// Overwrite cv.email/phone/linkedin with the regex-extracted originals when found
function enforceContactInfo(cv, cvText) {
  const contact = extractContactInfo(cvText);
  if (contact.email)    cv.email    = contact.email;
  if (contact.phone)    cv.phone    = contact.phone;
  if (contact.linkedin) cv.linkedin = normalizeLinkedin(contact.linkedin);
  return cv;
}

// Remove stray leading bullet markers (-, •, *, ·) that Claude sometimes copies
// verbatim from the source CV text into bullet strings, double-rendering with <li>
function stripBulletPrefix(str) {
  return String(str).replace(/^[\s]*[-•*·][\s]*/, '').trim();
}

// Strip bullet prefixes across every bullet-style field in a CV object
function cleanBulletPrefixes(cv) {
  (cv.experience || []).forEach(exp => {
    if (Array.isArray(exp.bullets)) exp.bullets = exp.bullets.map(stripBulletPrefix);
  });
  if (Array.isArray(cv.key_qualifications)) cv.key_qualifications = cv.key_qualifications.map(stripBulletPrefix);
  (cv.additional_sections || []).forEach(s => {
    if (Array.isArray(s.items)) s.items = s.items.map(stripBulletPrefix);
  });
  return cv;
}

async function extractJobTitles(cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 100,
    messages: [{ role: 'user', content: `Based on this CV, return ONLY the 3 most suitable job search queries as a comma-separated list. No explanation, just the queries.\n\nCV:\n${cvText}` }]
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
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: `Here is my CV:\n${cvText}\n\nHere are the jobs found:\n${jobList}\n\nPlease rank these jobs by fit. Prioritize jobs based in ${preferredCountry} or Remote. Return a JSON array with this exact structure, no explanation:\n[{\n  "rank": 1,\n  "job_title": "",\n  "company": "",\n  "location": "",\n  "fit_score": 5,\n  "reasons_for": "",\n  "reasons_against": "",\n  "apply_link": ""\n}]` }]
  });
  try {
    const raw = extractJSON(message.content[0].text);
    const ranked = JSON.parse(raw);
    return ranked.map(r => ({ ...r, apply_link: r.apply_link || topJobs[r.rank - 1]?.job_apply_link || '' }));
  } catch (e) { return []; }
}

// Extract the original CV into structured JSON without changing anything
async function parseCVStructure(cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: `Extract this CV into the exact JSON structure below.

CRITICAL RULES:
- Include EVERY experience entry — do not skip or merge any roles
- Include EVERY bullet point under each role — do not summarize or drop any
- Include ALL skills listed
- Include ALL education entries
- Capture ANY section not covered by the standard fields (e.g. Key Qualifications, Certifications, Languages, Publications, Awards, Volunteer) in "additional_sections"
- Do NOT rephrase, improve, or shorten anything — copy text verbatim
- If a field is not found, use an empty string or empty array

JSON structure:
{
  "name": "", "title": "", "email": "", "phone": "", "location": "", "linkedin": "",
  "summary": "",
  "key_qualifications": [],
  "experience": [{ "role": "", "company": "", "period": "", "bullets": [""] }],
  "education": [{ "degree": "", "school": "", "year": "" }],
  "skills": [],
  "additional_sections": [{ "title": "", "items": [""] }]
}

CV:
${cvText}

Return ONLY the JSON, no explanation.` }]
  });
  const raw = extractJSON(message.content[0].text);
  const cv = cleanBulletPrefixes(JSON.parse(raw));
  if (cv.linkedin) cv.linkedin = normalizeLinkedin(cv.linkedin);
  return enforceContactInfo(cv, cvText);
}

// HR review — categorizes changes into auto (safe) vs confirm (needs client approval)
async function reviewCV(cvText, job) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: `You are a senior HR manager and CV expert. Review this CV against the job description.

Categorize all recommended changes into two groups:
- auto_changes: safe to apply because they are directly evidenced in the CV (skills mentioned in experience but missing from the skills list, keyword optimization that matches existing experience, restructuring/reordering)
- confirm_changes: go beyond what the CV states — skills gaps, certifications not mentioned, claims that need the candidate to confirm they actually have them

Also decide which CV sections to include in the tailored version. Apply current best practices (2024/2025):
- "summary": include for most roles — strong 3-5 sentence professional profile targeting this specific job
- "key_qualifications": include for senior, specialist, or leadership roles where a quick highlight reel adds value before experience; skip for junior/generalist roles
- "skills": include when technical skills are key differentiators for this role; skip if skills are already embedded in experience bullets and adding a list adds no value
- "experience": always include
- "education": always include
- Additional sections (e.g. "certifications", "languages", "publications", "awards"): only if directly relevant to this specific role

Return JSON only:
{
  "overall_match": "Strong|Moderate|Weak",
  "strengths": [""],
  "recommended_sections": ["summary", "skills", "experience", "education"],
  "section_rationale": "",
  "auto_changes": [{ "description": "", "rationale": "" }],
  "confirm_changes": [{ "description": "", "rationale": "" }]
}

JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 800)}

CV:
${cvText}` }]
  });
  const raw = extractJSON(message.content[0].text);
  return JSON.parse(raw);
}

// Tailor CV applying specific changes from HR review + client confirmations
async function rewriteCVWithChanges(cvText, job, autoChanges, confirmedChanges, recommendedSections, originalName, confirmedContact) {
  const allChanges = [...(autoChanges || []), ...(confirmedChanges || [])];
  const changesText = allChanges.length
    ? allChanges.map(c => `- ${c.description}`).join('\n')
    : 'Optimize for the job description keywords where they match existing experience.';

  const sections = recommendedSections && recommendedSections.length
    ? recommendedSections
    : ['summary', 'skills', 'experience', 'education'];

  const standardSections = ['summary', 'key_qualifications', 'skills', 'experience', 'education'];
  const customSections = sections.filter(s => !standardSections.includes(s));

  const schemaFields = [
    `"name": "", "title": "", "email": "", "phone": "", "location": "", "linkedin": ""`,
    sections.includes('summary')            ? `"summary": ""` : null,
    sections.includes('key_qualifications') ? `"key_qualifications": ["one bullet per line — plain strings only"]` : null,
    `"experience": [{ "role": "", "company": "", "period": "", "bullets": [""] }]`,
    `"education": [{ "degree": "", "school": "", "year": "" }]`,
    sections.includes('skills')             ? `"skills": ["plain string per skill — NO objects"]` : null,
    customSections.length                   ? `"additional_sections": [{ "title": "", "items": [""] }]` : null,
  ].filter(Boolean).join(',\n    ');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    messages: [{ role: 'user', content: `You are an expert CV writer. Rewrite this CV applying the specific changes listed below.

RULES:
- Apply every listed change exactly as described
- Keep all facts accurate — do NOT invent experience not in the original
- Emphasize job description keywords where they match the candidate's actual experience
- Include ONLY the sections listed under SECTIONS TO INCLUDE — omit all others
- Return which top-level sections you modified in "modified_sections"

SECTIONS TO INCLUDE (in this order):
${sections.join(', ')}
${customSections.length ? `Custom sections to add under "additional_sections": ${customSections.join(', ')}` : ''}

CHANGES TO APPLY:
${changesText}

JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 800)}

ORIGINAL CV:
${cvText}

Return JSON only:
{
  "cv": {
    ${schemaFields}
  },
  "modified_sections": []
}

IMPORTANT: skills and key_qualifications must be flat arrays of plain strings only — no objects, no nested arrays.` }]
  });

  const raw = extractJSON(message.content[0].text);
  const result = JSON.parse(raw);
  const { cv: cvData, modified_sections = [] } = result;
  enforceContactInfo(cvData, cvText);
  cleanBulletPrefixes(cvData);
  if (originalName) cvData.name = originalName;
  // Confirmed contact is the highest-priority source — user-verified, never re-extracted from PDF
  if (confirmedContact) {
    ['name', 'title', 'email', 'phone', 'location', 'linkedin'].forEach(f => {
      if (confirmedContact[f]) cvData[f] = confirmedContact[f];
    });
    if (cvData.linkedin) cvData.linkedin = normalizeLinkedin(cvData.linkedin);
  }

  // Flatten any array field that Claude returned as objects instead of strings
  ['skills', 'key_qualifications'].forEach(field => {
    if (!Array.isArray(cvData[field])) return;
    cvData[field] = cvData[field].map(s => {
      if (typeof s === 'string') return s;
      if (s && typeof s === 'object') {
        if (s.category && Array.isArray(s.items)) return `${s.category}: ${s.items.join(', ')}`;
        return Object.values(s).filter(Boolean).join(': ');
      }
      return String(s);
    }).filter(s => s && String(s).trim());
  });

  const company = job.employer_name || job.company || 'Company';
  const html = generateExecutiveTemplate(cvData, job);
  const fileName = `output/cv_${company.replace(/\s+/g, '_')}.html`;
  await fse.outputFile(fileName, html);

  return { filePath: fileName, cvData, modified_sections };
}

// Coach chat — history grows across the session (one coach per CV+job)
async function chatWithCoach(cvText, job, hrReview, history, userMessage, gapDescription) {
  const gapContext = gapDescription ? `The candidate is currently discussing this specific gap: "${gapDescription}"\n\n` : '';
  const systemPrompt = `You are a warm, direct Career Coach. You have already reviewed this candidate's CV and the target job.

CV (summary):
${cvText.slice(0, 1500)}

TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 400)}

GAPS IDENTIFIED BY HR:
${(hrReview.confirm_changes || []).map(c => '- ' + c.description).join('\n')}

Your role:
- Help the client discover capabilities they may have forgotten or are too shy to mention
- Ask one specific probing question to uncover relevant experience
- Build confidence for legitimate skills the client genuinely has
- Be honest — if a skill is a real gap, acknowledge it and suggest a realistic short path to fill it
- Keep every response to 2-4 sentences maximum`;

  const messages = [...history, { role: 'user', content: gapContext + userMessage }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages,
  });
  const reply = response.content[0].text;
  return { reply, history: [...messages, { role: 'assistant', content: reply }] };
}

// HR agent refines a gap suggestion based on what the coach + client discussed
async function refineWithHR(cvText, job, hrReview, gap, conversation, hrHistory) {
  const conversationText = conversation.map(m =>
    `${m.role === 'user' ? 'Candidate' : 'Coach'}: ${m.content}`
  ).join('\n');

  const systemPrompt = `You are a Senior HR Manager. You already reviewed this CV for the role of ${job.job_title} at ${job.employer_name || job.company || ''}.

CV (summary):
${cvText.slice(0, 1000)}

Your initial HR review identified: ${gap.description}`;

  const userMessage = `The candidate discussed this gap with their career coach. Here is the conversation:

${conversationText}

Based on this discussion, rewrite the suggestion as a concrete, CV-ready statement. Be specific and honest.

Return JSON only:
{
  "refined_description": "",
  "rationale": "",
  "verdict": "add|skip|candidate_decides"
}

verdict: "add" if clearly evidenced, "skip" if not justified, "candidate_decides" if borderline.`;

  const messages = [...hrHistory, { role: 'user', content: userMessage }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages,
  });
  const raw = extractJSON(response.content[0].text);
  const result = JSON.parse(raw);
  return { result, history: [...messages, { role: 'assistant', content: response.content[0].text }] };
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

module.exports = { extractJobTitles, analyzeJobFit, parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText };
