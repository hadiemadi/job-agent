# Graph Report - .  (2026-07-02)

## Corpus Check
- 83 files · ~58,643 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 597 nodes · 1180 edges · 29 communities (25 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.86)
- Token cost: 97,785 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Legacy Agent + Cover Letter|Legacy Agent + Cover Letter]]
- [[_COMMUNITY_Dev Subagents + E2E Plan|Dev Subagents + E2E Plan]]
- [[_COMMUNITY_CV Routes + Input Routing|CV Routes + Input Routing]]
- [[_COMMUNITY_Frontend App (publicapp.js)|Frontend App (public/app.js)]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_CV Writer Agent|CV Writer Agent]]
- [[_COMMUNITY_Input Router + Claude Client|Input Router + Claude Client]]
- [[_COMMUNITY_Server + Config + Trial Mode|Server + Config + Trial Mode]]
- [[_COMMUNITY_Docx Placement Engine|Docx Placement Engine]]
- [[_COMMUNITY_Logger + DB Pool|Logger + DB Pool]]
- [[_COMMUNITY_UI Test Suite|UI Test Suite]]
- [[_COMMUNITY_Agent Gateway (legacy)|Agent Gateway (legacy)]]
- [[_COMMUNITY_Recruiter + Field Detection|Recruiter + Field Detection]]
- [[_COMMUNITY_Knowledge Store + Discipline Cache|Knowledge Store + Discipline Cache]]
- [[_COMMUNITY_Career Coach Agent|Career Coach Agent]]
- [[_COMMUNITY_Input Router + HR Refine|Input Router + HR Refine]]
- [[_COMMUNITY_Eval Harness + CV Reader|Eval Harness + CV Reader]]
- [[_COMMUNITY_HR Prompt Templates|HR Prompt Templates]]
- [[_COMMUNITY_Jobs Routes|Jobs Routes]]
- [[_COMMUNITY_Rate Limiting|Rate Limiting]]
- [[_COMMUNITY_Docs + Handoff Notes|Docs + Handoff Notes]]
- [[_COMMUNITY_Curator + Discipline Merge|Curator + Discipline Merge]]
- [[_COMMUNITY_Deploy + Status + Onboarding|Deploy + Status + Onboarding]]
- [[_COMMUNITY_Word Template Scripts|Word Template Scripts]]
- [[_COMMUNITY_Postgres DB Core|Postgres DB Core]]
- [[_COMMUNITY_Frontend DOM Tests|Frontend DOM Tests]]
- [[_COMMUNITY_DB Diagnostics Scripts|DB Diagnostics Scripts]]
- [[_COMMUNITY_Build Config|Build Config]]
- [[_COMMUNITY_Refactor Guard|Refactor Guard]]

## God Nodes (most connected - your core abstractions)
1. `extractJSON()` - 31 edges
2. `el()` - 23 edges
3. `hrSystemPrompt()` - 18 edges
4. `rewriteCVWithChanges()` - 15 edges
5. `logEvent()` - 15 edges
6. `getSession()` - 14 edges
7. `registerOutputFile()` - 14 edges
8. `generateWordCV()` - 14 edges
9. `generateWordCVAlt()` - 14 edges
10. `client` - 13 edges

## Surprising Connections (you probably didn't know these)
- `cv.pdf sample CV (RF/Hardware TPM profile)` --references--> `CLAUDE.md project context`  [AMBIGUOUS]
  cv.pdf → CLAUDE.md
- `extractJSON() helper` --semantically_similar_to--> `core/ shared plumbing`  [INFERRED] [semantically similar]
  handoff.md → ARCHITECTURE.md
- `README roadmap checklist` --semantically_similar_to--> `Career Coach feature spec (3 phases)`  [INFERRED] [semantically similar]
  README.md → CLAUDE.md
- `Mode B — market/scrape mode backlog cluster` --semantically_similar_to--> `JSearch poor US/state coverage blocker`  [INFERRED] [semantically similar]
  STATUS.md → CLAUDE.md
- `Interactive editable tailored CV (contenteditable)` --semantically_similar_to--> `Word template options (4-choice picker)`  [INFERRED] [semantically similar]
  handoff.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Runtime agents implementing the 4-part agent contract** — jobseeker_architecture_coach_agent, jobseeker_architecture_recruiter_agent, jobseeker_architecture_cvwriter_agent, jobseeker_architecture_extractor_agent, jobseeker_architecture_inputrouter_agent, jobseeker_architecture_researcher_agent, jobseeker_architecture_curator_agent, e2e_updateplan_agent_contracts [EXTRACTED 1.00]
