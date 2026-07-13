# UI Quality Audit — Job Agent App

**Date:** 2026-07-13
**Audited files:** `public/index.html`, `public/app.js`, `public/style.css`, `routes/hr.routes.js`, `routes/cv.routes.js`, `routes/coach.routes.js`, `routes/auth.routes.js`, `services/session.js`

> **Update this file** whenever an issue below is fixed (mark it ✅ with the commit ref) or whenever a new audit round adds items.

---

## Summary

| Severity | Count | Fixed |
|---|---|---|
| High | 12 | 2 |
| Medium | 18 | 0 |
| Low | 12 | 0 |

---

## 1. Error Handling & Display

**1.1** `app.js` — `runCoach` — **High**
No try/catch on `fetch('/coach/analyze')`. Network error leaves "Analyzing your profile…" permanently visible and `coachBtn` permanently disabled. No recovery without page reload.

**1.2** `app.js` — `getCareerPath` — **High**
Same pattern: no try/catch on `fetch('/coach/path')`. "Loading…" button state stuck indefinitely on failure.

**1.3** `app.js` — poll `.catch()` — **Medium**
Exponential-backoff retry loop swallows errors silently. Persistent network outage shows infinite spinner with no timeout, no error message, no user explanation.

**1.4** `app.js` — `initAuth` / `auth.routes.js:72` — **High**
Google OAuth failure redirects to `/?auth_error=1`, but `app.js` never reads that query param. User lands on the home page with no explanation of why sign-in failed.

**1.5** `app.js:104` — `submitAuth` catch — **Medium**
Network failure shows raw `err.message` ("Failed to fetch") to the user instead of a friendly message.

**1.6** `app.js:189` — `initAuth` catch — **Medium**
Server-side failure on `/auth/me` silently degrades to guest mode. If server is down the auth modal still shows; subsequent sign-in also fails with no explanation.

**1.7** `app.js:568` — `loadPrefillData` catch — **Medium**
Failure to load prefill data is swallowed silently. Saved model preference, tone, and contact details don't populate and the user isn't told why.

**1.8** `app.js:618–623` — `deleteMyData` — **High**
`location.reload()` runs unconditionally after both delete calls, even if the server silently failed. User believes data is deleted when it may not be.

**1.9** `app.js` — multiple render functions — **High** ⚠️ SECURITY ✅ fixed in hotfix/xss-model-default
AI-generated strings injected directly into `innerHTML` via template literals without `escapeHtml()`. Affected: `review.strengths`, `c.description`, `c.rationale`, `g.rationale`, `hrStatement`, `r.why_fit`, `r.why_next_step`, `d.key_challenges`, `d.skill_gaps`, `d.success_at_12_months`, `d.long_term_trajectory`. A prompt-injection payload in the job description or CV can execute arbitrary JS (XSS).

**1.10** `app.js:1278–1298` — `sendChat` — **Low**
`input.value = ''` executes before the fetch resolves. On network error the user's typed message is cleared with no way to re-send without retyping.

**1.11** `app.js:1290–1296` — `sendChat` error branch — **Medium**
`data.error` only fires the global error popup; no inline feedback inside the chat panel the user is focused on.

**1.12** `app.js:1213` — `decideGap` — **Medium**
Both `alert(data.error)` AND `showErrorPopup()` are called sequentially on the same failure — two error notifications back to back.

---

## 2. Loading / Progress States

**2.1** `app.js:1008–1049` — `confirmContact` — **High**
"Confirm & continue →" button never disabled during async POST. Double-click fires two concurrent poll loops.

**2.2** `app.js:1725–1735` — `runCoach` — **Medium**
No cancel button or abort mechanism once "Get advice" is clicked. User is stuck until response arrives or tab is reloaded.

**2.3** `app.js:1690–1707` — `viewComparison` — **Medium**
Only the button text changes to "Building comparison…". No spinner and no time estimate for a multi-second AI + file-write operation.

**2.4** `index.html:322–325` — progress modal Cancel button — **Medium**
"Cancel" button doesn't actually stop the backend AI call; it only hides the modal. No tooltip or UI copy communicates that tokens continue to be consumed.

**2.5** `app.js:1309–1336` — `askHR` — **Low**
"HR is drafting…" appears on button only. No secondary spinner or time signal for a >5s operation.

---

## 3. Confirmation Dialogs & Destructive Actions

**3.1** `index.html:241–315` — contact modal — **High**
No close (×) button, no Cancel button, no Escape key handler. Modal cannot be dismissed — user must submit or reload. Blocks flow if wrong CV was uploaded.

