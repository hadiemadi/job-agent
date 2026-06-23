let _cvPath = null;
let _currentJob = null;
let _hrReview = null;
let _selectedDir = null;
// One entry per rendered gap card (services/gapStore.js's lifecycle: open -> [discussing] ->
// proposed -> accepted|declined) — {id, description, rationale, severity, status,
// proposedStatement}. Set fresh by showChanges() on every /review-cv response, then mutated
// locally as askHR()/decideGap() succeed, so the card can re-render from local state without
// a full re-fetch.
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
      setStep(0,'err', upData.error); el('goBtn').disabled=false; show('goBtn');
      show('cvPickerGroup'); hide('fileChosenDisplay'); show('jobTextGroup'); hide('jobDescDisplay');
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
    await fetch('/confirm-contact', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(contact)
    });
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

  // Step 1: Parse pasted job description
  setStep(1, 'run');
  try {
    const res = await fetch('/fetch-job', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jobText }) });
    const data = await res.json();
    if (data.error || !data.job) { setStep(1,'err', data.error || 'Could not parse job'); el('goBtn').disabled=false; show('goBtn'); return; }
    _currentJob = data.job;
    setStep(1, 'ok', (data.job.job_title || 'Job') + (data.job.employer_name ? ' at ' + data.job.employer_name : ''));
  } catch (err) { setStep(1,'err', err.message); el('goBtn').disabled=false; show('goBtn'); return; }

  // Step 2: HR Review
  setStep(2, 'run');
  try {
    const res = await fetch('/review-cv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job: _currentJob }) });
    const data = await res.json();
    if (data.error) { setStep(2,'err', data.error); el('goBtn').disabled=false; show('goBtn'); return; }
    _hrReview = data;
    setStep(2, 'ok', (data.overall_match || 'Moderate') + ' match');
    await new Promise(r => setTimeout(r, 600));
    hide('progressCard');
    showChanges(data);
  } catch (err) { setStep(2,'err', err.message); el('goBtn').disabled=false; show('goBtn'); return; }

  el('goBtn').disabled = false;
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

  _gaps = (review.confirm_changes || []).map(c => ({ ...c }));

  el('confirmBlock').innerHTML = _gaps.length ? `
    <div class="changes-section-title">Your input needed</div>
    <p class="changes-hint">These go beyond your current CV — discuss with your coach (optional), ask HR to draft a sentence, or skip:</p>
    ${_gaps.map((g, i) => renderGapCard(i)).join('')}
  ` : '';

  show('changesCard');
  el('changesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Renders ONE gap card from its current lifecycle status (services/gapStore.js: open ->
// [discussing] -> proposed -> accepted|declined). open and discussing render identically
// (discussion is optional — it doesn't gate anything) and include the chat panel; proposed
// shows the HR-drafted sentence with Accept/Decline; accepted/declined are terminal, read-only.
function renderGapCard(i) {
  const g = _gaps[i];
  const severityTag = g.severity ? ` <span class="gap-severity ${g.severity}">${g.severity}</span>` : '';

  if (g.status === 'accepted' || g.status === 'declined') {
    return `
      <div class="confirm-change resolved ${g.status}" id="cc-${i}">
        <div class="confirm-change-text">
          <div class="confirm-desc">${g.status === 'accepted' ? g.proposedStatement : g.description}${severityTag}</div>
          <div class="confirm-rationale">${g.status === 'accepted' ? 'Added to your CV.' : 'Declined — not added.'}</div>
        </div>
      </div>`;
  }

  if (g.status === 'proposed') {
    return `
      <div class="confirm-change proposed" id="cc-${i}">
        <div class="confirm-change-text">
          <div class="confirm-desc">${severityTag}
            <div style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#185FA5;margin-top:4px;">HR proposed this sentence for your CV</div>
          </div>
          <div class="confirm-rationale" style="color:#2C2C2A;font-weight:500;">${g.proposedStatement}</div>
        </div>
        <div class="confirm-btns">
          <button class="btn btn-ghost btn-sm" onclick="decideGap(${i}, 'accept', this)">Accept</button>
          <button class="btn btn-sm" style="background:#f5f5f5;color:#888;" onclick="decideGap(${i}, 'decline', this)">Decline</button>
        </div>
      </div>`;
  }

  // 'open' or 'discussing' — coach discussion is optional, so "Ask HR to draft a sentence" is
  // always available; Discuss is just one path toward it, not a prerequisite.
  return `
    <div class="confirm-change" id="cc-${i}">
      <div class="confirm-change-text">
        <div class="confirm-desc" id="cc-desc-${i}">${g.description}${severityTag}</div>
        <div class="confirm-rationale" id="cc-rationale-${i}">${g.rationale}</div>
      </div>
      <div class="confirm-btns">
        <button class="btn btn-sm" style="background:#185FA5;color:white;" onclick="askHR(${i}, this)">Ask HR to draft a sentence →</button>
        <button class="btn btn-sm" style="background:#2C2C2A;color:white;" onclick="toggleDiscuss(${i})">Discuss with coach first →</button>
        <button class="btn btn-sm" style="background:#f5f5f5;color:#888;" onclick="decideGap(${i}, 'decline', this)">Skip</button>
      </div>
    </div>
    <div class="chat-panel" id="chat-${i}" style="display:none;">
      <div class="chat-messages" id="chat-msgs-${i}"></div>
      <div class="chat-input-row">
        <textarea class="chat-input" id="chat-input-${i}" placeholder="Talk to your Career Coach…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat(${i});}"></textarea>
        <button class="btn btn-blue btn-sm" onclick="sendChat(${i})">Send</button>
      </div>
      <div id="chat-status-${i}" class="info-msg" style="display:none;margin-top:6px;"></div>
    </div>`;
}

// Re-renders one card in place after a state-changing action (askHR success, decideGap). The
// chat panel (only present for open/discussing) is removed first since proposed/terminal
// renders don't include one — re-opening it later, if ever, starts a fresh transcript view.
function reRenderGapCard(i) {
  const chatPanel = el('chat-' + i);
  if (chatPanel) chatPanel.remove();
  const card = el('cc-' + i);
  if (card) card.outerHTML = renderGapCard(i);
}

// Accept/Decline (proposed) and Skip (open/discussing, the "early decline" path) all go
// through this one action — services/gapStore.js's acceptGap/declineGap are the only things
// that ever move a gap to a terminal status, and /rewrite trusts that server state directly.
async function decideGap(i, action, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/gap-decision', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ gapId: _gaps[i].id, action }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not update this gap.'); if (btn) btn.disabled = false; return; }
    _gaps[i].status = data.status;
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
  if (opening && !_cardChats[i]) {
    _cardChats[i] = [];
    const desc = el('cc-desc-' + i).textContent;
    appendBubble(i, 'coach', `Let's talk about this: "${desc}" — have you done anything similar, even if it wasn't your official role or main responsibility?`);
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
    }
  } catch (err) {
    el('chat-status-' + i).textContent = err.message;
  }
}

