// One smoke test per new agents/* module: confirms the module exports the expected
// functions, and that a mocked Claude call resolves end-to-end without throwing. This is
// not a behavior test (that's test.ui.js, via the routes) — just proof each split module
// loads correctly and its functions are callable.

jest.mock('../core/claude', () => ({
  client: { messages: { create: jest.fn() } },
  MODEL: 'claude-sonnet-4-6',
}));

const { client } = require('../core/claude');

beforeEach(() => {
  client.messages.create.mockClear();
});

function mockTextResponse(text) {
  client.messages.create.mockResolvedValue({ content: [{ type: 'text', text }] });
}

describe('agents/extractor', () => {
  const extractor = require('./extractor');
  test('exports extractJobTitles, parseJobFromText, detectField', () => {
    expect(typeof extractor.extractJobTitles).toBe('function');
    expect(typeof extractor.parseJobFromText).toBe('function');
    expect(typeof extractor.detectField).toBe('function');
  });
  test('extractJobTitles resolves with a mocked response', async () => {
    mockTextResponse('TPM, Program Manager, Engineering Lead');
    const titles = await extractor.extractJobTitles('some cv text');
    expect(titles).toEqual(['TPM', 'Program Manager', 'Engineering Lead']);
  });
  test('detectField resolves a field/seniority pair from a mocked response', async () => {
    mockTextResponse(JSON.stringify({ field: 'RF/Hardware Engineering', seniority: 'senior' }));
    const result = await extractor.detectField('some cv text');
    expect(result).toEqual({ field: 'RF/Hardware Engineering', seniority: 'senior' });
  });
});

describe('agents/recruiter', () => {
  const recruiter = require('./recruiter');
  test('exports reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, hrSystemPrompt, stealthWritingDirective, pinDisciplineSkill', () => {
    ['reviewCV', 'analyzeJobFit', 'refineWithHR', 'chatWithHRExpert', 'researchCvConventions', 'hrSystemPrompt', 'stealthWritingDirective', 'pinDisciplineSkill']
      .forEach(name => expect(typeof recruiter[name]).toBe('function'));
  });
  test('pinDisciplineSkill persists a pinned entry into that field\'s discipline store', () => {
    const fs = require('fs');
    const path = require('path');
    const storePath = path.join(__dirname, '..', 'knowledge', 'disciplines', 'smoke-test-pin-field.json');
    try {
      recruiter.pinDisciplineSkill({ field: 'Smoke Test Pin Field' }, 'Hands-on widget calibration');
      const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      expect(store.skills[0]).toMatchObject({ text: 'Hands-on widget calibration', pinned: true, confidence: 99, source_type: 'user' });
    } finally {
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    }
  });
  test('reviewCV resolves with a mocked response and also detects/returns a field', async () => {
    mockTextResponse(JSON.stringify({ overall_match: 'Strong', strengths: [], recommended_sections: [], section_rationale: '', auto_changes: [] }));
    const { review } = await recruiter.reviewCV('cv text', { job_title: 'TPM' }, [], {});
    expect(review.overall_match).toBe('Strong');
    // reviewCV calls detectField internally (Phase 4) — confirm it made the extra call rather
    // than skipping field detection silently.
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
  test('hrSystemPrompt assembles text containing the recruiter-core knowledge file content', () => {
    const prompt = recruiter.hrSystemPrompt('cv text', { job_title: 'TPM' }, {});
    expect(prompt).toContain('YOUR CORE PRINCIPLES');
    expect(prompt).toContain('cv text');
  });
  test('hrSystemPrompt includes the detected field/seniority when provided', () => {
    const prompt = recruiter.hrSystemPrompt('cv text', { job_title: 'TPM' }, {}, { field: 'RF/Hardware Engineering', seniority: 'senior' });
    expect(prompt).toContain('CANDIDATE FIELD/DISCIPLINE: RF/Hardware Engineering');
    expect(prompt).toContain('senior');
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
