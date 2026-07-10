'use strict';

// Unit tests for buildGapMemoryBlock — the pure async helper that fetches all gap_memory
// rows for a user and assembles the cross-session context block for the HR Expert sidebar.
// Testing at the function level (not via HTTP) avoids the ALS/session middleware complexity.

jest.mock('../agent', () => ({
  reviewCV: jest.fn(), analyzeGaps: jest.fn(), selectTopGaps: jest.fn(),
  researchCvConventions: jest.fn(), pinDisciplineSkill: jest.fn(),
  generateCoverLetter: jest.fn(), generateInterviewQuestions: jest.fn(),
  refineWithHR: jest.fn(), chatWithHRExpert: jest.fn(), applyConcernChange: jest.fn(),
}));
jest.mock('../src/wordExport', () => ({ generateCoverLetterWord: jest.fn() }));
jest.mock('../services/session',  () => ({ getSession: jest.fn(), als: { run: jest.fn() } }));
jest.mock('../services/gapStore', () => ({
  setGaps: jest.fn(), getGap: jest.fn(), proposeStatement: jest.fn(),
  setUserDecision: jest.fn(), buildSharedGapContext: jest.fn().mockReturnValue(''),
}));
jest.mock('../core/respondError', () => ({ sendError: jest.fn() }));
jest.mock('../core/logger',       () => ({ logEvent: jest.fn(), logDiagnostic: jest.fn() }));
jest.mock('../services/auth', () => ({
  saveProfilePreferences:  jest.fn(),
  getProfilePreferences:   jest.fn(),
  saveConversationHistory: jest.fn(),
  upsertGapMemory:         jest.fn(),
  listGapMemory:           jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const { buildGapMemoryBlock } = require('./hr.routes');
const { listGapMemory }        = require('../services/auth');

describe('Item 5 — /review-cv background job resets hrDisplayHistory', () => {
  test('hrDisplayHistory is reset to [] in the /review-cv background job — scopes summary to current session', () => {
    const src = fs.readFileSync(path.join(__dirname, 'hr.routes.js'), 'utf8');
    // The reset must appear inside the background job (after the als.run call) so it fires
    // for every new tailoring session, not just on first load.
    expect(src).toMatch(/appSession\.hrDisplayHistory\s*=\s*\[\]/);
    // lastGenHrCount must also be reset to 0 (not the old captured count) to match.
    expect(src).toMatch(/appSession\.lastGenHrCount\s*=\s*0/);
  });
});

describe('buildGapMemoryBlock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty string when userId is falsy', async () => {
    expect(await buildGapMemoryBlock(null)).toBe('');
    expect(await buildGapMemoryBlock(undefined)).toBe('');
    expect(listGapMemory).not.toHaveBeenCalled();
  });

  it('includes coach_verdict and hr_statement across multiple gaps', async () => {
    listGapMemory.mockResolvedValue([
      { gap_slogan: 'cloud-experience', tailoring_run_id: 'legacy', coach_verdict: 'Strong AWS background', hr_statement: 'good fit for the role' },
      { gap_slogan: 'leadership',       tailoring_run_id: 'legacy', coach_verdict: 'Led a 5-person team',   hr_statement: 'meets senior bar' },
    ]);
    const block = await buildGapMemoryBlock('user-123');
    expect(listGapMemory).toHaveBeenCalledWith('user-123');
    expect(block).toContain('Strong AWS background');
    expect(block).toContain('good fit for the role');
    expect(block).toContain('Led a 5-person team');
    expect(block).toContain('meets senior bar');
  });

  it('excludes gaps that have neither coach_verdict nor hr_statement', async () => {
    listGapMemory.mockResolvedValue([
      { gap_slogan: 'active-gap', tailoring_run_id: 'legacy', coach_verdict: 'some verdict', hr_statement: null },
      { gap_slogan: 'empty-gap',  tailoring_run_id: 'legacy', coach_verdict: null,           hr_statement: null },
    ]);
    const block = await buildGapMemoryBlock('user-456');
    expect(block).toContain('some verdict');
    expect(block).not.toContain('empty-gap');
  });

  it('returns empty string when all gaps have no verdict or statement', async () => {
    listGapMemory.mockResolvedValue([{ gap_slogan: 'x', tailoring_run_id: 'legacy', coach_verdict: null, hr_statement: null }]);
    expect(await buildGapMemoryBlock('user-789')).toBe('');
  });

  it('returns empty string when listGapMemory throws', async () => {
    listGapMemory.mockRejectedValue(new Error('DB down'));
    expect(await buildGapMemoryBlock('user-fail')).toBe('');
  });
});

describe('tailoringRunId isolation — buildGapMemoryBlock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excludes rows belonging to the current tailoring run (they are in buildSharedGapContext instead)', async () => {
    listGapMemory.mockResolvedValue([
      { gap_slogan: 'agile',      tailoring_run_id: '202607100001', coach_verdict: 'current run verdict',  hr_statement: null },
      { gap_slogan: 'leadership', tailoring_run_id: '202607090003', coach_verdict: 'prior run verdict',    hr_statement: 'prior statement' },
      { gap_slogan: 'cloud',      tailoring_run_id: 'legacy',       coach_verdict: 'legacy verdict',       hr_statement: null },
    ]);
    const block = await buildGapMemoryBlock('user-1', '202607100001');
    expect(block).not.toContain('current run verdict');   // current run excluded
    expect(block).toContain('prior run verdict');          // prior run included
    expect(block).toContain('legacy verdict');             // legacy rows included
  });

  it('includes all rows when currentRunId is null (no active run — e.g. guest or pre-tailor)', async () => {
    listGapMemory.mockResolvedValue([
      { gap_slogan: 'agile', tailoring_run_id: '202607100001', coach_verdict: 'some verdict', hr_statement: null },
    ]);
    const block = await buildGapMemoryBlock('user-2', null);
    expect(block).toContain('some verdict');
  });

  it('two different runs for same user+gap do not leak into each other', async () => {
    // Run A finishes; run B starts. Run B's HR chat should NOT see run A's rows as "current".
    const runA = '202607100001';
    const runB = '202607100002';
    listGapMemory.mockResolvedValue([
      { gap_slogan: 'cloud', tailoring_run_id: runA, coach_verdict: 'run A verdict', hr_statement: 'run A statement' },
      { gap_slogan: 'cloud', tailoring_run_id: runB, coach_verdict: 'run B verdict', hr_statement: null },
    ]);
    // From run B's perspective: run A is historical, run B is current (excluded)
    const blockForRunB = await buildGapMemoryBlock('user-3', runB);
    expect(blockForRunB).toContain('run A verdict');      // historical — visible
    expect(blockForRunB).not.toContain('run B verdict'); // current run — excluded
  });
});

