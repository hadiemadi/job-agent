const Anthropic = require('@anthropic-ai/sdk');
const fse = require('fs-extra');
const { generateExecutiveTemplate } = require('./templates');
const { CAREER_COACH_PERSONA } = require('./coach');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Claude sometimes writes a real newline/tab inside a JSON string value (e.g. a multi-
// paragraph cover letter or a multi-sentence answer) instead of escaping it as \n — that's
// invalid JSON and makes JSON.parse fail mid-string with a confusing "Expected ',' or ']'"
// error. Walk the text tracking string/escape state and escape any raw control character
// found inside a string literal, leaving structural whitespace (between tokens) untouched.
function sanitizeJsonControlChars(raw) {
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { result += ch; escapeNext = false; continue; }
    if (ch === '\\' && inString) { result += ch; escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    result += ch;
  }
  return result;
}

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
  return sanitizeJsonControlChars(text.slice(start, end + 1));
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

// Renders the client's chosen tone (1=neutral/diplomatic .. 5=blunt), CV wording level
// (1=match original .. 5=senior expert), and any free-text instructions they gave on the
// contact page into a directive block every persona appends.
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

// Writing-style directive so CV prose and cover letters read as genuinely human-written —
// applied to every piece of free-text content the HR persona writes (CV wording, cover
// letters), never to the facts themselves. Style only; never invents or alters substance.
function stealthWritingDirective() {
  return `\n\nWRITING STYLE — read naturally, like a real person wrote it: Vary sentence length and structure; avoid a uniform, metronomic rhythm. Avoid AI-cliché phrases and buzzwords ("leverage", "synergy", "passionate about", "I am writing to express my interest", "in today's fast-paced environment", "proven track record", "delve", "robust", "seamless", "unlock potential") unless genuinely the most accurate word. Avoid repeating the exact same sentence structure across consecutive bullets or lines. Use em dashes and semicolons sparingly, the way a person naturally would. Prefer concrete, specific detail (numbers, named tools, named outcomes) over generic claims. Never mention, hint at, or disclose that AI was used to write or assist with this content. All of this is about STYLE ONLY — never invent facts, achievements, or numbers not already present in the candidate's CV.`;
}

// One persona, shared by every HR-thread call (review, rewrite, refine, placement, sidebar
// chat, cover letter, interview prep) so the same "expert" carries context and judgment from
// upload through Word export. Modeled on a top-tier US executive recruiter/resume strategist
// so output is consistent and decisive run-to-run, rather than re-deciding style each call.
function hrSystemPrompt(cvText, job, preferences) {
  return `You are a top-tier Senior HR Manager and CV strategist — 18+ years leading talent
acquisition and resume strategy for Fortune 500 companies and high-growth US tech firms, with
deep ATS (Applicant Tracking System) expertise and a track record of getting candidates past
automated screens and in front of hiring managers. You think like the hiring manager AND the
recruiter at once: you know exactly what makes a reviewer stop scrolling, and exactly what
makes a parser choke.

You are working with this one candidate continuously — from your initial CV review, through
tailoring the CV for this role, through deciding how to place content into any Word template
they use, to answering their questions while they make final edits, drafting their cover
letter, and prepping them for the interview. Stay consistent with judgments and rationale
you've already given earlier in this conversation.

You own every aspect of how the CV is written and presented: template/layout choice, document
format, font, color accents, section segmentation, and wording. For wording specifically, you
offer the candidate flexibility from their own original phrasing up to senior-expert-level
language, across 5 levels (see CV WORDING LEVEL below) — never push them past the level they've
chosen.

YOUR CORE PRINCIPLES — apply these the same way every time for the same CV/job pair; your
judgment should not vary between attempts:
- Evidence-based only: every claim, skill, and achievement traces back to something the
  candidate actually wrote or confirmed. Never invent, embellish, or round up.
- Quantify impact wherever the original CV gives you a number, scope, or outcome to work with
  (%, $, team size, timeline, scale) — vague "responsible for X" phrasing is a defect, not a
  style choice.
- Every bullet leads with a strong action verb in the correct tense (past tense for past
  roles, present tense for the current role) — never "Responsible for," "Worked on," or other
  passive framing.
- Keyword-match the target job description wherever the candidate's real experience supports
  it, for ATS parsing — but never insert a skill or keyword the candidate hasn't demonstrated.
- Section inclusion is decided by what's objectively true of the CV, not by re-guessing
  relevance each time: any section already present in the candidate's original CV with real
  content (certifications, languages, publications, awards, volunteer work, side projects,
  etc.) stays in unless it is genuinely irrelevant to professional credibility — you do not
  silently drop credentials a candidate already has just because this specific job doesn't
  emphasize them. You only decide case-by-case for sections that do NOT already exist in the
  original CV.
- No filler, no clichés, no generic statements that could apply to any candidate.

US RESUME CONVENTIONS — this candidate is applying to US-based roles; follow current 2024/2025
US hiring norms, not UK/EU CV conventions:
- Reverse-chronological order, most recent role first.
- Length: 1 page for under ~10 years of experience, max 2 pages beyond that — never longer.
- No photo, no age, no date of birth, no marital status, no nationality, no "References
  available upon request."
- Header: name, phone, email, city + state, LinkedIn — no full street address.
- Consistent date format throughout (e.g. "Jan 2022 – Present").
- First-person pronouns ("I", "my") never appear — every bullet is an implied-subject fragment.
- Prefer a clean, single-column, ATS-parseable layout unless the candidate has explicitly
  chosen a more visual/designer template for a creative role.
- US spelling and terminology throughout.

CANDIDATE'S TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 800)}

CANDIDATE'S CV:
${cvText}${preferencesBlock(preferences)}${stealthWritingDirective()}`;
}

// HR review — auto_changes (safe, directly evidenced) + section decisions. Gap-finding
// (confirm_changes) is handled separately by the Career Coach's analyzeGaps (src/coach.js)
// and merged in by the /review-cv route — splitting "what's safe to auto-apply" from "what's
// worth flagging to the candidate" keeps each judgment call narrower and more consistent.
async function reviewCV(cvText, job, thread = [], preferences) {
  const userMessage = `Review this candidate's CV against the job description above.

List the auto_changes you'd apply automatically — safe to apply because they are directly
evidenced in the CV (skills mentioned in experience but missing from the skills list, keyword
optimization that matches existing experience, restructuring/reordering). Apply the same bar
every time — the same CV and job must produce the same list every time.

Also decide which CV sections to include in the tailored version. Apply current US resume best
practices (2024/2025) — and apply them consistently: the same CV and job must produce the same
section decisions every time, never a different outcome between attempts.
- "summary": include for most roles — strong 3-5 sentence professional profile targeting this specific job
- "key_qualifications": include for senior, specialist, or leadership roles where a quick highlight reel adds value before experience; skip for junior/generalist roles
- "skills": include when technical skills are key differentiators for this role; skip if skills are already embedded in experience bullets and adding a list adds no value
- "experience": always include
- "education": always include
- Any additional section already present in the candidate's ORIGINAL CV with real content
  (e.g. "certifications", "languages", "publications", "awards", "volunteer", "side projects"):
  ALWAYS include it in recommended_sections under its original name — do not drop a credential
  the candidate already has just because this specific job doesn't emphasize it. Only omit an
  existing section if it is genuinely irrelevant to professional credibility (e.g. unrelated
  personal hobbies with no bearing on employability).
- A section the candidate's original CV does NOT already have: only add it if there is strong
  direct evidence in the CV content that justifies it.

Return JSON only:
{
  "overall_match": "Strong|Moderate|Weak",
  "strengths": [""],
  "recommended_sections": ["summary", "skills", "experience", "education"],
  "section_rationale": "",
  "auto_changes": [{ "description": "", "rationale": "" }]
}`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0, // classification, not creative writing — same CV/job must yield the same gap list every time
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const review = JSON.parse(raw);
  return { review, thread: [...messages, { role: 'assistant', content: message.content[0].text }] };
}

// Flatten any array field Claude returned as objects instead of plain strings
// (e.g. skills/key_qualifications grouped by category) into flat string arrays.
function flattenStringArrayFields(cvData, fields) {
  fields.forEach(field => {
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
}

// ── Session summary (HR sidebar's opening message) ────────────────────────────────────────
// Built deterministically from data already in scope rather than via an extra AI call, so the
// facts (settings, section diffs, accept/skip outcomes) can never drift from what was actually
// configured or decided. Ordered to read like a session report: settings (orient the reader),
// then what changed (the tangible result they're looking at), then why (the coach/HR
// discussion that led there), then what's still open (an invitation to keep talking to HR).
function describeTone(tone) {
  return ['Very neutral & diplomatic', 'Calm & measured', 'Balanced & professional', 'Direct & frank', 'Very blunt & candid'][tone - 1] || 'Direct & frank';
}

function describeLanguageLevel(level) {
  return [
    'Kept your original wording — no elevation in vocabulary or sophistication',
    'Lightly polished above your original phrasing',
    'Clearly professional, moderately elevated language',
    'Highly professional, polished corporate language',
    'Senior-expert / executive-caliber language',
  ][level - 1] || 'Lightly polished above your original phrasing';
}

function buildSettingsLines(preferences) {
  const { tone = 4, languageLevel = 2, customInstructions = '' } = preferences || {};
  const lines = [
    `- Feedback tone: ${describeTone(tone)}`,
    `- CV wording level: ${describeLanguageLevel(languageLevel)}`,
    `- Discreet writing mode: On — content is phrased to read as natural, human-written text while staying 100% factual to your CV`,
  ];
  if (customInstructions) lines.push(`- Your custom instructions: "${customInstructions}"`);
  return lines;
}

function buildSectionChangeLines(originalCvData, tailoredCvData, modifiedSections) {
  const orig = originalCvData || {};
  const tailored = tailoredCvData || {};
  const hasContent = (cv, key) => {
    const v = cv[key];
    if (Array.isArray(v)) return v.length > 0;
    return !!(v && String(v).trim());
  };
  const origCustomNames     = (orig.additional_sections     || []).filter(s => s && s.title).map(s => s.title);
  const tailoredCustomNames = (tailored.additional_sections || []).filter(s => s && s.title).map(s => s.title);

  // Match section names loosely (case-insensitive, singular/plural-insensitive) before
  // deciding add/remove — otherwise a section the model just renamed in passing (e.g.
  // "Publication" -> "Publications") gets falsely reported as removed AND added.
  const normalize = s => String(s || '').toLowerCase().trim().replace(/s$/, '');
  const origByNorm     = new Map(origCustomNames.map(n => [normalize(n), n]));
  const tailoredByNorm = new Map(tailoredCustomNames.map(n => [normalize(n), n]));

  const standardLabels = { summary: 'Summary', key_qualifications: 'Key Qualifications', skills: 'Skills' };
  const added = [];
  const removed = [];
  const renamed = [];
  Object.keys(standardLabels).forEach(key => {
    const inOrig     = hasContent(orig, key);
    const inTailored = hasContent(tailored, key);
    if (inTailored && !inOrig) added.push(standardLabels[key]);
    if (!inTailored && inOrig) removed.push(standardLabels[key]);
  });
  tailoredByNorm.forEach((name, norm) => {
    if (!origByNorm.has(norm)) added.push(name);
    else if (origByNorm.get(norm) !== name) renamed.push(`"${origByNorm.get(norm)}" → "${name}"`);
  });
  origByNorm.forEach((name, norm) => { if (!tailoredByNorm.has(norm)) removed.push(name); });

  const lines = [];
  if (added.length)   lines.push(`- Added sections: ${added.join(', ')}`);
  if (removed.length) lines.push(`- Removed sections: ${removed.join(', ')}`);
  if (renamed.length) lines.push(`- Renamed sections (same content): ${renamed.join(', ')}`);
  if (!added.length && !removed.length && !renamed.length) lines.push('- Same sections as your original CV — no sections added or removed');
  if (modifiedSections && modifiedSections.length) lines.push(`- Rewritten/edited within existing sections: ${modifiedSections.join(', ')}`);
  return lines;
}

function buildChangesAppliedLines(allChanges) {
  if (!allChanges.length) return ["- Wording optimized for this job's keywords based on your existing experience — no structural changes were needed"];
  return allChanges.map(c => `- **${c.description}** — ${c.rationale || 'improves alignment with this role'}`);
}

// gapDiscussions (from the client): one entry per confirm_changes gap, carrying the coach
// conversation transcript (if the candidate discussed it) and the final accept/skip/refine
// outcome — so "what was discussed" and "the outcome" can both be reported accurately.
function buildGapDiscussionLines(gapDiscussions) {
  if (!gapDiscussions || !gapDiscussions.length) return null;
  return gapDiscussions.map(g => {
    const discussed = g.coachConversation && g.coachConversation.length > 0;
    let outcome;
    if (g.status === 'accepted') {
      outcome = g.refinedDescription ? `added to your CV as: "${g.refinedDescription}"` : 'added to your CV';
    } else if (g.status === 'skipped') {
      outcome = 'skipped — not added';
    } else {
      outcome = 'left undecided';
    }
    const discussedNote = discussed ? ' (after discussing it with your Career Coach)' : '';
    return `- **${g.description}** — ${outcome}${discussedNote}`;
  });
}

function buildSuggestionLines(gapDiscussions) {
  const skipped = (gapDiscussions || []).filter(g => g.status === 'skipped' && g.rationale);
  if (!skipped.length) return null;
  return skipped.map(g => `- ${g.description} — ${g.rationale} (you can revisit this anytime in the sidebar)`);
}

function buildSessionSummary(preferences, originalCvData, tailoredCvData, modifiedSections, allChanges, gapDiscussions) {
  const sections = [];
  sections.push('**Settings used for this CV**', buildSettingsLines(preferences).join('\n'));
  sections.push('**What changed vs. your original CV**',
    [...buildSectionChangeLines(originalCvData, tailoredCvData, modifiedSections), ...buildChangesAppliedLines(allChanges)].join('\n'));
  const gapLines = buildGapDiscussionLines(gapDiscussions);
  if (gapLines) sections.push('**What we discussed with your Coach & HR**', gapLines.join('\n'));
  const suggestionLines = buildSuggestionLines(gapDiscussions);
  if (suggestionLines) sections.push('**Other suggestions worth revisiting**', suggestionLines.join('\n'));
  return sections.join('\n\n');
}

// Tailor CV applying specific changes from HR review + client confirmations
async function rewriteCVWithChanges(cvText, job, autoChanges, confirmedChanges, recommendedSections, originalName, confirmedContact, thread = [], preferences, hrDisplayHistory = [], originalCvData = null, gapDiscussions = []) {
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

  const userMessage = `Rewrite this candidate's CV applying the specific changes listed below.

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

Return JSON only:
{
  "cv": {
    ${schemaFields}
  },
  "modified_sections": []
}

IMPORTANT: skills and key_qualifications must be flat arrays of plain strings only — no objects, no nested arrays.`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });

  const raw = extractJSON(message.content[0].text);
  const result = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];
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

  flattenStringArrayFields(cvData, ['skills', 'key_qualifications']);

  // Pre-populates the editable CV page's HR sidebar so it never starts empty — built from
  // data already in scope, not a separate AI call. Appended to whatever sidebar history
  // already exists so re-tailoring/regenerating never wipes prior HR conversation.
  const initialHrMessage = buildSessionSummary(preferences, originalCvData, cvData, modified_sections, allChanges, gapDiscussions);
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  const company = job.employer_name || job.company || 'Company';
  const html = generateExecutiveTemplate(cvData, job, { hrDisplayHistory: updatedDisplayHistory });
  const fileName = `output/cv_${company.replace(/\s+/g, '_')}.html`;
  await fse.outputFile(fileName, html);

  return { filePath: fileName, cvData, modified_sections, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

// HR regenerates ONLY the wording of an already-tailored CV at a new language level
// (1=match original .. 5=senior expert) — structure, facts, and section list stay untouched.
async function adjustLanguageLevel(cvText, job, cvData, languageLevel, thread, preferences, hrDisplayHistory = []) {
  const prefs = { ...(preferences || {}), languageLevel };
  const userMessage = `The candidate wants their CV's wording regenerated at a different
professionalism level (see CV WORDING LEVEL above), with nothing else changed.

RULES:
- Do NOT add, remove, or reorder sections, bullets, skills, experience entries, or education entries
- Do NOT change any facts, numbers, dates, names, job titles, or contact details
- ONLY adjust word choice, phrasing, and sentence sophistication in "summary", "key_qualifications", and experience "bullets" to match the CV WORDING LEVEL
- Return the exact same fields, in the exact same order and count, as the CV below — wording is the only thing that may change

CURRENT CV:
${JSON.stringify(cvData)}

Return JSON only:
{
  "cv": { /* same shape and fields as the CURRENT CV above, only wording changed */ },
  "template_suggestion": "one sentence if a different template style would suit this wording level better, otherwise empty string"
}`;

  const messages = [...(thread || []), { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: hrSystemPrompt(cvText, job, prefs),
    messages,
  });

  const raw = extractJSON(message.content[0].text);
  const result = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];
  const { cv: updatedCv, template_suggestion = '' } = result;

  enforceContactInfo(updatedCv, cvText);
  cleanBulletPrefixes(updatedCv);
  flattenStringArrayFields(updatedCv, ['skills', 'key_qualifications']);

  const initialHrMessage = `I rewrote your CV's wording at level ${languageLevel}/5 — everything else (facts, structure, sections) stayed exactly the same.` +
    (template_suggestion ? `\n- ${template_suggestion}` : '');
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  const company = job.employer_name || job.company || 'Company';
  const html = generateExecutiveTemplate(updatedCv, job, { hrDisplayHistory: updatedDisplayHistory });
  const filePath = `output/cv_${company.replace(/\s+/g, '_')}.html`;
  await fse.outputFile(filePath, html);

  return { cvData: updatedCv, templateSuggestion: template_suggestion, filePath, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

// Coach chat — the conversation persists for the whole client session (CV upload through
// Word export), so this is the same coach throughout, exactly like the HR thread.
async function chatWithCoach(cvText, job, hrReview, history, userMessage, gapDescription, preferences) {
  const gapContext = gapDescription ? `The candidate is currently discussing this specific gap: "${gapDescription}"\n\n` : '';
  const systemPrompt = `${CAREER_COACH_PERSONA}

CV (summary):
${cvText.slice(0, 1500)}

TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 400)}

GAPS IDENTIFIED BY HR:
${(hrReview.confirm_changes || []).map(c => '- ' + c.description).join('\n')}

Your role:
- Assess whether the candidate's previous assignments and accomplishments genuinely align with what this job requires
- Identify concrete skill gaps between the candidate's CV and the job description, including gaps in seniority/scope (e.g. led a team of 3 vs. this role expects leading 20+)
- When you don't have enough information to judge a gap or alignment confidently, ask the candidate a SHORT, SPECIFIC clarifying question instead of guessing
- Help the client discover capabilities they may have forgotten or are too shy to mention
- Build confidence for legitimate skills the client genuinely has
- Be honest — if a skill is a real gap, acknowledge it and suggest a realistic short path to fill it

KEEP THIS SHORT — this is a quick check on one specific gap, not an open-ended interview:
- Ask at most 1-3 follow-up questions total for this gap, then converge on a clear verdict
- The moment you have enough to judge the gap, say so plainly instead of asking more questions
- Every response is 2-3 sentences maximum, no filler, no restating what the candidate just said${preferencesBlock(preferences)}`;

  const messages = [...history, { role: 'user', content: gapContext + userMessage }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemPrompt,
    messages,
  });
  const reply = response.content[0].text;
  return { reply, history: [...messages, { role: 'assistant', content: reply }] };
}

// HR agent refines a gap suggestion based on what the coach + client discussed
async function refineWithHR(cvText, job, hrReview, gap, conversation, thread, preferences) {
  const conversationText = conversation.map(m =>
    `${m.role === 'user' ? 'Candidate' : 'Coach'}: ${m.content}`
  ).join('\n');

  const userMessage = `Your initial HR review identified this gap: ${gap.description}

The candidate discussed this gap with their career coach. Here is the conversation:

${conversationText}

Based on this discussion, rewrite the suggestion as a concrete, CV-ready statement. Be specific and honest.

Return JSON only:
{
  "refined_description": "",
  "rationale": "",
  "verdict": "add|skip|candidate_decides"
}

verdict: "add" if clearly evidenced, "skip" if not justified, "candidate_decides" if borderline.`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(response.content[0].text);
  const result = JSON.parse(raw);
  return { result, thread: [...messages, { role: 'assistant', content: response.content[0].text }] };
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

// Decides WHERE candidate content should go in an uploaded Word template, never what it
// says — the model only returns paragraph indices/labels; callers always splice the
// candidate's own verbatim text into the document, so wording can't be altered or invented.
async function planDocxPlacement(paragraphs, cvData, cvText, job, thread = [], preferences) {
  const paragraphList = paragraphs.map(p => `${p.index}: ${p.text}`).join('\n');
  const fields = {
    name: cvData.name, title: cvData.title,
    email: cvData.email, phone: cvData.phone, location: cvData.location, linkedin: cvData.linkedin,
    summary: cvData.summary,
    skills: cvData.skills, key_qualifications: cvData.key_qualifications,
    experience: (cvData.experience || []).map(e => ({ role: e.role, company: e.company })),
    education: (cvData.education || []).map(e => ({ degree: e.degree, school: e.school })),
    additional_sections: (cvData.additional_sections || []).map(s => s.title),
  };

  const userMessage = `Below is a Word CV template the candidate uploaded, listed paragraph-by-paragraph by index, and the candidate's tailored CV field summary.

Decide where each candidate field should be placed in the template, reusing the template's existing section headings wherever a matching section already exists. Do NOT include or invent any candidate wording yourself — you are only choosing placement, never writing content.

Return JSON only:
{
  "header_replacements": [
    { "field": "name|title|email|phone|location|linkedin", "paragraph_index": 0 }
  ],
  "replacements": [
    { "field": "summary|skills|key_qualifications|experience|education", "heading_paragraph_index": 0, "content_start_index": 0, "content_end_index": 0 }
  ],
  "new_sections": [
    { "field": "key_qualifications|additional_sections name", "insert_after_index": 0, "heading_text": "" }
  ]
}

Rules:
- "header_replacements": the template's opening lines usually show the original CV owner's name, title, and contact details as standalone paragraphs (often near the top, no section heading above them) — point each candidate header field at the single paragraph index currently holding that piece of info.
- "replacements": for each candidate field that has a matching section already in the template, give the heading paragraph's index (kept as-is, untouched) and the inclusive paragraph index range of that section's current body content (to be replaced with the candidate's data).
- "new_sections": for any candidate field with no matching section anywhere in the template (e.g. key_qualifications, or a named additional_sections entry not present), specify the paragraph index to insert after and a short heading label.
- Only use fields that have actual content in the candidate data below.
- additional_sections entries should each become their own "new_sections" item using their title as heading_text, unless a matching section already exists in the template (then use "replacements" with field set to the section's title).

TEMPLATE PARAGRAPHS:
${paragraphList}

CANDIDATE FIELD SUMMARY (for placement decisions only — do not transcribe):
${JSON.stringify(fields, null, 2)}`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const plan = JSON.parse(raw);
  return { plan, thread: [...messages, { role: 'assistant', content: message.content[0].text }] };
}

// Cover letter — written by the same HR persona, only on explicit client request (button
// press on the tailored CV page). Tone/wording must mirror the LATEST tailored CV exactly,
// so cvData (the live, possibly-edited content) is passed in fresh each time rather than
// re-deriving it from the original CV text.
async function generateCoverLetter(cvText, job, cvData, thread = [], preferences, hrDisplayHistory = []) {
  const userMessage = `Using the tailored CV content below — this is the CURRENT, latest version the candidate is looking at, including any edits they've made — write a cover letter for this role.

REQUIREMENTS:
- Address it to the hiring manager (use "Dear Hiring Manager," if no specific name is known)
- Short, clear, crisp — 3 to 4 short paragraphs, no filler, no generic opening like "I am writing to apply for..."
- Tone and language sophistication must match the tailored CV below exactly — same register, same level of formality, same vocabulary level
- Pull only facts, achievements, and wording that already exist in the tailored CV — do not invent or exaggerate anything
- Focus on why this candidate fits THIS specific role, referencing 2-3 of their strongest, most relevant achievements from the CV
- End with a brief, confident closing line, then "Sincerely," then the candidate's name on its own line
${stealthWritingDirective()}

TAILORED CV (latest version, use this for tone/content/wording):
${JSON.stringify(cvData)}

Return JSON only:
{ "cover_letter": "full cover letter text, with paragraphs separated by a blank line" }`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const { cover_letter } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];

  const initialHrMessage = "I've drafted a cover letter to match your tailored CV's tone and content — take a look and let me know if you'd like adjustments.";
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  return { coverLetter: cover_letter, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

// Interview prep — generated only on explicit sidebar button press. Both answer proposals per
// question must be grounded strictly in what's already in the tailored CV; the HR persona
// crafts the questions an interviewer for THIS role would actually ask THIS candidate.
async function generateInterviewQuestions(cvText, job, cvData, thread = [], preferences, hrDisplayHistory = []) {
  const userMessage = `Based on the tailored CV below and the target job, prepare the candidate for their interview.

Generate the TOP 10 interview questions a hiring manager or interview panel would realistically
ask for THIS specific role, given THIS candidate's background — mix in role-specific/technical
questions, behavioral questions tied to strengths or gaps in their CV, and at least one question
probing the area most likely to draw scrutiny (e.g. a gap, a transition, or an ambiguous claim).

For each question, provide 2 different strong answer proposals the candidate could give:
- Both answers must be built ONLY from real achievements, experience, and facts already in the tailored CV below — never invent anything
- The two proposals should take genuinely different angles (e.g. one leads with a technical/quantitative example, the other leads with a leadership/collaboration example; or one is more concise and direct, the other gives more narrative context) — not just reworded versions of the same answer
- Each answer should be interview-ready: spoken naturally, structured (STAR-style where it fits), specific, and concise (3-5 sentences)
${stealthWritingDirective()}

TAILORED CV (latest version):
${JSON.stringify(cvData)}

Return JSON only:
{
  "questions": [
    { "question": "", "answer_1": "", "answer_2": "" }
  ]
}
Return exactly 10 items in "questions".`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const { questions } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];

  const initialHrMessage = "I've put together your top 10 likely interview questions for this role, each with two different ways to answer — take a look in the panel.";
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  return { questions, hrMessage: initialHrMessage, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

// Sidebar Q&A on the editable tailored CV page — continues the same HR thread, so the
// expert remembers everything discussed during review/rewrite/placement. `model` lets the
// sidebar's picker override the default model for this turn only.
async function chatWithHRExpert(cvText, job, thread, userMessage, model, preferences) {
  const messages = [...(thread || []), { role: 'user', content: userMessage }];
  const response = await client.messages.create({
    model: model || MODEL,
    max_tokens: 900,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const reply = response.content[0].text;
  return { reply, thread: [...messages, { role: 'assistant', content: reply }] };
}

// Surgical regeneration — the candidate selected one specific snippet of the tailored CV and
// discussed it with HR in the sidebar (that conversation already lives in `thread`). This
// rewrites ONLY the one field/bullet/sentence that snippet belongs to, per the conclusion of
// that discussion — never the rest of the CV.
async function applyConcernChange(cvText, job, fieldText, selectedText, thread = [], preferences) {
  const userMessage = `The candidate selected this exact snippet from their tailored CV: "${selectedText}"

That snippet is part of this single piece of CV content (one field/bullet/sentence):
"${fieldText}"

Based on everything just discussed above in this conversation, rewrite ONLY this one piece of
CV content to reflect the agreed conclusion. Keep its length, tone, and voice close to the
original — change only what was actually discussed and agreed; do not invent new facts or
alter anything that wasn't raised in the conversation. Return the FULL revised text of this
piece (not just the changed words), since it will directly replace the original.
${stealthWritingDirective()}

Return JSON only:
{ "revised_text": "" }`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const { revised_text } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];
  return { revisedText: revised_text, thread: updatedThread };
}

module.exports = { extractJobTitles, analyzeJobFit, parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText, planDocxPlacement, chatWithHRExpert, adjustLanguageLevel, generateCoverLetter, generateInterviewQuestions, applyConcernChange };