// Asks HR to draft ONE concrete CV-ready sentence for this gap — available directly from
// open/discussing, with or without a coach discussion first (discussion is optional). On
// success the gap moves to 'proposed' and the card re-renders showing the sentence with
// Accept/Decline.
async function askHR(i, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'HR is drafting…'; }
  try {
    const res = await fetch('/hr/refine', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ gapId: _gaps[i].id })
    });
    const data = await res.json();
    if (!res.ok || !data.proposedStatement) {
      if (btn) { btn.disabled = false; btn.textContent = 'Ask HR to draft a sentence →'; }
      const statusEl = el('chat-status-' + i);
      if (statusEl) { statusEl.textContent = data.error || 'HR did not return a draft — try again.'; show('chat-status-' + i); }
      else alert(data.error || 'HR did not return a draft — try again.');
      return;
    }
    _gaps[i].status = data.status;
    _gaps[i].proposedStatement = data.proposedStatement;
    reRenderGapCard(i);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Ask HR to draft a sentence →'; }
    alert(err.message);
  }
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
    if (data.error) { setStep(3,'err', data.error); el('applyBtn').disabled=false; show('changesCard'); return; }
    if (!data.filePath) {
      setStep(3,'err', 'Server returned an unexpected response — check the server terminal for errors.');
      el('applyBtn').disabled=false; show('changesCard'); return;
    }
    setStep(3, 'ok', 'CV tailored');
    await new Promise(r => setTimeout(r, 500));
    hide('progressCard');
    showComparison(_currentJob, data);
  } catch (err) {
    setStep(3,'err', err.message);
    el('applyBtn').disabled = false;
    show('changesCard');
  }
}

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
    if (!data.comparisonPath) throw new Error(data.error || 'Failed to build comparison');
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

  if (data.error) { el('coachStatus').textContent = data.error; el('coachStatus').className='err-msg'; show('coachStatus'); return; }

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
  if (d.error) { panel.innerHTML='<p class="err-msg">'+d.error+'</p>'; return; }
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