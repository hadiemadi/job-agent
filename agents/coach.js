const { client, MODEL } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');
const { logDiagnostic } = require('../core/logger');
const { loadCore } = require('../core/knowledge');
const { preferencesBlock } = require('../core/preferences');
const { fieldBlock } = require('./recruiter');

const DIRECTION_DESCRIPTIONS = {
  specialist:  'Deep technical expert, Individual Contributor, architect, domain authority — going deeper not broader',
  generalist:  'Cross-functional, program/product management, business-technical bridge roles',
  leadership:  'Any kind of management — team lead, engineering manager, director, VP, people and organizational leadership',
};

// Shared persona for every Career Coach interaction — used here AND by chatWithCoach below
// (the gap-discussion coach during CV review), so the candidate is talking to one consistent
// coach throughout, not two differently-voiced ones. Text lives in knowledge/coach-core.md so
// it can be improved without touching code.
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
    const raw = extractJSON(firstText(message));
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
    const raw = extractJSON(firstText(message));
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
    const raw = extractJSON(firstText(message));
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
  const userMessage = `${CAREER_COACH_PERSONA}

Compare this candidate's CV against the target job description in detail. Identify up to 20
distinct gaps — anything the job description calls for (required or preferred) that the CV does
not clearly state or demonstrate. Look beyond just missing skills/certifications: also consider
gaps in seniority, scope, domain experience, tools, methodologies, and leadership scope.

Each gap's "description" must be a NEUTRAL TOPIC PHRASE naming the subject area only — no
judgment words and no claim about absence or presence (never "No", "Lacks", "Missing", "Zero",
"Limited", "Weak"). E.g. write "EMC engineering experience", not "No direct EMC engineering
experience". The "rationale" field is where the actual gap/judgment belongs.

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
with very few genuine gaps, return fewer items rather than inventing weak ones.`;
  let message, raw;
  for (let attempt = 0; attempt <= 1; attempt++) {
    let prevText = null;
    if (attempt > 0) { try { prevText = firstText(message); } catch (_) {} }
    const msgs = attempt === 0
      ? [{ role: 'user', content: userMessage }]
      : prevText !== null
        ? [{ role: 'user', content: userMessage }, { role: 'assistant', content: prevText }, { role: 'user', content: 'Reply with ONLY the JSON object — no prose before or after it.' }]
        : [{ role: 'user', content: userMessage }];
    message = await client.messages.create({ model: MODEL, max_tokens: 4000, messages: msgs });
    try {
      raw = extractJSON(firstText(message));
      if (attempt === 1) logDiagnostic('coach.analyzeGaps', { outcome: 'retry_succeeded' });
      break;
    } catch (e) {
      let excerpt = '[no-text-block]';
      try { excerpt = (firstText(message) || '').slice(0, 200); } catch (_) {}
      logDiagnostic('coach.analyzeGaps', { outcome: attempt === 0 ? 'retry_triggered' : 'both_failed', attempt, excerpt });
      if (attempt === 1) return [];
    }
  }
  try {
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

// Coach chat — the conversation persists for the whole client session (CV upload through
// Word export), so this is the same coach throughout, exactly like the HR thread. Lives here
// (not agents/recruiter.js) since it's a Coach interaction, even though it runs during the
// HR review step — the candidate is talking to their coach about a gap HR flagged.
// Builds a compact prior-history block from a gap_memory row, injected into the Coach prompt
// on the first turn of a new gap chat. The coach agent itself judges relevance and phrasing —
// no hardcoded template forces a reference when nothing useful exists.
// extensive=true (Deep research mode): include full prior conversation turns.
// extensive=false (default): verdict-only — faster and cheaper.
function buildPriorGapBlock(prior, extensive = false) {
  const parts = [];
  if (extensive) {
    const turns = Array.isArray(prior.coach_conversation) ? prior.coach_conversation : [];
    if (turns.length > 0) {
      const excerpt = turns.slice(-5).map(t => `${t.role === 'user' ? 'Candidate' : 'Coach'}: ${String(t.content || '').slice(0, 120)}`).join('\n');
      parts.push('Recent conversation:\n' + excerpt);
    }
  }
  if (prior.coach_verdict) parts.push('Coach\'s last verdict: ' + String(prior.coach_verdict).slice(0, 200));
  if (!parts.length) return '';
  return `PRIOR HISTORY FOR THIS GAP (from a previous session with this candidate):
${parts.join('\n')}

If any of the above is genuinely relevant to the current discussion, you may reference it naturally. Do not force a reference when nothing useful exists. You are the judge.`;
}

async function chatWithCoach(cvText, job, hrReview, history, userMessage, gapDescription, preferences, field, disciplineStore, sharedContext, priorGapHistory = null) {
  const gapContext = gapDescription ? `The candidate is currently discussing this specific gap: "${gapDescription}"\n\n` : '';
  const extensive = !!(preferences && preferences.extensiveSearch);
  const priorBlock = priorGapHistory ? buildPriorGapBlock(priorGapHistory, extensive) : '';
  const systemPrompt = `${CAREER_COACH_PERSONA}

CV (summary):
${cvText.slice(0, 1500)}

TARGET JOB: ${job.job_title} at ${job.employer_name || job.company || ''}
${(job.job_description || job.description || '').slice(0, 400)}

GAPS IDENTIFIED BY HR:
${(hrReview.confirm_changes || []).map(c => '- ' + c.description).join('\n')}${fieldBlock(field, disciplineStore)}

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
- When giving a verdict: open with a brief echo of the candidate's key input (the point or context they gave that shaped your judgment — one phrase distilling what they said, not a direct quote), then state your judgment plainly, then your specific advice. Total: 2-3 sentences, no filler.
- When asking a follow-up question: 1-2 sentences only, no restating what they just said.${preferencesBlock(preferences)}${sharedContext ? `\n\n${sharedContext}` : ''}${priorBlock ? `\n\n${priorBlock}` : ''}`;

  const messages = [...history, { role: 'user', content: gapContext + userMessage }];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemPrompt,
    messages,
  });
  const reply = firstText(response);
  return { reply, history: [...messages, { role: 'assistant', content: reply }] };
}

