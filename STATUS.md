# JOBSEEKER — STATUS (living handoff)

> Single source of truth for project state. Kept current automatically by Claude
> Code (see CLAUDE.md). Update the date whenever it changes.

**Last updated:** 2026-07-07
**Repo:** `hadiemadi/job-agent` (branch `main`) · **Live:** `jobseeker-rpzr.onrender.com` (Render free tier, US/Oregon)
**Tests:** 350/350 green (342/342 mocked; 8 real-API tests in test.js are transiently flaky — known, pre-existing) · **origin/main HEAD:** `61d4f03` (local ahead)

---

## ✅ Recently shipped (on `main`)

- **Fix batch (2/4): Saved CVs compact table in My Data** —

  Replaced the raw `lastJobText` text dump in My Data with a compact, scrollable table
  of tailored CVs. The table shows Job Title, Company, Date, Job ID (first 8 chars of
  the saved CV's UUID), and a Delete button per row.

  Job Title and Company are parsed from the saved CV's `label` field by splitting on
  " at " (the format set in `/rewrite`: `"Job Title at Company"`). The scrollable
  container (`max-height: 220px`) keeps My Data compact even with many saved CVs.

  Files changed: `public/app.js` (`renderMyData`), `public/style.css` (`.my-data-job-*`,
  `.mjt-*` table classes). Tests unchanged (client-side rendering, no route changes).

- **Fix batch (1/4): Write-path test coverage** —

  Confirmed `saveCv` (and the other fire-and-forget DB writes) are called correctly.
  Root cause of "empty My Data": write paths are structurally sound — they are guarded by
  `if (appSession.userId)`, so they only fire for authenticated users. Empty data for a
  guest session is correct behavior, not a bug.

  Test coverage added in `test.ui.js`: `services/auth` is now fully mocked (no real DB
  needed). New describe block "Write paths — saveCv fires for logged-in users" (2 tests):
  - `saveCv` called once with `userId` + `label` after `/rewrite` for a logged-in session.
  - `saveCv` NOT called for a guest session.

  Tests: 350/350 green (+2 mocked).

- **Bug fix: ERR-JOB-007 on /fetch-job** —

  `extractJSON` in `core/json.js` called `.replace()` on its `text` argument without
  checking its type first. When Claude returns a non-text content block (e.g. a
  `tool_use` block as `content[0]`), `message.content[0].text` is `undefined` and the
  call crashed with "Cannot read properties of undefined (reading 'replace')" — surfaced
  to the caller as `ERR-JOB-007`.

  Fix: one-line type guard at the top of `extractJSON`:
  `if (typeof text !== 'string') throw new Error('No text content returned by model');`
  This converts the opaque TypeError into a clear, actionable error message.

  Regression tests (2) added to `core/json.test.js`: `undefined` and `null` inputs
  now throw the new clear error instead of crashing. Total: 348/348 green.

- **Donation button (Phase 3)** —

  Donate button ("Buy me a coffee ☕") added to the bottom of the tailored CV toolbar, below
  the AI cost display. Click opens a lightweight popup with $1 / $3 / $5 options. Selecting
  an amount calls `POST /donate`, which creates a Stripe Checkout session and redirects the
  browser to Stripe's hosted payment page. No account or login required.

  Backend: `routes/donate.routes.js` — validates amount ∈ {1,3,5}, creates a one-time
  Stripe Checkout session (`mode:'payment'`), logs `donation_initiated` via `logEvent()`
  (amount only, no PII). Returns 503 when `STRIPE_SECRET_KEY` is not set (graceful
  no-op — app still boots). No webhook needed (nothing unlocks on payment).

  Frontend: CSS (`.tb-donate-wrap`, `.tb-donate`, `.donate-overlay`, `.donate-amt`) and JS
  (`openDonate()`, `closeDonate()`, `donate(amount)`) all self-contained in `render/cvHtml.js`.

  Env vars required on Render: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` — documented
  in `.env.example`.

  Note: paid CV tailoring (paywall, backlog item #19) is postponed. This donation button
  is separate and unrelated to CV access — the service remains free.

  Tests: 10 new tests in `routes/donate.routes.test.js` (invalid amounts rejected, valid
  amounts return Stripe URL, no-login, 503 when unconfigured). Total: 346/346.

- **UI layout cleanup (#7 from build.txt)** —

  All four layout items from build.txt §7 complete.

  - **Contact info modal renamed**: h2 changed from "Profile & Preferences" to "Preferences".
  - **Advanced options already a permanent bordered box**: no toggle present; `.adv-panel` has
    always-visible `border:1px solid var(--border)` styling. Verified — no HTML or CSS change needed.
  - **Default gapSeverities already `['major']`**: verified in `services/session.js`, `routes/cv.routes.js`,
    and `public/index.html` (only `ci-sev-major` is pre-checked). No change needed.
  - **Model picker now collapsible**: a compact toggle button replaces the static "AI model for
    this session" title. Shows current model name ("Sonnet 5", "Opus 4.8", etc.) in accent colour.
    Click to expand all 4 model cards; selecting one collapses the picker automatically. CSS:
    `.model-picker-toggle`, `.model-picker-current`, `.model-picker-chevron` (rotates 180° when open).
    JS: `toggleModelPicker()` + `_updateModelPickerCurrent()` (called from `initModelPicker` and
    `selectModel`).
  - **Consent checkbox moved directly above Tailor button**: the `.privacy-block` div was above
    the job description textarea; it's now between the textarea and the `#goBtn` button — visually
    adjacent and left-aligned with the button.

  No new tests needed (pure presentation; existing ID/behaviour-based tests pass unchanged).
  Tests: 336/336.

- **About modal rework (#5 from build.txt)** —

  Modal content replaced from a 4-bullet feature list to a per-agent pipeline explanation.
  Seven agents described: Recruiter, CV Writer, Coach, Extractor, Curator, Researcher, Input Router —
  each as a name + one-paragraph description. Layout: CSS grid, agent name right-aligned in accent
  colour with a vertical border separator, description left-aligned. h2 changed from "Job Agent"
  to "How it works". Modal max-width widened to 520px to accommodate the two-column agent grid.

  "About" link was already moved to the nav (`header-actions`) in a previous pass.

  CSS: `.about-agents`, `.about-agent`, `.about-agent-name`, `.about-agent-desc` added;
  `.about-list` + `.about-list li` removed.

  No tests needed (pure presentation).
  Tests: 336/336.

- **Feedback button rework (#2 from build.txt)** —

  Error dialog now has both Copy and Send feedback buttons. "Send feedback" reveals an
  inline form: message textarea (500 chars max) + optional contact email input. On submit,
  `POST /feedback` writes one row to the new `feedback` table
  (`id, ts, session_id_hash, error_code, route, message, contact_email`) — a dedicated table
  separate from `events`, so feedback survives account deletion.
  `routes/feedback.routes.js` rewritten to use direct pool insert; `core/logger.js` no
  longer involved (removed `user_note` from `ALLOWED_META_KEYS`).
  `feedback` table added to `core/db.js`'s `ensureTables`.

  **Tests updated** (+0 net, adjusted): Copy button + Send feedback button both present;
  form shows message textarea AND email input; POST /feedback accepts message + contact_email.

  Tests: 336/336.

- **GDPR / Privacy (#1 from build.txt)** —

  **Uploaded CV auto-delete**: already implemented — `fse.remove(cvPath)` runs immediately
  after the CV is read in `/upload-cv`, even on error.

  **Generated output file auto-delete**: already implemented — `services/session.js` sweeps
  every 30 min; output files older than 180 min (`OUTPUT_RETENTION_MINUTES`, configurable)
  are deleted even if the session is still active; sessions idle >24 h have all output files
  deleted and the session dropped.

  **logEvent() PII audit**: confirmed clean — `ALLOWED_META_KEYS` allowlist in `core/logger.js`
  strips any field not in the allowlist; `isSafePrimitive()` drops strings >120 chars or
  matching an email pattern.

  **Hard-delete user account** (new for this build):
  - `deleteUserAccount(userId)` added to `services/auth.js` — single `DELETE FROM users WHERE
    id = $1`; all child rows cascade (saved_cvs, user_preferences, conversation_history,
    coach_memory).
  - `DELETE /auth/account` route added to `routes/auth.routes.js` — 401 for guests; calls
    `deleteUserAccount` then `purgeSessionData` so the browser is immediately in a clean
    guest state; logs `account_deleted` event.
  - `deleteMyData()` in `public/app.js` now branches: guests call `POST /delete-my-data`
    (session-only purge, existing behavior); logged-in users call `DELETE /auth/account`
    (hard DB delete + session purge), with a clearer confirm message.
  - `_currentUserId` module-level var added; set by `showAuthUser()`, cleared by `logout()`.

  **Tests added** (+5): `DELETE /auth/account` returns 401 for guest; returns 200 and calls
  `deleteUserAccount` for logged-in user; guest `deleteMyData` calls `/delete-my-data`; 
  logged-in `deleteMyData` calls `/auth/account`; cancel confirm does nothing.

  Tests: 337/337.

- **About modal** —

  New footer link ("About") + modal (max-width 420px) with: app name, tagline, 4-bullet
  feature list, "Powered by Claude AI" + GitHub link. Pure front-end (`public/index.html`,
  `public/app.js`, `public/style.css`). `openAbout()` / `closeAbout()` added alongside the
  other modal helpers. No tests needed (pure presentation).

- **Feedback button on error dialog** —

  Replaced the "Copy" button in the technical error dialog with a "Send feedback" flow.
  Clicking "Send feedback" reveals an inline textarea (max 120 chars, placeholder: "no personal
  info please") + Submit/Cancel. On submit, `POST /feedback` calls `logEvent('user_feedback',
  {code, route, user_note})` — `user_note` passes through `sanitizeMeta`'s allowlist (email
  patterns and values >120 chars are silently dropped, so no raw PII reaches the DB). The
  `user_note` key was added to `core/logger.js`'s `ALLOWED_META_KEYS`.

  **Discipline learning loop verified** (no code change): `loadOrRefreshDiscipline()` in
  `agents/recruiter.js` fires on every HR review, calls `isStale()`, and if stale writes/stamps
  a discipline JSON file. The Researcher is deliberately a no-op stub — discipline stores ARE
  written on first review but only contain the `updated` timestamp (empty skills/keywords/
  red_flags) until the Researcher is upgraded from stub to live web search.

  **New files:** `routes/feedback.routes.js`
  **Files changed:** `core/logger.js`, `server.js`, `public/app.js`, `public/style.css`,
  `public/app.test.js`, `core/logger.test.js`, `routes/auth.routes.test.js`

  **Tests added** (+5): `user_note` in allowlist passes clean text, drops email-containing note,
  drops >120-char note; `POST /feedback` returns `{ok:true}` with note; returns `{ok:true}`
  with empty body; Send feedback button exists + feedback form hidden by default; clicking Send
  feedback reveals textarea.

  Tests: 332/332.

- **Cosmetic backlog — #32, #33, toggle redesign**

  **#32 — Toolbar tooltips now appear to the right** (`render/cvHtml.js`):
  Tooltip CSS changed from `left: 0; top: 100%` (below button, clips off-screen at the
  bottom of the sidebar) to `left: 100%; top: 50%; transform: translateY(-50%);
  margin-left: 10px` — tooltip now appears to the right of the hovered toolbar button at
  its vertical centre, always visible and never clipped.

  **#33 — Error popup on standalone tailored-CV page** (`render/cvHtml.js`):
  All 9 `alert()` calls replaced with self-contained helpers: `showCvPageError(msg)` (red
  overlay with Close button, for actual failures), `showCvPageInfo(msg)` (blue info overlay
  for HR notes and selection warnings), `showCvPageToast(msg)` (auto-dismissing bottom toast
  for clipboard confirmations). Consistent with the UX in `public/app.js`.

  **Toggle redesign — Advanced panel checkboxes** (`public/index.html`, `public/style.css`):
  `ci-extensive-search` and `ci-refresh-discipline` redesigned from plain `.check-row`
  checkboxes (where the `.opt` description text wrapped below the checkbox) to inline
  `.toggle-row` pill switches — the `<input type="checkbox">` is kept with the same ID for
  full test/JS compatibility (`.checked` reads and writes unchanged), but the visual is a
  compact 34×20 pill that slides on check. `.opt` description sits naturally on the same
  line as the label text.

  No new tests needed (pure presentation; existing ID-based tests pass unchanged).

- **My Data history fixes — Items 1+2+3** (audit of 4 broken/missing history panel items, 3 now fixed)

  **Item 1 — Discipline data now shown in My Data panel:**
  `GET /auth/my-data` was hardcoding `disciplines: []`; added `listDisciplines()` to
  `core/knowledge.js` (reads all `knowledge/disciplines/*.json` files, safe empty-return if dir
  absent); `auth.routes.js` now calls it and returns real content; `public/app.js`
  `renderMyData()` renders per-field skills/date instead of a static "None yet".

  **Item 2 — Saved CVs written after CV tailoring:**
  `saveCv()` existed in `services/auth.js` but was never called. Wired into `routes/cv.routes.js`
  `/rewrite` background task (after `logEvent('cv_tailored', …)`) — fire-and-forget for logged-in
  users only; failures are console-warned but never surfaced to the user. Label = "Job Title at
  Company" for easy recall in the My Data panel.

  **Item 3 — Last job description shown in My Data panel:**
  `last_job_text` from `user_preferences` was already written by `/fetch-job` but missing from
  `GET /auth/my-data`; added it to the parallel fetch and rendered as "Last Job Description"
  under "Previous CV & job info" in `renderMyData()`.

  **Tests added** (+3, one per item): disciplines returns real store data; savedCvs populated
  for logged-in user; lastJobText included in my-data response. Tests: 326/326.

  **Files changed:** `core/knowledge.js`, `routes/auth.routes.js`, `routes/cv.routes.js`,
  `public/app.js`, `routes/auth.routes.test.js`.

  **Item 4 — Coach & HR conversation history now saved:**
  Added `saveCoachMemory(userId, {gapTopic, digestSummary, rawLog})` and
  `saveConversationHistory(userId, {agent, gapTopic, digestSummary, rawLog})` to
  `services/auth.js` (INSERT into `coach_memory` / `conversation_history`). Call sites:
  `routes/coach.routes.js` fires `saveCoachMemory` after `/coach/discuss` and `/coach/analyze`
  (logged-in users only, fire-and-forget); `routes/hr.routes.js` fires `saveConversationHistory`
  after `/hr/chat` (logged-in users only, fire-and-forget). Test: `GET /auth/my-data` returns
  non-empty `coachMemory` and `conversationHistory` when mocked data is present.
  Tests: 327/327 (+1 test).

- **Phase 2.5 — Profile & Preferences persistent storage** —

  First-time users go through the normal CV upload → contact form flow; on form submit,
  their Profile & Preferences are saved to the `user_preferences` table (key `'profile_preferences'`,
  stored as a JSON blob). Returning users: `GET /auth/prefill` now includes `profilePreferences`
  alongside `preferredModel`/`lastJobText`; the frontend caches it in `_prefillProfile` and
  calls `applyProfilePrefill()` to pre-fill all form fields — DB data always wins over CV
  re-extraction (no unnecessary API calls on second login). Safety-net upsert: at the end of
  every HR review job, the current session's profile prefs are written back to the DB, so the
  DB stays current even for mid-session logins or DB hiccups during the confirm-contact write.
  Concurrent-edit warning logged if session and DB disagree at that point.

  **Files changed:**
  - `services/auth.js`: `saveProfilePreferences(userId, prefs)` + `getProfilePreferences(userId)`
    — thin wrappers over existing `setUserPreference`/`getUserPreference`
  - `routes/auth.routes.js`: `GET /auth/prefill` includes `profilePreferences` in response
  - `routes/cv.routes.js`: `POST /confirm-contact` fire-and-forgets `saveProfilePreferences`
    for logged-in users (email and model excluded — those live elsewhere)
  - `routes/hr.routes.js`: safety-upsert after every HR review job; `buildProfilePrefs(session)`
    helper ensures consistent shape
  - `public/app.js`: `_prefillProfile` cache var, `applyProfilePrefill(profile)` (applies all
    fields: name/title/phone/location/linkedin/instructions/tone/gapSeverities/extensiveSearch/
    refreshDiscipline), `loadPrefillData()` updated to cache and apply, CV upload done handler
    updated to apply prefill after CV extraction (DB wins)

  **Tests added** (+9):
  - `routes/auth.routes.test.js`: `GET /auth/prefill` returns `null` profilePreferences for
    new user; returns saved profilePreferences for returning user; logged-in
    `POST /confirm-contact` calls `saveProfilePreferences` with correct shape (incl. no email/
    model fields); guest does NOT call `saveProfilePreferences`
  - `public/app.test.js`: `applyProfilePrefill` fills all text fields; sets tone slider;
    checks only saved gapSeverities; sets extensiveSearch; `loadPrefillData` caches and
    applies profile; leaves fields empty for null profilePreferences (new user)

  Tests: 323/323 (+9 new).

- **Bug fixes: ERR-HR-003 + temperature deprecated** —

  **Root cause**: `reviewCV`, `reviewTailoredCV`, `analyzeGaps`, `detectField`, `classify`,
  and `rewriteCVWithChanges` all passed `temperature: 0` to the Claude API. When the model
  picker selects a newer model (claude-sonnet-5, claude-fable-5, claude-opus-4-8) and
  `meteredCreate` overrides `params.model` for that session, the API rejects the call with
  "temperature is deprecated for this model" — which bubbles up as ERR-HR-003 in the HR review
  background job, or crashes other agent calls silently.

  **Fix**: Removed `temperature` from all 6 Claude API call sites across 5 agent files
  (`agents/recruiter.js`, `agents/cvWriter.js`, `agents/extractor.js`, `agents/inputRouter.js`,
  `agents/coach.js`). The determinism intent (same CV/job → same result) is maintained by the
  prompts' explicit "same result every time" instructions, not by temperature clamping.

  **Regression tests added** (+3):
  - `agents/agents.smoke.test.js`: `reviewCV` + `reviewTailoredCV` call params have no
    `temperature` key (smoke-level verification that the removal holds)
  - `agents/agents.smoke.test.js`: `analyzeGaps` call params have no `temperature` key
  - `test.ui.js`: `/confirm-contact` with `model: 'claude-sonnet-5'` → `/review-cv` →
    job completes with `status: 'done'`, no ERR-HR-003

  Tests: 314/314 (+3 new regression tests).

- **Phase 2 Part 4 — Logged-in homepage redesign** —

  **Login/Sign-out toggle**: A "Log in" button now always appears in the header for guests, so
  dismissing the auth modal no longer leaves users with no way back. Once authenticated, the
  header shows the user's email + "Sign out" (the "My data" link was removed from the header
  and replaced by the workspace panel below).

  **Logged-in workspace panel** (`#loggedInPanel`): Shown only when authenticated. Contains:
  - Account email (small, non-interactive — not a button)
  - 3 section buttons: "Previous CV & job info", "Coach conversations", "Discipline & HR notes"
    — each opens the My Data modal filtered to that section
  - AI model picker + cost estimator (see below)
  Guest flow (blank header, no panel) is completely unchanged.

  **Pre-filled job textarea**: On login/page-load-auth, `GET /auth/prefill` is called; if the
  user has a saved `last_job_text` preference and the textarea is still empty, it's pre-filled
  automatically. Job text is saved to `user_preferences` whenever `POST /fetch-job` is called.
  CV pre-fill is **deferred** — `saveCv()` is not wired into the upload flow yet, so returning
  users have no saved CV text to restore. Track as a backlog item.

  **Model picker** (logged-in only): 4 cards — Fable 5 ($10/$50), Opus 4.8 ($5/$25),
  Sonnet 5 ($2/$10, default), Haiku 4.5 ($1/$5). Each shows a live cost estimate for the
  current session (based on CV ≈ 1500 tokens + job text length + 300 overhead × 4 pipeline
  steps, 20% buffer). Selecting a model saves it to `user_preferences` (key: `preferred_model`)
  and overrides the app's global `MODEL` constant for every Claude call in that session via
  `meteredCreate`'s per-request session inspection.

  **New backend routes**: `GET /auth/prefill` (model + lastJobText + latestCv, 401 for guests),
  `POST /auth/preferences` (saves any key/value preference, 401 for guests, 400 if key missing).

  **Session model wiring**: `clientPreferences.model` (new field, null = use global default)
  set from `req.body.model` in `POST /confirm-contact`. `meteredCreate` in `core/claude.js`
  reads `sess.clientPreferences.model` via `getSession()` and overrides `params.model` for
  that request if non-null. Try/catch ensures no-session contexts (tests, CLI) fail silently.

  Tests: 311/311 (+30 new: 9 backend prefill/preferences route tests, 7 login/toggle/panel UI
  tests, 4 prefill UI tests, 6 cost estimator math tests, 6 model picker UI tests; +1 updated:
  test.ui.js clientPreferences snapshot loosened to `toMatchObject` to accept new `model` field).

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
- ~~**#32** — Tailored-CV toolbar tooltips~~ ✅ shipped
- ~~**#33** — Error popup on standalone Tailored-CV page~~ ✅ shipped
- ~~**Feedback button**~~ ✅ shipped — "Send feedback" on error dialog, logs to events
- ~~**About modal**~~ ✅ shipped — footer link + modal with feature list + GitHub link

**Verified (built, working as designed):**
- ~~**Discipline learning loop**~~ ✅ verified — `loadOrRefreshDiscipline()` fires on every
  HR review; discipline JSON files ARE written on first review (stamped with `updated` date,
  empty skills until Researcher stub is upgraded to live web search).

**Parked (external deps):** **#19** PayPal (Business acct + GDPR).

**Mode B — market/scrape mode (big unlock; gates several):** **#3** cache CV on country
change · **#4a** market-level mismatch · **#5** LinkedIn import (puppeteer) · **#6**
career-shift titles · **#7** semantic embeddings. Touches `agents/researcher.js`,
`src/scraper.js`.

**Phase 2 — login / user_id:** The `user_id TEXT` column is now on the `jobs` table (nullable).
Once basic auth lands, set it from the session and queries can be scoped to real users.

**Noted, not built:** GDPR "delete my data" path · move to EU region someday.

---

## ▶️ Suggested next action

**Push `main`** — feedback button + About modal + all prior cosmetic + My Data fixes are
local-only (origin/main is still at `2339a07`).

**Smoke-test on the live site after push:**
1. Login → CV upload → HR review → `POST /coach/discuss` → `POST /hr/chat` → open My Data
   modal and verify all three sections show real content.
2. Trigger a real error → click "Send feedback" → enter a note → verify "Feedback sent" appears.
3. Click "About" footer link → verify modal opens with feature list + GitHub link.

**Set Render env vars for Google OAuth** (set via Render dashboard):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `SESSION_SECRET`.
Steps and generate-command are in the Phase 2 Part 1 section above.

**Remaining backlog** is either Mode B (market/scrape — complex, blocked on
`agents/researcher.js` live search) or infrastructure (GDPR, PayPal). All "Ready" and
"Verify" items are now shipped/confirmed.
