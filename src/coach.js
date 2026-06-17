const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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

const DIRECTION_DESCRIPTIONS = {
  specialist:  'Deep technical expert, Individual Contributor, architect, domain authority — going deeper not broader',
  generalist:  'Cross-functional, program/product management, business-technical bridge roles',
  leadership:  'Any kind of management — team lead, engineering manager, director, VP, people and organizational leadership',
};

async function analyzeAndSuggestRoles(cvText, direction) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are an expert career coach with 20 years of experience in the tech industry.

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
      content: `You are a career coach. The candidate is targeting these ideal roles: ${roleList}

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
      content: `You are an executive career coach.

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

module.exports = { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath };
