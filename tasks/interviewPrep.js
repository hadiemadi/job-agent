const { client, MODEL } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');
const { hrSystemPrompt, stealthWritingDirective } = require('../agents/recruiter');

// Interview prep — generated only on explicit sidebar button press. Both answer proposals per
// question must be grounded strictly in what's already in the tailored CV; the HR persona
// crafts the questions an interviewer for THIS role would actually ask THIS candidate. A
// "task" (Part C), not an agent — one-shot, owned by the Recruiter persona.
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
  let message, raw;
  for (let attempt = 0; attempt <= 1; attempt++) {
    const msgs = attempt === 0 ? messages : [
      ...messages,
      { role: 'assistant', content: firstText(message) },
      { role: 'user', content: 'Reply with ONLY the JSON object — no prose before or after it.' },
    ];
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: hrSystemPrompt(cvText, job, preferences),
      messages: msgs,
    });
    try { raw = extractJSON(firstText(message)); break; } catch (e) { if (attempt === 1) throw e; }
  }
  const { questions } = JSON.parse(raw);
  const updatedThread = [...messages, { role: 'assistant', content: firstText(message) }];

  const initialHrMessage = "I've put together your top 10 likely interview questions for this role, each with two different ways to answer — take a look in the panel.";
  const updatedDisplayHistory = [...(hrDisplayHistory || []), { role: 'expert', text: initialHrMessage }];

  return { questions, hrMessage: initialHrMessage, thread: updatedThread, hrDisplayHistory: updatedDisplayHistory };
}

module.exports = { generateInterviewQuestions };
