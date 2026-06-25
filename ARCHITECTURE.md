# JOBSEEKER — ARCHITECTURE (the map)

> What the app is and how the pieces fit. Update only when structure changes
> (new agent, module, or route). Read alongside STATUS.md.

## What it does
A web app that tailors a job-seeker's CV to a specific job. User uploads a CV and a job, AI
agents find gaps and draft tailored content, the user approves/overrides every AI suggestion,
and the app builds a downloadable tailored CV (HTML + Word export).

## Stack
- Backend: Node.js + Express (`server.js`), routes in `routes/*.routes.js`.
- Frontend: vanilla HTML/CSS/JS in `public/` (`index.html`, `app.js`, `style.css`) — no framework.
- AI: Anthropic SDK (`core/claude.js`); Haiku/Sonnet per agent.
- Data/logging: Postgres via `pg` (`core/db.js`); sanitized event/error logging (`core/logger.js`).
- Export: `docx` / `docxtemplater` / `pizzip` for Word; `puppeteer` for scraping/PDF.
- Deploy: Render free tier (US/Oregon), repo `hadiemadi/job-agent`, branch `main`.

## Agents (`agents/`)
User-facing pipeline:
- `coach.js` — Career Coach: talks with the user, surfaces gaps.
- `recruiter.js` — the "HR" reviewer: Add/Leave-out lean per gap; writes CV/cover-letter prose in
  a human style (style only, never invents facts); independent pre-release review (`reviewTailoredCV`)
  on a separate prompt from the writer.
- `cvWriter.js` — writes/tailors the CV text; own directive on top of the shared HR persona; never
  sees the reviewer's output (kept independent).
Behind the scenes:
- `extractor.js` — pulls job titles / structured data from CV text.
- `inputRouter.js` — classifies the user's free-text "anything you'd like the AI to know?" comment
  into the bucket it should influence.
- `researcher.js` — web-searches a discipline → candidate skills/keywords/red-flags.
- `curator.js` — merges Researcher findings (and routed user comments) into the discipline knowledge
  store. This is the discipline-learning mechanism.

## Core (`core/`)
`claude.js` (AI client) · `config.js` (`TRIAL_MODE`) · `db.js` (Postgres pool) · `errorCodes.js`
(catalog w/ `kind: error|validation`) · `respondError.js` (single error choke point) · `logger.js`
(sanitized, allowlist only) · `json.js` (robust JSON extraction) · `knowledge.js` · `preferences.js`.

## Knowledge (`knowledge/`)
- `coach-core.md`, `recruiter-core.md`, `cv-writer-core.md` — per-agent base prompts/rules.
- `disciplines/*.json` — per-discipline skill/keyword stores the Curator writes to. Today one file
  (`rf-hardware-engineering-technical-program-management.json`). Designed to grow.

## Routes (`routes/`)
`cv.routes.js` (upload/tailor/export/regenerate) · `hr.routes.js` (HR review/refine/chat, gap
decisions) · `coach.routes.js` · `jobs.routes.js` (job search/description). `server.js` also serves
`/healthz`, `/config.js`, `/__dbcheck` (temp), `/output`, `/templates`.

## Other
`src/` (cv, scraper, wordExport, wordTemplateExport, docxPlacement, jobs) · `tasks/` (coverLetter,
interviewPrep, docxPlacement) · `services/workflows.js` · `evals/` (scored cases per discipline) ·
tests: `test.js` (content), `test.ui.js` (UI), `*.test.js` (unit).

## Information flow
User → Coach (gaps) → 🔒 takeaway only → HR/Recruiter (Add/Leave-out lean per gap) →
**User decides (overrides HR)** → CV Writer assembles → tailored CV (HTML, editable inline, + Word
export). Researcher/Curator enrich discipline knowledge in the background.