- **Dev-only Claude Code subagents that never ship to users** — agents_architecture_reviewer, agents_prompt_tester, agents_ui_designer, e2e_updateplan_phased_migration [EXTRACTED 1.00]
- **Discipline knowledge self-improvement loop (Researcher to Curator to disciplines store to UI toggle)** — jobseeker_architecture_researcher_agent, jobseeker_architecture_curator_agent, e2e_updateplan_two_layer_knowledge, e2e_updateplan_learning_loop, index_html_ci_refresh_discipline, status_discipline_loop_verify, refactor_progress_researcher_stub_scope_cut [INFERRED 0.85]

## Communities (29 total, 4 thin omitted)

### Community 0 - "Legacy Agent + Cover Letter"
Cohesion: 0.05
Nodes (50): { generateCoverLetter }, { generateInterviewQuestions }, { client }, { als, getSessionSpend }, { client }, { chatWithCoach, analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath }, express, { getGap, appendGapMessage, buildSharedGapContext } (+42 more)

### Community 1 - "Dev Subagents + E2E Plan"
Cohesion: 0.07
Nodes (46): architecture-reviewer subagent, prompt-tester subagent, ui-designer subagent, 4-part agent contract (Part C), Eval harness measurement plan (Part H), Target architecture layering plan (Part B), Discipline knowledge learning loop, Phased migration plan (Part G, phases 0-8) (+38 more)

### Community 2 - "CV Routes + Input Routing"
Cohesion: 0.09
Nodes (40): { classify }, { generateComparisonTemplate }, express, fse, { generateWordCV, generateWordCVAlt }, { generateWordFromTemplate }, { getGaps }, { getSession, setSession, registerOutputFile, purgeSessionData } (+32 more)

### Community 3 - "Frontend App (public/app.js)"
Cohesion: 0.13
Nodes (41): appendBubble(), applyChanges(), askHR(), buildSteps(), _cardChats, confirmContact(), continueToJobAndHR(), decideGap() (+33 more)

### Community 4 - "Package Dependencies"
Cohesion: 0.05
Nodes (42): author, dependencies, @anthropic-ai/sdk, cookie-parser, docx, docxtemplater, dotenv, express (+34 more)

### Community 5 - "CV Writer Agent"
Cohesion: 0.09
Nodes (36): adjustLanguageLevel(), applyConcernChange(), buildChangesAppliedLines(), buildGapDiscussionLines(), buildSectionChangeLines(), buildSessionSummary(), buildSettingsLines(), buildSuggestionLines() (+28 more)

### Community 6 - "Input Router + Claude Client"
Cohesion: 0.07
Nodes (30): { classify }, { client }, { addSessionSpend }, Anthropic, checkBudget(), DAILY_AI_BUDGET_USD, { extractJSON }, { logEvent } (+22 more)

### Community 7 - "Server + Config + Trial Mode"
Cohesion: 0.09
Nodes (18): app, coachRoutes, cookieParser, cvRoutes, express, fse, { getPool }, { globalLimiter, aiLimiter } (+10 more)

### Community 8 - "Docx Placement Engine"
Cohesion: 0.15
Nodes (20): applyPlacementPlan(), buildParagraphXml(), escapeXml(), extractParagraphs(), fieldToLines(), fse, generateWordViaPlacement(), hasMergeTags() (+12 more)

### Community 9 - "Logger + DB Pool"
Cohesion: 0.18
Nodes (16): ALLOWED_META_KEYS, { als }, crypto, { getPool }, hashSessionId(), isSafePrimitive(), logError(), logEvent() (+8 more)

### Community 10 - "UI Test Suite"
Cohesion: 0.10
Nodes (17): agent, { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach }, app, { classify }, fse, { generateWordCV, generateWordCVAlt }, { generateWordFromTemplate }, MOCK_CV_DATA (+9 more)

### Community 11 - "Agent Gateway (legacy)"
Cohesion: 0.13
Nodes (16): { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach }, { extractJobTitles, parseJobFromText }, { generateExecutiveTemplate }, { parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange }, { reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV, draftFromSidebarDiscussion }, { client, MODEL }, extractJobTitles(), { extractJSON } (+8 more)

### Community 12 - "Recruiter + Field Detection"
Cohesion: 0.14
Nodes (14): detectField(), { client, MODEL }, { detectField }, { extractJSON }, { loadCore, loadDiscipline, saveDiscipline }, { mergeFindings, isStale }, { preferencesBlock }, { research } (+6 more)

### Community 13 - "Knowledge Store + Discipline Cache"
Cohesion: 0.17
Nodes (15): loadOrRefreshDiscipline(), pinDisciplineSkill(), preReleaseReviewPrompt(), cache, disciplineFileName(), DISCIPLINES_DIR, fs, loadCore() (+7 more)

