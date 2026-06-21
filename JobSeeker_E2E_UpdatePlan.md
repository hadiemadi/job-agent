# JobSeeker — End-to-End Refactor & Upgrade Plan

> One master plan covering every issue raised this session: architecture,
> clear agent roles, easy-to-improve expertise, field-agnostic HR, a
> web-fed self-improving knowledge base, UI integration, dev tooling, and
> security — migrated in phases so the working v1 never breaks.

---

## PART A — Every issue → its fix (full session inventory)

| # | Issue you raised | Root cause in code | Fix |
|---|---|---|---|
| 1 | Confused "agent roles" — couldn't find a clean cut | `hrSystemPrompt` is one god-agent doing review + tailoring + placement + cover letter + interview prep | Split into agents defined by a 4-part contract (Part C) |
| 2 | Hard to add features | feature = edit `ai.js` + `server.js` + `app.js`; `ai.js` is 949 lines | Layered structure; feature = ~1-file change (Part B) |
| 3 | Improve runtime HR/coach easily | personas hardcoded as JS strings in `ai.js`/`coach.js` | Expertise → `/knowledge/*.md` (Part D) |
| 4 | UI is weak / confusing | no design ownership | `ui-designer` dev subagent (Part F) |
| 5 | Don't know "what a great HR is" per field | knowledge invented by hand, RF-only | Detect field from CV → two-layer knowledge (Part D) |
| 6 | Discipline expertise should come from the internet | none today | **Researcher** agent + API web_search (Part C/D) |
| 7 | Knowledge should accumulate & improve over time | none today | **Curator** with confidence-weighting (Part D) |
| 8 | Live search is costly | always-on would be slow | Checkbox in advanced menu, next to `ci-extensive-search` (Part E) |
| 9 | User skill input should route to the right bucket | `ci-instructions` is free text, unparsed | **Input Router** classifies → General vs Discipline (Part E) |
| 10 | (found) broken `.claudeignore` | UTF-16 file holding a PowerShell command | Rewrite as UTF-8 ignore rules (Part G, Phase 0) |
| 11 | (found) duplicated JSON utils + Anthropic client | copied in `ai.js` AND `coach.js` | Dedupe into `core/` (Phase 1) |
| 12 | (found) secret hygiene | `APIK.txt` + `.env` in repo/zip | Delete `APIK.txt`, rotate key if pushed (Phase 0) |
| 13 | (found) second god-file | `templates.js` 949 lines | Split into `render/` (Phase 6) |

---

## PART B — Target architecture (final)

```
JobSeeker/
├── knowledge/                      # EXPERTISE as data — edit text, not code
│   ├── recruiter-core.md           # universal recruiter rules (hand-written once)
│   ├── cv-writer-core.md
│   ├── coach-core.md
│   └── disciplines/                # per-field, auto-built + self-improving
│       ├── rf-hardware-engineering.json
│       ├── embedded-software.json
│       └── ...                     # one file per field, grows smarter over time
│
├── agents/                         # runtime agents — one job each (Part C)
│   ├── recruiter.js
│   ├── cvWriter.js
│   ├── coach.js
│   ├── extractor.js                # detects field + structured data
│   ├── researcher.js               # web-search → candidate skills
│   ├── curator.js                  # merge/dedupe/confidence into knowledge
│   └── inputRouter.js              # routes user comments → General/Discipline
│
├── tasks/                          # one-shot jobs owned BY an agent
│   ├── coverLetter.js
│   ├── interviewPrep.js
│   └── docxPlacement.js
│
├── core/                           # shared plumbing (write once)
│   ├── claude.js                   # the ONE Anthropic client + runPrompt()
│   ├── search.js                   # web_search wrapper
│   ├── json.js                     # extractJSON + sanitize (deduped)
│   └── knowledge.js                # load/render/merge discipline stores
│
├── services/                       # orchestration & external data
│   ├── jobSearch.js                # was jobs.js + scraper.js
│   ├── cvParser.js                 # was cv.js
│   └── workflows.js                # multi-step pipelines (was index.js)
│
├── render/                         # all document/HTML output
│   ├── cvHtml.js                   # was templates.js
│   ├── comparison.js
│   └── word/                       # was wordExport.js + wordTemplateExport.js + docxPlacement.js
│
├── routes/                         # thin Express handlers (no logic)
│   ├── cv.routes.js
│   ├── jobs.routes.js
│   ├── hr.routes.js
│   └── coach.routes.js
│
├── config.js                       # MODEL, paths, staleness window, constants
├── server.js                       # wires routes only (~40 lines)
├── public/                         # frontend
└── .claude/agents/                 # DEV subagents (Part F) — never ship to users
```