**3.2** `app.js` — no `beforeunload` listener — **Medium**
Navigating away or refreshing mid-flow silently discards all gap decisions, HR-drafted sentences, and the review result.

**3.3** `app.js:356` — `deleteMyCV` error path — **Low**
Uses native `alert()` instead of the styled `showErrorPopup()` system used everywhere else.

---

## 4. Empty States

**4.1** `app.js:1086–1111` — `showChanges` — **Medium**
If `strengths`, `auto_changes`, and `confirm_changes` are all empty, the HR Review card shows only the match badge. No "No gaps found" or "Your CV is already a strong match" message.

**4.2** `app.js:1739–1759` — `runCoach` — **Medium**
If `data.suggestedRoles` is empty, the "Ideal roles for you" section header renders with nothing below it.

**4.3** `app.js:1750–1759` — `runCoach` — **Low**
If `data.marketMatches` is empty, the "Best available jobs" section is silently omitted with no explanation.

**4.4** `index.html:198–219` — workspace section buttons — **Low**
Brand-new logged-in users see only "None yet." in all three workspace sections with no guidance on how they get populated.

---

## 5. Success Feedback

**5.1** `app.js:468–487` — `selectModel` — **Low**
Model preference saved silently. No toast or confirmation; user cannot tell if the choice persisted.

**5.2** `app.js:1205–1221` — `decideGap` — **Low**
After working through all gap cards, no summary ("3 added, 2 skipped") and no call to action ("Ready — click Apply changes").

**5.3** `app.js:348–358` — `deleteMyCV` — **Low**
CV row removed from DOM silently. No "CV deleted" confirmation.

---

## 6. Navigation & Flow

**6.1** `index.html:241–315` / `app.js:998–1005` — **High**
No way to go back from contact modal to re-upload a different CV or change the job description.

**6.2** `app.js` — no Escape key listeners — **Medium**
None of the modals respond to Escape: contactCard, progressCard, authModal, myDataModal, aboutModal, validation nudge overlay, technical error overlay, rate-limit overlay.

**6.3** `app.js:1462–1497` — CV reading done-handler — **Medium**
`confirmContact()` is called automatically for logged-in users with no opportunity to review/correct extracted name, title, or email before the HR review runs.

**6.4** `session.js:254` + `cv.routes.js:172` — **High**
3-hour idle session sweep. Returning user gets ERR-CV-012 with no "session expired, please start over" message.

**6.5** `app.js:1679–1685` — `showComparison` — **Medium**
No "Tailor for a different job" or "Start over" button after comparison view. User must know to reload.

**6.6** `auth.routes.js:79` — Google OAuth success — **Low**
After successful Google OAuth the page loads with no welcome message or sign-in confirmation.

---

## 7. Form & Input Issues

**7.1** `app.js:943–945` — `go()` — **Medium**
File type is not validated client-side (`file.type === 'application/pdf'`). The `accept=".pdf"` attribute is bypassed by drag-and-drop. Non-PDF is only rejected after upload via polling.

**7.2** `app.js:522–529` — `applyProfilePrefill` — **Medium**
Sets `ci-tone` slider value but never updates `ci-tone-label`. Label stays "Direct (default)" even when a saved tone of 1 or 2 is loaded.

**7.3** `app.js:522–529` / `index.html:136,309` — dual tone sliders — **Low**
`ci-tone` (contact modal) and `side-tone` (left panel) are independent DOM elements. Changes to one are not reflected in the other.

**7.4** `app.js:530–538` — gap severity checkboxes — **Low**
`side-sev-*` changes at runtime are never mirrored to `ci-sev-*`. The two checkbox sets can silently diverge.

**7.5** `app.js:1008–1049` — `confirmContact` — **Medium**
No client-side validation on contact fields. Empty name, malformed email, or empty phone is silently baked into the tailored CV.

**7.6** `index.html:178–180` — `jobText` textarea — **Low**
No `maxlength`, no character counter, no length warning. A 20,000-character paste is sent to the AI pipeline with no user warning about cost or timeout risk.

**7.7** `index.html:247–273` — contact modal fields — **Low**
No `autocomplete` attributes on `ci-name`, `ci-title`, `ci-email`, `ci-phone`, `ci-location`, `ci-linkedin`.

---

## 8. Accessibility & Usability

**8.1** `index.html:156,364–378` — decorative emojis — **Low**
Decorative emojis not marked `aria-hidden="true"`. Screen readers announce them as content.

**8.2** `style.css:447–457` — tooltips — **Medium**
CSS `::after` tooltip content is invisible to assistive technology.