describe('tailoringRunId threading — source-level assertions', () => {
  test('coach.routes.js passes tailoringRunId to findGapMemoryBySlogan (excludes current run from cross-session lookup)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'coach.routes.js'), 'utf8');
    // findGapMemoryBySlogan must be called with 3 args: userId, gap.description, AND tailoringRunId
    expect(src).toMatch(/findGapMemoryBySlogan\s*\(\s*appSession\.userId\s*,\s*gap\.description\s*,\s*appSession\.tailoringRunId\s*\)/);
  });

  test('coach.routes.js passes tailoringRunId to upsertGapMemory', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'coach.routes.js'), 'utf8');
    expect(src).toMatch(/tailoringRunId\s*:\s*appSession\.tailoringRunId/);
  });

  test('hr.routes.js passes tailoringRunId to both upsertGapMemory call sites', () => {
    const src = fs.readFileSync(path.join(__dirname, 'hr.routes.js'), 'utf8');
    const matches = src.match(/tailoringRunId\s*:\s*appSession\.tailoringRunId/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // /hr/refine + /gap-decision
  });

  test('hr.routes.js passes tailoringRunId to buildGapMemoryBlock', () => {
    const src = fs.readFileSync(path.join(__dirname, 'hr.routes.js'), 'utf8');
    expect(src).toMatch(/buildGapMemoryBlock\s*\(\s*appSession\.userId\s*,\s*appSession\.tailoringRunId\s*\)/);
  });

  test('cv.routes.js sets appSession.tailoringRunId before createJob() in /rewrite', () => {
    const src = fs.readFileSync(path.join(__dirname, 'cv.routes.js'), 'utf8');
    // tailoringRunId must be assigned before the job is created
    const runIdIdx   = src.indexOf('appSession.tailoringRunId = generateTailoringRunId()');
    const createJobIdx = src.indexOf('createJob()');
    expect(runIdIdx).toBeGreaterThan(-1);
    expect(runIdIdx).toBeLessThan(createJobIdx);
  });
});

describe('Item 9 — applyConcernChange shows before/after text', () => {
  test('render/cvHtml.js captures beforeText and shows Before/After in confirmation', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'render', 'cvHtml.js'), 'utf8');
    expect(src).toMatch(/const beforeText\s*=\s*activeConcern\.selectedText/);
    expect(src).toMatch(/\*\*Before:\*\*/);
    expect(src).toMatch(/\*\*After:\*\*/);
    expect(src).toMatch(/beforeText.*data\.revisedText|data\.revisedText.*beforeText/s);
  });
});

describe('Item 10 — sendHrMessage JSON-guard prevents raw JSON in chat', () => {
  test('render/cvHtml.js detects JSON-looking replies and strips them to prose', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'render', 'cvHtml.js'), 'utf8');
    expect(src).toMatch(/JSON\.parse\(replyText\)/);
    expect(src).toMatch(/replyText.*parsed\.message.*parsed\.reply/s);
  });
});

describe('Item 11 — recruiter-core.md honest pushback instruction', () => {
  test('knowledge/recruiter-core.md contains sidebar chat prose-only and pushback rules', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'recruiter-core.md'), 'utf8');
    expect(src).toMatch(/SIDEBAR CHAT MODE/i);
    expect(src).toMatch(/NEVER output JSON/i);
    expect(src).toMatch(/HONEST PUSHBACK/i);
    expect(src).toMatch(/push back/i);
  });
});
