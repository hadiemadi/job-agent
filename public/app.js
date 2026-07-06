let _cvPath = null;
let _cvFileName = null; // set in go() for use in savePendingJob during continueToJobAndHR
let _currentJob = null;
let _hrReview = null;
let _selectedDir = null;
// One entry per rendered gap card (services/gapStore.js: status tracks discuss/draft progress
// open -> [discussing] -> proposed; userDecision is the candidate's own, separate
// undecided|added|left-out call) — {id, description, rationale, severity, status,
// proposedStatement, hrConclusion: {rationale, lean}|null, userDecision}, plus a client-only
// `expanded` flag (not persisted server-side). Set fresh by showChanges() on every /review-cv
// response, then mutated locally as askHR()/decideGap() succeed, so the card can re-render
// from local state without a full re-fetch.
let _gaps = [];

// ── Utilities ─────────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function el(id) { return document.getElementById(id); }

// ── First-time onboarding ──────────────────────────────────────────────────────
// "Seen" state is a plain client-set cookie (NOT localStorage/sessionStorage, per
// requirement) with a year-long expiry — persists a dismissal across visits without any
// backend/session change.
const ONBOARD_COOKIE = 'onboarded';

function getCookie(name) {
  return document.cookie.split('; ').reduce((found, part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return found;
    return part.slice(0, eq) === name ? decodeURIComponent(part.slice(eq + 1)) : found;
  }, null);
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function dismissIntro() {
  hide('introPanel');
  setCookie(ONBOARD_COOKIE, '1', 365);
}

// Only shown for first-time visitors — returning users (cookie already set) never see it,
// so this can't block or slow down anyone who's already used the app.
if (!getCookie(ONBOARD_COOKIE)) show('introPanel');

// Prevents the ERR-HR-001/ERR-CV-001 nudge from firing in the first place (build.txt) — the
// button starts disabled (see index.html) and only enables once a CV file is actually chosen,
// with a tooltip explaining why while disabled. The validation popup stays as a rare fallback
// (e.g. session/cookie loss between steps) rather than the normal path.
function updateGoBtnAvailability() {
  const hasFile = !!(el('cvFile').files && el('cvFile').files[0]);
  const btn = el('goBtn');
  btn.disabled = !hasFile;
  btn.title = hasFile ? '' : 'Upload your CV first.';
}
el('cvFile').addEventListener('change', updateGoBtnAvailability);
updateGoBtnAvailability();

// "Delete my data now" — wipes the server-side session (CV text, parsed data, HR/coach
// history, generated output files) and reloads, which naturally resets every bit of UI
// state back to the upload screen instead of needing to manually reset a dozen elements.
async function deleteMyData() {
  if (!confirm('This permanently deletes your uploaded CV, contact info, and any generated files from this session. Continue?')) return;
  try {
    await fetch('/delete-my-data', { method: 'POST' });
  } catch (err) { /* best-effort — reload regardless so the UI still resets */ }
  location.reload();
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Error popup — single choke point, branches on `kind` ─────────────────────
// Every server error response carries error_code + kind (core/respondError.js's sendError,
// core/errorCodes.js's catalog). This is the one place that decides which of the two renderers
// below to use — never call showTechnicalErrorDialog/showValidationNudge directly from a
// fetch call site, so the branch logic stays in one spot.
function showErrorPopup(data, route) {
  if (!data || !data.error_code) return;
  if (data.kind === 'validation') { showValidationNudge(data, route); return; }
  if (data.kind === 'rate') { showRatePopup(data); return; }
  showTechnicalErrorDialog(data, route);
}

// Per-code friendly copy for the validation nudge — title names what's needed, body is one
// warm sentence, ctaLabel is the action itself. Codes not listed here (any validation code we
// didn't anticipate) fall back to a generic, still-friendly card using the server's own
// catalog message as the body, with a plain dismiss button and no specific action.
const VALIDATION_COPY = {
  'ERR-CV-001':  { title: 'Add your CV first', body: "Upload your CV and I'll pick this up automatically.", ctaLabel: 'Upload CV', action: 'upload-cv' },
  'ERR-HR-001':  { title: 'Add your CV first', body: "Upload your CV and I'll run the HR review on it.", ctaLabel: 'Upload CV', action: 'upload-cv' },
  'ERR-COACH-001': { title: 'Add your CV first', body: "Upload your CV and I'll bring in the Career Coach.", ctaLabel: 'Upload CV', action: 'upload-cv' },
  'ERR-GEN-001': { title: 'Add your CV first', body: 'Upload your CV before regenerating it.', ctaLabel: 'Upload CV', action: 'upload-cv' },
  'ERR-HR-002':  { title: 'Choose a job first', body: 'Paste or select a job description before requesting the HR review.', ctaLabel: 'Got it', action: null },
  'ERR-GEN-002': { title: 'Choose a job first', body: "There's no job to regenerate your CV against yet.", ctaLabel: 'Got it', action: null },
  'ERR-COACH-002': { title: 'Pick a direction', body: 'Choose a career direction so the Coach knows where to focus.', ctaLabel: 'Got it', action: null },
  'ERR-GAP-002': { title: 'Ask HR first', body: 'Ask HR to draft a sentence for this before adding it to your CV.', ctaLabel: 'Got it', action: null },
  'ERR-JOB-002': { title: 'Search for jobs first', body: 'Run a job search before analyzing fit.', ctaLabel: 'Got it', action: null },
  'ERR-JOB-004': { title: 'Paste the description instead', body: "That site needs a login, so it can't be read automatically — paste the job description text instead.", ctaLabel: 'Got it', action: null },
  'ERR-JOB-005': { title: 'Paste the description instead', body: 'Reading job pages from a link is turned off right now — paste the text instead.', ctaLabel: 'Got it', action: null },
  'ERR-JOB-006': { title: 'Add a job link or text', body: 'Provide a job URL or paste the job description text.', ctaLabel: 'Got it', action: null },
  'ERR-CV-009':  { title: 'Try a different template option', body: "Style-matching your original CV isn't ready yet — use 'Upload your own template' instead.", ctaLabel: 'Got it', action: null },
};

// Friendly nudge for a missing-input/wrong-order case — no error code, no timestamp, no route,
// no support line, no red. A helpful teammate pointing at what's needed, not a system alarm.
//
// Trial-period addition: while window.TRIAL_MODE is true (core/config.js, default true — set
// TRIAL_MODE=false in the environment to turn this back off, the one-flag switch), a quiet,
// muted caption with just the code renders under the friendly body — never in the red/
// technical style showTechnicalErrorDialog uses, no timestamp, no route, no support line.
function showValidationNudge(data, route) {
  const copy = VALIDATION_COPY[data.error_code] || { title: 'One more thing', body: data.error, ctaLabel: 'Got it', action: null };

  let overlay = el('nudgePopupOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nudgePopupOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="card modal-box">' +
        '<div class="nudge-popup-title" id="nudgeTitle"></div>' +
        '<div class="nudge-popup-body" id="nudgeBody"></div>' +
        '<div class="nudge-code" id="nudgeCode" style="display:none;"></div>' +
        '<div class="nudge-popup-actions">' +
          '<button class="btn btn-blue btn-sm" id="nudgeCtaBtn" type="button"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  el('nudgeTitle').textContent = copy.title;
  el('nudgeBody').textContent = copy.body;
  const codeEl = el('nudgeCode');
  if (window.TRIAL_MODE && data.error_code) {
    codeEl.textContent = data.error_code;
    show('nudgeCode');
  } else {
    codeEl.textContent = '';
    hide('nudgeCode');
  }
  const ctaBtn = el('nudgeCtaBtn');
  ctaBtn.textContent = copy.ctaLabel;
  ctaBtn.onclick = () => {
    hide('nudgePopupOverlay');
    if (copy.action === 'upload-cv' && el('cvPickerGroup')) {
      show('cvPickerGroup');
      el('cvPickerGroup').scrollIntoView({ behavior: 'smooth', block: 'center' });
      el('cvFile').click();
    }
  };
  show('nudgePopupOverlay');
}

// The full, unchanged "Something went wrong" dialog for real failures — technical metadata
// ONLY: code, route, timestamp. Never the candidate's CV text, job description body, name, or
// email — those never reach this function in the first place, since the server only ever sends
// back a code + a static catalog message (core/errorCodes.js).
function showTechnicalErrorDialog(data, route) {
  const code = data.error_code;
  const message = data.error || 'Something unexpected went wrong.';
  const timestamp = new Date().toISOString();
  const blob = `error_code: ${code}\nroute: ${route || 'unknown'}\ntimestamp: ${timestamp}`;

  let overlay = el('errPopupOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'errPopupOverlay';
    overlay.className = 'modal-overlay err-popup-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="card modal-box">' +
        '<h2>Something went wrong</h2>' +
        '<div class="err-popup-message" id="errPopupMessage"></div>' +
        '<div class="err-popup-code" id="errPopupCode"></div>' +
        '<div class="err-popup-time" id="errPopupTime"></div>' +
        '<div class="err-popup-blob" id="errPopupBlob"></div>' +
        '<div class="err-popup-note">You can copy the technical details above and send them to support — they contain no personal data, just a code, the page, and a timestamp.</div>' +
        '<div class="err-popup-actions">' +
          '<span class="err-popup-copy-status" id="errPopupCopyStatus" style="display:none;">Copied</span>' +
          '<button class="btn btn-ghost btn-sm" id="errPopupCopyBtn" type="button">Copy</button>' +
          '<button class="btn btn-blue btn-sm" id="errPopupCloseBtn" type="button">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    el('errPopupCloseBtn').addEventListener('click', () => hide('errPopupOverlay'));
    el('errPopupCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el('errPopupBlob').textContent);
        show('errPopupCopyStatus');
        setTimeout(() => hide('errPopupCopyStatus'), 2000);
      } catch (e) { /* clipboard API unavailable — the blob is still selectable/copyable by hand */ }
    });
  }

  el('errPopupMessage').textContent = message;
  el('errPopupCode').textContent = code;
  el('errPopupTime').textContent = timestamp;
  el('errPopupBlob').textContent = blob;
  hide('errPopupCopyStatus');
  show('errPopupOverlay');
}

// Per-code copy for the rate-limit popup. Two causes: (a) burst (ERR-RATE-002 — clears in
// seconds, "Try again" makes sense), (b) daily cap (ERR-RATE-001/003 — resets overnight,
// "Try again" button is misleading so we show "Close" only).
const RATE_COPY = {
  'ERR-RATE-002': { title: 'One moment',        body: "You're going a little fast. Wait a few seconds and try again.",     isDaily: false },
  'ERR-RATE-001': { title: 'Daily limit reached', body: "The app has hit today's usage limit. Please try again tomorrow.", isDaily: true  },
  'ERR-RATE-003': { title: 'Daily limit reached', body: "The app has hit today's usage limit. Please try again tomorrow.", isDaily: true  },
};

// Calm overlay for a rate-limit response — no red, no route/timestamp, no support line.
// Burst: "Try again" just closes the overlay so the user can click again immediately.
// Daily cap: "Close" only — retrying right away will not help.
function showRatePopup(data) {
  const copy = RATE_COPY[data.error_code] || { title: 'Slow down', body: data.error, isDaily: false };

  let overlay = el('ratePopupOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ratePopupOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="card modal-box">' +
        '<div class="nudge-popup-title" id="rateTitle"></div>' +
        '<div class="nudge-popup-body" id="rateBody"></div>' +
        '<div class="nudge-code" id="rateCode" style="display:none;"></div>' +
        '<div class="nudge-popup-actions">' +
          '<button class="btn btn-blue btn-sm" id="rateCloseBtn" type="button"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    el('rateCloseBtn').addEventListener('click', () => hide('ratePopupOverlay'));
  }

  el('rateTitle').textContent = copy.title;
  el('rateBody').textContent = copy.body;
  const codeEl = el('rateCode');
  if (window.TRIAL_MODE && data.error_code) {
    codeEl.textContent = data.error_code;
    show('rateCode');
  } else {
    codeEl.textContent = '';
    hide('rateCode');
  }
  el('rateCloseBtn').textContent = copy.isDaily ? 'Close' : 'Try again';
  show('ratePopupOverlay');
}

// Turns the raw pasted job text into readable paragraphs — needs to stay legible in a
// nicer font/larger box since it remains on screen behind the contact-info and progress
// pop-ups that follow, long after the plain textarea would have been cramped.
function renderJobDescriptionHtml(text) {
  return text.split(/\n\s*\n/).map(block => {
    const esc = escapeHtml(block.trim());
    return esc ? '<p>' + esc.replace(/\n/g, '<br>') + '</p>' : '';
  }).filter(Boolean).join('');
}

function setGoStatus(msg, type) {
  const s = el('goStatus');
  s.textContent = msg;
  s.className = type === 'err' ? 'err-msg' : 'info-msg';
  s.style.display = msg ? 'block' : 'none';
}

function buildSteps(defs) {
  el('steps').innerHTML = defs.map((d, i) => `
    ${i > 0 ? '<div class="step-arrow">→</div>' : ''}
    <div class="step" id="step${i}">
      <div class="step-icon wait" id="si${i}">${i+1}</div>
      <div class="step-label">${d}</div>
      <div class="step-detail" id="sd${i}"></div>
    </div>
  `).join('');
}

// Maps an error kind to the correct step state. 'rate' and 'validation' use 'warn' (neutral,
// muted — the step didn't crash, the user just needs to wait or do something first). Real
// failures ('error' or unknown) keep the existing red 'err' state.
function errorStepState(kind) {
  return (kind === 'rate' || kind === 'validation') ? 'warn' : 'err';
}

function setStep(i, state, detail) {
  const icon = el('si' + i);
  const det = el('sd' + i);
  const iconMap = { wait: i+1, run: '<div class="spinner"></div>', ok:'✓', err:'✗', warn:'!' };
  icon.className = 'step-icon ' + state;
  icon.innerHTML = iconMap[state] || (i+1);
  if (det && detail) { det.className = 'step-detail ' + state; det.textContent = detail; }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function go() {
  if (!el('consentCheck').checked) {
    setGoStatus('Please confirm you understand how your CV will be used before continuing.', 'err');
    show('goStatus');
    return;
  }
  const file = el('cvFile').files[0];
  const jobText = el('jobText').value.trim();
  if (!file) { setGoStatus('Please upload your CV first.', 'err'); show('goStatus'); return; }
  if (!jobText) { setGoStatus('Please paste the job description.', 'err'); show('goStatus'); return; }

  // Lock in the chosen file + job description as a clean read-only display — they need to
  // stay legible behind the contact-info and progress pop-ups that follow, instead of being
  // buried in a tiny file input and a cramped textarea.
  hide('cvPickerGroup');
  _cvFileName = file.name;
  el('fileChosenDisplay').innerHTML = '<span class="fc-icon">📄</span><span class="fc-name">' + escapeHtml(file.name) + '</span>';
  show('fileChosenDisplay');
  hide('jobTextGroup');
  el('jobDescDisplay').innerHTML = renderJobDescriptionHtml(jobText);
  show('jobDescDisplay');

  el('goBtn').disabled = true;
  hide('goBtn');
  hide('changesCard'); hide('comparisonCard'); hide('searchResultsCard');
  hide('coachToggleBar'); hide('coachCard'); hide('goStatus'); hide('contactCard');

  // Built once and reused across go() → continueToJobAndHR() → applyChanges() — the same
  // 4-step bar stays visible (re-shown/hidden, never rebuilt) for the whole flow so the user
  // always sees where they are relative to the full journey, not just the current phase.
  show('progressCard');
  buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
  setStep(0, 'run');

  // Step 0: Upload CV
  const fd = new FormData();
  fd.append('cv', file);
  try {
    const upRes = await fetch('/upload-cv', { method:'POST', body: fd });
    const upData = await upRes.json();
    if (upData.error) {
      setStep(0, errorStepState(upData.kind), upData.error); el('goBtn').disabled=false; show('goBtn');
      show('cvPickerGroup'); hide('fileChosenDisplay'); show('jobTextGroup'); hide('jobDescDisplay');
      showErrorPopup(upData, '/upload-cv');
      return;
    }
    _cvPath = upData.cvPath;
    setStep(0, 'ok', 'CV ready');

    // Pause — show contact review card so user can verify/correct contact info
    await new Promise(r => setTimeout(r, 400));
    hide('progressCard');
    const d = upData.cvData || {};
    el('ci-name').value     = d.name     || '';
    el('ci-title').value    = d.title    || '';
    el('ci-email').value    = d.email    || '';
    el('ci-phone').value    = d.phone    || '';
    el('ci-location').value = d.location || '';
    el('ci-linkedin').value = d.linkedin || '';
    show('contactCard');
  } catch (err) {
    setStep(0,'err', err.message); el('goBtn').disabled=false; show('goBtn');
    show('cvPickerGroup'); hide('fileChosenDisplay'); show('jobTextGroup'); hide('jobDescDisplay');
  }
}

// Saves confirmed contact to server, then continues with job + HR steps
async function confirmContact() {
  const gapSeverities = ['major', 'mild', 'minor'].filter(s => el('ci-sev-' + s).checked);
  const contact = {
    name:     el('ci-name').value.trim(),
    title:    el('ci-title').value.trim(),
    email:    el('ci-email').value.trim(),
    phone:    el('ci-phone').value.trim(),
    location: el('ci-location').value.trim(),
    linkedin: el('ci-linkedin').value.trim(),
    customInstructions: el('ci-instructions').value.trim(),
    tone:     parseInt(el('ci-tone').value, 10),
    extensiveSearch: el('ci-extensive-search').checked,
    refreshDiscipline: el('ci-refresh-discipline').checked,
    gapSeverities: gapSeverities.length ? gapSeverities : ['major'],
  };
  hide('contactStatus');
  try {
    const res = await fetch('/confirm-contact', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(contact)
    });
    const data = await res.json();
    if (data.error) {
      el('contactStatus').textContent = data.error; el('contactStatus').className = 'err-msg'; show('contactStatus');
      showErrorPopup(data, '/confirm-contact');
      return;
    }
    hide('contactCard');
    await continueToJobAndHR();
  } catch (err) {
    el('contactStatus').textContent = err.message;
    el('contactStatus').className = 'err-msg';
    show('contactStatus');
  }
}

// Steps 1–2: parse job + HR review (runs after contact is confirmed)
async function continueToJobAndHR() {
  const jobText = el('jobText').value.trim();

  show('progressCard');

  // Step 1: Parse pasted job description (fast, stays synchronous)
  setStep(1, 'run');
  try {
    const res = await fetch('/fetch-job', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jobText }) });
    const data = await res.json();
    if (data.error || !data.job) { setStep(1, errorStepState(data.kind), data.error || 'Could not parse job'); el('goBtn').disabled=false; show('goBtn'); showErrorPopup(data, '/fetch-job'); return; }
    _currentJob = data.job;
    setStep(1, 'ok', (data.job.job_title || 'Job') + (data.job.employer_name ? ' at ' + data.job.employer_name : ''));
  } catch (err) { setStep(1,'err', err.message); el('goBtn').disabled=false; show('goBtn'); return; }

  // Step 2: HR Review — now async via job queue so a tab close/reload can resume.
  // POST returns { jobId } immediately; the actual review runs on the server and the
  // frontend polls until done, then calls showChanges() to render the results.
  setStep(2, 'run');
  try {
    const res = await fetch('/review-cv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job: _currentJob }) });
    const data = await res.json();
    if (data.error) { setStep(2, errorStepState(data.kind), data.error); el('goBtn').disabled=false; show('goBtn'); showErrorPopup(data, '/review-cv'); return; }
    if (!data.jobId) { setStep(2, 'err', 'Unexpected server response — try again.'); el('goBtn').disabled=false; show('goBtn'); return; }
    // Persist the job so a reload within 1 hour can resume from the same point (step 2 running).
    savePendingJob(data.jobId, {
      kind: 'hr_review',
      cvFileName: _cvFileName || '',
      jobText,
      currentJob: _currentJob,
    });
    startPolling(data.jobId, false, 'hr_review');
  } catch (err) { setStep(2,'err', err.message); el('goBtn').disabled=false; show('goBtn'); }
}

