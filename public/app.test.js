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

  test('TRIAL_MODE: rate popup shows count/limit/window caption when server provides numbers', () => {
    window.TRIAL_MODE = true;
    loadAppInDom();
    window.showErrorPopup(
      {
        error_code: 'ERR-RATE-002-UPLOAD',
        error: 'Too many requests — slow down and try again shortly.',
        kind: 'rate',
        rl_count: 14,
        rl_limit: 100,
        rl_window_ms: 900000,
      },
      '/upload-cv'
    );
    const countEl = document.getElementById('rateCount');
    expect(countEl.style.display).not.toBe('none');
    expect(countEl.textContent).toContain('14');    // count
    expect(countEl.textContent).toContain('100');   // limit
    expect(countEl.textContent).toContain('900');   // window in seconds
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
