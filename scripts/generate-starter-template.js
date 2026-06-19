'use strict';
// One-time generator for templates/word/starter_template.docx — a sample Word
// template a client can download, edit in Word, and re-upload as their own
// custom export template. Re-run with `node scripts/generate-starter-template.js`
// whenever the tag contract in src/wordTemplateExport.js changes.
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
} = require('docx');
const fse = require('fs-extra');
const path = require('path');

const FONT = 'Calibri';
function run(text, opts = {}) {
  return new TextRun({ text: String(text), font: FONT, size: 22, ...opts });
}
function heading(text) {
  return new Paragraph({ children: [run(text, { bold: true, size: 26 })], spacing: { before: 280, after: 100 } });
}
function p(text, opts = {}) {
  return new Paragraph({ children: [run(text, opts)], spacing: { after: 80 } });
}

async function main() {
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } },
      children: [
        new Paragraph({
          children: [run('{name}', { bold: true, size: 48 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({ children: [run('{title}', { italics: true, size: 24 })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
        new Paragraph({
          children: [run('{location}   |   {phone}   |   {email}   |   {linkedin}', { size: 20 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),

        heading('PROFESSIONAL SUMMARY'),
        p('{summary}'),

        heading('SKILLS'),
        p('{skills_joined}'),
        p('Or, one per line:'),
        p('{#skills}'),
        p('• {.}'),
        p('{/skills}'),

        heading('KEY QUALIFICATIONS'),
        p('{#key_qualifications}'),
        p('• {.}'),
        p('{/key_qualifications}'),

        heading('PROFESSIONAL EXPERIENCE'),
        p('{#experience}'),
        p('{role} — {company} ({period})', { bold: true }),
        p('{#bullets}'),
        p('• {.}'),
        p('{/bullets}'),
        p('{/experience}'),

        heading('EDUCATION'),
        p('{#education}'),
        p('{degree}, {school} ({year})'),
        p('{/education}'),

        heading('ADDITIONAL SECTIONS'),
        p('{#additional_sections}'),
        p('{title}', { bold: true }),
        p('{#items}'),
        p('• {.}'),
        p('{/items}'),
        p('{/additional_sections}'),

        heading('Instructions'),
        p('This is a starter template for the "Export to Word" custom template feature. Edit the text/formatting around the {tags} above however you like — fonts, colors, layout, spacing — the tags themselves must stay intact. Lines wrapped in {#name}...{/name} repeat once per item (loop). Save as .docx and upload it back into the app.'),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, '..', 'templates', 'word', 'starter_template.docx');
  await fse.ensureDir(path.dirname(outPath));
  await fse.writeFile(outPath, buffer);
  console.log('Wrote', outPath);
}

main();
