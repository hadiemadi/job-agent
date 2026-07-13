let _cvPath = null;
let _cvFileName = null; // set in go() — preserved across steps for resume/savePendingJob
let _jobText   = null; // set in go() — raw job description text, preserved the same way
let _currentJob = null;
let _hrReview = null;
let _tailorStartTime = null; // set in applyChanges(); cleared on each new tailor run
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

// ── Auth modal ─────────────────────────────────────────────────────────────────
// sessionStorage flag: modal shows on fresh sessions but NOT after dismiss within the same tab.
// Using sessionStorage (not a cookie) per build spec — cleared automatically when the tab closes,
// so a brand-new session always sees the modal; a reload in the same tab does not.
const AUTH_MODAL_DISMISSED_KEY = 'jsk_auth_dismissed';

let _authMode = 'login'; // 'login' | 'register'
let _currentUserId = null; // set by showAuthUser(), cleared by logout()

function dismissAuthModal() {
  hide('authModal');
  sessionStorage.setItem(AUTH_MODAL_DISMISSED_KEY, '1');
}

function toggleAuthMode() {
  _authMode = _authMode === 'login' ? 'register' : 'login';
  el('authSubmitBtn').textContent = _authMode === 'login' ? 'Sign in' : 'Create account';
  el('authToggleText').textContent = _authMode === 'login' ? 'No account yet?' : 'Already have one?';
  el('authToggleBtn').textContent = _authMode === 'login' ? 'Create one' : 'Sign in';
  hide('auth-error');
}

function showAuthError(msg) {
  const e = el('auth-error');
  e.textContent = msg;
  show('auth-error');
}

async function submitAuth() {
  const email = (el('auth-email').value || '').trim();
  const password = el('auth-password').value || '';
  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }
  const route = _authMode === 'login' ? '/auth/login' : '/auth/register';
  const btn = el('authSubmitBtn');
  btn.disabled = true;
  btn.textContent = _authMode === 'login' ? 'Signing in…' : 'Creating account…';
  try {
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(data.error || 'Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = _authMode === 'login' ? 'Sign in' : 'Create account';
      return;
    }
    hide('authModal');
    sessionStorage.setItem(AUTH_MODAL_DISMISSED_KEY, '1');
    if (data.user) showAuthUser(data.user);
  } catch (err) {
    showAuthError(err.message);
    btn.disabled = false;
    btn.textContent = _authMode === 'login' ? 'Sign in' : 'Create account';
  }
}

// Show or hide the 3-column layout (Preferences | inputCard | Advanced options).
// Called from showAuthUser (true) and logout (false).
// Side columns and col-center placement are controlled by CSS (.main-layout.three-col rules)
// — do NOT set inline display styles here, they would fight the CSS class and win incorrectly.
function _showThreeCols(on) {
  const mainLayout = el('mainLayout');
  const container = document.querySelector('.container');
  if (mainLayout) mainLayout.classList.toggle('three-col', on);
  if (container) container.classList.toggle('three-col', on);
}

// Populate the header user area without a full page reload — called on successful login/register
// and on page load when the session is already authenticated.
function showAuthUser(user) {
  _currentUserId = user.id;
  const userArea = el('headerUserArea');
  if (userArea) {
    userArea.innerHTML =
      '<span class="header-user-email">' + escapeHtml(user.email) + '</span>' +
      '<button class="link-btn header-logout-btn" onclick="logout()">Sign out</button>';
  }
  // Populate account info in the left column (shown via _showThreeCols below)
  const accountInfo = el('workspaceAccountInfo');
  if (accountInfo) {
    accountInfo.innerHTML =
      '<span class="ws-account-email">' + escapeHtml(user.email) + '</span>';
  }
  updateConsentText(true);
  _showThreeCols(true);
  loadPrefillData();
}

async function logout() {
  _currentUserId = null;
  try { await fetch('/auth/logout', { method: 'POST' }); } catch (e) { /* best-effort */ }
  const userArea = el('headerUserArea');
  if (userArea) {
    userArea.innerHTML =
      '<button class="link-btn header-login-btn" onclick="openAuthModal()">Log in</button>';
  }
  _showThreeCols(false);
  updateConsentText(false);
  sessionStorage.removeItem(AUTH_MODAL_DISMISSED_KEY);
  show('authModal');
}

function openAuthModal() {
  show('authModal');
}

// Switches the consent text in the upload card based on auth state.
// Guest text: accurate — session data auto-deleted after session ends.
// Logged-in text: accurate — saved CVs persist until explicitly deleted; My Data link to view/remove.
function updateConsentText(isLoggedIn) {
  const label = el('privacyLabel');
  if (!label) return;
  if (isLoggedIn) {
    label.innerHTML =
      '<strong>Your CV stays private.</strong> It\'s used only to tailor it to the job you paste below, ' +
      'and is never shared. If you save a CV to your account, it\'s stored until you delete it — ' +
      'you can view or remove your data anytime from ' +
      '<button class="link-btn" onclick="openMyData()" style="font-size:inherit;">My Data</button>.';
  } else {
    label.innerHTML =
      '<strong>Your CV stays private.</strong> It\'s used only to tailor it to the job you paste below, ' +
      'is never shared, and is automatically deleted after your session ends.';
  }
}

// On page load: check auth state via /auth/me, then show modal if session is anonymous.
// Errors (network, server down) fall through to guest mode — the modal shows unless dismissed.
(async function initAuth() {
  try {
    const res = await fetch('/auth/me');
    const data = await res.json();
    if (data && data.user) {
      showAuthUser(data.user);
      return; // already authenticated — no modal needed
    }
  } catch (e) { /* offline or error — treat as guest */ }
  // Guest: show the "Log in" toggle button in the header so there's always a way back.
  const userArea = el('headerUserArea');
  if (userArea) {
    userArea.innerHTML =
      '<button class="link-btn header-login-btn" onclick="openAuthModal()">Log in</button>';
  }
  updateConsentText(false);
  if (!sessionStorage.getItem(AUTH_MODAL_DISMISSED_KEY)) {
    show('authModal');
  }
})();

// ── My Data modal ──────────────────────────────────────────────────────────────

