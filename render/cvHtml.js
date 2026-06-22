'use strict';

const { CV_CSS } = require('./styles');

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
  /* ── Inline editing ─────────────────────────────────── */
  [contenteditable] { outline: none; border-radius: 3px; min-width: 4px; cursor: text; transition: background 0.1s; }
  [contenteditable]:hover  { background: rgba(24,95,165,0.07); }
  [contenteditable]:focus  { background: rgba(24,95,165,0.12); outline: 1.5px dashed var(--accent); outline-offset: 2px; }
  .header [contenteditable]:hover { background: rgba(255,255,255,0.08); }
  .header [contenteditable]:focus { background: rgba(255,255,255,0.14); outline-color: rgba(255,255,255,0.45); }

  /* ── Left toolbar (fixed sidebar) ────────────────────── */
  .cv-toolbar {
    position: fixed; top: 0; left: 0; bottom: 0; width: 230px; z-index: 9999;
    background: #181816; padding: 20px 16px;
    display: flex; flex-direction: column; align-items: stretch; gap: 10px;
    overflow-y: auto;
    box-shadow: 2px 0 12px rgba(0,0,0,0.45);
    font-family: var(--font-ui);
  }
  .tb-hint { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.5; padding-bottom: 10px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.12); }
  .tb-hint strong { color: rgba(255,255,255,0.85); font-weight: 500; display: block; margin-bottom: 2px; }
  .tb-actions { display: flex; flex-direction: column; gap: 8px; }
  .tb-btn { border: none; padding: 9px 14px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; width: 100%; text-align: left; transition: background 0.15s; }
  .tb-save  { background: rgba(255,255,255,0.1); color: white; }
  .tb-save:hover  { background: rgba(255,255,255,0.18); }
  .tb-print { background: var(--accent); color: white; }
  .tb-print:hover { background: var(--accent-dark); }
  .tb-select { border: none; padding: 8px 10px; border-radius: var(--radius-sm); font-size: 12px; font-family: inherit; background: rgba(255,255,255,0.1); color: white; width: 100%; }
  .tb-select option { color: var(--ink); }
  .tb-link { font-size: 11px; color: rgba(255,255,255,0.55); text-decoration: underline; cursor: pointer; display: block; }
  .tb-link:hover { color: white; }
  .tb-status { font-size: 11px; color: rgba(255,255,255,0.55); }
  .tb-btn:disabled, .tb-select:disabled, .hr-sb-model:disabled { opacity: 0.45; cursor: not-allowed; }
  .tb-row { display: flex; gap: 6px; align-items: center; }
  .tb-row .tb-select { flex: 1; min-width: 0; }
  .tb-go { width: auto; flex-shrink: 0; padding: 8px 12px; text-align: center; }

  /* ── Main CV area — left toolbar is always reserved; right 30% shares with HR sidebar ── */
  .cv-main { margin-left: 230px; margin-right: 30%; transition: margin-right 0.2s; }
  .cv-main.full { margin-right: 0; }

  /* ── HR Expert sidebar — visible by default, occupies 30% of the screen ── */
  .hr-sidebar {
    position: fixed; top: 0; right: 0; width: 30%; height: 100%; z-index: 9998;
    background: var(--surface); border-left: 1px solid var(--border); box-shadow: -4px 0 16px rgba(0,0,0,0.12);
    display: flex; flex-direction: column; transition: transform 0.2s;
    font-family: var(--font-ui);
  }
  .hr-sidebar.collapsed { transform: translateX(100%); }
  .hr-sb-header { padding: 56px 16px 12px; border-bottom: 1px solid #eee; display: flex; flex-direction: column; gap: 8px; }
  .hr-sb-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .hr-sb-model { padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; font-family: inherit; }
  .hr-sb-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .hr-sb-bubble { padding: 10px 13px; border-radius: 10px; font-size: 13.5px; line-height: 1.6; max-width: 90%; word-wrap: break-word; }
  .hr-sb-bubble p { margin: 0 0 8px; }
  .hr-sb-bubble p:last-child { margin-bottom: 0; }
  .hr-sb-bubble ul { margin: 0 0 8px 18px; padding: 0; }
  .hr-sb-bubble ul:last-child { margin-bottom: 0; }
  .hr-sb-bubble li { margin-bottom: 4px; }
  .hr-sb-bubble.user { background: var(--accent); color: white; align-self: flex-end; }
  .hr-sb-bubble.expert { background: #f0f0ee; color: #222; align-self: flex-start; }
  .hr-sb-input-row { padding: 12px 16px; border-top: 1px solid #eee; display: flex; gap: 8px; }
  .hr-sb-input-row textarea { flex: 1; resize: none; height: 44px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: inherit; font-size: 13px; }
  .hr-sb-send { border: none; background: var(--accent); color: white; border-radius: var(--radius-sm); padding: 0 14px; cursor: pointer; font-size: 13px; }
  .hr-sb-send:disabled { background: #bbb; cursor: not-allowed; }

  /* ── CV selection → HR concern ───────────────────────── */
  /* Highlighted text stays marked from the moment it's raised until the discussion resolves
     (changed or kept) — so the candidate never loses track of what's still "in review". */
  .hr-concern { background: #fffbdd; outline: 2px solid #e6a817; outline-offset: 2px; border-radius: 3px; }
  .concern-popover { position: fixed; z-index: 10020; background: var(--ink); color: white; border: none; padding: 6px 12px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.35); font-family: var(--font-ui); }
  .concern-popover:hover { background: #444; }
  .concern-banner { background: #fff8e6; border-top: 1px solid #f0dca0; border-bottom: 1px solid #f0dca0; padding: 8px 16px; font-size: 11.5px; color: #7a5500; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .concern-banner span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .concern-banner button { border: none; background: none; color: #7a5500; text-decoration: underline; cursor: pointer; font-size: 11px; flex-shrink: 0; }
  .concern-resolve-row { display: flex; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #eee; }

  /* ── Cover letter modal ─────────────────────────────── */
  .cl-modal-overlay { position: fixed; inset: 0; background: rgba(20,20,18,0.5); z-index: 10001; display: none; align-items: center; justify-content: center; font-family: var(--font-ui); }
  .cl-modal-overlay.open { display: flex; }
  .cl-modal { background: var(--surface); width: 600px; max-width: 90%; max-height: 85vh; border-radius: var(--radius-md); box-shadow: 0 16px 48px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; }
  .cl-modal-header { padding: 16px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
  .cl-modal-header h2 { font-size: 15px; color: var(--ink); }
  .cl-modal-close { border: none; background: none; font-size: 20px; cursor: pointer; color: #999; line-height: 1; }
  .cl-modal-close:hover { color: #333; }
  .cl-modal-body { padding: 20px; overflow-y: auto; font-size: 13.5px; line-height: 1.7; color: #333; }
  .cl-modal-body p { margin: 0 0 12px; }
  .cl-modal-body p:last-child { margin-bottom: 0; }
  .cl-modal-footer { padding: 14px 20px; border-top: 1px solid #eee; display: flex; gap: 8px; justify-content: flex-end; }

  /* ── Busy overlay — shown for every in-flight request so the user is never left
       wondering if a click registered; setBusy() also greys out every other button. ── */
  .busy-overlay { position: fixed; inset: 0; background: rgba(20,20,18,0.4); z-index: 10010; display: none; align-items: center; justify-content: center; font-family: var(--font-ui); }
  .busy-overlay.open { display: flex; }
  .busy-box { background: var(--surface); padding: 22px 30px; border-radius: var(--radius-md); box-shadow: 0 16px 48px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 14px; font-size: 14px; color: var(--ink); }
  .busy-spinner { width: 20px; height: 20px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: busy-spin 0.8s linear infinite; flex-shrink: 0; }
  @keyframes busy-spin { to { transform: rotate(360deg); } }

  /* ── Print: remove toolbar + edit indicators ────────── */
  @media print {
    .cv-toolbar { display: none !important; }
    .hr-sidebar { display: none !important; }
    .cv-main { margin: 0 !important; }
    body { background: white; }
    .page { box-shadow: none; margin: 0; }
    [contenteditable]:hover,
    [contenteditable]:focus { background: transparent !important; outline: none !important; }
  }

  /* ── Narrow screens: the fixed 230px left toolbar + 30% right sidebar don't fit a phone
       screen — turn the toolbar into a normal top bar and stop reserving sidebar space
       (the sidebar itself still opens as an overlay via the existing toggle). ── */
  @media (max-width: 900px) {
    .cv-toolbar { position: static; width: auto; flex-direction: row; flex-wrap: wrap; box-shadow: none; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .tb-hint { display: none; }
    .tb-actions { flex-direction: row; flex-wrap: wrap; }
    .tb-btn, .tb-select { width: auto; }
    .cv-main { margin-left: 0; margin-right: 0 !important; }
    .hr-sidebar { width: 86%; }
  }

  /* edu-item class overrides (generated with compound class names) */
  .edu-item-degree { font-size: 13px; font-weight: 600; color: var(--ink); }
  .edu-item-school { font-size: 12px; color: #666; }
  .edu-item-year   { font-size: 11px; color: var(--accent); margin-top: 2px; }
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
    <div class="tb-row">
      <select class="tb-select" id="languageLevel" title="How polished should the CV's wording be?">
        <option value="1">Wording: Original</option>
        <option value="2" selected>Wording: Slightly polished</option>
        <option value="3">Wording: Professional</option>
        <option value="4">Wording: Highly professional</option>
        <option value="5">Wording: Senior expert</option>
      </select>
      <button class="tb-btn tb-print tb-go" id="regenWordingBtn" onclick="regenerateWording()" title="Regenerate wording at this level">Go</button>
    </div>
    <button class="tb-btn tb-print" id="exportWordBtn" onclick="exportWord()">Export to Word</button>
    <button class="tb-btn tb-save" id="coverLetterBtn" onclick="generateCoverLetterPanel()">Generate Cover Letter</button>
    <button class="tb-btn tb-save" id="interviewQBtn" onclick="generateInterviewQuestionsPanel()">Generate Interview Questions</button>
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
  <div class="concern-banner" id="concernBanner" style="display:none;">
    <span id="concernBannerText"></span>
    <button onclick="cancelConcern()">cancel</button>
  </div>
  <div class="concern-resolve-row" id="concernResolveRow" style="display:none;">
    <button class="tb-btn tb-print" id="concernApplyBtn" onclick="applyConcernChange()" style="flex:1;">Apply this change</button>
    <button class="tb-btn tb-save" id="concernKeepBtn" onclick="keepConcernAsIs()" style="flex:1;">Keep as-is</button>
  </div>
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
    <div class="cl-modal-footer" id="clModalFooter" style="display:none;">
      <button class="tb-btn tb-save" onclick="copyCoverLetter()">Copy text</button>
      <button class="tb-btn tb-print" id="clDownloadBtn" onclick="downloadCoverLetterWord()">Download as Word</button>
    </div>
  </div>
</div>

<div class="cl-modal-overlay" id="iqModalOverlay">
  <div class="cl-modal" style="width:680px;">
    <div class="cl-modal-header">
      <h2>Interview Prep — Top 10 Questions</h2>
      <button class="cl-modal-close" onclick="closeInterviewQuestionsModal()">&times;</button>
    </div>
    <div class="cl-modal-body" id="iqModalBody">Generating…</div>
    <div class="cl-modal-footer" id="iqModalFooter" style="display:none;">
      <button class="tb-btn tb-save" onclick="copyInterviewQuestions()">Copy text</button>
    </div>
  </div>
</div>

<div class="busy-overlay" id="busyOverlay">
  <div class="busy-box">
    <div class="busy-spinner"></div>
    <span id="busyMessage">Working…</span>
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

  // Shows/hides the centered "working…" overlay so the user is never left wondering whether
  // a click registered, and greys out every other toolbar/sidebar control so two requests
  // can't be fired at once. opts.overlay:false skips the popup box (used for HR chat, where
  // the message bubble itself already signals "in progress") while still disabling buttons.
  function setBusy(on, message, opts) {
    opts = opts || {};
    const overlay = document.getElementById('busyOverlay');
    if (on && opts.overlay !== false) {
      document.getElementById('busyMessage').textContent = message || 'Working…';
      overlay.classList.add('open');
    } else {
      overlay.classList.remove('open');
    }
    document.querySelectorAll('.tb-btn, .tb-select, .hr-sb-model').forEach(function(b) {
      b.disabled = on;
    });
  }

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
    setBusy(true, 'Uploading your template…');
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
    } finally {
      setBusy(false);
    }
  }

  // Sends the live-edited CV content back to HR for a wording-only rewrite at the chosen
  // language level, then reloads this same page so the new wording shows up in place.
  async function regenerateWording() {
    const btn = document.getElementById('regenWordingBtn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Regenerating…';
    setBusy(true, 'Regenerating your CV wording…');
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
    } finally {
      setBusy(false);
    }
  }

  async function exportWord() {
    const btn = document.getElementById('exportWordBtn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Exporting…';
    setBusy(true, 'Exporting your CV to Word…');
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
      setBusy(false);
    }
  }

  // Cover letter is generated ONLY on explicit button press — never automatically — using
  // whatever is currently on screen (including live edits) so its tone/content matches the
  // latest tailored CV exactly.
  let lastCoverLetterText = '';

  async function generateCoverLetterPanel() {
    const overlay = document.getElementById('clModalOverlay');
    const body = document.getElementById('clModalBody');
    const footer = document.getElementById('clModalFooter');
    const btn = document.getElementById('coverLetterBtn');
    overlay.classList.add('open');
    body.textContent = 'Generating…';
    footer.style.display = 'none'; // no cover letter to copy/export until generation succeeds
    btn.disabled = true;
    setBusy(true, 'Generating your cover letter…');
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
      footer.style.display = '';
    } catch (err) {
      body.textContent = 'Failed to generate cover letter: ' + err.message;
    } finally {
      btn.disabled = false;
      setBusy(false);
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
    const btn = document.getElementById('clDownloadBtn');
    btn.disabled = true;
    setBusy(true, 'Preparing your cover letter Word document…');
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
    } finally {
      btn.disabled = false;
      setBusy(false);
    }
  }

  // Interview prep is generated ONLY on explicit button press, from whatever is currently
  // on screen (including live edits) — same pattern as the cover letter panel above.
  let lastInterviewQuestionsText = '';

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function generateInterviewQuestionsPanel() {
    const overlay = document.getElementById('iqModalOverlay');
    const body = document.getElementById('iqModalBody');
    const footer = document.getElementById('iqModalFooter');
    const btn = document.getElementById('interviewQBtn');
    overlay.classList.add('open');
    body.textContent = 'Generating…';
    footer.style.display = 'none'; // nothing to copy until questions are actually generated
    btn.disabled = true;
    setBusy(true, 'Generating your interview questions…');
    try {
      const res = await fetch('/generate-interview-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvData: extractCvData(), job: JOB_DATA }),
      });
      const data = await res.json();
      if (!data.questions) throw new Error(data.error || 'Generation failed');

      lastInterviewQuestionsText = data.questions.map(function(q, i) {
        return (i + 1) + '. ' + q.question + '\\n\\nAnswer option 1:\\n' + q.answer_1 + '\\n\\nAnswer option 2:\\n' + q.answer_2;
      }).join('\\n\\n---\\n\\n');

      body.innerHTML = data.questions.map(function(q, i) {
        return '<div style="margin-bottom:18px;">' +
          '<p><strong>' + (i + 1) + '. ' + escHtml(q.question) + '</strong></p>' +
          '<div style="margin-left:8px;"><em>Answer option 1:</em> ' + renderChatMarkdown(q.answer_1) + '</div>' +
          '<div style="margin-left:8px;"><em>Answer option 2:</em> ' + renderChatMarkdown(q.answer_2) + '</div>' +
          '</div>';
      }).join('');

      if (data.hrMessage) addHrBubble('expert', data.hrMessage);
      footer.style.display = '';
    } catch (err) {
      body.textContent = 'Failed to generate interview questions: ' + err.message;
    } finally {
      btn.disabled = false;
      setBusy(false);
    }
  }

  function closeInterviewQuestionsModal() {
    document.getElementById('iqModalOverlay').classList.remove('open');
  }

  async function copyInterviewQuestions() {
    if (!lastInterviewQuestionsText) return;
    await navigator.clipboard.writeText(lastInterviewQuestionsText);
    alert('Interview questions copied to clipboard.');
  }

  function toggleHrSidebar() {
    const collapsed = document.getElementById('hrSidebar').classList.toggle('collapsed');
    document.getElementById('cvMain').classList.toggle('full', collapsed);
    document.getElementById('hrToggleBtn').textContent = collapsed ? 'Ask HR Expert' : 'Hide HR Expert';
  }

  // ── Select a piece of the CV → discuss it with HR ───────────────────────────
  // Selecting text inside the CV marks it as "in review" (highlighted) until the candidate
  // either applies an agreed change or explicitly keeps it as-is. Only one concern is open
  // at a time, and only the piece actually discussed gets regenerated — never the whole CV.
  let activeConcern = null;
  let selectionPopover = null;

  function removeSelectionPopover() {
    if (selectionPopover) { selectionPopover.remove(); selectionPopover = null; }
  }

  document.addEventListener('mouseup', function(e) {
    if (e.target.closest('.hr-sidebar, .cl-modal-overlay, .cv-toolbar, .busy-overlay, .concern-popover')) return;
    setTimeout(function() {
      removeSelectionPopover();
      if (activeConcern) return; // resolve the current one before starting another
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text || text.length < 3) return;
      const pageEl = document.querySelector('.page');
      if (!pageEl || !pageEl.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const fieldEl = range.startContainer.nodeType === 1
        ? range.startContainer.closest('[data-field]')
        : range.startContainer.parentElement && range.startContainer.parentElement.closest('[data-field]');
      if (!fieldEl || !fieldEl.contains(range.endContainer)) return; // keep it to one field at a time

      const rect = range.getBoundingClientRect();
      const popover = document.createElement('button');
      popover.className = 'concern-popover';
      popover.textContent = '💬 Discuss with HR';
      popover.style.left = Math.max(8, rect.left) + 'px';
      popover.style.top = (rect.bottom + 6) + 'px';
      const frozenRange = range.cloneRange();
      popover.onclick = function() { startConcern(frozenRange, text, fieldEl); };
      document.body.appendChild(popover);
      selectionPopover = popover;
    }, 10);
  });

  function startConcern(range, text, fieldEl) {
    removeSelectionPopover();
    const span = document.createElement('span');
    span.className = 'hr-concern';
    span.id = 'concern-' + Date.now();
    try {
      range.surroundContents(span);
    } catch (err) {
      alert('Please select text within a single line or bullet to discuss it with HR.');
      return;
    }
    activeConcern = { id: span.id, targetEl: fieldEl, selectedText: text, originalFieldText: fieldEl.textContent, firstMessageSent: false };
    const banner = document.getElementById('concernBannerText');
    banner.textContent = 'Discussing: "' + (text.length > 60 ? text.slice(0, 60) + '…' : text) + '"';
    document.getElementById('concernBanner').style.display = '';
    document.getElementById('concernResolveRow').style.display = '';
    if (document.getElementById('hrSidebar').classList.contains('collapsed')) toggleHrSidebar();
    document.getElementById('hrSbInput').focus();
    window.getSelection().removeAllRanges();
  }

  function unwrapConcernSpan() {
    if (!activeConcern) return;
    const span = document.getElementById(activeConcern.id);
    if (span && span.parentNode) {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.parentNode.removeChild(span);
    }
  }

  function hideConcernUI() {
    document.getElementById('concernBanner').style.display = 'none';
    document.getElementById('concernResolveRow').style.display = 'none';
  }

  function cancelConcern() {
    unwrapConcernSpan();
    hideConcernUI();
    activeConcern = null;
  }

  function keepConcernAsIs() {
    unwrapConcernSpan();
    hideConcernUI();
    addHrBubble('expert', "Got it — I'll leave that part exactly as it is.");
    activeConcern = null;
  }

  async function applyConcernChange() {
    if (!activeConcern) return;
    const applyBtn = document.getElementById('concernApplyBtn');
    const keepBtn = document.getElementById('concernKeepBtn');
    applyBtn.disabled = true; keepBtn.disabled = true;
    setBusy(true, 'Updating that part of your CV…');
    try {
      const res = await fetch('/hr/apply-concern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: JOB_DATA, fieldText: activeConcern.originalFieldText, selectedText: activeConcern.selectedText }),
      });
      const data = await res.json();
      if (!data.revisedText) throw new Error(data.error || 'Update failed');
      activeConcern.targetEl.textContent = data.revisedText; // replaces the span too — content is regenerated, not just unhighlighted
      if (data.changed === false) {
        addHrBubble('expert', "We concluded no change was needed here — I've kept this part exactly as it was.");
      } else {
        addHrBubble('expert', "Done — I've updated that part of your CV based on our discussion.");
      }
      hideConcernUI();
      activeConcern = null;
    } catch (err) {
      addHrBubble('expert', 'Sorry, I could not apply that change: ' + err.message);
    } finally {
      applyBtn.disabled = false; keepBtn.disabled = false;
      setBusy(false);
    }
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
    setBusy(true, '', { overlay: false }); // chat bubble itself signals "in progress" — no popup needed
    try {
      const body = { message, model };
      if (activeConcern) {
        body.concern = { selectedText: activeConcern.selectedText, isFirst: !activeConcern.firstMessageSent };
        activeConcern.firstMessageSent = true;
      }
      const res = await fetch('/hr/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.reply) throw new Error(data.error || 'No reply');
      addHrBubble('expert', data.reply);
    } catch (err) {
      addHrBubble('expert', 'Sorry, something went wrong: ' + err.message);
    } finally {
      sendBtn.disabled = false;
      setBusy(false);
    }
  }
</script>
</body>
</html>`;
}

module.exports = { renderCVPage, generateExecutiveTemplate };