// ── Changes review ────────────────────────────────────────────────────────────

function showChanges(review) {
  const matchClass = review.overall_match || 'Moderate';
  el('matchBadge').innerHTML = `<span class="hr-match ${matchClass}">Match: ${matchClass}</span>`;

  const fitExplanationEl = el('fitExplanation');
  if (review.fit_explanation && review.fit_explanation.trim()) {
    fitExplanationEl.innerHTML = `
      <div class="changes-section-title">Why this is a ${matchClass.toLowerCase()} fit</div>
      <p class="changes-hint" style="margin:0;">${review.fit_explanation}</p>
    `;
    show('fitExplanation');
  } else {
    fitExplanationEl.innerHTML = '';
    hide('fitExplanation');
  }

  el('strengthsBlock').innerHTML = (review.strengths || []).length ? `
    <div class="changes-section-title">Strengths</div>
    <ul class="hr-list">${review.strengths.map(s => '<li>' + s + '</li>').join('')}</ul>
  ` : '';

  el('autoBlock').innerHTML = (review.auto_changes || []).length ? `
    <div class="changes-section-title">Applied automatically</div>
    <p class="changes-hint">Directly evidenced in your CV — no confirmation needed:</p>
    ${review.auto_changes.map(c => `
      <div class="auto-change">
        <div class="auto-desc">${c.description}</div>
        <div class="auto-rationale">${c.rationale}</div>
      </div>
    `).join('')}
  ` : '';

  _gaps = (review.confirm_changes || []).map(c => ({ ...c, expanded: c.userDecision === 'undecided' }));

  el('confirmBlock').innerHTML = _gaps.length ? `
    <div class="changes-section-title">Your input needed</div>
    <p class="changes-hint">These go beyond your current CV — discuss with your coach (optional), ask HR to draft a sentence, then add it to your CV or leave it out:</p>
    ${_gaps.map((g, i) => renderGapCard(i)).join('')}
  ` : '';

  show('changesCard');
  el('changesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// True when the candidate's own decision disagrees with HR's lean — the only time the
// collapsed card's HR line renders in red. Never true with no HR lean to disagree with.
function gapIsOverride(g) {
  if (!g.hrConclusion) return false;
  return (g.userDecision === 'added' && g.hrConclusion.lean === 'leave-out') ||
         (g.userDecision === 'left-out' && g.hrConclusion.lean === 'add');
}

function gapDecisionClass(g) {
  return g.userDecision === 'added' ? 'added' : g.userDecision === 'left-out' ? 'left-out' : 'undecided';
}

// Renders ONE gap card. `expanded` (client-only UI state, not server-persisted) decides the
// layout, not status/userDecision directly: undecided cards default to expanded, decided
// cards default to collapsed, and either can be toggled by clicking the card / making a
// decision. This is deliberately checked BEFORE anything else.
function renderGapCard(i) {
  return _gaps[i].expanded ? renderExpandedGapCard(i) : renderCollapsedGapCard(i);
}

// Collapsed: one line — the original slogan, colored by the candidate's decision (never by
// HR's lean) — with HR's drafted sentence below in small dark gray, turning red only on an
// override (the candidate's decision disagrees with HR's own lean).
function renderCollapsedGapCard(i) {
  const g = _gaps[i];
  return `
    <div class="confirm-change collapsed" id="cc-${i}" onclick="expandGapCard(${i})">
      <div class="confirm-change-text">
        <div class="gap-slogan ${gapDecisionClass(g)}">${g.description}</div>
        ${g.proposedStatement ? `<div class="gap-hr-line${gapIsOverride(g) ? ' override' : ''}">${g.proposedStatement}</div>` : ''}
      </div>
    </div>`;
}

// Expanded: fixed 6-item order — (1) slogan, (2) rationale (≤2 lines, reused as-is, no new
// field), (3) HR advice and (4) the drafted sentence (both only once HR has actually drafted
// something), (5) prep buttons (never decide anything — Discuss is optional, Ask HR is
// re-askable any time), (6) the Add-to-CV/Leave-out decision itself.
function renderExpandedGapCard(i) {
  const g = _gaps[i];
  const severityLabel = g.severity ? `${g.severity.charAt(0).toUpperCase()}${g.severity.slice(1)} Gap` : '';
  const severityTag = g.severity ? ` <span class="gap-severity ${g.severity}">${severityLabel}</span>` : '';
  const hasDraft = !!g.proposedStatement;
  const leanClass = g.hrConclusion && g.hrConclusion.lean === 'add' ? 'lean-add' : 'lean-leave-out';
  const hrStatement = (g.hrConclusion && g.hrConclusion.statement) || g.hrStatement || '';
  return `
    <div class="confirm-change expanded" id="cc-${i}">
      <div class="confirm-change-text">
        <div class="gap-slogan ${gapDecisionClass(g)}" id="cc-desc-${i}">${g.description}${severityTag}</div>
        <div class="confirm-rationale gap-rationale" id="cc-rationale-${i}">${g.rationale}</div>
        ${hasDraft ? `
          <div class="gap-hr-advice ${leanClass}">${hrStatement}</div>
        ` : ''}
      </div>
      <div class="confirm-btns">
        <button class="btn btn-sm" style="background:#185FA5;color:white;" onclick="askHR(${i}, this)">${hasDraft ? 'Ask HR to re-draft →' : 'Ask HR to draft a sentence →'}</button>
        <button class="btn btn-sm" style="background:#2C2C2A;color:white;" onclick="toggleDiscuss(${i})">Discuss with coach →</button>
      </div>
      <div class="chat-panel" id="chat-${i}" style="display:none;">
        <div class="chat-messages" id="chat-msgs-${i}"></div>
        <div class="chat-input-row">
          <textarea class="chat-input" id="chat-input-${i}" placeholder="Talk to your Career Coach…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat(${i});}"></textarea>
          <button class="btn btn-blue btn-sm" onclick="sendChat(${i})">Send</button>
        </div>
        <div id="chat-status-${i}" class="info-msg" style="display:none;margin-top:6px;"></div>
      </div>
      <div class="confirm-decision-row">
        <button class="btn btn-ghost btn-sm" ${hasDraft ? '' : 'disabled'} onclick="decideGap(${i}, 'added', this)">Add to CV</button>
        <button class="btn btn-sm" style="background:#f5f5f5;color:#888;" onclick="decideGap(${i}, 'left-out', this)">Leave out</button>
      </div>
    </div>`;
}

function expandGapCard(i) {
  _gaps[i].expanded = true;
  reRenderGapCard(i);
}

// Re-renders one card in place after a state-changing action (askHR success, decideGap,
// expandGapCard). The whole card — including the chat panel — is one element now, so a single
// outerHTML swap is enough; there's no separate sibling node to manage.
function reRenderGapCard(i) {
  const card = el('cc-' + i);
  if (card) card.outerHTML = renderGapCard(i);
}

// "Add to CV" / "Leave out" — the only two outcomes, and never terminal: either can be changed
// (overridden) later by re-expanding a collapsed card. Every decision click collapses the
// card, including overrides — there's no "stay expanded after deciding" path.
async function decideGap(i, decision, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/gap-decision', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ gapId: _gaps[i].id, decision }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not update this gap.'); showErrorPopup(data, '/gap-decision'); if (btn) btn.disabled = false; return; }
    _gaps[i].userDecision = data.userDecision;
    _gaps[i].expanded = false;
    reRenderGapCard(i);
  } catch (err) {
    alert(err.message);
    if (btn) btn.disabled = false;
  }
}

