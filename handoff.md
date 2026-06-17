# Job Agent — Session Handoff

Generated: 2026-06-17

---

## 1. Primary Request and Intent

This session contained multiple sequential requests:

1. **UI test run**: Run `npm run test:ui` to verify fast mocked tests pass (carried over from previous session)
2. **Manual browser testing**: Start the server so the user can test the app at http://localhost:3000
3. **Fix HR Review JSON error**: "Unexpected non-whitespace character after JSON at position 6635" — Haiku 4.5 adds preamble/postamble around JSON
4. **Fix email extraction**: Correct email `hadi_emadi@yahoo.com` extracted as `emadi@yahoo.com` (then as `hadiemadi@yahoo.com` — underscore completely dropped by pdf2json)
5. **Contact info preservation strategy**: User stated name/email/phone/LinkedIn are "extremely sensitive" and must be captured directly from the client once and reused — never re-extracted from PDF
6. **Fix LinkedIn URL prefix**: LinkedIn extracted as bare username `Hemadi` instead of full URL `https://www.linkedin.com/in/Hemadi`
7. **Interactive editable CV**: When tailored CV HTML is opened in browser, every field must be clickable/editable for manual polishing with no AI involvement
8. **Re-open test URL**: User closed the tab, asked for it to be resent

---

## 2. Key Technical Concepts

- **pdf2json token splitting**: PDF text is stored as individual tokens; special chars (underscore, hyphen) may split across tokens or be rendered as text decoration (not a character) — causing spaces or complete absence in extracted text
- **Coordinate-based text joining**: Use `curr.x - (prev.x + prev.w)` gap to decide whether to join tokens with a space or no space
- **extractJSON() helper**: Finds first `{`/`[` and last `}`/`]` to extract valid JSON, ignoring model preamble/postamble
- **contenteditable HTML**: Native browser inline editing with `contenteditable="true"` attribute
- **Single-line vs multi-line contenteditable**: `.sl` class + JS Enter-key prevention for single-line fields; `<li>` elements allow natural list editing (Enter = new bullet)
- **Plain-text paste**: `e.clipboardData.getData('text/plain')` + `execCommand('insertText')` prevents rich-text paste breaking CV layout
- **`confirmedContact` session pattern**: Store user-verified contact info in server session (`appSession.confirmedContact`), apply as highest-priority override in CV generation
- **normalizeLinkedin()**: Reconstructs full LinkedIn URL from bare username, `in/username`, partial URL, or full URL
- **Model switching via env var**: `CLAUDE_MODEL = claude-haiku-4-5` in `.env` for cheap dev; Sonnet 4.6 for prod
- **Jest module mocking**: `jest.mock()` hoisted before require, intercepts all imports for fast UI tests
- **`require.main === module` guard**: Prevents `app.listen()` in test context; `module.exports = app` for supertest

---

## 3. Files and Code Sections

### `src/ai.js`
Most heavily modified file — all JSON parsing, contact extraction, CV rewriting.

Added `extractJSON()` helper (replaces all `.replace(/```json|```/g, '').trim()` calls):
```javascript
function extractJSON(text) {
  text = text.replace(/```json|```/g, '').trim();
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const openChar  = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = text.lastIndexOf(closeChar);
  if (end === -1) throw new Error('Unclosed JSON in model response');
  return text.slice(start, end + 1);
}
```

Added `normalizeLinkedin()` helper:
```javascript
function normalizeLinkedin(raw) {
  if (!raw) return raw;
  raw = raw.trim().replace(/\/$/, '');
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/linkedin\.com/i.test(raw)) return 'https://' + raw.replace(/^\/\//, '');
  const username = raw.replace(/^in\//, '').replace(/^\//, '');
  return `https://www.linkedin.com/in/${username}`;
}
```

`MODEL` constant for env-var model switching:
```javascript
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
```

### `src/coach.js`
- Added same `extractJSON()` function (copy)
- Added `const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';`
- All 3 JSON parse calls use `extractJSON()`

### `src/cv.js`
Changed PDF text extraction from naive `.join(' ')` to coordinate-based joining:
```javascript
pdfParser.on('pdfParser_dataReady', (pdfData) => {
  const text = pdfData.Pages.map(page => {
    const items = page.Texts;
    if (!items || items.length === 0) return '';
    let result = '';
    for (let i = 0; i < items.length; i++) {
      const curr = items[i];
      const content = decodeURIComponent(curr.R[0].T);
      if (i === 0) { result += content; continue; }
      const prev = items[i - 1];
      const sameLine = Math.abs(curr.y - prev.y) < 0.05;
      const gap = curr.x - (prev.x + prev.w);
      result += (sameLine && gap < 0.5) ? content : ' ' + content;
    }
    return result;
  }).join('\n');
  resolve(text);
});
```

