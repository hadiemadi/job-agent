'use strict';

// ── Shared CSS (used by both standalone template and comparison) ───────────────
const CV_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #f4f4f4; }
  .page { max-width: 860px; margin: 40px auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .tailored-badge { display: inline-block; margin-top: 6px; background: #185FA5; color: white; font-size: 11px; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.3px; }
  .tailored-badge strong { font-weight: 600; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .ci { display: flex; align-items: center; gap: 5px; }
  .ci-i { font-size: 13px; color: rgba(255,255,255,0.5); flex-shrink: 0; user-select: none; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.75); }
  .contact-bar a  { font-size: 13px; color: #4A9FE0; text-decoration: none; }
  .li-url { color: #4A9FE0; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year   { font-size: 11px; color: #185FA5; margin-top: 2px; }
  .extra-item { font-size: 12px; color: #555; line-height: 1.6; padding: 2px 0; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .kq-list { padding-left: 16px; margin-bottom: 24px; }
  .kq-list li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 3px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role   { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }
`;

// ── Core CV page renderer ─────────────────────────────────────────────────────
// Single source of truth: every output (standalone, comparison) uses this function.
// opts.editable   → add contenteditable attributes (standalone only)
// opts.highlighted → Set of section names to highlight in yellow (comparison tailored side)
// opts.showBadge  → show "Tailored for …" pill in the header (standalone only)
// opts.footerText → override footer label (comparison original shows "Original CV")
function renderCVPage(cv, job, opts = {}) {
  const {
    editable    = false,
    highlighted = new Set(),
    showBadge   = false,
    footerText  = `Tailored for ${job.job_title || ''} at ${job.company || job.employer_name || ''}`,
  } = opts;

  const hl  = s => highlighted.has(s)
    ? 'style="background:#fffbdd;outline:2px solid #e6a817;outline-offset:3px;border-radius:3px;padding:4px;"'
    : '';

  // Attribute helpers — return empty string when not editable
  const sl  = (spell = true) => editable
    ? `contenteditable="true" class="sl" spellcheck="${spell}"`
    : '';
  const slC = (cls, spell = true) => editable         // sl + extra CSS class on same element
    ? `contenteditable="true" class="${cls} sl" spellcheck="${spell}"`
    : `class="${cls}"`;
  const ml  = () => editable ? 'contenteditable="true" spellcheck="true"' : '';

  const skills    = (cv.skills    || []).filter(s => s && String(s).trim());
  const education = (cv.education || []).filter(e => e.degree || e.school);
  const keyQuals  = (cv.key_qualifications  || []).filter(q => q && String(q).trim());
  const addlSecs  = (cv.additional_sections || []).filter(s =>
    s && s.title && (s.items || []).some(x => x && String(x).trim())
  );
  const experience = (cv.experience || []).filter(exp => exp.role || exp.company);

  return `
<div class="page">
  <div class="header">
    <h1 data-field="name" ${sl(true)}>${cv.name || 'Your Name'}</h1>
    <div data-field="title" ${slC('job-title', true)}>${cv.title || job.job_title || ''}</div>
    ${showBadge ? `<div class="tailored-badge">Tailored for: <strong>${job.job_title || ''}${job.employer_name ? ' at ' + job.employer_name : ''}</strong></div>` : ''}
    <div class="accent-line"></div>
    <div class="contact-bar">
      ${cv.email    ? `<span class="ci"><span class="ci-i">✉</span><span data-field="email" ${sl(false)}>${cv.email}</span></span>`             : ''}
      ${cv.phone    ? `<span class="ci"><span class="ci-i">✆</span><span data-field="phone" ${sl(false)}>${cv.phone}</span></span>`             : ''}
      ${cv.location ? `<span class="ci"><span class="ci-i">📍</span><span data-field="location" ${sl(false)}>${cv.location}</span></span>`         : ''}
      ${cv.linkedin ? `<span class="ci"><span data-field="linkedin" ${slC('li-url', false)}>${cv.linkedin}</span></span>`                          : ''}
    </div>
  </div>

  <div class="body">
    <div class="left">
      ${skills.length ? `
        <div ${slC('section-title', false)}>Skills</div>
        <div ${hl('skills')}>
          ${skills.map(s => `<span data-field="skill" ${slC('skill-tag', true)}>${String(s)}</span>`).join('')}
        </div>
      ` : ''}
      ${education.length ? `
        <div ${slC('section-title', false)}>Education</div>
        ${education.map(e => `
          <div class="edu-item" data-edu-item>
            <div data-field="degree" ${slC('degree edu-item-degree', true)}>${e.degree || ''}</div>
            <div data-field="school" ${slC('school edu-item-school', true)}>${e.school  || ''}</div>
            <div data-field="year"   ${slC('year edu-item-year',     false)}>${e.year   || ''}</div>
          </div>
        `).join('')}
      ` : ''}
      ${addlSecs.map(s => `
        <div data-field="addl-title" ${slC('section-title', false)}>${s.title}</div>
        ${(s.items || []).filter(x => x && String(x).trim()).map(x =>
          `<div data-field="addl-item" ${slC('extra-item', true)}>${x}</div>`
        ).join('')}
      `).join('')}
    </div>

    <div class="right">
      ${cv.summary && cv.summary.trim() ? `
        <div ${slC('section-title', false)}>Profile</div>
        <div class="summary" data-field="summary" ${ml()} ${hl('summary')}>${cv.summary}</div>
      ` : ''}
      ${keyQuals.length ? `
        <div ${slC('section-title', false)}>Key Qualifications</div>
        <ul class="kq-list" ${hl('key_qualifications')}>
          ${keyQuals.map(q => `<li data-field="key-qual" ${ml()}>${String(q)}</li>`).join('')}
        </ul>
      ` : ''}
      ${experience.length ? `
        <div ${slC('section-title', false)}>Experience</div>
        <div ${hl('experience')}>
          ${experience.map(exp => `
            <div class="exp-item" data-exp-item>
              <div class="exp-header">
                <div data-field="role"   ${slC('exp-role',    true)}>${exp.role    || ''}</div>
                <div data-field="period" ${slC('exp-period',  false)}>${exp.period || ''}</div>
              </div>
              <div data-field="company" ${slC('exp-company', true)}>${exp.company || ''}</div>
              <ul class="exp-bullets">
                ${(exp.bullets || []).filter(b => b && String(b).trim()).map(b =>
                  `<li data-field="bullet" ${ml()}>${b}</li>`
                ).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  </div>

  <div class="footer">
    <span ${sl(false)}>${footerText}</span>
  </div>
</div>`;
}

// ── Standalone tailored CV (editable, with toolbar) ───────────────────────────
function generateExecutiveTemplate(cv, job, opts = {}) {
  const { hrDisplayHistory = [] } = opts;
  const pageHtml = renderCVPage(cv, job, { editable: true, showBadge: true });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cv.name} — CV for ${job.job_title}</title>
<style>
${CV_CSS}
  /* Standalone: extra top padding for toolbar */
  body { padding-top: 52px; }
  .page { margin: 40px auto; }

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
  .tb-select { border: none; padding: 7px 10px; border-radius: 6px; font-size: 12px; font-family: inherit; background: rgba(255,255,255,0.1); color: white; }
  .tb-select option { color: #2C2C2A; }
  .tb-link { font-size: 11px; color: rgba(255,255,255,0.55); text-decoration: underline; cursor: pointer; }
  .tb-link:hover { color: white; }
  .tb-status { font-size: 11px; color: rgba(255,255,255,0.55); margin-left: 4px; }
  .cv-toolbar { right: 20%; transition: right 0.2s; }
  .cv-toolbar.full { right: 0; }

  /* ── Main CV area — shares the screen 80/20 with the HR sidebar ───── */
  .cv-main { margin-right: 20%; transition: margin-right 0.2s; }
  .cv-main.full { margin-right: 0; }

  /* ── HR Expert sidebar — visible by default, occupies 20% of the screen ── */
  .hr-sidebar {
    position: fixed; top: 0; right: 0; width: 20%; height: 100%; z-index: 9998;
    background: white; border-left: 1px solid #E0E0E0; box-shadow: -4px 0 16px rgba(0,0,0,0.12);
    display: flex; flex-direction: column; transition: transform 0.2s;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .hr-sidebar.collapsed { transform: translateX(100%); }
  .hr-sb-header { padding: 56px 16px 12px; border-bottom: 1px solid #eee; display: flex; flex-direction: column; gap: 8px; }
  .hr-sb-title { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .hr-sb-model { padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; font-family: inherit; }
  .hr-sb-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .hr-sb-bubble { padding: 10px 13px; border-radius: 10px; font-size: 13.5px; line-height: 1.6; max-width: 90%; word-wrap: break-word; }
  .hr-sb-bubble p { margin: 0 0 8px; }
  .hr-sb-bubble p:last-child { margin-bottom: 0; }
  .hr-sb-bubble ul { margin: 0 0 8px 18px; padding: 0; }
  .hr-sb-bubble ul:last-child { margin-bottom: 0; }
  .hr-sb-bubble li { margin-bottom: 4px; }
  .hr-sb-bubble.user { background: #185FA5; color: white; align-self: flex-end; }
  .hr-sb-bubble.expert { background: #f0f0ee; color: #222; align-self: flex-start; }
  .hr-sb-input-row { padding: 12px 16px; border-top: 1px solid #eee; display: flex; gap: 8px; }
  .hr-sb-input-row textarea { flex: 1; resize: none; height: 44px; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 13px; }
  .hr-sb-send { border: none; background: #185FA5; color: white; border-radius: 6px; padding: 0 14px; cursor: pointer; font-size: 13px; }
  .hr-sb-send:disabled { background: #bbb; cursor: not-allowed; }

  /* ── Cover letter modal ─────────────────────────────── */
  .cl-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10001; display: none; align-items: center; justify-content: center; font-family: 'Segoe UI', Arial, sans-serif; }
  .cl-modal-overlay.open { display: flex; }
  .cl-modal { background: white; width: 600px; max-width: 90%; max-height: 85vh; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; }
  .cl-modal-header { padding: 16px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
  .cl-modal-header h2 { font-size: 15px; color: #2C2C2A; }
  .cl-modal-close { border: none; background: none; font-size: 20px; cursor: pointer; color: #999; line-height: 1; }
  .cl-modal-close:hover { color: #333; }
  .cl-modal-body { padding: 20px; overflow-y: auto; font-size: 13.5px; line-height: 1.7; color: #333; }
  .cl-modal-body p { margin: 0 0 12px; }
  .cl-modal-body p:last-child { margin-bottom: 0; }
  .cl-modal-footer { padding: 14px 20px; border-top: 1px solid #eee; display: flex; gap: 8px; justify-content: flex-end; }

  /* ── Print: remove toolbar + edit indicators ────────── */
  @media print {
    .cv-toolbar { display: none !important; }
    .hr-sidebar { display: none !important; }
    body { background: white; padding-top: 0; }
    .page { box-shadow: none; margin: 0; }
    [contenteditable]:hover,
    [contenteditable]:focus { background: transparent !important; outline: none !important; }
  }

  /* edu-item class overrides (generated with compound class names) */
  .edu-item-degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item-school { font-size: 12px; color: #666; }
  .edu-item-year   { font-size: 11px; color: #185FA5; margin-top: 2px; }
</style>
</head>
<body>

<div class="cv-toolbar">
  <span class="tb-hint"><strong>✏ Edit mode</strong> — click any text to modify it &nbsp;·&nbsp; Enter on bullet points adds a new bullet</span>
  <div class="tb-actions">
    <button class="tb-btn tb-save"  onclick="saveHTML()">Save as HTML</button>
    <select class="tb-select" id="templateChoice">
      <option value="default" selected>Default template</option>
      <option value="alternate">Alternate template</option>
      <option value="original" disabled title="Coming soon — requires your original CV to be a Word file">Similar to original CV</option>
      <option value="custom" disabled>Custom uploaded template</option>
    </select>
    <input type="file" id="templateFile" accept=".docx" hidden onchange="uploadTemplate()">
    <button class="tb-btn tb-save" onclick="document.getElementById('templateFile').click()">Upload template…</button>
    <a class="tb-link" href="/templates/word/starter_template.docx" download>Download starter template ↓</a>
    <select class="tb-select" id="languageLevel" title="How polished should the CV's wording be?">
      <option value="1">Wording: Original</option>
      <option value="2" selected>Wording: Slightly polished</option>
      <option value="3">Wording: Professional</option>
      <option value="4">Wording: Highly professional</option>
      <option value="5">Wording: Senior expert</option>
    </select>
    <button class="tb-btn tb-save" id="regenWordingBtn" onclick="regenerateWording()">Regenerate wording</button>
    <button class="tb-btn tb-print" id="exportWordBtn" onclick="exportWord()">Export to Word</button>
    <button class="tb-btn tb-save" id="coverLetterBtn" onclick="generateCoverLetterPanel()">Generate Cover Letter</button>
    <span class="tb-status" id="templateStatus"></span>
    <button class="tb-btn tb-save" id="hrToggleBtn" onclick="toggleHrSidebar()">Hide HR Expert</button>
  </div>
</div>

<div class="hr-sidebar" id="hrSidebar">
  <div class="hr-sb-header">
    <span class="hr-sb-title">Ask your HR Expert</span>
    <select class="hr-sb-model" id="hrModelChoice">
      <option value="claude-sonnet-4-6" selected>Sonnet 4.6</option>
      <option value="claude-opus-4-8">Opus 4.8</option>
      <option value="claude-haiku-4-5">Haiku 4.5</option>
    </select>
  </div>
  <div class="hr-sb-messages" id="hrSbMessages"></div>
  <div class="hr-sb-input-row">
    <textarea id="hrSbInput" placeholder="Ask about your CV, this job, or your edits…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendHrMessage();}"></textarea>
    <button class="hr-sb-send" id="hrSbSend" onclick="sendHrMessage()">Send</button>
  </div>
</div>

<div class="cv-main" id="cvMain">
${pageHtml}
</div>

<div class="cl-modal-overlay" id="clModalOverlay">
  <div class="cl-modal">
    <div class="cl-modal-header">
      <h2>Cover Letter</h2>
      <button class="cl-modal-close" onclick="closeCoverLetterModal()">&times;</button>
    </div>
    <div class="cl-modal-body" id="clModalBody">Generating…</div>
    <div class="cl-modal-footer">
      <button class="tb-btn tb-save" onclick="copyCoverLetter()">Copy text</button>
      <button class="tb-btn tb-print" onclick="downloadCoverLetterWord()">Download as Word</button>
    </div>
  </div>
</div>

<script>
  const JOB_DATA = ${JSON.stringify(job).replace(/<\/script/gi, '<\\/script')};
  const HR_DISPLAY_HISTORY = ${JSON.stringify(hrDisplayHistory).replace(/<\/script/gi, '<\\/script')};

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

  // Read whatever is currently on screen — including the user's live edits —
  // back into a cvData-shaped object, by walking the data-field markers.
  function extractCvData() {
    const page = document.querySelector('.page');
    const text = node => (node && node.textContent || '').trim();
    const field = name => text(page.querySelector('[data-field="' + name + '"]'));
    const fieldsIn = (root, name) => [...root.querySelectorAll('[data-field="' + name + '"]')].map(text);

    const additional_sections = [];
    let currentSection = null;
    [...document.querySelectorAll('.left')[0].children].forEach(node => {
      const f = node.dataset && node.dataset.field;
      if (f === 'addl-title') {
        const title = text(node);
        currentSection = title ? { title, items: [] } : null;
        if (currentSection) additional_sections.push(currentSection);
      } else if (f === 'addl-item' && currentSection) {
        const v = text(node);
        if (v) currentSection.items.push(v);
      }
    });

    return {
      name: field('name') || undefined,
      title: field('title') || undefined,
      email: field('email') || undefined,
      phone: field('phone') || undefined,
      location: field('location') || undefined,
      linkedin: field('linkedin') || undefined,
      summary: field('summary') || undefined,
      skills: fieldsIn(page, 'skill').filter(Boolean),
      key_qualifications: fieldsIn(page, 'key-qual').filter(Boolean),
      education: [...page.querySelectorAll('[data-edu-item]')].map(item => ({
        degree: text(item.querySelector('[data-field="degree"]')),
        school: text(item.querySelector('[data-field="school"]')),
        year:   text(item.querySelector('[data-field="year"]')),
      })).filter(e => e.degree || e.school),
      experience: [...page.querySelectorAll('[data-exp-item]')].map(item => ({
        role:    text(item.querySelector('[data-field="role"]')),
        company: text(item.querySelector('[data-field="company"]')),
        period:  text(item.querySelector('[data-field="period"]')),
        bullets: fieldsIn(item, 'bullet').filter(Boolean),
      })).filter(e => e.role || e.company),
      additional_sections,
    };
  }

  let customTemplatePath = null;

  async function uploadTemplate() {
    const fileInput = document.getElementById('templateFile');
    const status = document.getElementById('templateStatus');
    const file = fileInput.files[0];
    if (!file) return;
    status.textContent = 'Uploading…';
    try {
      const formData = new FormData();
      formData.append('template', file);
      const res = await fetch('/upload-template', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.templatePath) throw new Error(data.error || 'Upload failed');
      customTemplatePath = data.templatePath;
      const choice = document.getElementById('templateChoice');
      choice.querySelector('option[value="custom"]').disabled = false;
      choice.value = 'custom';
      status.textContent = 'Template uploaded ✓';
    } catch (err) {
      status.textContent = '';
      alert('Template upload failed: ' + err.message);
    }
  }

  // Sends the live-edited CV content back to HR for a wording-only rewrite at the chosen
  // language level, then reloads this same page so the new wording shows up in place.
  async function regenerateWording() {
    const btn = document.getElementById('regenWordingBtn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Regenerating…';
    try {
      const languageLevel = parseInt(document.getElementById('languageLevel').value, 10);
      const res = await fetch('/adjust-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvData: extractCvData(), job: JOB_DATA, languageLevel }),
      });
      const data = await res.json();
      if (!data.filePath) throw new Error(data.error || 'Regeneration failed');
      if (data.templateSuggestion) alert('HR note: ' + data.templateSuggestion);
      location.reload();
    } catch (err) {
      alert('Regenerate wording failed: ' + err.message);
      btn.disabled = false; btn.textContent = original;
    }
  }

  async function exportWord() {
    const btn = document.getElementById('exportWordBtn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Exporting…';
    try {
      const templateStyle = document.getElementById('templateChoice').value;
      const body = { cvData: extractCvData(), job: JOB_DATA, templateStyle };
      if (templateStyle === 'custom' && customTemplatePath) body.templatePath = customTemplatePath;
      const res = await fetch('/export-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.wordPath) throw new Error(data.error || 'Export failed');
      const a = Object.assign(document.createElement('a'), { href: '/' + data.wordPath, download: '' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert('Export to Word failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  }

  // Cover letter is generated ONLY on explicit button press — never automatically — using
  // whatever is currently on screen (including live edits) so its tone/content matches the
  // latest tailored CV exactly.
  let lastCoverLetterText = '';

  async function generateCoverLetterPanel() {
    const overlay = document.getElementById('clModalOverlay');
    const body = document.getElementById('clModalBody');
    const btn = document.getElementById('coverLetterBtn');
    overlay.classList.add('open');
    body.textContent = 'Generating…';
    btn.disabled = true;
    try {
      const res = await fetch('/generate-cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvData: extractCvData(), job: JOB_DATA }),
      });
      const data = await res.json();
      if (!data.coverLetter) throw new Error(data.error || 'Generation failed');
      lastCoverLetterText = data.coverLetter;
      body.innerHTML = renderChatMarkdown(data.coverLetter);
    } catch (err) {
      body.textContent = 'Failed to generate cover letter: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function closeCoverLetterModal() {
    document.getElementById('clModalOverlay').classList.remove('open');
  }

  async function copyCoverLetter() {
    if (!lastCoverLetterText) return;
    await navigator.clipboard.writeText(lastCoverLetterText);
    alert('Cover letter copied to clipboard.');
  }

  async function downloadCoverLetterWord() {
    if (!lastCoverLetterText) return;
    try {
      const res = await fetch('/export-cover-letter-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverLetter: lastCoverLetterText, cvData: extractCvData(), job: JOB_DATA }),
      });
      const data = await res.json();
      if (!data.wordPath) throw new Error(data.error || 'Export failed');
      const a = Object.assign(document.createElement('a'), { href: '/' + data.wordPath, download: '' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert('Download failed: ' + err.message);
    }
  }

  function toggleHrSidebar() {
    const collapsed = document.getElementById('hrSidebar').classList.toggle('collapsed');
    document.getElementById('cvMain').classList.toggle('full', collapsed);
    document.querySelector('.cv-toolbar').classList.toggle('full', collapsed);
    document.getElementById('hrToggleBtn').textContent = collapsed ? 'Ask HR Expert' : 'Hide HR Expert';
  }

  // Renders a small subset of markdown (paragraphs, "- " bullet lists, **bold**) into safe
  // HTML — chat replies come back as markdown-ish text, and dumping it as textContent left
  // raw "**"/"-" characters visible instead of actually formatting the text.
  function renderChatMarkdown(text) {
    const esc  = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bold = s => s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    return text.split(/\\n\\s*\\n/).map(block => {
      const lines = block.split('\\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return '';
      const isList = lines.every(l => /^[-*>]\\s+/.test(l));
      if (isList) {
        return '<ul>' + lines.map(l => '<li>' + bold(esc(l.replace(/^[-*>]\\s+/, ''))) + '</li>').join('') + '</ul>';
      }
      return '<p>' + lines.map(l => bold(esc(l.replace(/^>\\s+/, '')))).join('<br>') + '</p>';
    }).join('');
  }

  function addHrBubble(role, text) {
    const messages = document.getElementById('hrSbMessages');
    const bubble = Object.assign(document.createElement('div'), {
      className: 'hr-sb-bubble ' + (role === 'user' ? 'user' : 'expert'),
      innerHTML: renderChatMarkdown(text),
    });
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  // Sidebar should never start empty — open with the HR expert explaining what just changed
  HR_DISPLAY_HISTORY.forEach(m => addHrBubble(m.role, m.text));

  async function sendHrMessage() {
    const input = document.getElementById('hrSbInput');
    const sendBtn = document.getElementById('hrSbSend');
    const message = input.value.trim();
    if (!message) return;
    const model = document.getElementById('hrModelChoice').value;
    addHrBubble('user', message);
    input.value = '';
    sendBtn.disabled = true;
    try {
      const res = await fetch('/hr/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model }),
      });
      const data = await res.json();
      if (!data.reply) throw new Error(data.error || 'No reply');
      addHrBubble('expert', data.reply);
    } catch (err) {
      addHrBubble('expert', 'Sorry, something went wrong: ' + err.message);
    } finally {
      sendBtn.disabled = false;
    }
  }
</script>
</body>
</html>`;
}

// ── Comparison page ───────────────────────────────────────────────────────────
// Both sides use renderCVPage — same sections, same content as standalone CV.
// Only difference: no editability, original side has no badge, tailored side gets highlights.
function generateComparisonTemplate(originalCv, tailoredCv, job, modifiedSections = []) {
  const highlighted = new Set(modifiedSections);

  const origPage = renderCVPage(originalCv, job, {
    editable:   false,
    showBadge:  false,
    footerText: 'Original CV',
  });

  const tailPage = renderCVPage(tailoredCv, job, {
    editable:    false,
    highlighted,
    showBadge:   false,
    footerText:  `Tailored for ${job.job_title || ''} at ${job.employer_name || job.company || ''}`,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CV Comparison — ${job.job_title || ''}</title>
<style>
${CV_CSS}
  /* Comparison overrides */
  body { background: #e8e8e6; padding: 0; }
  .page { margin: 0; }

  /* edu-item class overrides */
  .edu-item-degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item-school { font-size: 12px; color: #666; }
  .edu-item-year   { font-size: 11px; color: #185FA5; margin-top: 2px; }

  /* Comparison chrome */
  .comp-header { background: #2C2C2A; color: white; padding: 14px 32px; }
  .comp-header h1 { font-size: 15px; font-weight: 500; }
  .col-labels { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 14px auto 4px; padding: 0 24px; }
  .col-label  { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #999; text-align: center; }
  .col-label.right { color: #185FA5; }
  .legend     { max-width: 1380px; margin: 0 auto 8px; padding: 0 24px; display: flex; align-items: center; gap: 8px; }
  .legend-box { width: 14px; height: 14px; background: #fffbdd; border: 2px solid #e6a817; border-radius: 2px; flex-shrink: 0; }
  .legend-text { font-size: 12px; color: #666; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 0 auto 40px; padding: 0 24px; }
  .col  { zoom: 0.62; }
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
  <div class="col">${origPage}</div>
  <div class="col">${tailPage}</div>
</div>
</body>
</html>`;
}

module.exports = { generateExecutiveTemplate, generateComparisonTemplate };
