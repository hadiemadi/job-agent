'use strict';
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, BorderStyle,
} = require('docx');
const fse   = require('fs-extra');
const path  = require('path');

// half-point sizes: 22=11pt, 24=12pt, 26=13pt, 28=14pt, 36=18pt, 48=24pt
// spacing in twips:  240=12pt, 120=6pt, 80=4pt, 60=3pt

const BRAND   = '185FA5';
const DARK    = '2C2C2A';
const GREY    = '666666';
const LGREY   = '999999';
const FONT    = 'Calibri';

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(text, opts = {}) {
  return new TextRun({ text: String(text || ''), font: FONT, size: 22, color: DARK, ...opts });
}

function sectionHeading(label) {
  return new Paragraph({
    children: [run(label, { bold: true, size: 22, color: BRAND, allCaps: true })],
    spacing: { before: 280, after: 80 },
    border: { bottom: { color: BRAND, style: BorderStyle.SINGLE, size: 4, space: 2 } },
  });
}

function bullet(text) {
  return new Paragraph({
    children: [run(text)],
    bullet:  { level: 0 },
    spacing: { after: 40 },
    indent:  { left: 360 },
  });
}

function empty(pts = 60) {
  return new Paragraph({ children: [run('')], spacing: { after: pts } });
}

// ── Section builders ──────────────────────────────────────────────────────────

function contactLine(cv) {
  const parts = [cv.location, cv.phone, cv.email, cv.linkedin].filter(Boolean);
  const children = [];
  parts.forEach((p, i) => {
    children.push(run(p, { size: 20, color: GREY }));
    if (i < parts.length - 1)
      children.push(run('   |   ', { size: 20, color: LGREY }));
  });
  return children.length
    ? [new Paragraph({
        children,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        border: { bottom: { color: 'E0E0E0', style: BorderStyle.SINGLE, size: 4, space: 4 } },
      })]
    : [];
}

function summarySection(summary) {
  if (!summary) return [];
  return [
    sectionHeading('PROFESSIONAL SUMMARY'),
    new Paragraph({ children: [run(summary)], spacing: { after: 80 }, indent: { left: 0 } }),
  ];
}

function skillsSection(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return [];
  const isCategories = skills.length > 0 && typeof skills[0] === 'object' && skills[0].category;

  if (isCategories) {
    const rows = skills.map(cat => {
      const items = Array.isArray(cat.items) ? cat.items.join(', ') : String(cat.items || '');
      return new Paragraph({
        children: [
          run((cat.category || '') + ': ', { bold: true }),
          run(items),
        ],
        spacing: { after: 60 },
      });
    });
    return [sectionHeading('CORE COMPETENCIES'), ...rows];
  }

  return [sectionHeading('SKILLS'), ...skills.map(s => bullet(typeof s === 'string' ? s : String(s)))];
}

function keyQualificationsSection(keyQuals) {
  if (!Array.isArray(keyQuals) || keyQuals.length === 0) return [];
  const items = keyQuals.filter(q => q && String(q).trim());
  if (!items.length) return [];
  return [sectionHeading('KEY QUALIFICATIONS'), ...items.map(q => bullet(String(q)))];
}

function experienceSection(experience) {
  if (!Array.isArray(experience) || experience.length === 0) return [];
  const rows = [];
  for (const exp of experience) {
    const role    = exp.role || exp.title || '';
    const company = exp.company || '';
    const dates   = exp.dates || exp.date_range || exp.period || '';
    const loc     = exp.location || '';
    const bullets = exp.bullets || exp.responsibilities || [];

    // Role line
    rows.push(new Paragraph({
      children: [
        run(role, { bold: true, size: 24 }),
        ...(company ? [run(`  ·  ${company}`, { size: 24, color: GREY })] : []),
      ],
      spacing: { before: 120, after: 40 },
    }));

    // Meta line (dates + location)
    const meta = [dates, loc].filter(Boolean).join('  ·  ');
    if (meta) {
      rows.push(new Paragraph({
        children: [run(meta, { size: 20, italics: true, color: LGREY })],
        spacing: { after: 60 },
      }));
    }

    for (const b of bullets) rows.push(bullet(b));
    rows.push(empty(100));
  }
  return [sectionHeading('PROFESSIONAL EXPERIENCE'), ...rows];
}

function educationSection(education) {
  if (!Array.isArray(education) || education.length === 0) return [];
  const rows = education.map(edu => {
    const parts = [edu.degree || edu.field, edu.institution || edu.school, edu.year].filter(Boolean);
    const children = [];
    parts.forEach((p, i) => {
      const isFirst = i === 0;
      children.push(run(p, isFirst ? { bold: true } : { color: GREY }));
      if (i < parts.length - 1) children.push(run('  ·  ', { color: LGREY }));
    });
    return new Paragraph({ children, spacing: { after: 80 } });
  });
  return [sectionHeading('EDUCATION'), ...rows];
}

function additionalSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return [];
  const rows = [];
  for (const sec of sections) {
    if (!sec || !sec.title || !String(sec.title).trim()) continue;
    const items = (sec.items || []).filter(x => x && String(x).trim());
    if (!items.length) continue;
    rows.push(sectionHeading(String(sec.title).toUpperCase()));
    items.forEach(x => rows.push(bullet(String(x))));
  }
  return rows;
}

function certificationsSection(certifications) {
  if (!Array.isArray(certifications) || certifications.length === 0) return [];
  return [
    sectionHeading('CERTIFICATIONS'),
    ...certifications.map(c => bullet(typeof c === 'string' ? c : c.name || c.title || String(c))),
  ];
}

// ── Main export ───────────────────────────────────────────────────────────────

async function generateWordCV(cvData, job, outputDir = 'output') {
  const cv     = cvData || {};
  const slug   = (job && (job.job_title || job.title) || 'CV')
    .replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const fileName  = `cv_word_${slug}.docx`;
  const filePath  = path.join(outputDir, fileName);

  await fse.ensureDir(outputDir);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: DARK } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 1080, right: 1080 },
        },
      },
      children: [
        // Name
        new Paragraph({
          children: [run(cv.name || 'Your Name', { bold: true, size: 48, color: DARK })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        // Title
        ...(cv.title ? [new Paragraph({
          children: [run(cv.title, { size: 24, color: BRAND, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        })] : []),
        // Contact
        ...contactLine(cv),

        // Sections
        ...summarySection(cv.summary),
        ...keyQualificationsSection(cv.key_qualifications),
        ...skillsSection(cv.skills),
        ...experienceSection(cv.experience),
        ...educationSection(cv.education),
        ...additionalSections(cv.additional_sections),
        ...certificationsSection(cv.certifications),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  await fse.writeFile(filePath, buffer);
  return filePath.replace(/\\/g, '/');
}

module.exports = { generateWordCV };
