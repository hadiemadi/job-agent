# Job Agent — Project Context for Claude Code

## What we're building
An AI-powered job search and CV tailoring agent.

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
- warnings from pdf2json about "NOT valid form element" are harmless

## Backlog (priority order)
1. Career Coach — Claude acts as career advisor, not just job ranker
2. Multiple CV templates (Modern, Classic, Executive+)
3. Ghost job detection — flag suspicious listings
4. PDF export of rewritten CV
5. Tune wording to match user's writing style
6. Result-oriented CV restructuring
7. Refactor and modularize code

## Next Feature to Build
Career Coach integration:
- Analyze CV strengths and gaps
- Suggest career path
- Advise which jobs to apply first and why
- Integrate into existing UI as a new tab

## Developer Notes
- Developer: Hadi Emadi (RF/Hardware TPM background)
- Environment: Windows 11 + WSL2/Ubuntu 24.04
- Primary shell: WSL terminal
- Future plan: migrate to MacBook Air