### Community 14 - "Career Coach Agent"
Cohesion: 0.14
Nodes (15): analyzeAndSuggestRoles(), analyzeGaps(), buildCareerPath(), CAREER_COACH_PERSONA, chatWithCoach(), { client, MODEL }, DIRECTION_DESCRIPTIONS, { extractJSON } (+7 more)

### Community 15 - "Input Router + HR Refine"
Cohesion: 0.18
Nodes (12): classify(), { client, MODEL }, { extractJSON }, refineWithHR(), extractJSON(), { jsonrepair }, sanitizeJsonControlChars(), { extractJSON, sanitizeJsonControlChars } (+4 more)

### Community 16 - "Eval Harness + CV Reader"
Cohesion: 0.14
Nodes (12): { readCV }, { searchAllLocations }, CASES_DIR, CV_PATH, fs, fse, OUTPUT_DIR, path (+4 more)

### Community 17 - "HR Prompt Templates"
Cohesion: 0.23
Nodes (11): hrSystemPrompt(), regionalConventionsBlock(), stealthWritingDirective(), { client, MODEL }, { extractJSON }, generateCoverLetter(), { hrSystemPrompt, stealthWritingDirective }, { client, MODEL } (+3 more)

### Community 18 - "Jobs Routes"
Cohesion: 0.17
Nodes (11): express, fse, { getSession, setSession }, { logEvent }, { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, parseJobFromText }, router, { scrapeJobPage }, { sendError } (+3 more)

### Community 19 - "Rate Limiting"
Cohesion: 0.17
Nodes (8): AI_RATE_LIMIT_MAX, aiLimiter, { ERROR_CODES }, globalLimiter, { logEvent, logError }, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MIN, { rateLimit, ipKeyGenerator }

### Community 20 - "Docs + Handoff Notes"
Cohesion: 0.20
Nodes (10): cv.pdf sample CV (RF/Hardware TPM profile), Interactive editable tailored CV (contenteditable), Delete my data now button, CLAUDE.md project context, Business case: fast CV tailoring + apply flow, GDPR/privacy backlog: stop persisting client CVs, Switch to Jooble with US state filtering, JSearch poor US/state coverage blocker (+2 more)

### Community 21 - "Curator + Discipline Merge"
Cohesion: 0.39
Nodes (5): isStale(), mergeFindings(), mergeList(), { mergeFindings, isStale }, today()

### Community 22 - "Deploy + Status + Onboarding"
Cohesion: 0.25
Nodes (7): First-time onboarding intro panel, STATUS.md upkeep rule, render.yaml deploy config, DAILY_AI_BUDGET_USD / rate-limit env vars, Open thread: verify /__dbcheck Postgres logging then remove it, Error popup split by kind: validation vs error, TRIAL_MODE config flag

### Community 23 - "Word Template Scripts"
Cohesion: 0.43
Nodes (7): {
  Document, Packer, Paragraph, TextRun, AlignmentType,
}, fse, heading(), main(), p(), path, run()

### Community 24 - "Postgres DB Core"
Cohesion: 0.43
Nodes (4): buildPool(), ensureTables(), getPool(), { Pool }

## Ambiguous Edges - Review These
- `CLAUDE.md project context` → `cv.pdf sample CV (RF/Hardware TPM profile)`  [AMBIGUOUS]
  cv.pdf · relation: references
- `STATUS.md` → `First-time onboarding intro panel`  [AMBIGUOUS]
  public/index.html · relation: semantically_similar_to
- `GDPR/privacy backlog: stop persisting client CVs` → `Word template options (4-choice picker)`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **253 isolated node(s):** `{ extractJobTitles, parseJobFromText }`, `{ reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV, draftFromSidebarDiscussion }`, `{ parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange }`, `{ analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach }`, `{ generateExecutiveTemplate }` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `CLAUDE.md project context` and `cv.pdf sample CV (RF/Hardware TPM profile)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `STATUS.md` and `First-time onboarding intro panel`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `GDPR/privacy backlog: stop persisting client CVs` and `Word template options (4-choice picker)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `logEvent()` connect `Logger + DB Pool` to `Legacy Agent + Cover Letter`, `CV Routes + Input Routing`, `Input Router + Claude Client`, `Jobs Routes`, `Rate Limiting`, `Postgres DB Core`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `extractJSON()` connect `Input Router + HR Refine` to `CV Writer Agent`, `Input Router + Claude Client`, `Agent Gateway (legacy)`, `Recruiter + Field Detection`, `Career Coach Agent`, `HR Prompt Templates`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `registerOutputFile()` connect `CV Routes + Input Routing` to `Legacy Agent + Cover Letter`, `Docx Placement Engine`, `CV Writer Agent`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `{ extractJobTitles, parseJobFromText }`, `{ reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV, draftFromSidebarDiscussion }`, `{ parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange }` to the rest of the system?**
  _262 weakly-connected nodes found - possible documentation gaps or missing edges._