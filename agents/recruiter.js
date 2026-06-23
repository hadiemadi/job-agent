const { client, MODEL } = require('../core/claude');
const { extractJSON } = require('../core/json');
const { loadCore, loadDiscipline, saveDiscipline } = require('../core/knowledge');
const { preferencesBlock } = require('../core/preferences');
const { detectField } = require('./extractor');
const { mergeFindings, isStale } = require('./curator');
const { research } = require('./researcher');

// Writing-style directive so CV prose and cover letters read as genuinely human-written —
// applied to every piece of free-text content the HR persona writes (CV wording, cover
// letters), never to the facts themselves. Style only; never invents or alters substance.
// Exported because tasks/coverLetter.js and tasks/interviewPrep.js also append it directly
// to their own user messages, outside the system prompt.
function stealthWritingDirective() {
  return `\n\nWRITING STYLE — read naturally, like a real person wrote it: Vary sentence length and structure; avoid a uniform, metronomic rhythm. Avoid AI-cliché phrases and buzzwords ("leverage", "synergy", "passionate about", "I am writing to express my interest", "in today's fast-paced environment", "proven track record", "delve", "robust", "seamless", "unlock potential") unless genuinely the most accurate word. Avoid repeating the exact same sentence structure across consecutive bullets or lines. Use em dashes and semicolons sparingly, the way a person naturally would. Prefer concrete, specific detail (numbers, named tools, named outcomes) over generic claims. Never mention, hint at, or disclose that AI was used to write or assist with this content. All of this is about STYLE ONLY — never invent facts, achievements, or numbers not already present in the candidate's CV.`;
}

// CV layout/section norms differ by country, industry, and seniority (e.g. a photo and
// hobbies are customary on a Swedish engineer's CV but a red flag on a US one). Rather than
// hardcoding one country's rules, this either hands Claude its own live research findings
// (when the client opted into extensive search — see researchCvConventions below) or asks it
// to apply its trained knowledge of the target market's norms itself. Internal to
// hrSystemPrompt — not used anywhere else, so not exported.
function regionalConventionsBlock(job, conventionsResearch) {
  const country = job.job_country || job.country || job.job_location || job.location || 'the country implied by this job listing';
  if (conventionsResearch) {
    return `\n\nREGIONAL CV CONVENTIONS — live web research for this role's target market (apply these; do not default to generic US norms):\n${conventionsResearch}`;
  }
  return `\n\nREGIONAL CV CONVENTIONS: Determine and apply the correct CV/resume conventions for
${country}, for a candidate at this seniority and in this industry — using your own knowledge
of regional hiring norms, not a one-size-fits-all US template. Explicitly decide (silently —
don't explain this reasoning to the candidate unless asked):
- Page length norms for this market and seniority.
- Whether a photo, date of birth/age, marital status, or nationality is customary or a red flag.
- Whether hobbies/personal interests are customary here (e.g. commonly expected on engineering
  CVs in Sweden/Germany/Netherlands; typically omitted in the US/UK/India) — include them only
  if genuinely customary for this market and the candidate has real ones to list.
- Local date format, spelling/terminology, and section ordering conventions.
- First-person pronoun use ("I"/"my") — many European markets tolerate it more than the US.`;
}

// Identifies the candidate's field/discipline and seniority in the prompt so the HR persona's
// judgment is calibrated to what a great recruiter in THAT specific discipline would check,
// not one-size-fits-all advice. Also renders the accumulated discipline knowledge store
// (Phase 5's self-improving skills/keywords/red_flags, if any exist yet) — empty is fine,
// the core text in knowledge/recruiter-core.md still applies on its own.
function fieldBlock(field, disciplineStore) {
  if (!field || !field.field) return '';
  let block = `\n\nCANDIDATE FIELD/DISCIPLINE: ${field.field}${field.seniority ? ` (seniority: ${field.seniority})` : ''} — apply judgment calibrated to what a great recruiter in this specific discipline would check, not generic advice.`;
  const hasAny = disciplineStore && [disciplineStore.skills, disciplineStore.keywords, disciplineStore.red_flags].some(list => list && list.length);
  if (hasAny) {
    const renderList = (label, items) => (items && items.length) ? `\n- ${label}: ${items.map(i => i.text).join('; ')}` : '';
    block += `\n\nACCUMULATED KNOWLEDGE for ${field.field} (learned over time from prior reviews — weigh higher-confidence items more heavily):` +
      renderList('Skills/competencies a great recruiter in this field checks for', disciplineStore.skills) +
      renderList('Keywords', disciplineStore.keywords) +
      renderList('Red flags', disciplineStore.red_flags);
  }
  return block;
}

