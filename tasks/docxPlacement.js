const { client, MODEL } = require('../core/claude');
const { extractJSON } = require('../core/json');
const { hrSystemPrompt } = require('../agents/recruiter');

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

module.exports = { planDocxPlacement };