// ── Coach & HR chat (per confirm-change card) ─────────────────────────────────

// Local-only cache of each card's chat bubbles, purely for re-rendering the conversation UI —
// the server (services/gapStore.js) is the authoritative copy /hr/refine reads from.
const _cardChats = {};

function toggleDiscuss(i) {
  const panel = el('chat-' + i);
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  if (!opening) return;
  if (!_cardChats[i]) {
    // First time this gap has ever been discussed — seed the opening line.
    _cardChats[i] = [];
    const desc = el('cc-desc-' + i).textContent;
    appendBubble(i, 'coach', `Let's talk about this: "${desc}" — have you done anything similar, even if it wasn't your official role or main responsibility?`);
  } else if (el('chat-msgs-' + i).children.length === 0) {
    // A conversation already exists, but the panel's DOM was just recreated (the card
    // collapsed/re-rendered since this was last open) — replay it instead of re-seeding the
    // opening line, so prior bubbles aren't visually lost even though they were never gone
    // from the server's record (services/gapStore.js's coachConversation).
    _cardChats[i].forEach(m => appendBubble(i, m.role === 'user' ? 'user' : 'coach', m.content));
  }
}

// Renders a small subset of markdown (paragraphs, "- " bullet lists, **bold**) into safe
// HTML — chat replies come back as markdown-ish text, and dumping it as textContent left
// raw "**"/"-" characters visible instead of actually formatting the text.
function renderChatMarkdown(text) {
  const esc  = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return text.split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    const isList = lines.every(l => /^[-*>]\s+/.test(l));
    if (isList) {
      return '<ul>' + lines.map(l => '<li>' + bold(esc(l.replace(/^[-*>]\s+/, ''))) + '</li>').join('') + '</ul>';
    }
    return '<p>' + lines.map(l => bold(esc(l.replace(/^>\s+/, '')))).join('<br>') + '</p>';
  }).join('');
}