**The one rule:** *expertise* (`knowledge/`), *agents* (`agents/`), and *plumbing*
(`core/`, `routes/`, `render/`) never mix. Change one without touching the others.

---

## PART C — Runtime agents (the "clean cut")

Each agent is defined by **4 things only**; personality is the least important.

| Agent | Input | Decision it owns | Output | Reads |
|---|---|---|---|---|
| **Extractor** | CV / job text | what field & structured facts | `{field, seniority, sections...}` | — |
| **Researcher** | a field | what the web says recruiters want there | candidate skills/keywords/red-flags | web_search |
| **Curator** | new findings + stored knowledge | what's true & high-confidence | updated discipline store | knowledge/ |
| **Input Router** | user comment | which bucket a user skill belongs to | tagged item (General/Discipline) | — |
| **Recruiter** | CV + job | is this a fit, what's missing | fit score + gaps + safe changes | recruiter-core + discipline |
| **CV Writer** | CV + job + approved changes | how to phrase/structure | tailored CV JSON | cv-writer-core |
| **Coach** | CV + goals + gaps | direction & development | roles, path, gap advice | coach-core |

Cover letters, interview prep, doc-placement are **tasks**, not agents — owned by
Writer/Recruiter, reusing the same knowledge. Keep the agent count small.

**Where current functions go:**
- `reviewCV`, `analyzeJobFit` → Recruiter
- `rewriteCVWithChanges`, `adjustLanguageLevel`, `parseCVStructure`, `applyConcernChange` → CV Writer
- `analyzeAndSuggestRoles`, `matchRolesToMarket`, `buildCareerPath`, `chatWithCoach`, `analyzeGaps` → Coach
- `extractJobTitles`, `parseJobFromText` → Extractor
- `researchCvConventions` → folds into Researcher pattern

---

## PART D — Two-layer, self-improving knowledge

### Layer 1 — Universal (hand-written, stable)
`knowledge/recruiter-core.md` — rules true for any field: quantify impact, ATS
keywords, action verbs, evidence-based, no filler, section logic, regional norms.

### Layer 2 — Discipline (auto-built, self-improving)
`knowledge/disciplines/<field>.json` — what a great recruiter in *that* field checks.
Structured so it can be merged reliably:

```jsonc
{
  "field": "RF/Hardware Engineering",
  "updated": "2026-06-21",
  "skills": [
    { "text": "GaN power amplifier design", "confidence": 4,
      "sources": ["web:2026-06-21","web:2026-05-02"],
      "source_type": "search", "last_seen": "2026-06-21" },
    { "text": "must show DPD / linearization experience", "confidence": 99,
      "source_type": "user", "pinned": true }   // user-added = never decays
  ],
  "keywords": [...],
  "red_flags": [...]
}
```

### How it learns (the loop)
```
request for field D
 → Curator loads disciplines/D                 (what we already know)
 → IF (D is new) OR (D is stale > N days) OR (user ticked refresh):
        Researcher web-searches → extracts new skills/keywords/red-flags
        Curator merges: dedupe + bump confidence on repeats + timestamp
 → apply any user-routed items (highest weight, pinned)
 → render rubric text → Recruiter uses it
 → save disciplines/D                          (smarter for next time)
```

**Accumulate = curate, not append.** Recurring skills gain confidence and rise;
one-off noise stays low and decays. User-added items are pinned and override search.
The store stays small and sharp, not a growing log.

---

## PART E — UI integration (grounded in your real elements)

