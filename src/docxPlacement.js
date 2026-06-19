'use strict';
const fse = require('fs-extra');
const path = require('path');
const PizZip = require('pizzip');

const TAG_PATTERN = /\{[#/]?[a-zA-Z_][a-zA-Z0-9_.]*\}/;

function extractParagraphs(documentXml) {
  const paragraphs = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let match;
  let index = 0;
  while ((match = re.exec(documentXml)) !== null) {
    const xml = match[0];
    const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
    paragraphs.push({ index, text, xml, start: match.index, end: match.index + xml.length });
    index += 1;
  }
  return paragraphs;
}

function hasMergeTags(paragraphs) {
  return paragraphs.some(p => TAG_PATTERN.test(p.text));
}

function escapeXml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildParagraphXml(donorXml, text) {
  const pPrMatch = donorXml && donorXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const rPrMatch = donorXml && donorXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';
  const rPr = rPrMatch ? rPrMatch[0] : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function fieldToLines(field, cvData) {
  const cv = cvData || {};
  switch (field) {
    case 'name': case 'title': case 'email': case 'phone': case 'location': case 'linkedin': case 'summary':
      return [cv[field] || ''];
    case 'skills':
      return Array.isArray(cv.skills) ? cv.skills.map(String) : [];
    case 'key_qualifications':
      return Array.isArray(cv.key_qualifications) ? cv.key_qualifications.map(String) : [];
    case 'experience':
      return (Array.isArray(cv.experience) ? cv.experience : []).flatMap(exp => {
        const header = `${exp.role || ''} — ${exp.company || ''} (${exp.period || exp.dates || exp.date_range || ''})`;
        const bullets = Array.isArray(exp.bullets) ? exp.bullets.map(String) : [];
        return [header, ...bullets];
      });
    case 'education':
      return (Array.isArray(cv.education) ? cv.education : []).map(edu =>
        `${edu.degree || ''}, ${edu.school || edu.institution || ''} (${edu.year || ''})`);
    default: {
      const section = (cv.additional_sections || []).find(s => s.title === field);
      return section && Array.isArray(section.items) ? section.items.map(String) : [];
    }
  }
}

function applyPlacementPlan(documentXml, paragraphs, plan, cvData) {
  const headerReplacements = Array.isArray(plan && plan.header_replacements) ? plan.header_replacements : [];
  const replacements = Array.isArray(plan && plan.replacements) ? plan.replacements : [];
  const newSections = Array.isArray(plan && plan.new_sections) ? plan.new_sections : [];

  const genericHeadingDonor = replacements.length ? paragraphs[replacements[0].heading_paragraph_index] : null;
  const genericBodyDonor = replacements.length ? paragraphs[replacements[0].content_start_index] : null;

  const events = [];

  for (const h of headerReplacements) {
    const p = paragraphs[h.paragraph_index];
    if (!p) continue;
    const [line] = fieldToLines(h.field, cvData);
    if (!line) continue;
    events.push({ offsetStart: p.start, offsetEnd: p.end, content: buildParagraphXml(p.xml, line) });
  }

  for (const r of replacements) {
    const startP = paragraphs[r.content_start_index];
    const endP = paragraphs[r.content_end_index];
    if (!startP || !endP) continue;
    const lines = fieldToLines(r.field, cvData);
    const content = lines.map(line => buildParagraphXml(startP.xml, line)).join('');
    events.push({ offsetStart: startP.start, offsetEnd: endP.end, content });
  }

  for (const s of newSections) {
    const anchor = paragraphs[s.insert_after_index];
    if (!anchor) continue;
    const headingDonor = genericHeadingDonor ? genericHeadingDonor.xml : null;
    const bodyDonor = genericBodyDonor ? genericBodyDonor.xml : null;
    const lines = fieldToLines(s.field, cvData);
    const heading = buildParagraphXml(headingDonor, s.heading_text || s.field);
    const body = lines.map(line => buildParagraphXml(bodyDonor, line)).join('');
    events.push({ offsetStart: anchor.end, offsetEnd: anchor.end, content: heading + body });
  }

  events.sort((a, b) => a.offsetStart - b.offsetStart);

  let cursor = 0;
  let result = '';
  for (const ev of events) {
    result += documentXml.slice(cursor, ev.offsetStart);
    result += ev.content;
    cursor = ev.offsetEnd;
  }
  result += documentXml.slice(cursor);
  return result;
}

async function generateWordViaPlacement(cvData, job, templatePath, cvText, thread, preferences, planFn, outputDir = 'output') {
  const slug = (job && (job.job_title || job.title) || 'CV')
    .replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const fileName = `cv_word_custom_${slug}.docx`;
  const filePath = path.join(outputDir, fileName);

  await fse.ensureDir(outputDir);

  const content = await fse.readFile(templatePath);
  const zip = new PizZip(content);
  const documentXml = zip.files['word/document.xml'].asText();
  const paragraphs = extractParagraphs(documentXml);

  const { plan, thread: updatedThread } = await planFn(paragraphs, cvData, cvText, job, thread, preferences);
  const newXml = applyPlacementPlan(documentXml, paragraphs, plan, cvData);
  zip.file('word/document.xml', newXml);

  const buffer = zip.generate({ type: 'nodebuffer' });
  await fse.writeFile(filePath, buffer);
  return { wordPath: filePath.replace(/\\/g, '/'), thread: updatedThread };
}

module.exports = {
  extractParagraphs, hasMergeTags, buildParagraphXml, fieldToLines,
  applyPlacementPlan, generateWordViaPlacement,
};
