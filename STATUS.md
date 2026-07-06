# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-06
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 221/221 green · **origin/main HEAD:** `12beb89`

---

## ✅ Recently shipped (on `main`)

- **Rate-limit fix: separate poll limiter + raised thresholds** —
  Root cause confirmed: `aiLimiter` (20 req/hr) was shared between real Claude API calls AND
  `/job/:id/status` polling. A single HR review (several minutes, polling every ~10s with backoff)
  alone generated ~18 polls/3min which exceeded the 20/hr bucket alongside the actual AI calls.
  **Fix:**
  - New `pollLimiter` (600 req/hr) applied at route level on `/job/:id/status` only.
    Polling costs nothing (no Anthropic calls); 600/hr catches only truly runaway loops.
  - `aiLimiter` raised 20→60/hr and now skips poll routes. Math: claude-sonnet-4-6 ~$0.03/call;
    $3/day ÷ $0.03 = 100 safe calls/day. 60/hr lets a 1-hr burst of $1.80 — under the daily cap.
    A full 4-step pipeline = ~6-8 AI calls; 60/hr supports 7-10 full runs/hr.
  - `globalLimiter` raised 100→300 req/15min. A pipeline run with HR review generates ~42-50
    HTTP requests in 15min; 300/15min gives 6× headroom above worst case.
  - All diagnostic logging and stage-tagged error codes from prior commit preserved.
  Tests: 221/221 (+6 threshold constants, total).
- **Rate-limit full diagnostic + Anthropic spend visibility** —
  - **Spend cap startup log**: `core/claude.js` now prints `[AI-SPEND] startup | cap=$5/day | today_so_far=$0.0000` at module load; `server.js` repeats it once the port is bound. `getSpendToday()` exported for tests and future dashboard.
  - **-POLL caption fix**: `req.rateLimit.current` is `undefined` in express-rate-limit v8 — fixed to `req.rateLimit.used`. All stage tags now carry real counts, not '?'. Added null guard in `showRatePopup` so a missing `rateCount` DOM element can't throw into the poll's `.catch()` and silently retry instead of showing the popup.
  - **Poll kind splitting**: frontend now passes `?k=<kind>` on every poll call. Rate handler maps `hr_review→-POLL-HR`, `cv_tailor→-POLL-REWRITE`, `reading_cv→-POLL-UPLOAD`, `parsing_job→-POLL-PARSE`. Exact poll loop visible in Render logs.
  - **Per-request ramp log**: `rateLimitLogger` middleware (mounted after `globalLimiter`) logs `[RATE-LIMIT-RAMP] used=N/limit` on every API request so count ramp-up is visible before a trip fires.
  - Tests: 215/215 (+15: 8 caption tests for all stage tags, 5 poll-kind tests, `rateLimitLogger` tests, `getSpendToday` test).
- **Rate-limit diagnostic visibility** — `tooManyRequests()` now logs a
  `[RATE-LIMIT] ERR-RATE-002-{STAGE} | key=… | {count}/{limit} in {window}s | route=…`
  line to the server console on every trip, and server startup prints the configured
  limits once (`globalLimiter: 100 req/15min | aiLimiter: 20 req/60min`). The 429 JSON
  response now includes `rl_count`, `rl_limit`, `rl_window_ms` so the frontend can show
  real numbers. In TRIAL_MODE, the rate popup shows a diagnostic caption:
  "14 req / 900s window · limit: 100". Thresholds unchanged — this is diagnostic only.
  Tests: 200/200 (+5: 3 handler tests in ratelimit.test.js, 2 popup caption tests in app.test.js).
- **Double-poll-loop fix + stage-tagged error codes** —
  Fixed ERR-RATE-002 triggered on every HR-review → Tailor-CV transition: an in-flight
  `hr_review` poll fetch was resurrecting `_pollTimer` after `startPolling('cv_tailor')`
  had already run, creating two parallel loops that doubled the request rate.
  Fix: `stopPolling()` (new helper) is called synchronously at the start of `applyChanges()`
  and `go()`, before any `await`, so no future `.then()` callback can re-arm the old loop.
  `startPolling()` also calls `stopPolling()` as belt-and-suspenders.
  Also fixed: `tooManyRequests()` was missing `kind: 'rate'`, causing rate errors to hit the
  red technical dialog instead of the calm overlay. Now fixed.
  Stage-tagged error codes (`ERR-RATE-002-UPLOAD`, `-PARSE`, `-HR`, `-REWRITE`, `-POLL`) added
  via `stageTag(path)` in `services/ratelimit.js` — failures are now traceable to the exact
  pipeline step. `showRatePopup` falls back to base-code copy for stage-tagged codes.
  Tests: 195/195 (+10: 7 `stageTag` unit tests, 3 new `app.test.js` cases).
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
Deploy and run a full pipeline. Confirm no ERR-RATE-002-POLL-* fires during normal HR review.
Check Render logs for:
  `[RATE-LIMIT-RAMP]` lines showing ramp-up before the trip
  `[RATE-LIMIT] ERR-RATE-002-POLL-HR | used=N/20` or similar showing exact count
  `[AI-SPEND] server ready | cap=$5/day` confirming the spend cap
Then compare `used/limit` to understand whether it's the `aiLimiter` (20/hr) or
`globalLimiter` (100/15min) that's tripping — and decide whether to raise the threshold.