No new screens. Everything hangs off the existing `contactCard` modal.

**1. User skills — via the existing comment box `ci-instructions`**
On `confirmContact()`, the text in `ci-instructions` is sent to the **Input Router**:
- If it's an HR-skill request, classify by one test — *field-dependent or not?*
  - field-agnostic → append to `recruiter-core` (General bucket)
  - field-specific → append to `disciplines/<field>` (Discipline bucket)
- Tag `source: user`, `pinned: true` → highest trust, never decays.
- Non-skill comments keep flowing to preferences as today.
- Ambiguous items: flag back to the user rather than guess.

**2. Live-search cost — a new checkbox in the Advanced panel**
Add `ci-refresh-discipline` right beside the existing `ci-extensive-search`:
```html
<input type="checkbox" id="ci-refresh-discipline" />
  Refresh discipline knowledge from web (slower)
```
- OFF → use accumulated knowledge only (fast, free).
- ON → Researcher runs a live search this request.
- Default: auto-checked when the field is new or its store is stale; user can override.
- Passed through `confirmContact()` alongside `extensiveSearch`, into `/confirm-contact`.

Result: the contact window is the single place the user injects trusted skills **and**
controls search cost — reusing patterns already in `app.js`.

---

## PART F — Dev subagents (for building, not shipping)

Markdown files in `.claude/agents/`. Small, focused set:
- **`ui-designer.md`** — owns `public/` UX: clean, accessible, consistent. Your
  "UI expert that maintains the UI through the project."
- **`architecture-reviewer.md`** — read-only; flags when a change re-tangles layers.
- **`prompt-tester.md`** — runs new `knowledge/` rubrics against eval CVs, reports diffs.

These live in your dev workflow only; users never see them.

---

## PART G — Phased migration (E2E execution order)

Each phase ships independently. Stop any time → app still runs.

| Phase | Work | Done when | Risk |
|---|---|---|---|
| **0 Safety** | delete `APIK.txt`; rewrite `.claudeignore` (UTF-8); rotate key if ever pushed | secrets clean, ignore works | none |
| **1 Core** | `core/claude.js` + `core/json.js`; dedupe from `ai.js`/`coach.js` | one client, one JSON util | low |
| **2 Knowledge** | move personas → `recruiter-core.md` etc.; agents load them | HR editable as text | low |
| **3 Agents** | split `ai.js` into `agents/*` by the 4 contracts | `ai.js` gone | medium |
| **4 Field detection** | `extractor.js` returns `field`; two-layer load (core + discipline) | recruiter is field-aware | medium |
| **5 Learning loop** | `researcher.js` + `curator.js` + discipline store + staleness rule | rubrics self-improve | medium |
| **6 UI hooks** | Input Router on `ci-instructions`; `ci-refresh-discipline` checkbox | user feedback + cost toggle live | low |
| **7 Routes/Render** | thin `server.js` → `routes/*` + `services/*`; split `templates.js` → `render/*` | features = 1-file change | low |
| **8 Dev tools + evals** | `.claude/agents/*`; 3–5 CV eval set; measure changes | regressions caught | low |

**Dependency order that matters:** 1 → 2 → 3 unlock everything. 4 must precede 5
(can't research a field you haven't detected). 6 depends on 5 (router writes into the
stores the loop manages). 7 and 8 can come anytime after 3.

---

## PART H — Measure it (so "better" is real, not a feeling)

Build a tiny eval set: 3–5 real CVs + a target job each + a sketch of good output.
After any change to a rubric or agent, run it and diff. The `prompt-tester` subagent
automates this. Without it, you can't tell if a knowledge edit helped or hurt.

---

## PART I — First concrete step

Do **Phase 0 + Phase 2** together in the VS Code Claude extension:
1. Delete `APIK.txt`; fix `.claudeignore`.
2. Create `knowledge/recruiter-core.md` from the text inside `hrSystemPrompt`.
3. Make the recruiter path load it instead of the hardcoded string.

That proves the whole pattern and immediately gives you the "improve HR without
touching code" workflow — the foundation everything else builds on.
