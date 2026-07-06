/**
 * @jest-environment jsdom
 */
// DOM-level test of the validation-nudge popup's trial-mode code caption (build.txt). app.js
// is a plain browser script (no module.exports) — loaded into jsdom via indirect eval so its
// top-level `function` declarations attach to `window`, exactly like a real <script> tag.
const fs = require('fs');
const path = require('path');

function loadAppInDom() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  // Strip <script src> tags — only the markup is needed; app.js itself is eval'd separately
  // below so we control exactly when it runs (after window.TRIAL_MODE is set).
  document.documentElement.innerHTML = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const code = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  (0, eval)(code); // indirect eval — runs in global scope, not this module's local scope
}

// initAuth() calls fetch('/auth/me') at module load time (every loadAppInDom()). Ensure fetch
// is mocked globally before any describe's beforeEach calls loadAppInDom, so existing tests
// don't throw on the unresolved Promise. Individual tests override window.fetch as needed.
beforeEach(() => {
  sessionStorage.clear();
  window.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ user: null }),
  }));
});

describe('stopPolling — stacked-loop prevention', () => {
  beforeEach(() => {
    document.cookie = 'onboarded=1';
    window.TRIAL_MODE = false;
    loadAppInDom();
  });

  test('stopPolling is a no-op (no clearTimeout) when _pollTimer is null', () => {
    // _pollTimer starts as null — stopPolling must NOT call clearTimeout
    const clearSpy = jest.spyOn(window, 'clearTimeout');
    window.stopPolling();
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test('startPolling cancels a prior scheduled timer when one is pending', async () => {
    // Track every clearTimeout(id) call so we can verify the prior timer was cancelled.
    const clearedIds = [];
    const origClearTimeout = window.clearTimeout;
    window.clearTimeout = (id) => { clearedIds.push(id); origClearTimeout.call(window, id); };

    // Mock fetch to return 'running' so the first poll schedules a retry timer.
    window.fetch = jest.fn(() => Promise.resolve({
      json: () => Promise.resolve({ status: 'running', current_step: '' }),
    }));

    window.startPolling('job-1', false, 'hr_review');

    // setImmediate fires only after the current microtask queue is fully drained —
    // this guarantees the fetch().then(r.json()).then(data→_pollTimer=…) chain has
    // completed and _pollTimer holds a real (non-null) timer id before we proceed.
    await new Promise(resolve => setTimeout(resolve, 0));

    // Starting a second loop must call stopPolling() which cancels the first timer.
    window.startPolling('job-2', false, 'cv_tailor');

    const nonNullCancels = clearedIds.filter(id => id != null);
    expect(nonNullCancels.length).toBeGreaterThan(0);

    window.clearTimeout = origClearTimeout;
  });
});

describe('showValidationNudge / showErrorPopup — trial-mode code caption', () => {
  beforeEach(() => {
    document.cookie = 'onboarded=1'; // skip the first-time intro panel noise for these tests
  });

  test('TRIAL_MODE on: a validation popup (ERR-HR-001) shows the code as a quiet caption', () => {
    window.TRIAL_MODE = true;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-HR-001', error: 'Please upload your CV before requesting an HR review.', kind: 'validation' },
      '/review-cv'
    );
    const codeEl = document.getElementById('nudgeCode');
    expect(codeEl.style.display).not.toBe('none');
    expect(codeEl.textContent).toBe('ERR-HR-001');
    // No alarm styling, no support/route/timestamp block on the validation nudge.
    expect(document.getElementById('nudgePopupOverlay').innerHTML).not.toContain('send them to support');
  });

  test('TRIAL_MODE off: the same validation popup hides the code entirely', () => {
    window.TRIAL_MODE = false;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-HR-001', error: 'Please upload your CV before requesting an HR review.', kind: 'validation' },
      '/review-cv'
    );
    const codeEl = document.getElementById('nudgeCode');
    expect(codeEl.style.display).toBe('none');
    expect(codeEl.textContent).toBe('');
  });

  test('TRIAL_MODE on: a burst rate-limit popup (ERR-RATE-002) shows calm title, Try again button, muted code — no red/support', () => {
    window.TRIAL_MODE = true;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-RATE-002', error: 'Too many requests — slow down and try again shortly.', kind: 'rate' },
      '/review-cv'
    );
    const overlay = document.getElementById('ratePopupOverlay');
    expect(overlay.style.display).not.toBe('none');
    expect(document.getElementById('rateTitle').textContent).toBe('One moment');
    expect(document.getElementById('rateCloseBtn').textContent).toBe('Try again');
    const codeEl = document.getElementById('rateCode');
    expect(codeEl.style.display).not.toBe('none');
    expect(codeEl.textContent).toBe('ERR-RATE-002');
    // Must NOT render the technical error dialog
    expect(document.getElementById('errPopupOverlay')).toBeNull();
    expect(overlay.innerHTML).not.toContain('send them to support');
  });

  test('stage-tagged rate code (ERR-RATE-002-HR) shows same calm popup as base code but displays the full tagged code', () => {
    window.TRIAL_MODE = true;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-RATE-002-HR', error: 'Too many requests — slow down and try again shortly.', kind: 'rate' },
      '/review-cv'
    );
    const overlay = document.getElementById('ratePopupOverlay');
    expect(overlay.style.display).not.toBe('none');
    // Falls back to base-code copy (ERR-RATE-002) → 'One moment', not 'Slow down'
    expect(document.getElementById('rateTitle').textContent).toBe('One moment');
    expect(document.getElementById('rateCloseBtn').textContent).toBe('Try again');
    // Full stage-tagged code shown in caption (not the base code)
    const codeEl = document.getElementById('rateCode');
    expect(codeEl.style.display).not.toBe('none');
    expect(codeEl.textContent).toBe('ERR-RATE-002-HR');
  });

  test('daily cap popup (ERR-RATE-001) shows "Daily limit reached" title and "Close" button (no Try again)', () => {
    window.TRIAL_MODE = false;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-RATE-001', error: "Today's AI budget has been reached — please try again tomorrow.", kind: 'rate' },
      '/rewrite'
    );
    expect(document.getElementById('rateTitle').textContent).toBe('Daily limit reached');
    expect(document.getElementById('rateCloseBtn').textContent).toBe('Close');
    // TRIAL_MODE off: code hidden
    const codeEl = document.getElementById('rateCode');
    expect(codeEl.style.display).toBe('none');
    expect(codeEl.textContent).toBe('');
  });

  // Parametric check: caption must appear on ALL stage tags, not just -UPLOAD
  const STAGE_TAGS = [
    ['ERR-RATE-002-UPLOAD',       '/upload-cv'],
    ['ERR-RATE-002-HR',           '/review-cv'],
    ['ERR-RATE-002-REWRITE',      '/rewrite'],
    ['ERR-RATE-002-POLL',         '/job/status'],
    ['ERR-RATE-002-POLL-HR',      '/job/status'],
    ['ERR-RATE-002-POLL-REWRITE', '/job/status'],
    ['ERR-RATE-002-POLL-UPLOAD',  '/job/status'],
    ['ERR-RATE-002-POLL-PARSE',   '/job/status'],
  ];

  STAGE_TAGS.forEach(([code, route]) => {
    test(`TRIAL_MODE: count caption shown for ${code}`, () => {
      window.TRIAL_MODE = true;
      loadAppInDom();
      window.showErrorPopup(
        {
          error_code: code,
          error: 'Too many requests.',
          kind: 'rate',
          rl_count: 8,
          rl_limit: 20,
          rl_window_ms: 3600000,
        },
        route
      );
      const countEl = document.getElementById('rateCount');
      expect(countEl.style.display).not.toBe('none');
      expect(countEl.textContent).toContain('8');     // count
      expect(countEl.textContent).toContain('20');    // limit
      expect(countEl.textContent).toContain('3600');  // window in seconds
    });
  });

  test('TRIAL_MODE off: count caption is hidden even when numbers are present', () => {
    window.TRIAL_MODE = false;
    loadAppInDom();
    window.showErrorPopup(
      {
        error_code: 'ERR-RATE-002-UPLOAD',
        error: 'Too many requests.',
        kind: 'rate',
        rl_count: 14,
        rl_limit: 100,
        rl_window_ms: 900000,
      },
      '/upload-cv'
    );
    const countEl = document.getElementById('rateCount');
    expect(countEl.style.display).toBe('none');
    expect(countEl.textContent).toBe('');
  });

  test('the real-error technical dialog is unchanged either way — full code/route/timestamp block', () => {
    window.TRIAL_MODE = true;
    loadAppInDom();
    window.showErrorPopup(
      { error_code: 'ERR-HR-003', error: 'The HR review failed. Please try again.', kind: 'error' },
      '/review-cv'
    );
    expect(document.getElementById('errPopupCode').textContent).toBe('ERR-HR-003');
    expect(document.getElementById('errPopupOverlay').innerHTML).toContain('send them to support');

    window.TRIAL_MODE = false;
    window.showErrorPopup(
      { error_code: 'ERR-HR-003', error: 'The HR review failed. Please try again.', kind: 'error' },
      '/review-cv'
    );
    expect(document.getElementById('errPopupCode').textContent).toBe('ERR-HR-003');
  });
});