// One persona, shared by every HR-thread call (review, rewrite, refine, placement, sidebar
// chat, cover letter, interview prep) so the same "expert" carries context and judgment from
// upload through Word export. Modeled on a top-tier executive recruiter/resume strategist
// so output is consistent and decisive run-to-run, rather than re-deciding style each call.
// Exported so agents/cvWriter.js and tasks/* (which write/place CV content but don't own the
// persona itself) can build their system prompts with it. `field`/`disciplineStore` are
// optional — only reviewCV passes them for now; other callers are unaffected.
function hrSystemPrompt(cvText, job, preferences, field, disciplineStore) {
  return `${loadCore('recruiter-core')}
${regionalConventionsBlock(job, preferences && preferences.conventionsResearch)}${fieldBlock(field, disciplineStore)}

CANDIDATE'S TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 800)}

CANDIDATE'S CV:
${cvText}${preferencesBlock(preferences)}${stealthWritingDirective()}`;
}

// The learning loop (Part D of the refactor plan): load this field's discipline store; if
// it's never been researched or has gone stale, run the Researcher (a no-op stub for now —
// see agents/researcher.js — so this costs nothing until live search is enabled) and have
// the Curator merge whatever it finds, then persist. Returns the store either way (possibly
// still empty) so hrSystemPrompt always has something to render or safely skip.
async function loadOrRefreshDiscipline(field) {
  if (!field || !field.field) return null;
  let store = loadDiscipline(field.field);
  if (isStale(store)) {
    const findings = await research(field.field);
    store = mergeFindings(store, findings);
    store.field = field.field;
    saveDiscipline(field.field, store);
  }
  return store;
}

// Pins a client-stated skill claim (routed here by agents/inputRouter.js's "discipline"
// bucket — see the /confirm-contact + /review-cv wiring in server.js) into that field's
// discipline store as a trusted, never-decaying fact. Source_type "user" + pinned: true
// means the Curator will never bump/alter it via a later Researcher merge.
function pinDisciplineSkill(field, text) {
  if (!field || !field.field || !text) return;
  const store = loadDiscipline(field.field);
  const updated = mergeFindings(store, { skills: [{ text, confidence: 99, source_type: 'user', pinned: true }] });
  updated.field = field.field;
  saveDiscipline(field.field, updated);
}