function appendBubble(i, type, text) {
  const msgs = el('chat-msgs-' + i);
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + (type === 'user' ? 'user' : type === 'hr' ? 'hr-msg' : 'coach');
  div.innerHTML = renderChatMarkdown(text);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChat(i) {
  const input = el('chat-input-' + i);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (!_cardChats[i]) _cardChats[i] = [];
  _cardChats[i].push({ role: 'user', content: text });
  appendBubble(i, 'user', text);
  el('chat-status-' + i).textContent = 'Coach is thinking…';
  show('chat-status-' + i);
  try {
    const res = await fetch('/coach/discuss', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: text, gapId: _gaps[i].id })
    });
    const data = await res.json();
    hide('chat-status-' + i);
    if (data.reply) {
      _cardChats[i].push({ role: 'assistant', content: data.reply });
      appendBubble(i, 'coach', data.reply);
    } else if (data.error) {
      showErrorPopup(data, '/coach/discuss');
    }
  } catch (err) {
    el('chat-status-' + i).textContent = err.message;
  }
}

// Asks HR to draft (or re-draft) ONE concrete CV-ready sentence for this gap — available
// directly from open/discussing, with or without a coach discussion first (discussion is
// optional), and re-askable any time, including after a decision was already made. A
// successful draft always resets userDecision to 'undecided' server-side (services/gapStore.js's
// proposeStatement) — mirrored here — since a prior decision was made against a now-superseded
// sentence and must be explicitly re-confirmed. The card stays expanded so the candidate can
// see and decide on the new draft.
async function askHR(i, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'HR is drafting…'; }
  try {
    const res = await fetch('/hr/refine', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ gapId: _gaps[i].id })
    });
    const data = await res.json();
    if (!res.ok || !data.proposedStatement) {
      if (btn) { btn.disabled = false; btn.textContent = _gaps[i].proposedStatement ? 'Ask HR to re-draft →' : 'Ask HR to draft a sentence →'; }
      const statusEl = el('chat-status-' + i);
      if (statusEl) { statusEl.textContent = data.error || 'HR did not return a draft — try again.'; show('chat-status-' + i); }
      else alert(data.error || 'HR did not return a draft — try again.');
      showErrorPopup(data, '/hr/refine');
      return;
    }
    _gaps[i].status = data.status;
    _gaps[i].proposedStatement = data.proposedStatement;
    _gaps[i].hrConclusion = { rationale: data.rationale, lean: data.lean, targetSection: data.targetSection || null, statement: data.hrStatement || null };
    _gaps[i].targetSection = data.targetSection || null;
    _gaps[i].hrStatement = data.hrStatement || null;
    _gaps[i].userDecision = 'undecided';
    _gaps[i].expanded = true;
    reRenderGapCard(i);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Ask HR to draft a sentence →'; }
    alert(err.message);
  }
}

