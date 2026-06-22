'use strict';
const fse = require('fs-extra');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { extractParagraphs, hasMergeTags, generateWordViaPlacement } = require('./docxPlacement');
const { planDocxPlacement } = require('../tasks/docxPlacement');
const { registerOutputFile } = require('../services/session');

function prepareTemplateData(cvData) {
  const cv = cvData || {};
  return {
    name: cv.name || '',
    title: cv.title || '',
    email: cv.email || '',
    phone: cv.phone || '',
    location: cv.location || '',
    linkedin: cv.linkedin || '',
    summary: cv.summary || '',
    skills_joined: Array.isArray(cv.skills) ? cv.skills.join(', ') : '',
    skills: Array.isArray(cv.skills) ? cv.skills : [],
    key_qualifications: Array.isArray(cv.key_qualifications) ? cv.key_qualifications : [],
    experience: Array.isArray(cv.experience) ? cv.experience.map(exp => ({
      role: exp.role || '',
      company: exp.company || '',
      period: exp.period || exp.dates || exp.date_range || '',
      bullets: Array.isArray(exp.bullets) ? exp.bullets : [],
    })) : [],
    education: Array.isArray(cv.education) ? cv.education.map(edu => ({
      degree: edu.degree || '',
      school: edu.school || edu.institution || '',
      year: edu.year || '',
    })) : [],
    additional_sections: Array.isArray(cv.additional_sections) ? cv.additional_sections.map(sec => ({
      title: sec.title || '',
      items: Array.isArray(sec.items) ? sec.items : [],
    })) : [],
  };
}

function flattenDocxtemplaterError(err) {
  if (err && Array.isArray(err.properties && err.properties.errors)) {
    const messages = err.properties.errors.map(e => e.properties && e.properties.explanation).filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return err && err.message || 'Invalid Word template.';
}

async function renderTaggedTemplate(cvData, job, templatePath, outputDir) {
  const filePath = registerOutputFile('docx'); // unguessable, session-scoped — see services/session.js

  await fse.ensureDir(outputDir);

  const content = await fse.readFile(templatePath, 'binary');
  const zip = new PizZip(content);
  let doc;
  try {
    doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(prepareTemplateData(cvData));
  } catch (err) {
    throw new Error(flattenDocxtemplaterError(err));
  }

  const buffer = doc.getZip().generate({ type: 'nodebuffer' });
  await fse.writeFile(filePath, buffer);
  return filePath.replace(/\\/g, '/');
}

// Routes between the two custom-template strategies: a template authored with {merge tags}
// (e.g. our starter template) renders deterministically via docxtemplater; a plain Word CV
// with no tags goes through the AI-placement engine, which only ever decides WHERE
// candidate content goes — the text itself always comes verbatim from cvData. The AI path
// shares the same HR-expert thread used by review/rewrite, so placement judgment stays
// consistent with everything already discussed for this candidate.
async function generateWordFromTemplate(cvData, job, templatePath, cvText, thread, preferences, outputDir = 'output') {
  const content = await fse.readFile(templatePath);
  const zip = new PizZip(content);
  const documentXml = zip.files['word/document.xml'].asText();
  const paragraphs = extractParagraphs(documentXml);

  if (hasMergeTags(paragraphs)) {
    const wordPath = await renderTaggedTemplate(cvData, job, templatePath, outputDir);
    return { wordPath, thread };
  }
  return generateWordViaPlacement(cvData, job, templatePath, cvText, thread, preferences, planDocxPlacement, outputDir);
}

module.exports = { generateWordFromTemplate, prepareTemplateData };