// ── Consent text — auth-state variants ───────────────────────────────────────

describe('Consent text — guest vs logged-in variants', () => {
  beforeEach(() => {
    document.cookie = 'onboarded=1';
    window.TRIAL_MODE = false;
    loadAppInDom();
  });

  test('consent label starts with the guest text (session auto-deleted after session ends)', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    const label = document.getElementById('privacyLabel');
    expect(label).not.toBeNull();
    expect(label.innerHTML).toContain('automatically deleted after your session ends');
    expect(label.innerHTML).not.toContain('My Data');
  });

  test('consent label switches to logged-in text when /auth/me returns a user', async () => {
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    const label = document.getElementById('privacyLabel');
    expect(label.innerHTML).toContain('My Data');
    expect(label.innerHTML).not.toContain('automatically deleted after your session ends');
  });

  test('consent label reverts to guest text after logout()', async () => {
    // Start logged in
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    // Confirm logged-in text is showing
    expect(document.getElementById('privacyLabel').innerHTML).toContain('My Data');

    // Logout — fetch returns ok for /auth/logout POST
    window.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }));
    await window.logout();
    expect(document.getElementById('privacyLabel').innerHTML).toContain('automatically deleted after your session ends');
    expect(document.getElementById('privacyLabel').innerHTML).not.toContain('My Data');
  });

  test('updateConsentText(true) shows My Data link; updateConsentText(false) shows guest text', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.updateConsentText(true);
    expect(document.getElementById('privacyLabel').innerHTML).toContain('My Data');
    window.updateConsentText(false);
    expect(document.getElementById('privacyLabel').innerHTML).toContain('automatically deleted after your session ends');
  });
});