// Unified coach agent — single entry point for all coach interactions in this session.
// All intents share `coachThread` (appSession.coachHistory) so the coach remembers what
// it found during gap analysis when the user later opens the Career Coach tab.
// `profileBlock` is injected by Phase 4 (currently always empty string).
async function coachAgent(intent, {
  cvText, job, hrReview, coachThread = [], preferences = {}, profileBlock = '',
  field = null, disciplineStore = null, sharedContext = null,
  direction, suggestedRoles, rankedJobs,
  roleTitle,
  userMessage, gapDescription,
  priorGapHistory = null,
}) {
  switch (intent) {
    case 'analyze-gaps': {
      const gaps = await analyzeGaps(cvText, job);
      // Prime the coach thread with the gap analysis so Career Coach chat inherits this context.
      const summary = gaps.length
        ? `I've reviewed the CV against the job description and identified ${gaps.length} gap(s):\n` +
          gaps.map((g, i) => `${i + 1}. [${g.severity}] ${g.description}: ${g.rationale}`).join('\n')
        : 'I reviewed the CV against the job description and found no significant gaps.';
      const thread = [
        ...coachThread,
        { role: 'user', content: 'Please analyze this CV against the job description and identify the key gaps to address.' },
        { role: 'assistant', content: summary },
      ];
      return { structured: gaps, thread, reply: summary };
    }
    case 'suggest-roles': {
      const result = await analyzeAndSuggestRoles(cvText, direction);
      const summary = result
        ? `Based on your CV and your ${direction} direction preference, here are ${(result.suggested_roles || []).length} suggested role(s).`
        : 'Unable to generate role suggestions at this time.';
      const thread = [...coachThread,
        { role: 'user', content: `Suggest ideal roles for a ${direction} track.` },
        { role: 'assistant', content: summary },
      ];
      return { structured: result, thread, reply: summary };
    }
    case 'match-market': {
      const matches = await matchRolesToMarket(suggestedRoles, rankedJobs);
      const summary = matches.length
        ? `Found ${matches.length} market match(es) aligned with your ideal roles.`
        : 'No strong market matches found for the suggested roles at this time.';
      const thread = [...coachThread,
        { role: 'user', content: 'Match my ideal roles to current market listings.' },
        { role: 'assistant', content: summary },
      ];
      return { structured: matches, thread, reply: summary };
    }
    case 'build-path': {
      const path = await buildCareerPath(roleTitle, cvText);
      const summary = path
        ? `Here is a career path overview for the "${roleTitle}" role.`
        : 'Unable to build a career path at this time.';
      const thread = [...coachThread,
        { role: 'user', content: `Build a career path for the role: "${roleTitle}".` },
        { role: 'assistant', content: summary },
      ];
      return { structured: path, thread, reply: summary };
    }
    case 'chat': {
      const { reply, history } = await chatWithCoach(
        cvText, job, hrReview, coachThread, userMessage, gapDescription,
        preferences, field, disciplineStore, sharedContext, priorGapHistory
      );
      return { reply, thread: history, structured: null };
    }
    default:
      throw new Error(`Unknown coach intent: ${intent}`);
  }
}

module.exports = {
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps,
  chatWithCoach, CAREER_COACH_PERSONA, buildPriorGapBlock,
  coachAgent,
};