// ── Background job polling (tab-close resilience) ────────────────────────────
// A stable per-browser key stored in localStorage lets us resume polling after a reload.
// We intentionally do NOT use sessionStorage (gone on tab close) or the server's `sid`
// cookie (httpOnly, unreadable from JS).
const _clientId = (function () {
  const k = 'jsk_cid';
  let id = localStorage.getItem(k);
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, id); }
  return id;
})();
const _pendingJobKey = 'jsk_job_' + _clientId;
// Exponential backoff for the polling loop: first poll is immediate, then 2 s, 4 s, 8 s,
// capped at 10 s. Each call to startPolling() gets a fresh backoff state so a new job
// never inherits stale state from a previous polling session.
const POLL_BACKOFF_START_MS = 2000;
const POLL_BACKOFF_CAP_MS   = 10000;
const JOB_MAX_AGE_MS        = 60 * 60 * 1000; // 1 hour — discard stale pending-job entries

let _pollTimer = null;

// extra carries kind-specific context needed on reload: { kind, cvFileName, jobText, currentJob }
function savePendingJob(jobId, extra) {
  localStorage.setItem(_pendingJobKey, JSON.stringify({ jobId, ts: Date.now(), ...extra }));
}

function clearPendingJob() {
  localStorage.removeItem(_pendingJobKey);
}