// HR review — auto_changes (safe, directly evidenced) + section decisions. Gap-finding
// (confirm_changes) is handled separately by the Career Coach's analyzeGaps (agents/coach.js)
// and merged in by the /review-cv route — splitting "what's safe to auto-apply" from "what's
// worth flagging to the candidate" keeps each judgment call narrower and more consistent.
async function reviewCV(cvText, job, thread = [], preferences) {
  const field = await detectField(cvText);
  const disciplineStore = await loadOrRefreshDiscipline(field);
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

If overall_match is "Moderate" or "Weak", also explain WHY in fit_explanation: which of THIS
job's requirements aren't evidenced in this CV, and what's missing — 2-4 plain sentences,
using only this CV and this job description (no market/search). Leave fit_explanation empty
for "Strong".

Return JSON only:
{
  "overall_match": "Strong|Moderate|Weak",
  "strengths": [""],
  "fit_explanation": "",
  "recommended_sections": ["summary", "skills", "experience", "education"],
  "section_rationale": "",
  "auto_changes": [{ "description": "", "rationale": "" }]
}`;

  const messages = [...thread, { role: 'user', content: userMessage }];
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0, // classification, not creative writing — same CV/job must yield the same gap list every time
    system: hrSystemPrompt(cvText, job, preferences, field, disciplineStore),
    messages,
  });
  const raw = extractJSON(message.content[0].text);
  const review = JSON.parse(raw);
  return { review, field, thread: [...messages, { role: 'assistant', content: message.content[0].text }] };
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

// HR agent drafts ONE concrete, CV-ready statement for a gap, based on whatever the coach +
// client discussed (the conversation may be empty — discussion is optional, see
// services/gapStore.js). HR takes a clear position every time: it leans "add" or "leave-out"
// with one honest reason — it never hedges with a third, wait-and-see option. The candidate's
// own accept/decline decision is separate and final regardless of which way HR leans.
// `coachFinalStatement` is Coach's FINAL takeaway for THIS gap only — never the raw
// conversation transcript. HR never sees the candidate's back-and-forth with Coach, only the
// conclusion Coach reached; keeps the candidate's own words from being re-litigated or quoted
// out of context by a different agent persona.
async function refineWithHR(cvText, job, hrReview, gap, coachFinalStatement, thread, preferences, sharedContext) {
  const coachNote = coachFinalStatement
    ? `Coach's takeaway on this gap: ${coachFinalStatement}`
    : "The candidate hasn't discussed this gap with their coach — that's normal, not a reason to refuse drafting.";

  // WARNING: HR must only use evidence actually present in the candidate's CV.
  // Never invent or imply experience they don't have — fabrication breaks app trust
  // and gets candidates caught in interviews. Do not loosen this when editing the prompt.
  const userMessage = `Your initial HR review identified this gap: ${gap.description}

${coachNote}
${sharedContext ? `\n${sharedContext}\n` : ''}
Draft ONE concrete, CV-ready statement for this gap. Look at the candidate's FULL CV (given to
you above) for the closest genuinely-evidenced related experience, credential, coursework, or
adjacent skill — even if it's not an exact match for what this gap asks for — and base the
statement on that. refined_description must NEVER be empty, even when you lean "leave-out" or
there's no coach note above: the candidate needs to see exactly what would be added before
deciding whether to follow or override your lean. No coach discussion is normal, not a reason
to refuse — the candidate's CV is itself evidence. Only if the CV truly contains nothing even
adjacent to this gap should you draft a plainly conditional statement (e.g. naming what's
missing and what confirming it would require) — never return an empty string.

Then take a clear position on whether THIS drafted statement belongs on the CV as-is — lean
"add" or "leave-out", never a hedge. Also pick which CV section this statement belongs in
(e.g. "Summary", "Experience", "Skills", "Certifications", "Publications", "Education" — use
the candidate's own section names where one already fits, or the closest standard CV section).

Return JSON only:
{
  "refined_description": "",
  "rationale": "",
  "lean": "add|leave-out",
  "targetSection": ""
}

lean: "add" if the statement is clearly evidenced by the discussion/CV, "leave-out" if it would
overclaim or isn't well-supported. rationale is the reason for that lean — at most 2 short
sentences, crisp and direct, never a paragraph.`;

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

// Sidebar Q&A on the editable tailored CV page — continues the same HR thread, so the
// expert remembers everything discussed during review/rewrite/placement. `model` lets the
// sidebar's picker override the default model for this turn only.
async function chatWithHRExpert(cvText, job, thread, userMessage, model, preferences, sharedContext) {
  const finalUserMessage = sharedContext ? `${userMessage}\n\n${sharedContext}` : userMessage;
  const messages = [...(thread || []), { role: 'user', content: finalUserMessage }];
  const response = await client.messages.create({
    model: model || MODEL,
    max_tokens: 900,
    system: hrSystemPrompt(cvText, job, preferences),
    messages,
  });
  const reply = response.content[0].text;
  return { reply, thread: [...messages, { role: 'assistant', content: reply }] };
}

// Opt-in "extensive search" — the client checked a box asking for live web research into
// CV/resume conventions for this specific job's country, industry, and seniority, rather than
// relying on the model's own trained knowledge (see regionalConventionsBlock above). Runs once
// per job; the resulting summary is cached in appSession.clientPreferences.conventionsResearch
// by the server and reused for every subsequent HR-thread call on that job.
async function researchCvConventions(job, cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Research current resume/CV conventions for a "${job.job_title}" role at
${job.employer_name || job.company || 'this company'}, located in ${job.job_country || job.country || job.job_location || job.location || 'an unspecified country'}.
Infer the candidate's seniority and industry from this CV excerpt:
${(cvText || '').slice(0, 600)}

Search for and summarize the LOCAL market's actual norms for: page length, whether a photo is
expected/discouraged, whether date of birth/age/marital status/nationality are customary,
whether hobbies/personal interests are commonly included, section ordering, and any other
distinctive convention for this country/industry. Be concrete and specific to this market —
not generic advice. Return a plain-text summary, under 12 lines, no markdown headers.`,
    }],
  });
  return message.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

// Splits recruiter-core.md on the PRE-RELEASE REVIEW heading so the reviewer's prompt is ONLY
// the checklist — not the writing/persona instructions the writer used to produce the draft.
// This is what makes the review independent: the reviewer never sees hrSystemPrompt's
// "you are a top-tier HR strategist, here's how to write/lay out a CV" framing, only the
// fresh-eyes checklist that judges the finished result.
function preReleaseReviewPrompt() {
  const core = loadCore('recruiter-core');
  const marker = 'PRE-RELEASE REVIEW';
  const idx = core.indexOf(marker);
  return idx === -1 ? core : core.slice(idx);
}

// Independent quality gate, run before any tailored CV reaches the candidate. Deliberately a
// fresh, separate client.messages.create call with no shared thread/history — it must judge
// only the final tailored CV against the job and the original source CV, with zero visibility
// into the writer's reasoning, so an elementary mistake (e.g. the target company name baked
// into the summary) gets caught by independent eyes rather than rubber-stamped by the same
// judgment that produced it.
async function reviewTailoredCV({ tailoredCv, job, sourceCvText }) {
  const userMessage = `TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}

CANDIDATE'S ORIGINAL/SOURCE CV (verify nothing was fabricated and nothing genuine was dropped):
${sourceCvText}

TAILORED CV TO REVIEW (JSON):
${JSON.stringify(tailoredCv, null, 2)}

Go through the checklist one item at a time. Return JSON only:
{
  "checks": [{ "item": "", "verdict": "PASS|FAIL", "evidence": "", "fix": "" }],
  "verdict": "SHIP|FIX_REQUIRED",
  "required_edits": [""]
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    temperature: 0, // a gate, not a creative pass — same CV/job must get the same verdict every time
    system: preReleaseReviewPrompt(),
    messages: [{ role: 'user', content: userMessage }],
  });
  const raw = extractJSON(message.content[0].text);
  return JSON.parse(raw);
}

module.exports = {
  reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions,
  hrSystemPrompt, stealthWritingDirective, pinDisciplineSkill, reviewTailoredCV, fieldBlock,
};
