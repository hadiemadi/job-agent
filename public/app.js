let _cvPath = null;
let _currentJob = null;
let _hrReview = null;
let _selectedDir = null;

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
    gapSeverities: gapSeverities.length ? gapSeverities : ['major', 'mild', 'minor'],
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

  el('confirmBlock').innerHTML = (review.confirm_changes || []).length ? `
    <div class="changes-section-title">Your input needed</div>
    <p class="changes-hint">These go beyond your current CV — discuss with your coach or accept/skip directly:</p>
    ${review.confirm_changes.map((c, i) => `
      <div class="confirm-change" id="cc-${i}">
        <div class="confirm-change-text">
          <div class="confirm-desc" id="cc-desc-${i}">${c.description}${c.severity ? ` <span class="gap-severity ${c.severity}">${c.severity}</span>` : ''}</div>
          <div class="confirm-rationale" id="cc-rationale-${i}">${c.rationale}</div>
        </div>
        <div class="confirm-btns">
          <button class="btn btn-ghost btn-sm" id="cc-yes-${i}" onclick="confirmChange(${i}, true)">Accept</button>
          <button class="btn btn-sm" style="background:#f5f5f5;color:#888;" id="cc-no-${i}" onclick="confirmChange(${i}, false)">Skip</button>
          <button class="btn btn-sm" style="background:#2C2C2A;color:white;" onclick="toggleDiscuss(${i})">Discuss →</button>
        </div>
      </div>
      <div class="chat-panel" id="chat-${i}" style="display:none;">
        <div class="chat-messages" id="chat-msgs-${i}"></div>
        <div class="chat-input-row">
          <textarea class="chat-input" id="chat-input-${i}" placeholder="Talk to your Career Coach…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat(${i});}"></textarea>
          <button class="btn btn-blue btn-sm" onclick="sendChat(${i})">Send</button>
        </div>
        <div class="chat-footer">
          <button class="btn btn-sm" id="hr-refine-btn-${i}" style="background:#185FA5;color:white;display:none;" onclick="askHR(${i})">Ask HR to update suggestion →</button>
        </div>
        <div id="chat-status-${i}" class="info-msg" style="display:none;margin-top:6px;"></div>
      </div>
    `).join('')}
  ` : '';

  show('changesCard');
  el('changesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function confirmChange(i, accept) {
  const card = el('cc-' + i);
  card.classList.toggle('accepted', accept);
  card.classList.toggle('skipped', !accept);
  el('cc-yes-' + i).style.cssText = accept ? 'background:#1A7A3C;color:white;' : '';
  el('cc-no-' + i).style.cssText = !accept ? 'background:#888;color:white;' : 'background:#f5f5f5;color:#888;';
  el('chat-' + i).style.display = 'none';
}

// ── Coach & HR chat (per confirm-change card) ─────────────────────────────────

const _cardChats = {};
const _refinedChanges = {};

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
      body: JSON.stringify({ message: text, gapIndex: i })
    });
    const data = await res.json();
    hide('chat-status-' + i);
    if (data.reply) {
      _cardChats[i].push({ role: 'assistant', content: data.reply });
      appendBubble(i, 'coach', data.reply);
      el('hr-refine-btn-' + i).style.display = '';
    }
  } catch (err) {
    el('chat-status-' + i).textContent = err.message;
  }
}

async function askHR(i) {
  const btn = el('hr-refine-btn-' + i);
  btn.disabled = true; btn.textContent = 'HR is reviewing…';
  try {
    const res = await fetch('/hr/refine', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ gapIndex: i, conversation: _cardChats[i] || [] })
    });
    const data = await res.json();
    btn.disabled = false; btn.textContent = 'Ask HR to update suggestion →';
    if (data.refined_description) {
      _refinedChanges[i] = { refined_description: data.refined_description, rationale: data.rationale, verdict: data.verdict };
      const originalDesc = el('cc-desc-' + i).textContent;
      el('chat-' + i).style.display = 'none';
      el('cc-desc-' + i).innerHTML = `
        <div style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#888;margin-bottom:4px;">Original</div>
        <div style="color:#999;text-decoration:line-through;margin-bottom:10px;">${originalDesc}</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#185FA5;margin-bottom:4px;">HR updated</div>
        <div style="color:#2C2C2A;font-weight:500;">${data.refined_description}</div>
      `;
      el('cc-rationale-' + i).textContent = data.rationale;
      el('cc-yes-' + i).style.cssText = '';
      el('cc-no-' + i).style.cssText = 'background:#f5f5f5;color:#888;';
      el('cc-' + i).classList.remove('accepted', 'skipped');
    } else {
      el('chat-' + i).style.display = '';
      el('chat-status-' + i).textContent = data.error || 'HR did not return an update — try discussing again.';
      show('chat-status-' + i);
    }
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Ask HR to update suggestion →';
    el('chat-status-' + i).textContent = err.message;
    show('chat-status-' + i);
  }
}

async function applyChanges() {
  el('applyBtn').disabled = true;
  hide('changesCard');
  show('progressCard');
  setStep(3, 'run');

  const confirmedChanges = (_hrReview.confirm_changes || []).filter((c, i) => {
    const card = el('cc-' + i);
    return card && card.classList.contains('accepted');
  });

  // One entry per gap the HR review raised, carrying the coach conversation (if discussed)
  // and the final outcome — lets the tailored CV page's HR sidebar open with an accurate
  // "what we discussed and what happened" summary instead of just the applied change list.
  const gapDiscussions = (_hrReview.confirm_changes || []).map((c, i) => {
    const card = el('cc-' + i);
    const status = card && card.classList.contains('accepted') ? 'accepted'
      : card && card.classList.contains('skipped') ? 'skipped' : 'undecided';
    const refined = _refinedChanges[i];
    return {
      description: c.description,
      rationale: c.rationale,
      status,
      coachConversation: _cardChats[i] || [],
      refinedDescription: refined ? refined.refined_description : null,
      verdict: refined ? refined.verdict : null,
    };
  });

  try {
    const res = await fetch('/rewrite', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ job: _currentJob, cvPath: _cvPath, autoChanges: _hrReview.auto_changes || [], confirmedChanges, gapDiscussions })
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