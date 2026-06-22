# Job Agent — Project Context for Claude Code

## Business Case

**Primary goal:** Make job applications as fast and easy as possible for the client.

**Core flow (must work perfectly):**
1. Client uploads their CV
2. System finds available jobs in the US, filtered by state
3. AI ranks jobs by fit against the CV
4. Client picks a job → CV is automatically tailored to that job
5. Client edits the tailored CV in-browser and exports it to Word
6. Client clicks directly to the job application page

**Secondary goals (layered on top):**
- Career Coach: AI advisor to help identify the right role and next career step
- Self-assessment: future "career psychologist" feature — helps clients understand if they are underestimating their own skills and capabilities

**Current blocker:** JSearch API has poor US coverage and no reliable state-level filtering. Need a better job data source.

## What we're building
An AI-powered job application assistant — find US jobs by state, tailor CV, export to Word, apply.

## Tech Stack
- Runtime: Node.js v24 (WSL/Ubuntu 24.04)
- AI: Anthropic Claude claude-sonnet-4-6
- Job Search: JSearch via RapidAPI
- PDF parsing: pdf2json
- Web server: Express.js
- Testing: Jest
- Version control: GitHub (https://github.com/hadiemadi/job-agent)

## Project Structure
- agent.js → AI logic (CV reading, job search, Claude API calls)
- server.js → Express web server + browser UI
- index.js → CLI version (legacy)
- test.js → Jest test suite (8 passing tests)
- cv.pdf → Sample CV (RF/Hardware TPM profile)

## What's Done (v1.0)
- CV PDF reader
- Job title extractor via Claude
- Parallel job search (Stockholm/SE, Remote, London/GB)
- Job fit analyzer and ranker (returns JSON)
- CV rewriter with Executive HTML template
- Express web UI with file upload
- Jest test suite (8 tests passing)
- GitHub repository

## Coding Conventions
- CommonJS (require/module.exports) — NOT ES modules
- async/await throughout
- API keys in .env — never hardcoded
- Test file: test.js with Jest
- CV output saved to output/ folder

## Known Issues & Decisions
- JSearch has weak coverage for Sweden/Stockholm — workaround: search London/GB + Remote
- CV template: Executive style (dark header #2C2C2A, blue accents #185FA5)
- warnings from pdf2json about "NOT valid form element" are harmless — suppressed in v1.1

## Bug Backlog
- **CV link UX**: After tailoring CV, the link to open it is not visible enough — needs a highlighted/prominent button ✅ fixed in v1.1
- **Country/location filter**: JSearch coverage too weak for reliable geo-filtering — ✅ resolved by switching to Jooble with US state filtering.
- **CV re-read on country change**: If only the country changes (same CV), the app re-reads and re-analyzes the CV unnecessarily — cache CV text + job titles in the session so only the job search step reruns
- **Executive mismatch analysis**: After ranking, generate a short AI summary explaining WHY the found jobs are not a strong fit overall (e.g. "Market shows mostly mid-level roles; your profile is senior TPM with RF specialization — low overlap with available listings"). Shown above the job cards as a coach-level insight.
- **LinkedIn job post import**: User should be able to paste a LinkedIn (or any) job post URL directly into the app and get the full service — tailored CV + HR agent review — without going through the job search flow. Scrape/fetch the job post content from the URL, parse title/company/description, then feed into the existing tailor + HR review pipeline.
- **Career-shift job title expansion**: Currently we extract 3 job titles directly from the CV (what the person has done). For career shift scenarios, Claude should also suggest adjacent or target role titles the candidate could realistically move into — e.g. an RF TPM could target "Product Manager - Hardware", "Director of Engineering", "Solutions Architect". These expanded titles feed the job search so we surface transition opportunities, not just more of the same.
- **Semantic CV-to-market mapping (computationally expensive)**: Job titles differ by country and company — a "Technical Program Manager" in the US may be listed as "Delivery Manager" or "Engineering Lead" in other markets. Instead of relying only on title matching, embed the candidate's CV skills/experience and compare against actual job description text using semantic similarity. Computationally costly (embedding + vector search) — defer until job volume justifies it, but keep as a long-term quality improvement.
- **Frontend extraction**: The entire HTML/CSS/JS frontend is embedded as a template string inside `server.js`. Move it to `public/index.html` served statically (`app.use(express.static('public'))`). This makes UI changes trivial — edit an HTML file directly instead of navigating a 600-line monolith.
- **Word template options**: ✅ Picker in the editable tailored CV page's toolbar now has 4 choices — Default (built-in, `generateWordCV`), Alternate (built-in, `generateWordCVAlt`), "Similar to original CV" (disabled — see below), and "Upload your own template". The upload path auto-detects merge-tag templates (`docxtemplater`, deterministic) vs. plain untagged Word CVs (new AI-placement engine in `src/docxPlacement.js` + `planDocxPlacement` in `src/ai.js` — the model only ever decides *where* content goes; the inserted text always comes verbatim from `cvData`, so wording/numbers/names can't be altered or invented). Still deferred: "Similar to original CV" is wired into the menu but disabled, because original CVs are read via `src/cv.js`'s PDF-only `readCV()` — there's no `.docx` to run the placement engine against. Build after either (a) accepting `.docx` CV uploads, or (b) PDF style-extraction (fonts/colors/layout via pdf2json metadata, single/two-column detection).
- **Show total cost on the tailored CV page**: Display the running AI spend total (the same daily-spend figure tracked in `core/claude.js`'s metered `client.messages.create` wrapper) at the bottom-left of the tailored CV page, so the candidate/owner can see cost-to-date at a glance.
- **Contact info page — Advanced options as a box, not hide/show**: The Advanced panel (`adv-toggle`/`adv-panel` disclosure in `public/index.html`) should be visually always-present in a bordered box instead of a collapsible hide/show toggle.
- **Default "Gaps to show" to major only**: `clientPreferences.gapSeverities` currently defaults to all three (`['major', 'mild', 'minor']`) — change the default (in `routes/cv.routes.js`'s `/confirm-contact` and `services/session.js`'s default session shape) to `['major']` only, so minor/mild gaps are opt-in rather than shown by default.
- **Contact info page needs a better name + future LLM model picker**: Once each search/call has a visible price tag (builds on the spend-metering work in `core/claude.js`), let the user pick which LLM model to use on this page. The page is no longer just "contact info" (it already holds tone, wording level, advanced options, etc.) — rename it to something that reflects its actual scope (e.g. "Preferences" or "Search Settings") once the model picker lands.
- **Log every error to GitHub for easier debugging**: Wire up centralized error logging (e.g. via the GitHub Issues API, or a logging service that surfaces into GitHub) so server-side errors caught in routes/agents are recorded somewhere browsable instead of only living in local console/server logs.
- **Fix "live web search" / "Refresh Discipline" checkbox layout**: In the Advanced panel, `ci-extensive-search` and `ci-refresh-discipline`'s description text renders below the checkbox box rather than alongside it, which looks broken. Redesign the input (e.g. a toggle button instead of a checkbox-with-label-underneath) so the description sits naturally next to/inside the control.
- **First-time user tips/onboarding**: Add contextual tips and instructions for first-time users to help them navigate the site more easily (e.g. a guided walkthrough or inline hints on first visit across the upload → contact info → job search → tailor CV flow).
- **Unanswered "Your input needed" gaps should default to skip**: On the gap-confirmation UI (`public/app.js`'s `confirm_changes` block — Accept/Skip/Discuss per gap), if the user proceeds to tailor the CV without explicitly responding to one of these items, treat it as a skip rather than leaving it in limbo. Since the user gave no real input either way, the responsible agent (not a hardcoded rule) should decide how to interpret that silence for that specific gap — e.g. the recruiter/HR agent judging whether silently omitting it is safe, given the gap's severity and rationale.
- **GDPR / privacy — stop persisting clients' CVs**: Uploaded CVs currently land on disk via `services/uploads.js`'s multer storage (`uploads/`), generated tailored CVs are written to `output/`, and the raw CV text/parsed data lives in the per-browser session (`services/session.js`) for the session's lifetime. None of this is currently encrypted, access-controlled, or auto-deleted. Before any real client data flows through this app, address: (1) not storing the original CV file/text beyond what's needed to serve the active session, (2) deleting/expiring uploaded files and generated output once a session ends or after a short retention window, (3) a documented data-retention + deletion policy, and (4) confirming nothing PII-bearing gets logged (console logs, GitHub error logging backlog item above) or committed.

## Priority Roadmap

### Phase 1 — Foundation ✅ Done
| # | Task | Status |
|---|------|--------|
| 1 | Refactor & modularize code | ✅ |
| 2 | Write README.md | ✅ |
| 3 | Suppress pdf2json warnings | ✅ |
| 4 | Create .env.example | ✅ |

### Phase 2 — Core Features ✅ Done
| # | Task | Status |
|---|------|--------|
| 5 | Improve UI + step-by-step progress | ✅ |
| 6 | Career Coach (3 phases) | ✅ |
| 7 | Ghost Job Detection | ⏳ deferred |
| 8 | Fix location filter | ⏳ blocked on job API |

### Phase 3 — Core Business Flow (Next Priority)
| # | Task | Why |
|---|------|-----|
| 9 | **Find better US job source** | JSearch has no reliable US/state coverage — evaluate Adzuna, Indeed, LinkedIn |
| 10 | **State-level filtering** | Client needs to filter jobs by US state (e.g. California, Texas) |
| 11 | **Word export of tailored CV** ✅ | On-demand export from the editable tailored CV page — reflects live edits |
| 12 | **Direct apply link** | One-click to job application page from the tailored CV result |

### Career Coach — Feature Spec

A 3-phase AI career advisor that goes beyond job ranking.

**Coach Phase 1 — Profile Analysis + Career Direction**
- Claude deeply analyzes the CV (experience, skills, seniority, trajectory)
- Asks the user one high-level input: career direction preference
  - Technical track (deep specialist, IC, architect)
  - Generalist track (cross-functional, program/product management)
  - Leadership track (director, VP, people management)
- Output: 3–5 ideal role suggestions tailored to the chosen direction
  - These may NOT exist in current job ads — they are aspirational/strategic targets
  - Each role includes: title, why it fits this person's background, what makes them a strong candidate

**Coach Phase 2 — Market Fit**
- Uses the current job search results (already fetched and ranked)
- Maps the user's ideal roles (from Phase 1) to what actually exists in the market today
- Output: best available matches with explanation of:
  - Why this job fits as a NEXT STEP (not just skills match)
  - How it aligns with the chosen career direction

**Coach Phase 3 — Career Path + Challenges**
- For each role proposed in Phase 1 or 2:
  - Key challenges the candidate will likely face
  - Skills gaps to address before/after transition
  - What success looks like in 6–12 months
  - Long-term trajectory from this role

**UI**: New "Career Coach" tab in the main UI, available after a job search completes.

### HR CV Reviewer — Feature Spec

After a CV is tailored for a specific job, an HR expert AI reviews it and gives structured feedback.

**Trigger**: "HR Review" button appears next to "Open Tailored CV ↗" after tailoring completes.

**Claude acts as**: Senior HR manager / recruiter with industry expertise in the target job's sector.

**Review covers**:
1. **Template & presentation** — Does the format look professional for this role/industry? ATS-friendly?
2. **Content vs job description** — How well does the CV content match the specific JD? Missing keywords?
3. **Industry wording** — Are the right sector-specific terms used? What sounds off to an HR reader?
4. **Strengths** — What stands out positively in this CV for this role?
5. **Top 3 improvements** — Concrete, actionable edits the candidate should make before applying

**Output**: Structured feedback panel shown in the UI alongside the CV link.
**Location in roadmap**: Phase 3 — CV Features (after Career Coach)

### Phase 3 — CV Features
| # | Task | Why |
|---|------|-----|
| 9 | Word export of tailored CV ✅ | On-demand export reflecting live in-browser edits |
| 10 | Multiple CV templates | Modern, Classic, Executive |
| 11 | Result-oriented CV restructuring | Stronger CV |
| 12 | Writing style tuning | More personalized CV |
| 13 | HR CV Reviewer | AI HR expert reviews tailored CV vs JD — template, content, industry wording, top 3 fixes |

### Phase 4 — Advanced Features (selective)
| # | Task | Why |
|---|------|-----|
| 13 | Cover letter generator | Alongside CV |
| 14 | Interview prep | Likely questions based on job |
| 15 | Application tracker | Track all applications |
| 16 | Salary insights | Market rate awareness |
| 17 | LinkedIn profile optimizer | CV → LinkedIn |
| 18 | Cold email generator | Outreach to companies |

### Phase 5 — Technical Infrastructure (long term)
| # | Task | Why |
|---|------|-----|
| 19 | Database integration | Save job search history |
| 20 | User accounts | Multi-user support |
| 21 | Cloud deployment | Accessible from anywhere |
| 22 | Mobile friendly UI | Works on phone |
| 23 | Docker setup | Consistent environment across machines |

### Phase 6 — Environment & Tools
| # | Task | Why |
|---|------|-----|
| 24 | Mac migration plan | Ready when MacBook arrives |
| 25 | VS Code settings sync | Consistent across Windows and Mac |
| 26 | Kiro GUI | When company grants access |

**Execution Order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 (selective) → Phase 5 (long term)

## Current State
- v1.0 complete and working
- 8 Jest tests passing
- Deployed on GitHub: https://github.com/hadiemadi/job-agent
- Running on WSL2/Ubuntu 24.04 + Node.js v24
- Primary dev environment: VS Code + WSL terminal

## Developer Notes
- Developer: Hadi Emadi (RF/Hardware TPM background)
- Environment: Windows 11 + WSL2/Ubuntu 24.04
- Primary shell: VS Code integrated terminal (PowerShell)

## Communication Style & Learning Goals

### Language
- English only — no Farsi

### Code Explanation Format
For every code snippet, always explain:
1. **What it does** — functional description
2. **Why we need it** — reasoning and context
3. **Python equivalent** — developer has Python/Java background and ML/MOOC experience

### Learning Approach
- Developer is a beginner in JavaScript/Node.js
- Has background in: Python, Java, OOP concepts, ML/MOOC courses
- Explain in terms of classes, functions, objects, parameters — not beginner analogies
- After explanation, always provide the COMPLETE file — not just snippets
- When debugging: always send the full file, not just the changed part

### Step by Step Progress
- Never move to the next step without explicit confirmation from developer
- Always wait for "done", "ok", or confirmation before proceeding
- If something fails, debug before moving forward
- Keep track of backlog and remind developer of progress

### Response Format
- Use tables for comparisons
- Use checklists for progress tracking
- Avoid long bullet lists — use prose or tables instead
- When giving terminal commands: one command per block
- Always explain what a command does before running it