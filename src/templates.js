function generateExecutiveTemplate(cv, job) {
  const skills    = (cv.skills    || []).filter(s => s && String(s).trim());
  const education = (cv.education || []).filter(e => e.degree || e.school);
  const keyQuals  = (cv.key_qualifications  || []).filter(q => q && String(q).trim());
  const addlSecs  = (cv.additional_sections || []).filter(s =>
    s && s.title && (s.items || []).some(x => x && String(x).trim())
  );
  const experience = (cv.experience || []).filter(exp => exp.role || exp.company);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cv.name} — CV for ${job.job_title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #f4f4f4; padding-top: 52px; }
  .page { max-width: 860px; margin: 40px auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .ci { display: flex; align-items: center; gap: 5px; }
  .ci-i { font-size: 13px; color: rgba(255,255,255,0.5); flex-shrink: 0; user-select: none; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.75); }
  .contact-bar .li-url { color: #4A9FE0; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year { font-size: 11px; color: #185FA5; margin-top: 2px; }
  .extra-item { font-size: 12px; color: #555; line-height: 1.6; padding: 2px 0; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .kq-list { padding-left: 16px; margin-bottom: 28px; }
  .kq-list li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }

  /* ── Inline editing ─────────────────────────────────── */
  [contenteditable] { outline: none; border-radius: 3px; min-width: 4px; cursor: text; transition: background 0.1s; }
  [contenteditable]:hover  { background: rgba(24,95,165,0.07); }
  [contenteditable]:focus  { background: rgba(24,95,165,0.12); outline: 1.5px dashed #185FA5; outline-offset: 2px; }
  .header [contenteditable]:hover { background: rgba(255,255,255,0.08); }
  .header [contenteditable]:focus { background: rgba(255,255,255,0.14); outline-color: rgba(255,255,255,0.45); }

  /* ── Floating toolbar ───────────────────────────────── */
  .cv-toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #1a1a18; padding: 10px 28px;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 2px 12px rgba(0,0,0,0.45);
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .tb-hint { font-size: 12px; color: rgba(255,255,255,0.4); }
  .tb-hint strong { color: rgba(255,255,255,0.85); font-weight: 500; }
  .tb-actions { display: flex; gap: 8px; }
  .tb-btn { border: none; padding: 7px 18px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; }
  .tb-save  { background: rgba(255,255,255,0.1); color: white; }
  .tb-save:hover  { background: rgba(255,255,255,0.18); }
  .tb-print { background: #185FA5; color: white; }
  .tb-print:hover { background: #0C447C; }

  /* ── Print: remove toolbar + edit indicators ────────── */
  @media print {
    .cv-toolbar { display: none !important; }
    body { background: white; padding-top: 0; }
    .page { box-shadow: none; margin: 0; }
    [contenteditable]:hover,
    [contenteditable]:focus { background: transparent !important; outline: none !important; }
  }
</style>
</head>
<body>

<div class="cv-toolbar">
  <span class="tb-hint"><strong>✏ Edit mode</strong> — click any text to modify it &nbsp;·&nbsp; Enter on bullet points adds a new bullet</span>
  <div class="tb-actions">
    <button class="tb-btn tb-save"  onclick="saveHTML()">Save as HTML</button>
    <button class="tb-btn tb-print" onclick="window.print()">Print / Save PDF</button>
  </div>
</div>

<div class="page">
  <div class="header">
    <h1 contenteditable="true" class="sl" spellcheck="true">${cv.name || 'Your Name'}</h1>
    <div class="job-title sl" contenteditable="true" spellcheck="true">${cv.title || job.job_title}</div>
    <div class="accent-line"></div>
    <div class="contact-bar">
      ${cv.email    ? `<span class="ci"><span class="ci-i">✉</span><span contenteditable="true" class="sl" spellcheck="false">${cv.email}</span></span>`                  : ''}
      ${cv.phone    ? `<span class="ci"><span class="ci-i">✆</span><span contenteditable="true" class="sl" spellcheck="false">${cv.phone}</span></span>`                  : ''}
      ${cv.location ? `<span class="ci"><span class="ci-i">📍</span><span contenteditable="true" class="sl" spellcheck="false">${cv.location}</span></span>`              : ''}
      ${cv.linkedin ? `<span class="ci"><span contenteditable="true" class="sl li-url" spellcheck="false">${cv.linkedin}</span></span>` : ''}
    </div>
  </div>

  <div class="body">
    <div class="left">
      ${skills.length ? `
        <div class="section-title sl" contenteditable="true" spellcheck="false">Skills</div>
        <div>${skills.map(s => `<span class="skill-tag sl" contenteditable="true" spellcheck="true">${String(s)}</span>`).join('')}</div>
      ` : ''}
      ${education.length ? `
        <div class="section-title sl" contenteditable="true" spellcheck="false">Education</div>
        ${education.map(e => `
          <div class="edu-item">
            <div class="degree sl" contenteditable="true" spellcheck="true">${e.degree || ''}</div>
            <div class="school sl" contenteditable="true" spellcheck="true">${e.school  || ''}</div>
            <div class="year   sl" contenteditable="true" spellcheck="false">${e.year   || ''}</div>
          </div>
        `).join('')}
      ` : ''}
      ${addlSecs.map(s => `
        <div class="section-title sl" contenteditable="true" spellcheck="false">${s.title}</div>
        ${(s.items || []).filter(x => x && String(x).trim()).map(x =>
          `<div class="extra-item sl" contenteditable="true" spellcheck="true">${x}</div>`
        ).join('')}
      `).join('')}
    </div>

    <div class="right">
      ${cv.summary && cv.summary.trim() ? `
        <div class="section-title sl" contenteditable="true" spellcheck="false">Profile</div>
        <div class="summary" contenteditable="true" spellcheck="true">${cv.summary}</div>
      ` : ''}
      ${keyQuals.length ? `
        <div class="section-title sl" contenteditable="true" spellcheck="false">Key Qualifications</div>
        <ul class="kq-list">
          ${keyQuals.map(q => `<li contenteditable="true" spellcheck="true">${String(q)}</li>`).join('')}
        </ul>
      ` : ''}
      ${experience.length ? `
        <div class="section-title sl" contenteditable="true" spellcheck="false">Experience</div>
        ${experience.map(exp => `
          <div class="exp-item">
            <div class="exp-header">
              <div class="exp-role   sl" contenteditable="true" spellcheck="true">${exp.role    || ''}</div>
              <div class="exp-period sl" contenteditable="true" spellcheck="false">${exp.period || ''}</div>
            </div>
            <div class="exp-company sl" contenteditable="true" spellcheck="true">${exp.company || ''}</div>
            <ul class="exp-bullets">
              ${(exp.bullets || []).filter(b => b && String(b).trim()).map(b =>
                `<li contenteditable="true" spellcheck="true">${b}</li>`
              ).join('')}
            </ul>
          </div>
        `).join('')}
      ` : ''}
    </div>
  </div>

  <div class="footer">
    <span class="sl" contenteditable="true" spellcheck="false">Tailored for ${job.job_title} at ${job.company || job.employer_name || ''}</span>
  </div>
</div>

<script>
  // Single-line fields (.sl): block Enter, just commit on blur instead
  document.querySelectorAll('.sl').forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Paste as plain text everywhere — prevent rich-text pasting breaking CV layout
  document.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  // Save edited CV as a standalone HTML file (toolbar + edit scripts included so it stays editable)
  function saveHTML() {
    const html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: document.title.replace(/[^a-z0-9]+/gi, '_') + '.html',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
</script>
</body>
</html>`;
}

// ── Comparison page ───────────────────────────────────────────────────────────
// generateExecutiveTemplate is never touched here.
// renderCVForComparison is a clone of that template, extended for the original CV side
// (adds key_qualifications and additional_sections). The tailored side uses the same
// clone with yellow highlights on modified sections.

function generateComparisonTemplate(originalCv, tailoredCv, job, modifiedSections = []) {
  const highlighted = new Set(modifiedSections);

  function hl(section) {
    return highlighted.has(section)
      ? 'style="background:#fffbdd;outline:2px solid #e6a817;outline-offset:3px;border-radius:3px;padding:4px;"'
      : '';
  }

  // Clone of the executive template — extended for comparison, never modifies the original
  function renderCVForComparison(cv, isRight, footerLabel) {
    const skills     = (cv.skills     || []).filter(s => s && String(s).trim());
    const education  = (cv.education  || []).filter(e => e.degree || e.school);
    const experience = (cv.experience || []).filter(exp => exp.role || exp.company);
    const keyQuals   = !isRight ? (cv.key_qualifications  || []).filter(q => q && String(q).trim()) : [];
    const addlSecs   = !isRight ? (cv.additional_sections || []).filter(s =>
      s && s.title && (s.items || []).some(x => x && String(x).trim())
    ) : [];

    return `
<div class="page">
  <div class="header">
    <h1>${cv.name || 'Your Name'}</h1>
    <div class="job-title">${cv.title || job.job_title || ''}</div>
    <div class="accent-line"></div>
    <div class="contact-bar">
      ${cv.email    ? `<span>✉ ${cv.email}</span>`           : ''}
      ${cv.phone    ? `<span>✆ ${cv.phone}</span>`           : ''}
      ${cv.location ? `<span>📍 ${cv.location}</span>`       : ''}
      ${cv.linkedin ? `<a href="${cv.linkedin}">LinkedIn</a>` : ''}
    </div>
  </div>
  <div class="body">
    <div class="left">
      ${skills.length ? `
        <div class="section-title">Skills</div>
        <div ${isRight ? hl('skills') : ''}>
          ${skills.map(s => `<span class="skill-tag">${String(s)}</span>`).join('')}
        </div>
      ` : ''}
      ${education.length ? `
        <div class="section-title">Education</div>
        ${education.map(e => `
          <div class="edu-item">
            <div class="degree">${e.degree || ''}</div>
            <div class="school">${e.school  || ''}</div>
            <div class="year">${e.year    || ''}</div>
          </div>
        `).join('')}
      ` : ''}
      ${addlSecs.map(s => `
        <div class="section-title">${s.title}</div>
        ${(s.items || []).filter(x => x && String(x).trim()).map(item => `<div class="extra-item">${item}</div>`).join('')}
      `).join('')}
    </div>
    <div class="right">
      ${cv.summary && cv.summary.trim() ? `
        <div class="section-title">Profile</div>
        <div class="summary" ${isRight ? hl('summary') : ''}>${cv.summary}</div>
      ` : ''}
      ${keyQuals.length ? `
        <div class="section-title">Key Qualifications</div>
        <ul class="kq-list">
          ${keyQuals.map(q => `<li>${String(q)}</li>`).join('')}
        </ul>
      ` : ''}
      ${experience.length ? `
        <div class="section-title">Experience</div>
        <div ${isRight ? hl('experience') : ''}>
          ${experience.map(exp => `
            <div class="exp-item">
              <div class="exp-header">
                <div class="exp-role">${exp.role    || ''}</div>
                <div class="exp-period">${exp.period || ''}</div>
              </div>
              <div class="exp-company">${exp.company || ''}</div>
              <ul class="exp-bullets">
                ${(exp.bullets || []).filter(b => b && String(b).trim()).map(b => `<li>${b}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  </div>
  <div class="footer"><span>${footerLabel}</span></div>
</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CV Comparison — ${job.job_title || ''}</title>
<style>
  /* Executive template CSS — exact copy, never shared with generateExecutiveTemplate */
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #e8e8e6; }
  .page { max-width: 860px; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.7); }
  .contact-bar a { color: #4A9FE0; text-decoration: none; font-size: 13px; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year { font-size: 11px; color: #185FA5; margin-top: 2px; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }
  /* Extra fields shown on original CV side only */
  .kq-list { padding-left: 16px; margin-bottom: 24px; }
  .kq-list li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 3px; }
  .extra-item { font-size: 12px; color: #555; line-height: 1.6; padding: 2px 0; }
  /* Comparison layout */
  .comp-header { background: #2C2C2A; color: white; padding: 14px 32px; }
  .comp-header h1 { font-size: 15px; font-weight: 500; }
  .col-labels { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 14px auto 4px; padding: 0 24px; }
  .col-label { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #999; text-align: center; }
  .col-label.right { color: #185FA5; }
  .legend { max-width: 1380px; margin: 0 auto 8px; padding: 0 24px; display: flex; align-items: center; gap: 8px; }
  .legend-box { width: 14px; height: 14px; background: #fffbdd; border: 2px solid #e6a817; border-radius: 2px; flex-shrink: 0; }
  .legend-text { font-size: 12px; color: #666; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 0 auto 40px; padding: 0 24px; }
  .col { zoom: 0.62; }
</style>
</head>
<body>
<div class="comp-header">
  <h1>CV Comparison — ${job.job_title || ''}${job.employer_name ? ' at ' + job.employer_name : ''}</h1>
</div>
<div class="col-labels">
  <div class="col-label">Original</div>
  <div class="col-label right">Tailored — highlighted sections changed</div>
</div>
<div class="legend">
  <span class="legend-box"></span>
  <span class="legend-text">Section modified from original</span>
</div>
<div class="cols">
  <div class="col">${renderCVForComparison(originalCv, false, 'Original CV')}</div>
  <div class="col">${renderCVForComparison(tailoredCv, true,  `Tailored for ${job.job_title} at ${job.employer_name || job.company || ''}`)}</div>
</div>
</body>
</html>`;
}

module.exports = { generateExecutiveTemplate, generateComparisonTemplate };
