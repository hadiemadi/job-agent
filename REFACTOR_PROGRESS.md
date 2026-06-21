# JobSeeker E2E Refactor — Progress Tracker

> If a session runs out of context, read this file plus `JobSeeker_E2E_UpdatePlan.md`
> (the original spec) to resume exactly where work left off. Full phase plan, file
> targets, and test expectations also live in the saved plan at
> `C:\Users\ezemaha\.claude\plans\sequential-snuggling-parnas.md` — this file is the
> lightweight status checklist; that one is the detailed reference.

## Scope cuts (apply to every phase)
1. The web-search **Researcher** (`agents/researcher.js`) is a documented no-op stub —
   no network calls, ever, until explicitly enabled later (`// TODO: enable web_search`).
2. New checkbox `ci-refresh-discipline` beside `ci-extensive-search` in the contact modal's
   Advanced panel — **unchecked by default**, wired through but a server-side no-op.

## Execution rules
- One phase at a time, strict order 0→8 (dependency: 4 before 5, 5 before 6; 7/8 anytime
  after 3).
- After each phase: add/extend tests → `npm test` green → `npm start` boots + manual
  upload→review→tailor smoke pass → commit → mark phase done below → move on automatically.
- Stop and ask only if: a test fails and isn't fixed in 2 attempts, an action is
  destructive/irreversible, or the plan is ambiguous and a wrong guess is costly.
- Full-file output + Python-equivalent explanations for every changed file (per CLAUDE.md).

## Phase status

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 — Safety (delete `APIK.txt`, fix `.claudeignore` encoding) | **done** | `chore(phase-0)` | Also fixed pre-existing stale `rewriteCV` → `rewriteCVWithChanges` calls in `test.js` (unrelated breakage found while verifying). **Gate going forward: `npm run test:ui` per phase (free, mocked); `npm test` (real API) only occasionally/at the end** — test.js has no mocks, unlike test.ui.js. |
| 1 — Core (`core/claude.js`, `core/json.js`, dedupe ai.js/coach.js) | **done** | `refactor(phase-1)` | Added `npm run test:unit` script + `testMatch: "**/*.test.js"` to package.json so new isolated unit tests (this phase's `core/json.test.js`, future agent tests) run separately from the costly `test.js`. Per-phase gate from now on: `npm run test:ui` + `npm run test:unit` (both free/mocked). |
| 2 — Knowledge (`knowledge/recruiter-core.md`, `coach-core.md`) | **done** | `refactor(phase-2)` | `core/knowledge.js`'s `loadCore(name)` reads+caches `knowledge/<name>.md`. Ran one real Claude call via a throwaway script (deleted after) to confirm `hrSystemPrompt` still assembles correctly end-to-end — the mocked test:ui suite doesn't exercise prompt-construction internals. |
| 3 — Agents (split ai.js/coach.js into `agents/*`) | **done** | `refactor(phase-3)` | `src/ai.js`/`src/coach.js` deleted. New: `agents/{extractor,recruiter,cvWriter,coach}.js`, `tasks/{coverLetter,interviewPrep,docxPlacement}.js`, `core/preferences.js`. `agent.js`'s export surface is byte-identical (verified via a require + key diff). `src/wordTemplateExport.js`'s `planDocxPlacement` import updated to `../tasks/docxPlacement`. `test.ui.js` mocks split to match (`./src/ai`/`./src/coach` → `./agents/*`); `test.js` untouched (only requires `./agent`). Ran a full real-API pipeline smoke (parseJobFromText → extractJobTitles → reviewCV + analyzeGaps → rewriteCVWithChanges) end-to-end across every new module — passed. |
| 4 — Field detection (`agents/extractor.js` `detectField`) | **done** | `refactor(phase-4)` | `reviewCV` now calls `detectField` internally and threads `{field, seniority}` into `hrSystemPrompt` via a new `fieldBlock`; returns `field` too (unused by server.js yet — Phase 5 will wire it to the discipline store). Real-API smoke confirmed: detected "RF/Hardware Engineering & Technical Program Management" / senior for the sample CV. |
| 5 — Learning loop (discipline store + curator + researcher stub) | **done** | `feat(phase-5)` | `agents/curator.js` (`mergeFindings`, `isStale`), `agents/researcher.js` (no-op stub, zero network calls — verified by a dedicated test), `core/knowledge.js` gained `loadDiscipline`/`saveDiscipline`. `agents/recruiter.js`'s `reviewCV` now runs the full loop (`loadOrRefreshDiscipline`) and renders accumulated knowledge into `hrSystemPrompt` via `fieldBlock`. `knowledge/disciplines/*.json` is gitignored (auto-generated, per-field learned cache — only `.gitkeep` is tracked). Real-API smoke confirmed a discipline store gets created (empty, since the stub returns nothing) on first review for a field. |
| 6 — UI hooks (input router + `ci-refresh-discipline` checkbox) | **done** | `feat(phase-6)` | `agents/inputRouter.js`'s `classify()` buckets a contact-page comment as general/discipline/ambiguous. `/confirm-contact` classifies `customInstructions` and stores it on `clientPreferences.routedInstruction`; `/review-cv` applies a discipline-bucket comment once a field is known via `agents/recruiter.js`'s new `pinDisciplineSkill`, applied once per contact confirmation (`routedInstructionApplied`). New `ci-refresh-discipline` checkbox (unchecked default) added beside `ci-extensive-search`; wired through but server-side no-op (`clientPreferences.refreshDiscipline` is stored, unused — matches the Researcher stub from Phase 5). Real-API smoke confirmed both classification directions and the full pin-to-disk loop. |
| 7 — Routes/Render (split `server.js` → `routes/`, `templates.js` → `render/`) | pending | — | |
| 8 — Dev tools + evals (`.claude/agents/*`, eval harness) | pending | — | |

## Resume instructions for a new session
1. Read this file's Phase status table — find the first row not marked `done`.
2. Read the matching phase section in the saved plan file (path above) for exact file
   targets, test expectations, and commit message.
3. Check `git log --oneline -10` to confirm which commits already landed — the commit
   message prefix (`refactor(phase-N)`/`feat(phase-N)`/`chore(phase-N)`) tells you which
   phases are actually done in the repo, which is the source of truth if this file and
   git history ever disagree.
4. Continue from there, same execution rules as above.
