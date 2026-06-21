const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Claude sometimes writes a real newline/tab inside a JSON string value instead of escaping
// it as \n — invalid JSON that makes JSON.parse fail mid-string. Escape any raw control
// character found inside a string literal, leaving structural whitespace untouched.
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

const DIRECTION_DESCRIPTIONS = {
  specialist:  'Deep technical expert, Individual Contributor, architect, domain authority — going deeper not broader',
  generalist:  'Cross-functional, program/product management, business-technical bridge roles',
  leadership:  'Any kind of management — team lead, engineering manager, director, VP, people and organizational leadership',
};

// Shared persona for every Career Coach interaction — used here AND by chatWithCoach in
// src/ai.js (the gap-discussion coach during CV review), so the candidate is talking to one
// consistent coach throughout, not two differently-voiced ones.
const CAREER_COACH_PERSONA = `You are a senior Career Coach with 20+ years of hands-on industry experience across both large enterprises and high-growth startups. You combine deep technical/domain fluency in this candidate's field with practical, no-nonsense career strategy advice. You are working with this one candidate continuously — from your first assessment of their fit for a role, through gap discussions, market-fit mapping, and long-term career path planning. Stay consistent with judgments you've already given earlier in the conversation.`;

async function analyzeAndSuggestRoles(cvText, direction) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `${CAREER_COACH_PERSONA}

Analyze this CV and suggest 3-5 ideal next career roles. The candidate's preferred direction is:
${direction.toUpperCase()} TRACK — ${DIRECTION_DESCRIPTIONS[direction]}

CV:
${cvText}

Return JSON only, no explanation:
{
  "profile": {
    "current_level": "",
    "key_strengths": [""],
    "domain_expertise": [""],
    "years_experience": 0,
    "trajectory": ""
  },
  "suggested_roles": [
    {
      "title": "",
      "why_fit": "",
      "why_next_step": "",
      "typical_in_market": true
    }
  ]
}`
    }]
  });

  try {
    const raw = extractJSON(message.content[0].text);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function matchRolesToMarket(suggestedRoles, rankedJobs) {
  const roleList = suggestedRoles.map(r => r.title).join(', ');
  const jobList = rankedJobs.slice(0, 10).map((j, i) =>
    `${i + 1}. ${j.job_title} at ${j.company} (${j.location}) — Fit score: ${j.fit_score}/10`
  ).join('\n');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `${CAREER_COACH_PERSONA}

The candidate is targeting these ideal roles: ${roleList}

Available jobs in the current market:
${jobList}

Identify the TOP 3 available jobs that best serve as stepping stones toward the candidate's ideal roles.
Return JSON only:
[{
  "job_index": 0,
  "job_title": "",
  "company": "",
  "alignment_score": 8,
  "why_it_fits": "",
  "stepping_stone_to": "",
  "caveats": ""
}]`
    }]
  });

  try {
    const raw = extractJSON(message.content[0].text);
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function buildCareerPath(roleTitle, cvText) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `${CAREER_COACH_PERSONA}

Analyze the career path for this candidate targeting the role: "${roleTitle}"

CV:
${cvText}

Return JSON only:
{
  "key_challenges": [""],
  "skill_gaps": [""],
  "quick_wins": [""],
  "success_at_6_months": "",
  "success_at_12_months": "",
  "long_term_trajectory": ""
}`
    }]
  });

  try {
    const raw = extractJSON(message.content[0].text);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Gap discovery — the same Career Coach persona reviews CV vs job and produces up to 20
// candidate gaps, each scored by severity. We deliberately separate "find everything that
// could be a gap" (this call, cast wide) from "what's actually worth bothering the candidate
// about" (selectTopGaps below) — collapsing both into one judgment call was what made the
// HR review's gap count swing wildly between runs.
async function analyzeGaps(cvText, job) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `${CAREER_COACH_PERSONA}

Compare this candidate's CV against the target job description in detail. Identify up to 20
distinct gaps — anything the job description calls for (required or preferred) that the CV does
not clearly state or demonstrate. Look beyond just missing skills/certifications: also consider
gaps in seniority, scope, domain experience, tools, methodologies, and leadership scope.

Score each gap's severity:
- "major": explicitly required by the job, and completely absent from the CV
- "mild": explicitly required or strongly preferred, and only partially or ambiguously covered
- "minor": a "nice to have" in the job description, absent or unclear in the CV

TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 1500)}

CANDIDATE'S CV:
${cvText}

Return JSON only:
{
  "gaps": [
    { "description": "", "rationale": "", "severity": "major|mild|minor" }
  ]
}
List up to 20 gaps, ranked most to least severe. If the CV is an exceptionally strong match
with very few genuine gaps, return fewer items rather than inventing weak ones.`
    }]
  });

  try {
    const raw = extractJSON(message.content[0].text);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.gaps) ? parsed.gaps : [];
  } catch (e) {
    return [];
  }
}

// Picks a manageable subset of the full gap list to actually put in front of the candidate —
// at least 5 where that many genuinely exist, prioritized by severity, capped so the review
// stays digestible rather than turning into 20 separate chats.
function selectTopGaps(gaps, minCount = 5, maxCount = 8) {
  const order = { major: 0, mild: 1, minor: 2 };
  const sorted = [...(gaps || [])].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const count = Math.min(Math.max(minCount, sorted.length), maxCount);
  return sorted.slice(0, count);
}

module.exports = { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, CAREER_COACH_PERSONA };
