const fse = require('fs-extra');
const { generateExecutiveTemplate } = require('../render/cvHtml');
const { client, MODEL, createJsonCompletion } = require('../core/claude');
const { extractJSON } = require('../core/json');
const { loadCore } = require('../core/knowledge');
const { registerOutputFile, getSessionSpend } = require('../services/session');
const { hrSystemPrompt, stealthWritingDirective, EVIDENCE_HIERARCHY } = require('./recruiter');

// The writer's own generation directive, appended on top of the shared HR persona/rules
// (hrSystemPrompt). Keeps the writer and the independent pre-release reviewer (recruiter.js's
// reviewTailoredCV) on genuinely separate prompts — the writer never sees the reviewer's
// checklist-only framing, and the reviewer never sees this generation directive.
function writerSystemPrompt(...args) {
  return `${hrSystemPrompt(...args)}\n\n${loadCore('cv-writer-core')}`;
}

// Extract contact info directly from raw CV text via regex — never trust the LLM
// to transcribe sensitive identifiers verbatim (it can silently alter dots, hyphens, etc.)
function extractContactInfo(cvText) {
  if (!cvText) return { email: null, phone: null, linkedin: null };
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
// Any status other than an explicit "accepted" — skipped, missing, blank, or anything else
// — resolves to skipped. A gap the candidate left unanswered carries no real signal either
// way, so the only safe default is "not added": this function never invents CV content for
// a gap that wasn't explicitly accepted, and never reports a stalled/ambiguous outcome.
function buildGapDiscussionLines(gapDiscussions) {
  if (!gapDiscussions || !gapDiscussions.length) return null;
  return gapDiscussions.map(g => {
    const discussed = g.coachConversation && g.coachConversation.length > 0;
    const outcome = g.status === 'accepted'
      ? (g.refinedDescription ? `added to your CV as: "${g.refinedDescription}"` : 'added to your CV')
      : 'skipped — not added';
    const discussedNote = discussed ? ' (after discussing it with your Career Coach)' : '';
    return `- **${g.description}** — ${outcome}${discussedNote}`;
  });
}

function buildSuggestionLines(gapDiscussions) {
  const skipped = (gapDiscussions || []).filter(g => g.status !== 'accepted' && g.rationale);
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
  // autoChanges are already directly evidenced in the CV (HR review's safe, auto-applied
  // edits) — confirmedChanges are different in kind: each one is a single sentence HR drafted
  // from a gap discussion and the candidate explicitly accepted (#21's gap lifecycle). That's
  // net-new content sourced from a side conversation, not an edit to something already on the
  // CV — a materially different risk from "polish an existing bullet," so it gets its own
  // labeled block and its own explicit guardrail rather than being flattened into one list.
  const autoChangesText = (autoChanges || []).length ? autoChanges.map(c => `- ${c.description}`).join('\n') : '';
  const confirmedChangesText = (confirmedChanges || []).length ? confirmedChanges.map(c => `- "${c.description}"`).join('\n') : '';
  const changesText = (autoChangesText || confirmedChangesText)
    ? [
        autoChangesText ? `AUTO-APPLIED CHANGES (directly evidenced in the CV — integrate naturally):\n${autoChangesText}` : null,
        confirmedChangesText ? `CANDIDATE-ACCEPTED STATEMENTS (drafted by HR from a gap discussion, then explicitly accepted by the candidate — insert each one with wording-only polish to match the CV's voice; do NOT add specifics, numbers, scope, or supporting detail beyond what the sentence already states; never invent context for it):\n${confirmedChangesText}` : null,
      ].filter(Boolean).join('\n\n')
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
- The section list below is already FINAL — it was decided in the HR review step that already
  ran. Include every section listed, and ONLY those — do not re-judge relevance or silently drop
  one you'd personally consider less impactful for this job; that decision has already been made.
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
    max_tokens: 4096, // bumped from 3500 to reduce truncation risk on long/senior CVs
    temperature: 0, // section list is a closed decision already made by reviewCV — the same CV/job/sections must produce the same set of sections every time
    system: writerSystemPrompt(cvText, job, preferences),
    messages,
  });

  const raw = extractJSON(message.content[0].text);
  const result = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];
  const { cv: cvData, modified_sections = [] } = result;
  // Section inclusion was already decided by reviewCV (`sections`) — re-assert it here rather
  // than trusting the rewrite call to have honored it under sampling, since dropping a
  // candidate's existing section (e.g. Publications) silently is the exact bug this guards.
  customSections.forEach(title => {
    const norm = String(title).toLowerCase().trim();
    const exists = (cvData.additional_sections || []).some(s => String(s.title || '').toLowerCase().trim() === norm);
    if (!exists) {
      const original = (originalCvData?.additional_sections || []).find(s => String(s.title || '').toLowerCase().trim() === norm);
      if (original) {
        cvData.additional_sections = [...(cvData.additional_sections || []), original];
      }
    }
  });
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

  const html = generateExecutiveTemplate(cvData, job, { hrDisplayHistory: updatedDisplayHistory, aiSpendUsd: getSessionSpend() });
  const filePath = registerOutputFile('html'); // unguessable, session-scoped — see services/session.js
  await fse.outputFile(filePath, html);

  return { filePath, cvData, modified_sections, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
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

  const { text, messages, raw } = await createJsonCompletion({
    model: MODEL,
    max_tokens: 3500,
    system: writerSystemPrompt(cvText, job, prefs),
    messages: [...(thread || []), { role: 'user', content: userMessage }],
  });

  const result = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: text }];
  const { cv: updatedCv, template_suggestion = '' } = result;

  enforceContactInfo(updatedCv, cvText);
  cleanBulletPrefixes(updatedCv);
  flattenStringArrayFields(updatedCv, ['skills', 'key_qualifications']);

  const initialHrMessage = `I rewrote your CV's wording at level ${languageLevel}/5 — everything else (facts, structure, sections) stayed exactly the same.` +
    (template_suggestion ? `\n- ${template_suggestion}` : '');
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  const html = generateExecutiveTemplate(updatedCv, job, { hrDisplayHistory: updatedDisplayHistory, aiSpendUsd: getSessionSpend() });
  const filePath = registerOutputFile('html'); // unguessable, session-scoped — see services/session.js
  await fse.outputFile(filePath, html);

  return { cvData: updatedCv, templateSuggestion: template_suggestion, filePath, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

// Surgical regeneration — the candidate selected one specific snippet of the tailored CV and
// discussed it with HR in the sidebar (that conversation already lives in `thread`). This
// rewrites ONLY the one field/bullet/sentence that snippet belongs to, per the conclusion of
// that discussion — never the rest of the CV.
async function applyConcernChange(cvText, job, fieldText, selectedText, thread = [], preferences, sharedContext) {
  const userMessage = `The candidate selected this exact snippet from their tailored CV: "${selectedText}"

That snippet is part of this single piece of CV content (one field/bullet/sentence):
"${fieldText}"

Based on everything just discussed above in this conversation, decide the agreed conclusion:
- If the discussion concluded that this piece should change, rewrite ONLY this one piece of CV
  content to reflect that agreement. Keep its length, tone, and voice close to the original —
  change only what was actually discussed and agreed; do not invent new facts or alter anything
  that wasn't raised in the conversation. Return the FULL revised text of this piece (not just
  the changed words), since it will directly replace the original.
- If the discussion concluded that nothing should actually change (the candidate decided to
  keep it as-is, or the concern was resolved without needing an edit), return the original text
  unchanged and set "changed" to false — do not invent a cosmetic edit just to have something
  to return.

${EVIDENCE_HIERARCHY}
${stealthWritingDirective()}${sharedContext ? `\n\n${sharedContext}` : ''}

Return JSON only:
{ "revised_text": "", "changed": true }`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: writerSystemPrompt(cvText, job, preferences),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const { revised_text, changed } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: message.content[0].text }];
  return { revisedText: revised_text, changed: changed !== false, thread: updatedThread };
}

module.exports = { parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange };
