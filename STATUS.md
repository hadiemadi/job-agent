# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-06
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 167/167 green · **origin/main HEAD:** `99e24d0` (local: rate-limit UX committed, not yet pushed)

---

## 🔴 DO THIS FIRST (one open thread, mid-flight)

**Verify Postgres logging actually writes rows, then remove the temp tool used to check it.**

- Temporary route `GET /__dbcheck` was pushed live (commit `99e24d0`). It reuses the real
  logger DB pool and runs `SELECT count(*) FROM events`, returning plain text.
- Action: once Render shows the deploy **Live**, open
  `https://jobseeker-rpzr.onrender.com/__dbcheck` and read the result:
  - `EVENTS_ROWS: <n>` (even 0) → DB works, table exists → logging verified. ✅
  - `DB_ERR: relation "events" does not exist` → connected but table never created.
  - `DB_ERR: ECONNREFUSED / timeout / auth` → not reaching the DB (URL/SSL/region).
- After a PASS: remove `/__dbcheck` (revert `99e24d0`); then the validation-nudge logging
  from `b91d829` is trustworthy and the long-standing "is logging real?" question is closed.
- Free tier has no Render Shell, so verification is via this URL, not a shell command.

**Local uncommitted (leave as-is, never stage):** `CLAUDE.md` (modified), `build.txt`, `scripts/count-events.js`.

---

## ✅ Recently shipped (on `main`)

- **rate-limit UX** (local, not yet pushed) — `kind: 'rate'` added to error catalog. ERR-RATE-001/002/003
  switch from the red "Something went wrong" dialog to a calm overlay: burst (002) → "One moment / Try again",
  daily cap (001/003) → "Daily limit reached / Close". Inline pipeline step uses neutral `warn` state
  (yellow `!`) instead of red `err` for rate + validation failures. TRIAL_MODE: muted code caption shown
  (same as validation nudges). `sendError` skips logError + logEvent for rate kind (DB logging deferred).
  Tests: 167/167.
- **`b91d829`** — Error popups split by `kind`: `validation` (missing input / wrong order →
  friendly nudge, no code/red/support line) vs `error` (real failure → full technical dialog).
  45 codes in `core/errorCodes.js` (23 validation). Single choke point in `core/respondError.js`;
  `core/logger.js` allowlist widened to `code`/`kind` only (no PII). `goBtn` disabled w/ tooltip
  until a CV is present.
- **`3701d5e`** — Trial mode: `core/config.js` `TRIAL_MODE` (default true, `TRIAL_MODE=false`
  env to disable). Served via `GET /config.js` → `window.TRIAL_MODE`. Validation nudges show the
  error code as a small muted caption under the slogan when trial is on.
- **`99e24d0`** — temp `/__dbcheck` route (see red section; revert after verify).

---

## 📋 Backlog

**Ready (small/cosmetic):**
- **#32** — Tailored-CV toolbar tooltips: right-side on hover, fix visibility (`style.css`).
- **#33** — Extend error popup to the standalone Tailored-CV page (`render/cvHtml.js`); popup is
  currently only wired into `public/app.js`.
- **About modal** — built (`about-modal-v2.html`, assembly-line block diagram). TODO: match labels
  to real agents (user-facing = Coach / HR-Recruiter / CV Writer; behind the scenes = Researcher,
  Curator, Extractor, InputRouter), retheme to `style.css` tokens, wire button+modal+script into
  `index.html` / `public/app.js`.
- **Feedback button** — on the real-error dialog, replace "Copy" with "Send feedback": store
  `{code, route, timestamp, user_note}` to `events`. ⚠️ user_note is free text → can contain PII;
  needs a "no PII please" hint + ties to GDPR delete path. Depends on DB logging verified.

**Verify (already designed, not a from-scratch build):**
- **Discipline learning loop** — Researcher (web-searches a discipline → skills/keywords/red-flags)
  → Curator (merges into `knowledge/disciplines/*.json`). Only one discipline file exists today
  (`rf-hardware-engineering-technical-program-management.json`). Confirm whether the loop actually
  fires per search and writes/updates discipline files, or is built-but-dormant.

**Parked (external deps):** **#19** PayPal (Business acct + GDPR) · **#13b** model picker (per-search pricing).

**Mode B — market/scrape mode (big unlock; gates several):** **#3** cache CV on country change ·
**#4a** market-level mismatch · **#5** LinkedIn import (puppeteer) · **#6** career-shift titles ·
**#7** semantic embeddings. Touches `agents/researcher.js`, `src/scraper.js`.

**Noted, not built:** GDPR "delete my data" path · move to EU region someday (Oregon is US; logs carry no PII).

---

## ▶️ Suggested next action
Verify `/__dbcheck` (red section). On PASS → remove the temp route, then free choice:
About-modal wiring, #32/#33 polish, or start Mode B.