// Polls /job/:id/status until done/failed, then branches on kind:
//   'hr_review'  → calls showChanges() with the review data (steps 0-2)
//   'cv_tailor'  → calls showComparison() (steps 0-3, default)
// `isResume` is true when picking up a job after a page reload — the resume caller
// (resumePendingJob) sets up the UI before calling startPolling, not here.
function startPolling(jobId, isResume, kind) {
  kind = kind || 'cv_tailor';
  // Each polling session gets its own backoff state — starts at 2 s after the first
  // immediate call, doubles on every non-terminal response, caps at 10 s.
  let backoffMs = POLL_BACKOFF_START_MS;

  if (isResume && kind === 'cv_tailor') {
    show('progressCard');
    buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
    setStep(0, 'ok', ''); setStep(1, 'ok', ''); setStep(2, 'ok', '');
    setStep(3, 'run');
  }
  // hr_review resume: UI already built by resumePendingJob() before this is called.

  function poll() {
    fetch('/job/' + jobId + '/status')
      .then(r => r.json())
      .then(data => {
        if (data.error && data.status !== 'done' && data.status !== 'failed') {
          clearPendingJob();
          const step = kind === 'hr_review' ? 2 : 3;
          setStep(step, 'err', data.error);
          if (!isResume && kind === 'cv_tailor') { el('applyBtn').disabled = false; show('changesCard'); }
          showErrorPopup(data, '/job/status');
          return;
        }
        if (data.status === 'running' || data.status === 'pending') {
          _pollTimer = setTimeout(poll, backoffMs);
          backoffMs = Math.min(backoffMs * 2, POLL_BACKOFF_CAP_MS);
          return;
        }
        // done or failed
        clearPendingJob();
        _pollTimer = null;
        const result = data.result || {};

        if (kind === 'hr_review') {
          if (data.status === 'failed' || result.error) {
            const errData = { error: result.error || 'HR review failed.', error_code: result.code || 'ERR-HR-003', kind: 'error' };
            setStep(2, 'err', errData.error);
            if (!isResume) { el('goBtn').disabled = false; show('goBtn'); }
            showErrorPopup(errData, '/review-cv');
            return;
          }
          if (!result.hrReview) {
            setStep(2, 'err', 'No review data returned — try again.');
            if (!isResume) { el('goBtn').disabled = false; show('goBtn'); }
            return;
          }
          _hrReview = result.hrReview;
          if (result.currentJob) _currentJob = result.currentJob;
          setStep(2, 'ok', (result.hrReview.overall_match || 'Moderate') + ' match');
          setTimeout(() => { hide('progressCard'); showChanges(result.hrReview); }, 600);
          return;
        }

        // cv_tailor
        if (data.status === 'failed' || result.error) {
          const errData = { error: result.error || 'Tailoring failed.', error_code: result.code || 'ERR-CV-004', kind: 'error' };
          setStep(3, 'err', errData.error);
          if (!isResume) { el('applyBtn').disabled = false; show('changesCard'); }
          showErrorPopup(errData, '/rewrite');
          return;
        }
        if (!result.filePath) {
          setStep(3, 'err', 'No file path in result — try again.');
          if (!isResume) { el('applyBtn').disabled = false; show('changesCard'); }
          return;
        }
        setStep(3, 'ok', 'CV tailored');
        setTimeout(() => { hide('progressCard'); showComparison(_currentJob, result); }, 500);
      })
      .catch(() => {
        _pollTimer = setTimeout(poll, backoffMs);
        backoffMs = Math.min(backoffMs * 2, POLL_BACKOFF_CAP_MS);
      });
  }

  poll();
}

