const { client, MODEL } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');
const { hrSystemPrompt, stealthWritingDirective } = require('../agents/recruiter');
const { logDiagnostic } = require('../core/logger');

// Cover letter — written by the same HR persona, only on explicit client request (button
// press on the tailored CV page). Tone/wording must mirror the LATEST tailored CV exactly,
// so cvData (the live, possibly-edited content) is passed in fresh each time rather than
// re-deriving it from the original CV text. A "task" (Part C of the refactor plan), not an
// agent — it's a one-shot job owned by the Recruiter persona, reusing hrSystemPrompt.
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
  let message, raw;
  for (let attempt = 0; attempt <= 1; attempt++) {
    let prevText = null;
    if (attempt > 0) { try { prevText = firstText(message); } catch (_) {} }
    const msgs = attempt === 0 ? messages
      : prevText !== null
        ? [...messages, { role: 'assistant', content: prevText }, { role: 'user', content: 'Reply with ONLY the JSON object — no prose before or after it.' }]
        : messages;
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: hrSystemPrompt(cvText, job, preferences),
      messages: msgs,
    });
    try {
      raw = extractJSON(firstText(message));
      if (attempt === 1) logDiagnostic('tasks.generateCoverLetter', { outcome: 'retry_succeeded' });
      break;
    } catch (e) {
      let excerpt = '[no-text-block]';
      try { excerpt = (firstText(message) || '').slice(0, 200); } catch (_) {}
      logDiagnostic('tasks.generateCoverLetter', { outcome: attempt === 0 ? 'retry_triggered' : 'both_failed', attempt, excerpt });
      if (attempt === 1) throw e;
    }
  }
  const { cover_letter } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: firstText(message) }];

  const initialHrMessage = "I've drafted a cover letter to match your tailored CV's tone and content — take a look and let me know if you'd like adjustments.";
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  return { coverLetter: cover_letter, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

module.exports = { generateCoverLetter };