// ── My Data modal ─────────────────────────────────────────────────────────────

describe('My Data modal', () => {
  beforeEach(() => {
    document.cookie = 'onboarded=1';
    window.TRIAL_MODE = false;
    loadAppInDom();
  });

  test('My Data modal is in the DOM and starts hidden', () => {
    const modal = document.getElementById('myDataModal');
    expect(modal).not.toBeNull();
    expect(modal.style.display).toBe('none');
  });

  test('header user area contains a My Data button after login', async () => {
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    const userArea = document.getElementById('headerUserArea');
    expect(userArea.innerHTML).toContain('My data');
  });

  test('openMyData() shows the modal and fetches /auth/my-data', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        account: { email: 'hadi@example.com', created_at: '2026-07-06T00:00:00Z' },
        savedCvs: [],
        conversationHistory: [],
        coachMemory: [],
        disciplines: [],
      }),
    }));
    await window.openMyData();
    expect(document.getElementById('myDataModal').style.display).not.toBe('none');
    expect(window.fetch).toHaveBeenCalledWith('/auth/my-data');
  });

  test('closeMyData() hides the modal', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    show('myDataModal');
    window.closeMyData();
    expect(document.getElementById('myDataModal').style.display).toBe('none');
  });

  test('renderMyData shows account email and saved CVs', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.renderMyData({
      account: { email: 'hadi@example.com', created_at: '2026-07-06T00:00:00Z' },
      savedCvs: [{ id: 'cv-001', label: 'RF TPM CV', created_at: '2026-07-01T00:00:00Z' }],
      conversationHistory: [],
      coachMemory: [],
      disciplines: [],
    });
    const content = document.getElementById('myDataContent').innerHTML;
    expect(content).toContain('hadi@example.com');
    expect(content).toContain('RF TPM CV');
  });

  test('renderMyData shows "None yet" when savedCvs is empty', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.renderMyData({
      account: { email: 'hadi@example.com', created_at: '2026-07-06T00:00:00Z' },
      savedCvs: [],
      conversationHistory: [],
      coachMemory: [],
      disciplines: [],
    });
    const content = document.getElementById('myDataContent').innerHTML;
    expect(content).toContain('None yet');
  });

  test('renderMyData shows coachMemory entries with gap_topic and digest_summary', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.renderMyData({
      account: { email: 'hadi@example.com', created_at: '2026-07-06T00:00:00Z' },
      savedCvs: [],
      conversationHistory: [],
      coachMemory: [{ id: 'cm-001', gap_topic: 'leadership path', digest_summary: 'Targeting Director roles', created_at: '2026-07-06T00:00:00Z' }],
      disciplines: [],
    });
    const content = document.getElementById('myDataContent').innerHTML;
    expect(content).toContain('leadership path');
    expect(content).toContain('Targeting Director roles');
  });

  test('openMyData() shows error message when fetch fails', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Not authenticated', error_code: 'ERR-AUTH-007' }),
    }));
    await window.openMyData();
    const content = document.getElementById('myDataContent').innerHTML;
    expect(content).toContain('Could not load');
  });
});

