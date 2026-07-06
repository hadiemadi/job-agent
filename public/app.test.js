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
