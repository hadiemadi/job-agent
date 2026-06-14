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
- warnings from pdf2json about "NOT valid form element" are harmless — suppressed in v1.1

## Bug Backlog
- **Country filter bug**: Selecting "United States" returns GB jobs — country param not being passed correctly to job search
- **CV link UX**: After tailoring CV, the link to open it is not visible enough — needs a highlighted/prominent button
- **Job database coverage**: JSearch returns too few results — evaluate alternative APIs (LinkedIn, Indeed, Adzuna) in Phase 5+

## Priority Roadmap

### Phase 1 — Foundation (Do First)
| # | Task | Why |
|---|------|-----|
| 1 | Refactor & modularize code | Clean foundation for everything else |
| 2 | Write README.md | Documentation + portfolio |
| 3 | Suppress pdf2json warnings | Cleaner output |
| 4 | Create .env.example | Other devs know what variables are needed |

### Phase 2 — Core Features
| # | Task | Why |
|---|------|-----|
| 5 | Improve UI | Better usability + portfolio |
| 6 | Career Coach | AI career advisor, not just job ranker |
| 7 | Ghost Job Detection | Flag suspicious listings |
| 8 | Fix Sweden/Stockholm search | Personal job search |

### Phase 3 — CV Features
| # | Task | Why |
|---|------|-----|
| 9 | PDF export of rewritten CV | Professional output |
| 10 | Multiple CV templates | Modern, Classic, Executive |
| 11 | Result-oriented CV restructuring | Stronger CV |
| 12 | Writing style tuning | More personalized CV |

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
- Primary: Mixed Farsi/English (developer prefers this natural style)
- Code explanations: Always in English
- When switching language mid-sentence: go to a new line
- General conversation: Farsi with English technical terms

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