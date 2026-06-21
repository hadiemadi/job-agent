// One smoke test per new agents/* module: confirms the module exports the expected
// functions, and that a mocked Claude call resolves end-to-end without throwing. This is
// not a behavior test (that's test.ui.js, via the routes) — just proof each split module
// loads correctly and its functions are callable.

jest.mock('../core/claude', () => ({
  client: { messages: { create: jest.fn() } },
  MODEL: 'claude-sonnet-4-6',
}));

const { client } = require('../core/claude');

function mockTextResponse(text) {
  client.messages.create.mockResolvedValue({ content: [{ type: 'text', text }] });
}

describe('agents/extractor', () => {
  const extractor = require('./extractor');
  test('exports extractJobTitles and parseJobFromText', () => {
    expect(typeof extractor.extractJobTitles).toBe('function');
    expect(typeof extractor.parseJobFromText).toBe('function');
  });
  test('extractJobTitles resolves with a mocked response', async () => {
    mockTextResponse('TPM, Program Manager, Engineering Lead');
    const titles = await extractor.extractJobTitles('some cv text');
    expect(titles).toEqual(['TPM', 'Program Manager', 'Engineering Lead']);
  });
});

describe('agents/recruiter', () => {
  const recruiter = require('./recruiter');
  test('exports reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, hrSystemPrompt, stealthWritingDirective', () => {
    ['reviewCV', 'analyzeJobFit', 'refineWithHR', 'chatWithHRExpert', 'researchCvConventions', 'hrSystemPrompt', 'stealthWritingDirective']
      .forEach(name => expect(typeof recruiter[name]).toBe('function'));
  });
  test('reviewCV resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ overall_match: 'Strong', strengths: [], recommended_sections: [], section_rationale: '', auto_changes: [] }));
    const { review } = await recruiter.reviewCV('cv text', { job_title: 'TPM' }, [], {});
    expect(review.overall_match).toBe('Strong');
  });
  test('hrSystemPrompt assembles text containing the recruiter-core knowledge file content', () => {
    const prompt = recruiter.hrSystemPrompt('cv text', { job_title: 'TPM' }, {});
    expect(prompt).toContain('YOUR CORE PRINCIPLES');
    expect(prompt).toContain('cv text');
  });
});

describe('agents/cvWriter', () => {
  const cvWriter = require('./cvWriter');
  test('exports parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange', () => {
    ['parseCVStructure', 'rewriteCVWithChanges', 'adjustLanguageLevel', 'applyConcernChange']
      .forEach(name => expect(typeof cvWriter[name]).toBe('function'));
  });
  test('applyConcernChange resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ revised_text: 'Led RF integration.', changed: true }));
    const result = await cvWriter.applyConcernChange('cv text', { job_title: 'TPM' }, 'Led RF integration.', 'RF integration', [], {});
    expect(result.revisedText).toBe('Led RF integration.');
    expect(result.changed).toBe(true);
  });
});

describe('agents/coach', () => {
  const coach = require('./coach');
  test('exports analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach, CAREER_COACH_PERSONA', () => {
    ['analyzeAndSuggestRoles', 'matchRolesToMarket', 'buildCareerPath', 'analyzeGaps', 'chatWithCoach']
      .forEach(name => expect(typeof coach[name]).toBe('function'));
    expect(typeof coach.selectTopGaps).toBe('function');
    expect(typeof coach.CAREER_COACH_PERSONA).toBe('string');
    expect(coach.CAREER_COACH_PERSONA.length).toBeGreaterThan(0);
  });
  test('analyzeGaps resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ gaps: [{ description: 'Missing PMP', rationale: 'preferred in JD', severity: 'mild' }] }));
    const gaps = await coach.analyzeGaps('cv text', { job_title: 'TPM' });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe('mild');
  });
});