// section is optional: undefined → all sections, 'cv' | 'coach' | 'discipline' → filtered view.
async function openMyData(section) {
  const SECTION_TITLES = { cv: 'Previous CV & Job Info', coach: 'Coach Conversations', discipline: 'Discipline & HR Notes' };
  const modal = el('myDataModal');
  if (modal) {
    const titleEl = modal.querySelector('h2');
    if (titleEl) titleEl.textContent = section ? (SECTION_TITLES[section] || 'My Data') : 'My Data';
  }
  show('myDataModal');
  const content = el('myDataContent');
  content.innerHTML = '<div class="my-data-loading">Loading…</div>';
  try {
    const res = await fetch('/auth/my-data');
    if (!res.ok) {
      content.innerHTML = '<p class="my-data-empty">Could not load your data. Please try again.</p>';
      return;
    }
    const data = await res.json();
    renderMyData(data, section);
  } catch (e) {
    content.innerHTML = '<p class="my-data-empty">Could not load your data. Please try again.</p>';
  }
}

// Opens the My Data modal filtered to the given section — called by workspace panel buttons.
function openSection(section) {
  openMyData(section);
}

function closeMyData() {
  hide('myDataModal');
}

function openAbout() { show('aboutModal'); }
function closeAbout() { hide('aboutModal'); }

