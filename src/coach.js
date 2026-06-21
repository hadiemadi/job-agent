const { client, MODEL } = require('../core/claude');
const { extractJSON } = require('../core/json');
const { loadCore } = require('../core/knowledge');

const DIRECTION_DESCRIPTIONS = {
  specialist:  'Deep technical expert, Individual Contributor, architect, domain authority — going deeper not broader',
  generalist:  'Cross-functional, program/product management, business-technical bridge roles',
  leadership:  'Any kind of management — team lead, engineering manager, director, VP, people and organizational leadership',
};

// Shared persona for every Career Coach interaction — used here AND by chatWithCoach in
// src/ai.js (the gap-discussion coach during CV review), so the candidate is talking to one
// consistent coach throughout, not two differently-voiced ones. Text lives in
// knowledge/coach-core.md so it can be improved without touching code.
const CAREER_COACH_PERSONA = loadCore('coach-core');

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
// at least 5 where that many genuinely exist, prioritized by severity, capped at 20 total
// (across all severities combined) so the review stays digestible. `severities` is the set of
// severities the client opted into seeing (checkboxes on the contact page, all on by default).
function selectTopGaps(gaps, severities = ['major', 'mild', 'minor'], minCount = 5, maxCount = 20) {
  const order = { major: 0, mild: 1, minor: 2 };
  const filtered = (gaps || []).filter(g => severities.includes(g.severity));
  const sorted = filtered.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  const count = Math.min(Math.max(minCount, sorted.length), maxCount);
  return sorted.slice(0, count);
}

module.exports = { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, CAREER_COACH_PERSONA };