### `src/templates.js`
Completely rewrote `generateExecutiveTemplate()` to add full inline editing capability:
- `contenteditable="true"` + `.sl` class on every text field
- Floating `.cv-toolbar` div (dark bar at top: "Save as HTML" + "Print / Save PDF")
- Edit-mode CSS (blue dashed outline on focus, subtle highlight on hover)
- Print CSS (hides toolbar and edit indicators)
- Embedded JS: Enter prevention for single-line fields, plain-text paste handling, `saveHTML()` download

### `server.js`
- Added `confirmedContact: null` to `appSession`
- Added `POST /confirm-contact` endpoint
- Passes `appSession.confirmedContact` to `rewriteCVWithChanges` in `/rewrite` endpoint
- Has `require.main === module` guard and `module.exports = app`

### `public/index.html`
- Added contact review card between input card and progress card (6 editable fields: name, title, email, phone, location, linkedin)
- LinkedIn input has placeholder `https://www.linkedin.com/in/username`

### `public/app.js`
Split `go()` into three functions:
- `go()`: Step 0 upload only → shows contact card
- `confirmContact()`: saves to server → calls `continueToJobAndHR()`
- `continueToJobAndHR()`: Steps 1-2 (job parse + HR review)

### `public/style.css`
Added `.contact-hint` style: `{ font-size:12px; color:#888; margin-bottom:18px; line-height:1.6; border-left:3px solid #185FA5; padding-left:10px; }`

### `test.ui.js`
- 19 fast mocked tests, run via `npm run test:ui`
- All external modules (Claude, pdf, scraper, jobs) are Jest-mocked
- Tests confirmed 19/19 passing in ~2.7 seconds

### `package.json`
- Scripts: `test`, `test:ui`, `test:content`, `start`
- `supertest ^7.2.2` in dependencies
- `testMatch: ["**/test.js", "**/test.ui.js"]` in jest config

---

## 4. Errors and Fixes

| Error | Root Cause | Fix |
|-------|-----------|-----|
| HR Review JSON parse error at position 6635 | Haiku 4.5 adds text around JSON output | `extractJSON()` helper finds first/last JSON bracket pair |
| Email extracted as `emadi@yahoo.com` | pdf2json split `hadi_emadi` into `hadi_` + space + `emadi` | Coordinate-based joining in `cv.js` (gap < 0.5) + space normalization in `extractContactInfo` |
| Email still wrong as `hadiemadi@yahoo.com` | Underscore rendered as text decoration in PDF, completely absent from pdf2json output | Contact review card — user verifies/corrects contact info once, stored in `appSession.confirmedContact` |
| LinkedIn URL extracted as just `Hemadi` | PDF display text is just username; pdf2json extracts text not `href` | `normalizeLinkedin()` reconstructs full URL from any partial form |

---

## 5. Completed Tasks (this session)

- ✅ UI tests run (19/19 passing)
- ✅ JSON parsing error fixed (`extractJSON()`)
- ✅ Contact info capture redesigned (contact review card in UI)
- ✅ LinkedIn URL normalization (`normalizeLinkedin()`)
- ✅ Editable tailored CV (user confirmed "OK Good!")

---

## 6. Pending / Backlog

From CLAUDE.md bug backlog — not yet started:

- **CV link UX**: Already fixed (v1.1)
- **CV re-read on country change**: Cache CV text + job titles in session — only re-run job search if CV unchanged
- **Executive mismatch analysis**: AI summary above job cards explaining WHY found jobs are not a strong fit
- **Career-shift job title expansion**: Suggest adjacent/target roles beyond what's on the CV
- **Frontend extraction**: Move inline HTML/CSS/JS from `server.js` to `public/index.html` ← already done
- **Semantic CV-to-market mapping**: Embedding + vector search — deferred (expensive)
- **PDF export**: Downloadable PDF of tailored CV (Phase 3 priority)
- **US job source**: JSearch has poor US/state coverage — evaluate Adzuna, Indeed, LinkedIn
- **State-level filtering**: Filter jobs by US state (e.g. California, Texas)
- **Update `test.ui.js`**: Add `POST /confirm-contact` to session-dependent `beforeAll`
- **Make comparison page editable**: `generateComparisonTemplate` is NOT yet editable — only tailored CV is

---

## 7. Security Constraints

- API keys in `.env` — NEVER hardcode or commit
- `.env` contains: `ANTHROPIC_API_KEY`, `RAPIDAPI_KEY`, `GIT_TOKEN`, `JOOBLE_KEY`
- `CLAUDE_MODEL = claude-haiku-4-5` currently set in `.env` for dev (cheap); switch to `claude-sonnet-4-6` for prod
