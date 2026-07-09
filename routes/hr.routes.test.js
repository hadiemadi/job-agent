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
      { gap_slogan: 'cloud-experience', coach_verdict: 'Strong AWS background', hr_statement: 'good fit for the role' },
      { gap_slogan: 'leadership',       coach_verdict: 'Led a 5-person team',   hr_statement: 'meets senior bar' },
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
      { gap_slogan: 'active-gap', coach_verdict: 'some verdict', hr_statement: null },
      { gap_slogan: 'empty-gap',  coach_verdict: null,           hr_statement: null },
    ]);
    const block = await buildGapMemoryBlock('user-456');
    expect(block).toContain('some verdict');
    expect(block).not.toContain('empty-gap');
  });

  it('returns empty string when all gaps have no verdict or statement', async () => {
    listGapMemory.mockResolvedValue([{ gap_slogan: 'x', coach_verdict: null, hr_statement: null }]);
    expect(await buildGapMemoryBlock('user-789')).toBe('');
  });

  it('returns empty string when listGapMemory throws', async () => {
    listGapMemory.mockRejectedValue(new Error('DB down'));
    expect(await buildGapMemoryBlock('user-fail')).toBe('');
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
