const { client, MODEL } = require('../core/claude');
const { extractJSON, firstText } = require('../core/json');
const { hrSystemPrompt } = require('../agents/recruiter');
const { logDiagnostic } = require('../core/logger');

// NOTE: this is the AI placement-PLANNING task (decides where content goes). The separate
// src/docxPlacement.js (XML paragraph extraction, splicing the plan into a .docx) is a
// different, unrelated file that actually executes the plan this returns.
//
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
      max_tokens: 1500,
      system: hrSystemPrompt(cvText, job, preferences),
      messages: msgs,
    });
    try {
      raw = extractJSON(firstText(message));
      if (attempt === 1) logDiagnostic('tasks.planDocxPlacement', { outcome: 'retry_succeeded' });
      break;
    } catch (e) {
      let excerpt = '[no-text-block]';
      try { excerpt = (firstText(message) || '').slice(0, 200); } catch (_) {}
      logDiagnostic('tasks.planDocxPlacement', { outcome: attempt === 0 ? 'retry_triggered' : 'both_failed', attempt, excerpt });
      if (attempt === 1) throw e;
    }
  }
  const plan = JSON.parse(raw);
  return { plan, thread: [...messages, { role: 'assistant', content: firstText(message) }] };
}

module.exports = { planDocxPlacement };