async function applyChanges() {
  el('applyBtn').disabled = true;
  hide('changesCard');
  show('progressCard');
  setStep(3, 'run');

  // Gap accept/skip status and the coach conversation are now tracked server-side as each
  // happens (services/gapStore.js, via /gap-decision and /coach/discuss) — /rewrite reads
  // them directly instead of this resending a snapshot built from the DOM.
  try {
    const res = await fetch('/rewrite', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ job: _currentJob })
    });
    const data = await res.json();
    if (data.error) { setStep(3, errorStepState(data.kind), data.error); el('applyBtn').disabled=false; show('changesCard'); showErrorPopup(data, '/rewrite'); return; }
    if (!data.jobId) {
      setStep(3,'err', 'Server returned an unexpected response — check the server terminal for errors.');
      el('applyBtn').disabled=false; show('changesCard'); return;
    }
    savePendingJob(data.jobId, { kind: 'cv_tailor' });
    startPolling(data.jobId, false, 'cv_tailor');
  } catch (err) {
    setStep(3,'err', err.message);
    el('applyBtn').disabled = false;
    show('changesCard');
  }
}

// On load: resume any pending job that was in-flight when the tab was closed.
// For hr_review jobs, restores the CV filename display, job description display, and
// the progress steps at "HR Review running" before starting to poll.
(function resumePendingJob() {
  try {
    const raw = localStorage.getItem(_pendingJobKey);
    if (!raw) return;
    const { jobId, ts, kind, cvFileName, jobText, currentJob } = JSON.parse(raw);
    if (!jobId || Date.now() - ts > JOB_MAX_AGE_MS) { clearPendingJob(); return; }

    if (kind === 'hr_review') {
      // Restore the read-only file + job description display that go() originally set up.
      hide('cvPickerGroup');
      el('fileChosenDisplay').innerHTML = '<span class="fc-icon">📄</span><span class="fc-name">' + escapeHtml(cvFileName || 'CV') + '</span>';
      show('fileChosenDisplay');
      if (jobText) {
        hide('jobTextGroup');
        el('jobDescDisplay').innerHTML = renderJobDescriptionHtml(jobText);
        show('jobDescDisplay');
      }
      hide('goBtn');
      if (currentJob) _currentJob = currentJob;
      // Rebuild the 4-step bar at "HR Review running" so the user sees where they are.
      show('progressCard');
      buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
      setStep(0, 'ok', ''); setStep(1, 'ok', '');
      setStep(2, 'run');
      startPolling(jobId, true, 'hr_review');
    } else {
      startPolling(jobId, true, 'cv_tailor');
    }
  } catch (e) {
    clearPendingJob();
  }
})();

