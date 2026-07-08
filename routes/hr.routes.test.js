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

const { buildGapMemoryBlock } = require('./hr.routes');
const { listGapMemory }        = require('../services/auth');

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
