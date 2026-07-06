# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-06
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 281/281 green · **origin/main HEAD:** `6146f1f`

---

## ✅ Recently shipped (on `main`)

- **Phase 2 Part 3 — Logout data clearing, consent text variants, My Data view** —

  **Logout clears working session state**: `POST /auth/logout` now calls `purgeSessionData()`
  (same mechanism as "Delete my data now"), which resets cvText, currentJob, hrReview, and
  all other in-progress session state to a blank `createSession()`. DB records (saved_cvs,
  coach_memory, user_preferences) are left intact — those belong to the account and persist
  across logins by design. Only the browser session's working data is cleared so the next
  person using the browser sees nothing from the previous user.

  **Two-variant consent text**: The upload card's privacy note now shows the correct text
  based on auth state. Guest text is unchanged ("automatically deleted after your session
  ends"). Logged-in text explains that saved CVs persist until deleted and links to the new
  My Data view. Text switches live on login, logout, and page-load auth check (initAuth).

  **My Data view (logged-in users only)**: "My data" link appears in the header next to
  "Sign out" once authenticated. Opens a modal listing:
  - Account info (email, member since date)
  - Saved CVs (label + date; Delete button per item — DELETE /auth/saved-cvs/:id, ownership-verified)
  - Career Coach history (gap_topic + digest_summary per coach_memory entry)
  - HR conversations (gap_topic + digest_summary from conversation_history)
  - Skills & Discipline data ("None yet" — Phase 5 will populate this)

  **New backend routes**: `GET /auth/my-data` (returns all user data, 401 for guests),
  `DELETE /auth/saved-cvs/:id` (ownership-verified delete).

  **New error codes**: ERR-AUTH-007 (not authenticated), ERR-AUTH-008 (saved CV not found).

  Tests: 281/281 (+21: 9 backend route tests + 4 consent-text UI tests + 8 My Data UI tests).

- **Phase 2 Part 2 — Frontend login modal** —
  Visible on every fresh session (sessionStorage flag suppresses it after dismiss within the same
  tab; closing the tab resets it so a new session always sees it).

  **Modal features:**
  - Google OAuth button — `<a href="/auth/google">` redirect, same as Part 1's route.
  - Email/password form with inline toggle to switch between Login and Register modes.
  - Short one-line benefit copy ("Sign in to save your CVs, preferences, and pick up where you
    left off.") — not a sales pitch.
  - "Continue as guest →" link — same visual weight as login options, not hidden or de-emphasised.
  - On successful login/register: modal closes and user's email appears in the header (top-right
    group) without a page reload. "Sign out" link in the header clears the session and re-shows
    the modal.
  - Mid-session login: the backend session is already session-to-user-linked (Part 1). Frontend
    just calls the auth route and updates the header — no in-progress UI state is touched.
  - `GET /auth/me` called on page load: if session is already authenticated, shows user in header
    immediately without ever showing the modal.

  **Header change**: "Delete my data" button and user area are now grouped in a `.header-actions`
  flex row on the right of the header (same visual position, nothing moved).

  **Style**: matches existing app design language — modal-overlay, card/modal-box, btn-go for
  primary action, same design tokens, no new design language introduced.

  Tests: 260/260 (+13: modal shows/hides on session state, dismiss sets flag, login/register
  POST to correct route, failure shows error, success closes modal + updates header, toggle mode,
  Google button href, already-logged-in flow).

- **Phase 2 Part 1 — Backend auth (Google OAuth + email/password) + user schema** —
  Optional user accounts added on top of the existing anonymous/guest flow, which is
  fully preserved: users who don't log in continue working exactly as before.

  **DB schema** (5 new tables):
  - `users` — id, email (unique), google_id (unique), password_hash (bcryptjs, never exposed), created_at
  - `saved_cvs` — per-user CV store (cv_text, file_ref, label); FK → users
  - `user_preferences` — key/value (JSONB), unique(user_id, key); FK → users
  - `conversation_history` — hybrid digest+raw (digest_summary + raw_log JSONB), per-gap
    relevance fields (gap_topic, relevance_score) designed for #43 Coach long-term memory to
    slot in; FK → users
  - `coach_memory` — Coach's per-user long-term learning store, separate from
    conversation_history so HR long-term memory (#43b) can be added independently; FK → users
  - `jobs.user_id` — already existed as nullable TEXT; links to users.id for logged-in users

  **Backend auth** (`routes/auth.routes.js`, `core/passport.js`, `services/auth.js`):
  - POST /auth/register — email/password, bcrypt cost 10, duplicate-email 409, short-password 400
  - POST /auth/login — passport-local strategy, validates, sets userId in session
  - GET /auth/google — passport-google-oauth20 redirect
  - GET /auth/google/callback — completes OAuth, links/creates user, sets userId, redirects to /
  - POST /auth/logout — clears userId from session (anonymous session and any in-progress
    work remains; only the login association is removed)
  - GET /auth/me — returns {user: {id, email}} or {user: null} for guests
  - Mid-session login: when a user authenticates mid-flow (after uploading CV, during HR review),
    the existing anonymous session is kept and the userId is added to it — no work is lost
  - password_hash never included in any API response

  **Tech**: `bcryptjs` (pure-JS, no native deps), `passport`, `passport-local`,
  `passport-google-oauth20`. Passport used stateless (`session: false`) — our own
  session store (services/session.js + ALS) handles persistence.

  **No frontend login UI yet** — that's Part 2.
  Tests: 247/247 (+25: register/login/logout/me/OAuth/hashing/guest-isolation/session-linking).

  **⚠️ Render env vars needed before Google OAuth works** (set via Render dashboard):
  | Var | What to set |
  |---|---|
  | `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from console.cloud.google.com |
  | `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
  | `GOOGLE_CALLBACK_URL` | `https://jobseeker-rpzr.onrender.com/auth/google/callback` |
  | `SESSION_SECRET` | Long random string — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

  Steps to create Google OAuth credentials:
  1. Go to console.cloud.google.com → APIs & Services → Credentials
  2. Create Project (if needed) → Enable "Google+ API"
  3. Create Credentials → OAuth 2.0 Client ID → Web application
  4. Add `https://jobseeker-rpzr.onrender.com/auth/google/callback` as Authorized redirect URI
  5. Copy Client ID and Secret → paste into Render env vars above

- **ERR-CV-004 session-expiry fix** —
  Root cause: after idle/laptop sleep, `appSession.cvText` could expire, leaving null in the
  session. The `/rewrite` route passed null into `tailorCvWithReview` → `rewriteCVWithChanges`
  → `enforceContactInfo` → `extractContactInfo(cvText)` → `cvText.replace(...)` — crashing
  with "Cannot read properties of null (reading 'replace')".
  **Fix:**
  - Null guard at the top of `/rewrite` before `createJob()`: missing `cvText` → clean 400
    with `ERR-CV-012` ("Your session may have expired. Please restart the CV tailoring
    process.", `kind: 'validation'`); missing `job` body → `ERR-CV-003`.
  - Defensive early return added to `extractContactInfo()` in `agents/cvWriter.js` for belt-
    and-suspenders safety against any call path that bypasses the route-level guard.
  - New catalog entry `ERR-CV-012` in `core/errorCodes.js`.
  - Session-isolation and output-file tests updated to seed `cvText` via `uploadCVFor()` before
    calling `/rewrite` (previously they relied on null passing through the mocked pipeline).
  Tests: 222/222 (+1 null-cvText validation test in `test.ui.js`).
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
**Set Render env vars for Google OAuth** (set via Render dashboard — no shell access needed):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `SESSION_SECRET`.
Steps and generate-command are in the Part 1 section above.

**After that:** smoke-test the live site — login modal, Google OAuth flow, email/password
register + login, dismiss-as-guest, mid-session login, My Data view (including saving a CV
and verifying it shows/deletes correctly).