function showComparison(job, data) {
  el('compTitle').textContent = job.job_title || 'Tailored CV';
  el('compCompany').textContent = job.employer_name || '';
  el('openTailoredBtn').href = '/' + data.filePath;
  show('comparisonCard');
  show('coachToggleBar');
  el('comparisonCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The comparison page costs nothing on the main path (tailored CV) unless the user actually
// asks to see it — it's only built here, on demand, instead of eagerly during /rewrite.
async function viewComparison() {
  const btn = el('openCompBtn');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Building comparison…';
  try {
    const res = await fetch('/build-comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: _currentJob }),
    });
    const data = await res.json();
    if (!data.comparisonPath) { showErrorPopup(data, '/build-comparison'); throw new Error(data.error || 'Failed to build comparison'); }
    window.open('/' + data.comparisonPath, '_blank');
  } catch (err) {
    alert('Could not build comparison: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// ── Career Coach (secondary) ──────────────────────────────────────────────────

function toggleCoach() {
  const c = el('coachCard');
  c.style.display = c.style.display === 'none' ? '' : 'none';
}

function selectDir(d) {
  _selectedDir = d;
  ['specialist','generalist','leadership'].forEach(x =>
    el('dir-' + x).classList.toggle('sel', x === d)
  );
  el('coachBtn').disabled = false;
}

async function runCoach() {
  if (!_selectedDir) return;
  el('coachBtn').disabled = true;
  el('coachResults').innerHTML = '';
  el('coachStatus').textContent = 'Analyzing your profile…';
  show('coachStatus');

  const res = await fetch('/coach/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: _selectedDir }) });
  const data = await res.json();
  el('coachBtn').disabled = false;
  hide('coachStatus');

  if (data.error) { el('coachStatus').textContent = data.error; el('coachStatus').className='err-msg'; show('coachStatus'); showErrorPopup(data, '/coach/analyze'); return; }

  el('coachResults').innerHTML = `
    <div class="coach-section-title">Ideal roles for you</div>
    ${data.suggestedRoles.map((r, i) => `
      <div class="role-card">
        <div class="role-title">${r.title}</div>
        <div class="role-row"><strong>Why you fit:</strong> ${r.why_fit}</div>
        <div class="role-row"><strong>Why now:</strong> ${r.why_next_step}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="pth-${i}" onclick="getCareerPath('${r.title.replace(/'/g,"\\'")}',${i})">Career path →</button>
        <div id="pp-${i}"></div>
      </div>
    `).join('')}
    ${data.marketMatches.length ? `
      <div class="coach-section-title">Best available jobs for your next step</div>
      ${data.marketMatches.map(m=>`
        <div class="role-card">
          <div class="role-title">${m.job_title} · <span style="font-weight:400;color:#888">${m.company||''}</span></div>
          <div class="role-row"><strong>Why it fits:</strong> ${m.why_it_fits}</div>
          <div class="role-row"><strong>Stepping stone to:</strong> ${m.stepping_stone_to}</div>
        </div>
      `).join('')}
    ` : ''}
  `;
}

async function getCareerPath(title, i) {
  const btn = el('pth-'+i), panel = el('pp-'+i);
  btn.disabled=true; btn.textContent='Loading…';
  const res = await fetch('/coach/path', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roleTitle: title }) });
  const d = await res.json();
  btn.textContent='Career path →'; btn.disabled=false;
  if (d.error) { panel.innerHTML='<p class="err-msg">'+d.error+'</p>'; showErrorPopup(d, '/coach/path'); return; }
  panel.innerHTML=`<div class="path-panel">
    <div class="path-label">Key Challenges</div>
    <ul class="path-list">${d.key_challenges.map(c=>'<li>'+c+'</li>').join('')}</ul>
    <div class="path-label">Skill Gaps</div>
    <ul class="path-list">${d.skill_gaps.map(g=>'<li>'+g+'</li>').join('')}</ul>
    <div class="path-label">Success at 12 months</div>
    <p class="path-p">${d.success_at_12_months}</p>
    <div class="path-label">Long-term trajectory</div>
    <p class="path-p">${d.long_term_trajectory}</p>
  </div>`;
}