// section optional: undefined → all sections, 'cv' | 'coach' | 'discipline' → filtered view.
function renderMyData(data, section) {
  const content = el('myDataContent');
  const fmt = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso || '—'; }
  };

  let html = '';

  // Account — only in full view (no section), it's identity not history
  if (!section) {
    html += '<div class="my-data-section">';
    html += '<div class="my-data-section-title">Account</div>';
    html += '<div class="my-data-row"><span class="my-data-key">Email</span><span>' + escapeHtml(data.account.email || '—') + '</span></div>';
    html += '<div class="my-data-row"><span class="my-data-key">Member since</span><span>' + fmt(data.account.created_at) + '</span></div>';
    html += '</div>';
  }

  // Saved CVs — full view or 'cv' section
  // Shown as a compact table: Job Title | Company | Date | ID (first 8 chars) | Delete
  if (!section || section === 'cv') {
    html += '<div class="my-data-section">';
    html += '<div class="my-data-section-title">Saved CVs <span class="my-data-count">(' + data.savedCvs.length + ')</span></div>';
    if (data.savedCvs.length === 0) {
      html += '<p class="my-data-empty">None yet.</p>';
    } else {
      html += '<div class="my-data-job-scroll">';
      html += '<table class="my-data-job-table">';
      html += '<thead><tr><th>Job Title</th><th>Company</th><th>Date</th><th>ID</th><th></th></tr></thead>';
      html += '<tbody>';
      data.savedCvs.forEach(cv => {
        const raw = (cv.label || '').trim();
        const atIdx = raw.indexOf(' at ');
        const jobTitle = (atIdx === -1 ? raw : raw.slice(0, atIdx)).trim() || '—';
        const company  = (atIdx === -1 ? '—' : raw.slice(atIdx + 4)).trim() || '—';
        const shortId  = (cv.id || '').slice(0, 8);
        html += '<tr id="cv-row-' + escapeHtml(cv.id) + '">';
        html += '<td class="mjt-title">' + escapeHtml(jobTitle) + '</td>';
        html += '<td class="mjt-company">' + escapeHtml(company) + '</td>';
        html += '<td class="mjt-date">' + fmt(cv.created_at) + '</td>';
        html += '<td class="mjt-id" title="' + escapeHtml(cv.id || '') + '">' + escapeHtml(shortId) + '</td>';
        html += '<td><button class="link-btn my-data-delete-btn" onclick="deleteMyCV(\'' + escapeHtml(cv.id) + '\')">Delete</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
  }

  // Career Coach history — full view or 'coach' section
  if (!section || section === 'coach') {
    html += '<div class="my-data-section">';
    html += '<div class="my-data-section-title">Career Coach History <span class="my-data-count">(' + (data.coachMemory.length) + ')</span></div>';
    if (data.coachMemory.length === 0) {
      html += '<p class="my-data-empty">None yet.</p>';
    } else {
      data.coachMemory.forEach(entry => {
        html += '<div class="my-data-history-row">';
        html += '<span class="my-data-topic">' + escapeHtml(entry.gap_topic || '—') + '</span>';
        if (entry.digest_summary) html += '<span class="my-data-digest">' + escapeHtml(entry.digest_summary) + '</span>';
        html += '</div>';
      });
    }
    html += '</div>';
  }

  // HR conversations — full view, 'coach' section, or 'discipline' section
  if (!section || section === 'coach' || section === 'discipline') {
    const hrHistory = (data.conversationHistory || []).filter(e => e.agent === 'hr' || !e.agent);
    html += '<div class="my-data-section">';
    html += '<div class="my-data-section-title">HR Conversations <span class="my-data-count">(' + hrHistory.length + ')</span></div>';
    if (hrHistory.length === 0) {
      html += '<p class="my-data-empty">None yet.</p>';
    } else {
      hrHistory.forEach(entry => {
        html += '<div class="my-data-history-row">';
        if (entry.gap_topic) html += '<span class="my-data-topic">' + escapeHtml(entry.gap_topic) + '</span>';
        if (entry.digest_summary) html += '<span class="my-data-digest">' + escapeHtml(entry.digest_summary) + '</span>';
        html += '</div>';
      });
    }
    html += '</div>';
  }

  // Discipline data — full view or 'discipline' section
  if (!section || section === 'discipline') {
    html += '<div class="my-data-section">';
    html += '<div class="my-data-section-title">Skills &amp; Discipline Data</div>';
    const disciplines = data.disciplines || [];
    if (disciplines.length === 0) {
      html += '<p class="my-data-empty">None yet.</p>';
    } else {
      disciplines.forEach(d => {
        html += '<div class="my-data-discipline-row">';
        html += '<span class="my-data-topic">' + escapeHtml(d.field || '—') + '</span>';
        if (d.updated) html += '<span class="my-data-date"> — updated ' + escapeHtml(d.updated) + '</span>';
        const skills = (d.skills || []).slice(0, 5).map(s => escapeHtml(s.text || '')).filter(Boolean);
        if (skills.length) html += '<div class="my-data-digest">Skills: ' + skills.join(', ') + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';
  }

  content.innerHTML = html;
}

async function deleteMyCV(cvId) {
  if (!confirm('Delete this saved CV? This cannot be undone.')) return;
  try {
    const res = await fetch('/auth/saved-cvs/' + encodeURIComponent(cvId), { method: 'DELETE' });
    if (!res.ok) { alert('Could not delete the CV. Please try again.'); return; }
    const row = el('cv-row-' + cvId);
    if (row) row.remove();
  } catch (e) {
    alert('Could not delete the CV. Please try again.');
  }
}

// ── Model picker + cost estimator (logged-in users only) ──────────────────────

const MODEL_OPTIONS = [
  { id: 'claude-fable-5',   provider: 'Anthropic', label: 'Fable 5',         accuracy: 'Highest accuracy',    speed: 'Slower',   inputPer1M: 10,    outputPer1M: 50   },
  { id: 'claude-opus-4-8',  provider: 'Anthropic', label: 'Opus 4.8',        accuracy: 'High accuracy',       speed: 'Moderate speed', inputPer1M: 5,     outputPer1M: 25   },
  { id: 'claude-sonnet-5',  provider: 'Anthropic', label: 'Sonnet 5',        accuracy: 'Strong accuracy',     speed: 'Balanced speed', inputPer1M: 2,     outputPer1M: 10   },
  { id: 'claude-haiku-4-5', provider: 'Anthropic', label: 'Haiku 4.5',       accuracy: 'Reasonable accuracy', speed: 'Fastest',        inputPer1M: 1,     outputPer1M: 5    },
  { id: 'deepseek-chat',    provider: 'DeepSeek',  label: 'DeepSeek V4 Pro', accuracy: 'Strong accuracy',     speed: 'Balanced speed', inputPer1M: 0.435, outputPer1M: 0.87 },
];

// Fixed pipeline assumptions for cost estimate: 4 pipeline steps (read CV, parse job,
// HR review, tailor), average CV ≈ 1500 tokens, 300 overhead tokens per step, output ≈ 600
// tokens per step. All estimates include a 20% buffer for retries, system prompts, etc.
const _COST_CV_TOKENS = 1500;
const _COST_OVERHEAD_TOKENS = 300;
const _COST_OUTPUT_TOKENS = 600;
const _COST_PIPELINE_STEPS = 4;
const _COST_BUFFER = 1.2;

let _selectedModel = 'deepseek-chat';
let _prefillProfile = null; // profile preferences fetched from DB on login; null for guests/first-time users

function calcTokenEstimate(jobTextLength) {
  const jobTokens = Math.ceil((jobTextLength || 0) / 4);
  const totalInput  = (_COST_CV_TOKENS + jobTokens + _COST_OVERHEAD_TOKENS) * _COST_PIPELINE_STEPS;
  const totalOutput = _COST_OUTPUT_TOKENS * _COST_PIPELINE_STEPS;
  return { totalInput, totalOutput, totalTok: totalInput + totalOutput };
}

function calcCostEstimate(modelId, jobTextLength) {
  const m = MODEL_OPTIONS.find(o => o.id === modelId);
  if (!m) return null;
  const { totalInput, totalOutput } = calcTokenEstimate(jobTextLength);
  const rawCost = (totalInput / 1e6) * m.inputPer1M + (totalOutput / 1e6) * m.outputPer1M;
  return rawCost * _COST_BUFFER;
}

function formatCostEstimate(cost) {
  if (cost === null || cost === undefined) return '';
  if (cost < 0.005) return '< $0.01';
  return '$' + cost.toFixed(2);
}

function _updateModelPickerCurrent() {
  const cur = el('modelPickerCurrent');
  if (!cur) return;
  const m = MODEL_OPTIONS.find(o => o.id === _selectedModel);
  cur.textContent = m ? (m.provider + ' — ' + m.label) : _selectedModel;
}

function toggleAdvOptions() {
  const body = el('advOptionsBody');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  const btn = el('advOptsToggle');
  if (btn) btn.classList.toggle('open', !open);
}

function toggleModelPicker() {
  const opts = el('modelOptions');
  const toggle = el('modelPickerToggle');
  if (!opts) return;
  const open = opts.style.display !== 'none';
  opts.style.display = open ? 'none' : '';
  if (toggle) toggle.classList.toggle('open', !open);
}

function initModelPicker(preferredModel) {
  _selectedModel = preferredModel || 'deepseek-chat';
  const container = el('modelOptions');
  if (!container) return;
  container.innerHTML = MODEL_OPTIONS.map(m => {
    const safeId = m.id.replace(/[^a-zA-Z0-9]/g, '-');
    const isRecommended = m.id === 'deepseek-chat';
    const tag = isRecommended
      ? ' <span class="model-opt-default">Recommended</span>'
      : '';
    return '<div class="model-option' + (m.id === _selectedModel ? ' selected' : '') + '"' +
      ' id="model-opt-' + safeId + '"' +
      ' onclick="selectModel(\'' + m.id + '\')">' +
      '<div class="model-opt-header">' +
        '<span class="model-opt-label">' + escapeHtml(m.provider) + ' — ' + escapeHtml(m.label) + tag + '</span>' +
        '<span class="model-opt-cost" id="cost-' + safeId + '"></span>' +
      '</div>' +
      '<div class="model-opt-scoreboard">' +
        '<span class="sboard-row">🎯 ' + escapeHtml(m.accuracy) + '</span>' +
        '<span class="sboard-row">⚡ ' + escapeHtml(m.speed) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  _updateModelPickerCurrent();
  updateCostEstimate();
}

function updateCostEstimate() {
  const jobText = el('jobText') ? el('jobText').value : '';
  const { totalTok } = calcTokenEstimate(jobText.length);
  const tokLabel = totalTok >= 1000 ? Math.round(totalTok / 1000) + 'k tok' : totalTok + ' tok';
  MODEL_OPTIONS.forEach(m => {
    const safeId = m.id.replace(/[^a-zA-Z0-9]/g, '-');
    const costEl = el('cost-' + safeId);
    if (!costEl) return;
    const cost = calcCostEstimate(m.id, jobText.length);
    costEl.textContent = '~' + tokLabel + ' · ' + formatCostEstimate(cost);
  });
}

async function selectModel(modelId) {
  _selectedModel = modelId;
  document.querySelectorAll('.model-option').forEach(o => o.classList.remove('selected'));
  const safeId = modelId.replace(/[^a-zA-Z0-9]/g, '-');
  const optEl = el('model-opt-' + safeId);
  if (optEl) optEl.classList.add('selected');
  _updateModelPickerCurrent();
  // Collapse the picker after selection
  const opts = el('modelOptions');
  const toggle = el('modelPickerToggle');
  if (opts) opts.style.display = 'none';
  if (toggle) toggle.classList.remove('open');
  try {
    await fetch('/auth/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'preferred_model', value: modelId }),
    });
  } catch (e) { /* best-effort — model is still set in _selectedModel for this session */ }
}

// Applies saved Profile & Preferences data to the contact form fields.
// DB data always wins over CV extraction — called both when the form is shown (overrides
// extracted values) and on mid-session login (updates a visible form immediately).
function applyProfilePrefill(profile) {
  if (!profile) return;
  if (profile.name       !== undefined) {
    el('ci-name').value = profile.name;
    if (el('ld-name')) el('ld-name').value = profile.name;
  }
  if (profile.title      !== undefined) {
    el('ci-title').value = profile.title;
    if (el('ld-title')) el('ld-title').value = profile.title;
  }
  if (profile.email      !== undefined) {
    el('ci-email').value = profile.email;
    if (el('ld-email')) el('ld-email').value = profile.email;
  }
  if (profile.phone      !== undefined) {
    el('ci-phone').value = profile.phone;
    if (el('ld-phone')) el('ld-phone').value = profile.phone;
  }
  if (profile.location   !== undefined) {
    el('ci-location').value = profile.location;
    if (el('ld-location')) el('ld-location').value = profile.location;
  }
  if (profile.linkedin   !== undefined) {
    el('ci-linkedin').value = profile.linkedin;
    if (el('ld-linkedin')) el('ld-linkedin').value = profile.linkedin;
  }
  if (profile.customInstructions !== undefined) {
    el('ci-instructions').value = profile.customInstructions;
    if (el('side-instructions')) el('side-instructions').value = profile.customInstructions;
  }
  if (profile.tone !== undefined) {
    el('ci-tone').value = profile.tone;
    if (el('side-tone')) {
      el('side-tone').value = profile.tone;
      const labels = ['Very neutral','Calm','Balanced','Direct (default)','Very blunt'];
      if (el('side-tone-label')) el('side-tone-label').textContent = labels[profile.tone - 1] || 'Direct (default)';
    }
  }
  if (Array.isArray(profile.gapSeverities)) {
    const gs = profile.gapSeverities;
    if (el('ci-sev-major'))  el('ci-sev-major').checked  = gs.includes('major');
    if (el('ci-sev-mild'))   el('ci-sev-mild').checked   = gs.includes('mild');
    if (el('ci-sev-minor'))  el('ci-sev-minor').checked  = gs.includes('minor');
    if (el('side-sev-major'))  el('side-sev-major').checked  = gs.includes('major');
    if (el('side-sev-mild'))   el('side-sev-mild').checked   = gs.includes('mild');
    if (el('side-sev-minor'))  el('side-sev-minor').checked  = gs.includes('minor');
  }
  if (profile.extensiveSearch !== undefined) {
    if (el('ci-extensive-search'))   el('ci-extensive-search').checked   = !!profile.extensiveSearch;
    if (el('side-extensive-search')) el('side-extensive-search').checked = !!profile.extensiveSearch;
  }
  if (profile.refreshDiscipline !== undefined) {
    if (el('ci-refresh-discipline'))   el('ci-refresh-discipline').checked   = !!profile.refreshDiscipline;
    if (el('side-refresh-discipline')) el('side-refresh-discipline').checked = !!profile.refreshDiscipline;
  }
}

// Loads the user's saved preferences and pre-fills the form for returning users.
// Called by showAuthUser() so it runs after every login (including page-load auth check).
async function loadPrefillData() {
  try {
    const res = await fetch('/auth/prefill');
    if (!res.ok) return;
    const data = await res.json();
    // Pre-fill job text only when the textarea is still empty (don't overwrite something typed)
    if (data.lastJobText && el('jobText') && !el('jobText').value.trim()) {
      el('jobText').value = data.lastJobText;
    }
    initModelPicker(data.preferredModel || 'deepseek-chat');
    // Cache profile preferences for use when the contact form is shown after CV upload.
    // If the form is already visible (mid-session login), apply immediately.
    _prefillProfile = data.profilePreferences || null;
    const card = el('contactCard');
    if (_prefillProfile && card && !card.classList.contains('hidden')) {
      applyProfilePrefill(_prefillProfile);
    }
  } catch (e) { /* best-effort — non-fatal */ }
}

// Re-calculate cost whenever the user edits the job text (logged-in panel shown).
(function wireJobTextCostUpdate() {
  const jt = el('jobText');
  if (jt) jt.addEventListener('input', updateCostEstimate);
})();

// Button gating: all 3 conditions must be met before "Tailor my CV" enables.
// 1. CV file chosen   2. Job description non-empty   3. Consent checkbox ticked
// Called from change/input listeners on each of the three inputs, and once on load.
function updateGoBtnAvailability() {
  const hasFile    = !!(el('cvFile') && el('cvFile').files && el('cvFile').files[0]);
  const hasJob     = !!(el('jobText') && el('jobText').value.trim());
  const hasConsent = !!(el('consentCheck') && el('consentCheck').checked);
  const btn = el('goBtn');
  if (!btn) return;
  const ready = hasFile && hasJob && hasConsent;
  btn.disabled = !ready;
  btn.title = ready ? '' :
    !hasFile    ? 'Upload your CV first.' :
    !hasJob     ? 'Paste the job description first.' :
                  'Tick the consent checkbox first.';
}
el('cvFile').addEventListener('change', updateGoBtnAvailability);
el('jobText').addEventListener('input', updateGoBtnAvailability);
el('consentCheck').addEventListener('change', updateGoBtnAvailability);
updateGoBtnAvailability();

// Wire fixed-position tooltip for .tooltip-anchor elements (tone slider info icon).
// The ::after pseudo-element uses position:fixed with CSS custom props --tt-left/--tt-top
// so it escapes any ancestor's overflow clip and always appears fully visible.
(function wireTooltipAnchors() {
  document.querySelectorAll('.tooltip-anchor').forEach(anchor => {
    anchor.addEventListener('mouseenter', function() {
      const r = this.getBoundingClientRect();
      this.style.setProperty('--tt-left', (r.right + 8) + 'px');
      this.style.setProperty('--tt-top',  (r.top + r.height / 2 - 60) + 'px');
    });
  });
})();

// "Delete my data now" — two paths:
//  • Guest: purges session only (CV text, HR/coach history, generated files).
//  • Logged-in: hard-deletes the user account + all DB rows (saved_cvs, coach_memory,
//    conversation_history, user_preferences — cascade from users row) AND purges session.
async function deleteMyData() {
  if (_currentUserId) {
    if (!confirm('This permanently deletes your account and all saved data — CVs, coaching history, and preferences. This cannot be undone. Continue?')) return;
    try { await fetch('/auth/account', { method: 'DELETE' }); } catch (err) { /* best-effort */ }
  } else {
    if (!confirm('This permanently deletes your uploaded CV, contact info, and any generated files from this session. Continue?')) return;
    try { await fetch('/delete-my-data', { method: 'POST' }); } catch (err) { /* best-effort */ }
  }
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

// The full "Something went wrong" dialog for real failures — technical metadata ONLY:
// code, route, timestamp. Never the candidate's CV text, job description body, name, or
// email — those never reach this function (server only sends back a code + catalog message).
// Feedback is auto-captured on button click — no typing required.
function showTechnicalErrorDialog(data, route) {
  const code = data.error_code;
  const message = data.error || 'Something unexpected went wrong.';
  const timestamp = new Date().toISOString();
  const blobLines = [`error_code: ${code}`, `route: ${route || 'unknown'}`, `timestamp: ${timestamp}`];
  if (data.stage) blobLines.push(`stage: ${data.stage}`);
  if (data.traceId) blobLines.push(`traceId: ${data.traceId}`);
  if (window.APP_VERSION) blobLines.push(`version: ${window.APP_VERSION}`);
  const blob = blobLines.join('\n');

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
        '<div class="err-popup-sent" id="errPopupSent" style="display:none;">Feedback sent — thank you!</div>' +
        '<div class="err-popup-actions">' +
          '<span class="err-popup-copy-status" id="errPopupCopyStatus" style="display:none;">Copied</span>' +
          '<button class="btn btn-ghost btn-sm" id="errPopupCopyBtn" type="button">Copy</button>' +
          '<button class="btn btn-ghost btn-sm" id="errPopupFeedbackBtn" type="button">Send feedback</button>' +
          '<button class="btn btn-blue btn-sm" id="errPopupCloseBtn" type="button">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    el('errPopupCloseBtn').addEventListener('click', () => {
      hide('errPopupOverlay');
      hide('errPopupSent');
    });
    el('errPopupCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el('errPopupBlob').textContent);
        show('errPopupCopyStatus');
        setTimeout(() => hide('errPopupCopyStatus'), 2000);
      } catch (_) { /* clipboard unavailable — blob is still selectable */ }
    });
    // Auto-capture: on click, immediately POST the error context — no form, no typing.
    el('errPopupFeedbackBtn').addEventListener('click', async () => {
      el('errPopupFeedbackBtn').disabled = true;
      try {
        await fetch('/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: el('errPopupCode').textContent,
            route: route || '',
            message: '',
            contact_email: null,
          }),
        });
      } catch (_) { /* fire-and-forget */ }
      show('errPopupSent');
    });
  }

  el('errPopupMessage').textContent = message;
  el('errPopupCode').textContent = code;
  el('errPopupTime').textContent = timestamp;
  el('errPopupBlob').textContent = blob;
  hide('errPopupCopyStatus');
  hide('errPopupSent');
  if (el('errPopupFeedbackBtn')) el('errPopupFeedbackBtn').disabled = false;
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
  // Stage-tagged codes (e.g. ERR-RATE-002-HR) share the same copy as their base
  // code but show the full tag in the caption so the user can report which stage failed.
  const baseCode = (data.error_code || '').match(/^ERR-RATE-\d{3}/)?.[0] || data.error_code;
  const copy = RATE_COPY[data.error_code] || RATE_COPY[baseCode] || { title: 'Slow down', body: data.error, isDaily: false };

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
        '<div class="nudge-code" id="rateCount" style="display:none;"></div>' +
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
  // Show count/limit/window as a small diagnostic caption in TRIAL_MODE when the server
  // includes real numbers (rl_count, rl_limit, rl_window_ms) in the 429 response.
  // Guard against null: if the overlay was created without rateCount (e.g. stale cached DOM),
  // skip silently rather than letting a TypeError propagate into the poll's .catch() handler
  // which would retry the poll instead of showing the error.
  const countEl = el('rateCount');
  if (countEl) {
    if (window.TRIAL_MODE && data.rl_count != null && data.rl_limit != null) {
      const windowSec = data.rl_window_ms != null ? data.rl_window_ms / 1000 : '?';
      countEl.textContent = data.rl_count + ' req / ' + windowSec + 's window · limit: ' + data.rl_limit;
      show('rateCount');
    } else {
      countEl.textContent = '';
      hide('rateCount');
    }
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
      <div class="step-cost" id="sc${i}" style="font-size:0.68rem;opacity:0.55;margin-top:2px;min-height:0;"></div>
    </div>
  `).join('');
}

// ── AI cost/token helpers (Item 8) ────────────────────────────────────────────
function fmtTok(n) { return (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)); }

function formatStageUsage(u) {
  if (!u || (!u.tokIn && !u.tokOut)) return '';
  return '$' + Number(u.usd || 0).toFixed(4) + ' · ' + fmtTok(u.tokIn || 0) + '+' + fmtTok(u.tokOut || 0) + ' tok';
}

function updateElapsedDisplay() {
  if (!_tailorStartTime) return;
  const secs = Math.round((Date.now() - _tailorStartTime) / 1000);
  const elapsed = el('elapsedTracker');
  if (!elapsed) return;
  elapsed.textContent = 'Tailored in ' + secs + 's';
  show('elapsedTracker');
}

function updateCostTracker(u) {
  if (!u) return;
  const body = el('costTrackerBody');
  if (!body) return;
  body.innerHTML =
    '$' + Number(u.usd || 0).toFixed(4) + '<br>' +
    'In: ' + (u.tokIn || 0).toLocaleString() + ' tok<br>' +
    'Out: ' + (u.tokOut || 0).toLocaleString() + ' tok';
  show('costTracker');
  const pc = el('progressCost');
  if (pc) {
    pc.textContent = 'Running total: $' + Number(u.usd || 0).toFixed(4) +
      ' (' + (u.tokIn || 0).toLocaleString() + ' in / ' + (u.tokOut || 0).toLocaleString() + ' out)';
    show('progressCost');
  }
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

  // Kill any leftover poll loop from a previous run before starting fresh.
  stopPolling();

  // Lock in the chosen file + job description as a clean read-only display — they need to
  // stay legible behind the contact-info and progress pop-ups that follow, instead of being
  // buried in a tiny file input and a cramped textarea.
  hide('cvPickerGroup');
  _cvFileName = file.name;
  _jobText    = jobText;
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

  // Step 0: Upload CV — /upload-cv is now async (job-queue). Returns { jobId } immediately;
  // when the job is done the startPolling done-handler shows the contact card.
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
    savePendingJob(upData.jobId, { kind: 'reading_cv', cvFileName: _cvFileName, jobText: _jobText });
    startPolling(upData.jobId, false, 'reading_cv');
  } catch (err) {
    setStep(0,'err', err.message); el('goBtn').disabled=false; show('goBtn');
    show('cvPickerGroup'); hide('fileChosenDisplay'); show('jobTextGroup'); hide('jobDescDisplay');
  }
}

// Hides the prefs/advanced section inside the contact modal when the side panel
// is active (logged-in users), then shows the modal.
function showContactCard() {
  const prefsSectionEl = el('ci-prefs-section');
  if (prefsSectionEl) {
    const sideActive = !!(el('mainLayout') && el('mainLayout').classList.contains('three-col'));
    prefsSectionEl.style.display = sideActive ? 'none' : '';
  }
  show('contactCard');
}

// Saves confirmed contact to server, then continues with job + HR steps
async function confirmContact() {
  // When the 3-column layout is active (logged-in users), read Preferences and Advanced
  // from the side-* elements; otherwise read from the modal ci-* elements.
  const usePanel = !!(el('mainLayout') && el('mainLayout').classList.contains('three-col'));
  const gapSeverities = usePanel
    ? ['major', 'mild', 'minor'].filter(s => el('side-sev-' + s) && el('side-sev-' + s).checked)
    : ['major', 'mild', 'minor'].filter(s => el('ci-sev-' + s).checked);
  const contact = {
    // Logged-in: read contact fields from ld-* (left column box). Guests: ci-* (popup).
    name:     usePanel ? (el('ld-name')     ? el('ld-name').value.trim()     : '') : el('ci-name').value.trim(),
    title:    usePanel ? (el('ld-title')    ? el('ld-title').value.trim()    : '') : el('ci-title').value.trim(),
    email:    usePanel ? (el('ld-email')    ? el('ld-email').value.trim()    : el('ci-email').value.trim()) : el('ci-email').value.trim(),
    phone:    usePanel ? (el('ld-phone')    ? el('ld-phone').value.trim()    : '') : el('ci-phone').value.trim(),
    location: usePanel ? (el('ld-location') ? el('ld-location').value.trim() : '') : el('ci-location').value.trim(),
    linkedin: usePanel ? (el('ld-linkedin') ? el('ld-linkedin').value.trim() : '') : el('ci-linkedin').value.trim(),
    customInstructions: (usePanel ? el('side-instructions') : el('ci-instructions')).value.trim(),
    tone:     parseInt((usePanel && el('side-tone') ? el('side-tone') : el('ci-tone')).value, 10),
    extensiveSearch:   usePanel ? el('side-extensive-search').checked : el('ci-extensive-search').checked,
    refreshDiscipline: usePanel ? el('side-refresh-discipline').checked : el('ci-refresh-discipline').checked,
    testMode: !!(el('side-test-mode') && el('side-test-mode').checked),
    gapSeverities: gapSeverities.length ? gapSeverities : ['major'],
    model: _selectedModel,
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
// /fetch-job is now async (job-queue, kind='parsing_job'). When parsing_job is done,
// startPolling's done-handler automatically cascades to step 2 (HR review).
async function continueToJobAndHR() {
  show('progressCard');

  setStep(1, 'run');
  try {
    const jobTextVal = _jobText || el('jobText').value.trim();
    const res = await fetch('/fetch-job', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jobText: jobTextVal }) });
    const data = await res.json();
    if (data.error) { setStep(1, errorStepState(data.kind), data.error); el('goBtn').disabled=false; show('goBtn'); showErrorPopup(data, '/fetch-job'); return; }
    if (!data.jobId) { setStep(1, 'err', 'Unexpected server response — try again.'); el('goBtn').disabled=false; show('goBtn'); return; }
    savePendingJob(data.jobId, { kind: 'parsing_job', cvFileName: _cvFileName || '', jobText: jobTextVal });
    startPolling(data.jobId, false, 'parsing_job');
  } catch (err) { setStep(1,'err', err.message); el('goBtn').disabled=false; show('goBtn'); }
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
    <ul class="hr-list">${review.strengths.map(s => '<li>' + escapeHtml(s) + '</li>').join('')}</ul>
  ` : '';

  el('autoBlock').innerHTML = (review.auto_changes || []).length ? `
    <div class="changes-section-title">Applied automatically</div>
    <p class="changes-hint">Directly evidenced in your CV — no confirmation needed:</p>
    ${review.auto_changes.map(c => `
      <div class="auto-change">
        <div class="auto-desc">${escapeHtml(c.description)}</div>
        <div class="auto-rationale">${escapeHtml(c.rationale)}</div>
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
        <div class="gap-slogan ${gapDecisionClass(g)}" id="cc-desc-${i}">${escapeHtml(g.description)}${severityTag}</div>
        <div class="confirm-rationale gap-rationale" id="cc-rationale-${i}">${escapeHtml(g.rationale)}</div>
        ${hasDraft ? `
          <div class="gap-hr-advice ${leanClass}">${escapeHtml(hrStatement)}</div>
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
          <button class="btn-mic" id="coach-mic-${i}" onclick="toggleCoachVoice(${i})" title="Voice input" aria-label="Voice input"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
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

// Cancels any scheduled poll timer. Must be called synchronously before any
// async operation (e.g. POST /rewrite) that starts a new poll session, because
// an in-flight poll fetch can complete AFTER startPolling() and set _pollTimer
// again, creating a ghost loop alongside the new one (the stacked-loop bug that
// causes ERR-RATE-002 at the HR-review → Tailor-CV handoff).
function stopPolling() {
  if (_pollTimer !== null) { clearTimeout(_pollTimer); _pollTimer = null; }
}

// UI-only cancel — stops the poll timer and returns the user to the upload screen.
// IMPORTANT: the backend job (reading CV, HR review, tailoring) keeps running to completion
// because there is no AbortController wired to the job queue. This is intentional: aborting
// mid-generation could leave the session in a half-written state (partial cvData, incomplete
// hrThread) and would require complex cleanup. The cost of letting it finish is a few API
// tokens that are simply discarded. If the user re-uploads and starts fresh immediately,
// resetSessionUsage() will zero the counter again.
function cancelProgress() {
  stopPolling();
  clearPendingJob();
  hide('progressCard');
  // Restore the upload form so the user can start a fresh tailoring session
  show('cvPickerGroup');  hide('fileChosenDisplay');
  show('jobTextGroup');   hide('jobDescDisplay');
  const btn = el('goBtn');
  if (btn) { btn.disabled = false; show('goBtn'); }
  setGoStatus('Cancelled. Upload your CV to start a new tailoring.', 'info');
  show('goStatus');
}

// Polls /job/:id/status until done/failed, then branches on kind:
//   'reading_cv'  → shows contact card pre-filled (step 0 done)
//   'parsing_job' → cascades to /review-cv (step 1 done → step 2 starts)
//   'hr_review'   → calls showChanges() (steps 0-2)
//   'cv_tailor'   → calls showComparison() (steps 0-3, default)
// `isResume` is true when picking up a job after a page reload — the resume caller
// (resumePendingJob) sets up the UI before calling startPolling, not here.
function startPolling(jobId, isResume, kind) {
  kind = kind || 'cv_tailor';
  // Belt-and-suspenders guard: cancel any SCHEDULED next-poll timer. stopPolling()
  // should already have been called at the top of every transition function
  // (go, applyChanges, continueToJobAndHR) to prevent ghost loops from in-flight
  // fetches, but this catches anything missed at a transition boundary.
  stopPolling();
  // Each polling session gets its own backoff state — starts at 2 s after the first
  // immediate call, doubles on every non-terminal response, caps at 10 s.
  let backoffMs = POLL_BACKOFF_START_MS;

  if (isResume && kind === 'cv_tailor') {
    show('progressCard');
    buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
    setStep(0, 'ok', ''); setStep(1, 'ok', ''); setStep(2, 'ok', '');
    setStep(3, 'run');
  }
  // reading_cv/parsing_job/hr_review resume: UI already set up by resumePendingJob().

  function poll() {
    // Pass the job kind as ?k= so the rate-limit handler can emit -POLL-HR / -POLL-REWRITE /
    // -POLL-UPLOAD / -POLL-PARSE instead of the generic -POLL tag — helps trace which poll
    // loop is over-firing in Render logs.
    fetch('/job/' + jobId + '/status?k=' + kind)
      .then(r => r.json())
      .then(data => {
        if (data.error && data.status !== 'done' && data.status !== 'failed') {
          clearPendingJob();
          const step = kind === 'reading_cv' ? 0 : kind === 'parsing_job' ? 1 : kind === 'hr_review' ? 2 : 3;
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

        if (kind === 'reading_cv') {
          if (data.status === 'failed' || result.error) {
            const errData = { error: result.error || 'Could not read CV.', error_code: result.code || 'ERR-CV-002', kind: 'error' };
            setStep(0, 'err', errData.error);
            el('goBtn').disabled = false; show('goBtn');
            show('cvPickerGroup'); hide('fileChosenDisplay'); show('jobTextGroup'); hide('jobDescDisplay');
            showErrorPopup(errData, '/upload-cv');
            return;
          }
          // Contact handling: logged-in users skip the popup — their details live in the
          // left-column #yourDetailsCard (ld-* fields). Guests still see the popup.
          setStep(0, 'ok', 'CV ready');
          if (result.stageUsage) { const sc = el('sc0'); if (sc) sc.textContent = formatStageUsage(result.stageUsage); }
          updateCostTracker(data.sessionUsage);
          setTimeout(async () => {
            hide('progressCard');
            const cvData = result.cvData || {};
            const isLoggedIn = !!_currentUserId;
            if (isLoggedIn) {
              // For logged-in users: populate ld-* fields from CV extraction if not yet filled
              // (first-time user with no saved profile). DB profile always wins over extraction.
              const ldName     = el('ld-name');
              const ldTitle    = el('ld-title');
              const ldEmail    = el('ld-email');
              const ldPhone    = el('ld-phone');
              const ldLocation = el('ld-location');
              const ldLinkedin = el('ld-linkedin');
              if (ldName     && !ldName.value.trim())     ldName.value     = cvData.name     || '';
              if (ldTitle    && !ldTitle.value.trim())    ldTitle.value    = cvData.title    || '';
              if (ldEmail    && !ldEmail.value.trim())    ldEmail.value    = cvData.email    || '';
              if (ldPhone    && !ldPhone.value.trim())    ldPhone.value    = cvData.phone    || '';
              if (ldLocation && !ldLocation.value.trim()) ldLocation.value = cvData.location || '';
              if (ldLinkedin && !ldLinkedin.value.trim()) ldLinkedin.value = cvData.linkedin || '';
              // Also keep ci-* email in sync (fallback for confirmContact if ld-email absent)
              if (!el('ci-email').value.trim()) el('ci-email').value = cvData.email || '';
              // Skip popup — proceed directly
              await confirmContact();
            } else {
              // Guest: fill popup fields from CV extraction, apply saved profile, show popup.
              el('ci-name').value     = cvData.name     || '';
              el('ci-title').value    = cvData.title    || '';
              el('ci-email').value    = cvData.email    || '';
              el('ci-phone').value    = cvData.phone    || '';
              el('ci-location').value = cvData.location || '';
              el('ci-linkedin').value = cvData.linkedin || '';
              if (_prefillProfile) applyProfilePrefill(_prefillProfile);
              showContactCard();
            }
          }, 400);
          return;
        }

        if (kind === 'parsing_job') {
          if (data.status === 'failed' || result.error) {
            const errCode = result.code || 'ERR-JOB-007';
            const errKind = (errCode === 'ERR-JOB-004' || errCode === 'ERR-JOB-005') ? 'validation' : (result.kind || 'error');
            const errData = { error: result.error || 'Could not parse job.', error_code: errCode, kind: errKind, loginWall: result.loginWall, scraperDisabled: result.scraperDisabled };
            setStep(1, 'err', errData.error);
            el('goBtn').disabled = false; show('goBtn');
            showErrorPopup(errData, '/fetch-job');
            return;
          }
          if (!result.job) {
            setStep(1, 'err', 'Could not parse job — try again.');
            el('goBtn').disabled = false; show('goBtn');
            return;
          }
          _currentJob = result.job;
          setStep(1, 'ok', (_currentJob.job_title || 'Job') + (_currentJob.employer_name ? ' at ' + _currentJob.employer_name : ''));
          if (result.stageUsage) { const sc = el('sc1'); if (sc) sc.textContent = formatStageUsage(result.stageUsage); }
          updateCostTracker(data.sessionUsage);
          // Cascade: parsing done → kick off HR review (step 2) immediately.
          setStep(2, 'run');
          (async () => {
            try {
              const r2 = await fetch('/review-cv', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ job: _currentJob }) });
              const d2 = await r2.json();
              if (d2.error) { setStep(2, errorStepState(d2.kind), d2.error); el('goBtn').disabled=false; show('goBtn'); showErrorPopup(d2, '/review-cv'); return; }
              if (!d2.jobId) { setStep(2, 'err', 'Unexpected server response — try again.'); el('goBtn').disabled=false; show('goBtn'); return; }
              let savedCvFileName = _cvFileName || '', savedJobText = _jobText || '';
              try { const s = JSON.parse(localStorage.getItem(_pendingJobKey) || '{}'); savedCvFileName = s.cvFileName || savedCvFileName; savedJobText = s.jobText || savedJobText; } catch (e) { /* use module vars */ }
              savePendingJob(d2.jobId, { kind: 'hr_review', cvFileName: savedCvFileName, jobText: savedJobText, currentJob: _currentJob });
              startPolling(d2.jobId, false, 'hr_review');
            } catch (e) { setStep(2, 'err', e.message); el('goBtn').disabled=false; show('goBtn'); }
          })();
          return;
        }

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
          if (result.stageUsage) { const sc = el('sc2'); if (sc) sc.textContent = formatStageUsage(result.stageUsage); }
          updateCostTracker(data.sessionUsage);
          setTimeout(() => { hide('progressCard'); showChanges(result.hrReview); }, 600);
          return;
        }

        // cv_tailor
        if (data.status === 'failed' || result.error) {
          const errData = { error: result.error || 'Tailoring failed.', error_code: result.code || 'ERR-CV-004', kind: 'error', stage: result.stage || null, traceId: result.traceId || null };
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
        if (result.stageUsage) { const sc = el('sc3'); if (sc) sc.textContent = formatStageUsage(result.stageUsage); }
        updateCostTracker(data.sessionUsage);
        updateElapsedDisplay();
        setTimeout(() => { hide('progressCard'); showComparison(_currentJob, result); }, 500);
      })
      .catch(() => {
        _pollTimer = setTimeout(poll, backoffMs);
        backoffMs = Math.min(backoffMs * 2, POLL_BACKOFF_CAP_MS);
      });
  }

  poll();
}

function startTailorTimer() { _tailorStartTime = Date.now(); }

async function applyChanges() {
  startTailorTimer(); // start elapsed timer from "Apply changes" click
  // Stop any running poll loop (e.g. hr_review) BEFORE the async POST to /rewrite.
  // An in-flight poll fetch can set _pollTimer after startPolling('cv_tailor') runs,
  // which would create a ghost loop alongside the cv_tailor loop and double the
  // request rate into the rate-limit guard (ERR-RATE-002).
  stopPolling();
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

    // Shared display setup used by reading_cv, parsing_job, and hr_review resumes.
    function restoreDisplayForResume() {
      hide('cvPickerGroup');
      el('fileChosenDisplay').innerHTML = '<span class="fc-icon">📄</span><span class="fc-name">' + escapeHtml(cvFileName || 'CV') + '</span>';
      show('fileChosenDisplay');
      if (jobText) {
        hide('jobTextGroup');
        el('jobDescDisplay').innerHTML = renderJobDescriptionHtml(jobText);
        show('jobDescDisplay');
      }
      // Restore module vars so downstream savePendingJob calls have the right values.
      if (cvFileName) _cvFileName = cvFileName;
      if (jobText)    _jobText    = jobText;
      hide('goBtn');
    }

    if (kind === 'reading_cv') {
      restoreDisplayForResume();
      show('progressCard');
      buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
      setStep(0, 'run');
      startPolling(jobId, true, 'reading_cv');
    } else if (kind === 'parsing_job') {
      restoreDisplayForResume();
      show('progressCard');
      buildSteps(['Reading CV', 'Parsing job', 'HR Review', 'Tailor CV']);
      setStep(0, 'ok', '');
      setStep(1, 'run');
      startPolling(jobId, true, 'parsing_job');
    } else if (kind === 'hr_review') {
      restoreDisplayForResume();
      if (currentJob) _currentJob = currentJob;
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
        <div class="role-title">${escapeHtml(r.title)}</div>
        <div class="role-row"><strong>Why you fit:</strong> ${escapeHtml(r.why_fit)}</div>
        <div class="role-row"><strong>Why now:</strong> ${escapeHtml(r.why_next_step)}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="pth-${i}" data-title="${escapeHtml(r.title)}" onclick="getCareerPath(this.dataset.title,${i})">Career path →</button>
        <div id="pp-${i}"></div>
      </div>
    `).join('')}
    ${data.marketMatches.length ? `
      <div class="coach-section-title">Best available jobs for your next step</div>
      ${data.marketMatches.map(m=>`
        <div class="role-card">
          <div class="role-title">${escapeHtml(m.job_title)} · <span style="font-weight:400;color:#888">${escapeHtml(m.company||'')}</span></div>
          <div class="role-row"><strong>Why it fits:</strong> ${escapeHtml(m.why_it_fits)}</div>
          <div class="role-row"><strong>Stepping stone to:</strong> ${escapeHtml(m.stepping_stone_to)}</div>
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
    <ul class="path-list">${d.key_challenges.map(c=>'<li>'+escapeHtml(c)+'</li>').join('')}</ul>
    <div class="path-label">Skill Gaps</div>
    <ul class="path-list">${d.skill_gaps.map(g=>'<li>'+escapeHtml(g)+'</li>').join('')}</ul>
    <div class="path-label">Success at 12 months</div>
    <p class="path-p">${escapeHtml(d.success_at_12_months)}</p>
    <div class="path-label">Long-term trajectory</div>
    <p class="path-p">${escapeHtml(d.long_term_trajectory)}</p>
  </div>`;
}

// Voice-to-text for Career Coach chat panels (Web Speech API).
// Mic buttons are hidden by the CSS default (.btn-mic { display:none }). When the browser
// supports SpeechRecognition, index.html's inline script adds .voice-supported to <body>,
// activating .voice-supported .btn-mic { display:inline-flex }. No inline style needed.
(function initCoachVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  let activeRec = null;
  let activeIdx = null;

  window.toggleCoachVoice = function toggleCoachVoice(i) {
    if (activeIdx === i && activeRec) { activeRec.stop(); return; }
    if (activeRec) activeRec.stop();

    const textarea = document.getElementById('chat-input-' + i);
    const btn      = document.getElementById('coach-mic-' + i);
    if (!textarea || !btn) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    activeRec = rec;
    activeIdx = i;

    rec.onstart = () => { btn.classList.add('recording'); btn.setAttribute('aria-label', 'Recording — click to stop'); };
    rec.onresult = e => { textarea.value = Array.from(e.results).map(r => r[0].transcript).join(''); };
    rec.onerror = e => {
      btn.classList.remove('recording');
      btn.setAttribute('aria-label', 'Voice input');
      const status = document.getElementById('chat-status-' + i);
      if (status) {
        status.textContent = e.error === 'not-allowed' ? 'Mic access denied.' : 'No speech detected.';
        status.style.display = '';
        clearTimeout(status._micT);
        status._micT = setTimeout(() => { status.style.display = 'none'; status.textContent = ''; }, 3000);
      }
      activeRec = null; activeIdx = null;
    };
    rec.onend = () => {
      btn.classList.remove('recording');
      btn.setAttribute('aria-label', 'Voice input');
      if (activeRec === rec) { activeRec = null; activeIdx = null; }
    };
    rec.start();
  };
}());