**8.3** `style.css:135` — `.link-btn` focus — **Medium**
No `:focus-visible` style. "Sign out", "Log in", "Continue as guest →", workspace delete buttons have no keyboard focus indicator.

**8.4** `index.html:309` — tone range slider — **Low**
No `aria-label` and no `aria-valuetext` update. Screen reader users hear only the raw number (1–5) with no meaning.

**8.5** `index.html:22` — header delete button — **Low**
"Delete my data now" shown before any data exists. On an empty session it triggers a confirm + reload that achieves nothing.

**8.6** `style.css:386` — undefined CSS variable — **Low**
`.adv-opts-toggle { color: var(--fg) }` — `--fg` is undefined in `:root`. Resolves to inherited color by accident; latent bug if inheritance chain changes.

---

## 9. Architecture Mismatch (Current vs. New Plan)

**9.1** `app.js:291–323` — My Data modal — **High**
Renders `coachMemory` and `conversationHistory` as persistent cross-session records. Both tables (`conversation_history`, `coach_memory`) are being dropped in Phase 0c.

**9.2** `hr.routes.js:356–361` — `/hr/chat` — **Medium**
Still calls `saveConversationHistory()`. After Phase 0c drops the table, this will cause silent failures or uncaught errors on every HR chat turn.

**9.3** `coach.routes.js:62–67` — `/coach/discuss` — **Medium**
Still calls `saveCoachMemory()`. After Phase 0c the My Data "Career Coach History" section will always be empty with no explanation.

**9.4** `index.html:404–439` — About modal — **Medium**
Describes 7 distinct agents. New architecture has 2: `hrAgent(intent)` and `coachAgent(intent)`.

**9.5** `app.js:1131–1187` — `renderGapCard` — **Medium**
No "Profile covers this" badge or profile-covered gap prioritization. Required by Phase 3 of the plan.

**9.6** `app.js:1462–1497` + `index.html:72–148` — **Medium**
No pre-tailoring profile popup (Phase 2 of plan). The left-column `yourDetailsCard` is a persistent sidebar widget, not the profile gate described in the plan.

**9.7** `app.js:362–368` — `MODEL_OPTIONS` — **High** ⚠️ BROKEN TODAY
Model IDs `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` do not exist in the Anthropic API. Selecting any of them causes API errors at the backend.

**9.8** `auth.routes.js:162` — default model — **High** ⚠️ BROKEN TODAY ✅ fixed in hotfix/xss-model-default
Default model hardcoded as `'claude-sonnet-5'` which does not exist. Breaks every new user's first tailoring attempt.

**9.9** `hr.routes.js:36–51`, `hr.routes.js:12` — `gap_memory` naming — **Low**
Comments and function names still reference `gap_memory`. Plan renames to `tailoring_gap_log`; will cause confusion during migration.

---

## 10. Broken, Inconsistent, or Unfinished

**10.1** `app.js:1213,1218,1334,356,1703–1704` — **Medium**
Mix of native `alert()` and styled overlay popups for errors. `decideGap` calls both in sequence for the same error.

**10.2** `index.html:329–333` — dead search results card — **Low**
`#jobList` div is dead HTML in the DOM with no empty-state content.

**10.3** `index.html:428` — About modal — Researcher description — **Low**
Developer status note ("Currently a stub") exposed as user-facing copy.

**10.4** `index.html:302–304` — HTML comment — **Low**
Internal CLAUDE.md reference in user-downloadable HTML: "Not built yet — see CLAUDE.md Bug Backlog item #13."

**10.5** `app.js:445` / `index.html:19` — version chip — **Low**
"vdev" developer artifact visible in the UI header when `APP_VERSION` is not set.

**10.6** `app.js:49` — `initIntro` / `initAuth` race — **Low**
Intro panel briefly flashes for returning logged-in users who lack the onboarding cookie, before the 3-column layout activates.

**10.7** `app.js:1284–1299` — `sendChat` error — **Medium**
Inline chat status hidden before checking for `data.error`. Failed chat turn leaves no inline indication of failure if the global popup is missed. (Reinforces 1.11.)

**10.8** `app.js:292` + right column button labels — **Low**
My Data section title "Career Coach History" doesn't match the workspace button label "Coach conversations."

**10.9** `style.css:392` — dead CSS rule — **Low**
`.model-picker-section { }` is an empty rule.

**10.10** `index.html:383` / `app.js:205–225` — workspace section buttons — **Low**
Buttons labeled as distinct pages ("Previous CV & job info", "Coach conversations", "Discipline & HR Notes") all open the same shared My Data modal with hidden sections, creating a mismatch between expectation and reality.