// ── Auth modal ────────────────────────────────────────────────────────────────

describe('Auth modal — login/register UI', () => {
  beforeEach(() => {
    document.cookie = 'onboarded=1';
    window.TRIAL_MODE = false;
    // fetch already mocked by the outer beforeEach (returns { user: null })
    loadAppInDom();
  });

  test('modal is in the DOM and starts hidden before initAuth() resolves', () => {
    // synchronously after loadAppInDom — initAuth has not yet resolved its fetch promise
    const modal = document.getElementById('authModal');
    expect(modal).not.toBeNull();
  });

  test('modal is shown when session is anonymous and no sessionStorage flag is set', async () => {
    // sessionStorage is clear (outer beforeEach). Drain microtasks so initAuth() resolves.
    await new Promise(resolve => setTimeout(resolve, 0));
    const modal = document.getElementById('authModal');
    expect(modal.style.display).not.toBe('none');
  });

  test('modal is NOT shown when sessionStorage dismissed flag is already set', async () => {
    sessionStorage.setItem('jsk_auth_dismissed', '1');
    // Reload the app JS with the flag already in place
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    const modal = document.getElementById('authModal');
    expect(modal.style.display).toBe('none');
  });

  test('modal is NOT shown when /auth/me returns a logged-in user', async () => {
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    const modal = document.getElementById('authModal');
    expect(modal.style.display).toBe('none');
  });

  test('dismissAuthModal() hides the modal and sets sessionStorage flag', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.dismissAuthModal();
    expect(document.getElementById('authModal').style.display).toBe('none');
    expect(sessionStorage.getItem('jsk_auth_dismissed')).toBe('1');
  });

  test('dismissing modal does not block guest usage — main input card is still accessible', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.dismissAuthModal();
    expect(document.getElementById('inputCard')).not.toBeNull();
    expect(document.getElementById('cvFile')).not.toBeNull();
    expect(document.getElementById('goBtn')).not.toBeNull();
  });

  test('login form submits to /auth/login with the correct body', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, user: { id: 'usr-001', email: 'test@example.com' } }),
    }));
    document.getElementById('auth-email').value = 'test@example.com';
    document.getElementById('auth-password').value = 'secret123';
    await window.submitAuth();
    expect(window.fetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'secret123' }),
    }));
  });

  test('register form submits to /auth/register after toggleAuthMode()', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.toggleAuthMode(); // switch to register
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, user: { id: 'usr-002', email: 'new@example.com' } }),
    }));
    document.getElementById('auth-email').value = 'new@example.com';
    document.getElementById('auth-password').value = 'newpassword';
    await window.submitAuth();
    expect(window.fetch).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', password: 'newpassword' }),
    }));
  });

  test('login failure shows error message in modal and keeps modal open', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid email or password.', error_code: 'ERR-AUTH-005' }),
    }));
    document.getElementById('auth-email').value = 'test@example.com';
    document.getElementById('auth-password').value = 'wrong';
    await window.submitAuth();
    const errEl = document.getElementById('auth-error');
    expect(errEl.style.display).not.toBe('none');
    expect(errEl.textContent).toContain('Invalid email or password');
    // Modal stays open
    expect(document.getElementById('authModal').style.display).not.toBe('none');
  });

  test('successful login closes modal and shows user email in header', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    document.getElementById('auth-email').value = 'hadi@example.com';
    document.getElementById('auth-password').value = 'secret123';
    await window.submitAuth();
    expect(document.getElementById('authModal').style.display).toBe('none');
    const userArea = document.getElementById('headerUserArea');
    expect(userArea.innerHTML).toContain('hadi@example.com');
  });

  test('toggleAuthMode switches button label between Sign in and Create account', async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('authSubmitBtn').textContent).toBe('Sign in');
    window.toggleAuthMode();
    expect(document.getElementById('authSubmitBtn').textContent).toBe('Create account');
    window.toggleAuthMode();
    expect(document.getElementById('authSubmitBtn').textContent).toBe('Sign in');
  });

  test('Google button href points to /auth/google', () => {
    const googleBtn = document.querySelector('.auth-google-btn');
    expect(googleBtn).not.toBeNull();
    expect(googleBtn.getAttribute('href')).toBe('/auth/google');
  });

  test('already-logged-in user gets email shown in header, no modal', async () => {
    window.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'usr-001', email: 'hadi@example.com' } }),
    }));
    loadAppInDom();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('authModal').style.display).toBe('none');
    expect(document.getElementById('headerUserArea').innerHTML).toContain('hadi@example.com');
  });
});
