# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-06
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 185/185 green · **origin/main HEAD:** `b94141c` (local: 2 commits ahead, not pushed)

---

## ✅ Recently shipped (on `main`)

- **"Reading CV" + "Parsing job" resume on tab reopen** (local, not yet pushed) — Both
  stage-0 (CV upload/parse) and stage-1 (job description parse) are now async via the
  job-queue pattern. `POST /upload-cv` and `POST /fetch-job` each create a `jobs` row with
  `kind='reading_cv'`/`'parsing_job'` and return `{ jobId }` immediately; the real work runs
  in a background ALS-pinned task. `GET /job/:id/status` restores session state (`cvData`,
  `currentJob`) on done. Frontend: `savePendingJob` / `resumePendingJob` handle both new
  kinds — on tab reopen, the correct step is marked `run` and polling resumes seamlessly.
  `startPolling()` cancels any stacked `_pollTimer` before starting a new loop.
  `parsing_job` done handler cascades immediately into `/review-cv` + an `hr_review` poll
  session (same as the live flow). Tests: 185/185 (+2 jobQueue kind tests, all /upload-cv
  and /fetch-job UI tests rewritten to async poll pattern).
- **Polling exponential backoff** — `startPolling()` now uses exponential backoff
  (2 s → 4 s → 8 s → 10 s cap) instead of a fixed 3 s interval. Fixes ERR-RATE-002 on
  HR-review resume. 6 pure-math unit tests in `public/pollBackoff.test.js`. Tests: 183/183.
- **HR review resume on tab reopen** — `/review-cv` is now wrapped
  in the same job-queue pattern as `/rewrite`. Starting an HR review creates a `jobs` row
  with `kind='hr_review'`; the pipeline runs in background; `GET /job/:id/status` returns
  `hrReview`/`currentJob`/`gapRecords` when done and re-applies them to the session.
  Frontend: `savePendingJob` saves `{ kind, cvFileName, jobText, currentJob }`; `resumePendingJob`
  detects `kind='hr_review'` and re-renders the CV filename display, job description, and
  the step-2 progress bar before resuming polling; `showChanges` is called on poll success.
  DB: `jobs.kind` column added (+ idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for
  the live Render DB). Tests: 177/177.
- **background job queue** — CV-tailoring pipeline now runs in the
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
