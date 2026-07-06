# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-06
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 175/175 green · **origin/main HEAD:** `fe9f6b8` (local: 2 commits ahead, not pushed)

---

## ✅ Recently shipped (on `main`)

- **background job queue** (local, not yet pushed) — CV-tailoring pipeline now runs in the
  background. `POST /rewrite` creates a `jobs` row and returns `{ jobId }` immediately; the
  pipeline writes progress into the row as it runs. `GET /job/:id/status` returns status +
  result and re-applies session state (hrThread etc.) when polled done. Frontend polls every
  3s; `localStorage` stores the pending `jobId` so a tab-close/reload can resume polling.
  In-memory fallback for dev/test (no DB). Tests: 175/175.
- **`jobs` table** — new Postgres table in `core/db.js`'s `ensureTables`: id TEXT PK,
  user_id TEXT (nullable, Phase-2 login placeholder), status, current_step, result JSONB,
  created_at/updated_at TIMESTAMPTZ.
- **DB verified + `/__dbcheck` removed** (2026-07-06) — live hit returned `EVENTS_ROWS: 41`;
  Postgres logging confirmed. Temp route removed from `server.js` (reverts `99e24d0`).
- **rate-limit UX** — `kind: 'rate'` for ERR-RATE-*. Calm overlay for burst/daily cap.
- **`b91d829`** — Error popups split by `kind` (validation nudge vs technical dialog).
- **`3701d5e`** — Trial mode: TRIAL_MODE flag, error codes shown as muted caption.

---

## 📋 Backlog

**Ready (small/cosmetic):**
- **#32** — Tailored-CV toolbar tooltips: right-side on hover, fix visibility (`style.css`).
- **#33** — Extend error popup to the standalone Tailored-CV page (`render/cvHtml.js`).
- **About modal** — built (`about-modal-v2.html`). TODO: match agent labels, retheme, wire
  button+modal+script into `index.html` / `public/app.js`.
- **Feedback button** — on the real-error dialog, replace "Copy" with "Send feedback":
  store `{code, route, timestamp, user_note}` to `events`. ⚠️ user_note is free text →
  PII risk; needs "no PII please" hint + GDPR delete path.

**Verify (already designed, not a from-scratch build):**
- **Discipline learning loop** — Researcher + Curator. Only one discipline file exists
  (`rf-hardware-engineering-technical-program-management.json`). Confirm whether the loop
  fires per search and writes/updates discipline files, or is built-but-dormant.

**Parked (external deps):** **#19** PayPal (Business acct + GDPR) · **#13b** model picker.

**Mode B — market/scrape mode (big unlock; gates several):** **#3** cache CV on country
change · **#4a** market-level mismatch · **#5** LinkedIn import (puppeteer) · **#6**
career-shift titles · **#7** semantic embeddings. Touches `agents/researcher.js`,
`src/scraper.js`.

**Phase 2 — login / user_id:** The `user_id TEXT` column is now on the `jobs` table (nullable).
Once basic auth lands, set it from the session and queries can be scoped to real users.

**Noted, not built:** GDPR "delete my data" path · move to EU region someday.

---

## ▶️ Suggested next action
Push the 2 new commits. Then free choice: About-modal wiring, #32/#33 polish, or Mode B.
