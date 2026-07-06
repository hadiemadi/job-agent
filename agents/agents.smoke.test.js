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
  test('exports reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, hrSystemPrompt, stealthWritingDirective, pinDisciplineSkill, reviewTailoredCV, draftFromSidebarDiscussion', () => {
    ['reviewCV', 'analyzeJobFit', 'refineWithHR', 'chatWithHRExpert', 'researchCvConventions', 'hrSystemPrompt', 'stealthWritingDirective', 'pinDisciplineSkill', 'reviewTailoredCV', 'draftFromSidebarDiscussion']
      .forEach(name => expect(typeof recruiter[name]).toBe('function'));
    expect(typeof recruiter.EVIDENCE_HIERARCHY).toBe('string');
  });
  test('draftFromSidebarDiscussion makes zero AI calls and returns null when there is no new sidebar conversation (#29/#31 gating)', async () => {
    const callsBefore = client.messages.create.mock.calls.length;
    const result = await recruiter.draftFromSidebarDiscussion('cv text', { job_title: 'TPM' }, [], {});
    expect(result).toBeNull();
    expect(client.messages.create.mock.calls.length).toBe(callsBefore);
  });
  test('draftFromSidebarDiscussion returns the drafted statement when new conversation produced one', async () => {
    mockTextResponse(JSON.stringify({ added: true, description: 'Led a cross-functional team of 8', rationale: 'Confirmed in sidebar chat', targetSection: 'Experience' }));
    const result = await recruiter.draftFromSidebarDiscussion('cv text', { job_title: 'TPM' }, [{ role: 'user', text: 'I actually led 8 people on that project' }, { role: 'expert', text: 'Got it, noted.' }], {});
    expect(result).toMatchObject({ description: 'Led a cross-functional team of 8', targetSection: 'Experience' });
  });
  test('draftFromSidebarDiscussion returns null when HR concludes nothing new emerged', async () => {
    mockTextResponse(JSON.stringify({ added: false, description: '', rationale: '', targetSection: '' }));
    const result = await recruiter.draftFromSidebarDiscussion('cv text', { job_title: 'TPM' }, [{ role: 'user', text: 'just asking a question' }, { role: 'expert', text: 'here is the answer' }], {});
    expect(result).toBeNull();
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
  test('reviewCV passes through fit_explanation (the weak/moderate-fit rationale) with no extra AI call', async () => {
    mockTextResponse(JSON.stringify({
      overall_match: 'Weak', strengths: [], recommended_sections: [], section_rationale: '', auto_changes: [],
      fit_explanation: "This role requires 5+ years of embedded firmware experience, which isn't evidenced anywhere in this CV.",
    }));
    const callsBefore = client.messages.create.mock.calls.length;
    const { review } = await recruiter.reviewCV('cv text', { job_title: 'Firmware Engineer' }, [], {});
    expect(review.fit_explanation).toContain('embedded firmware experience');
    // Same 2 calls as the Strong-match case above (HR review + detectField) — the rationale
    // came from the existing reviewCV call's own JSON output, not a separate request.
    expect(client.messages.create.mock.calls.length - callsBefore).toBe(2);
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
  test('reviewTailoredCV uses ONLY the PRE-RELEASE REVIEW section as its system prompt, not the writing/persona instructions', async () => {
    mockTextResponse(JSON.stringify({ checks: [], verdict: 'SHIP', required_edits: [] }));
    await recruiter.reviewTailoredCV({ tailoredCv: { summary: 'Senior TPM with RF background.' }, job: { job_title: 'TPM', employer_name: 'Acme Corp' }, sourceCvText: 'source cv text' });
    const call = client.messages.create.mock.calls[0][0];
    expect(call.system).toContain('PRE-RELEASE REVIEW');
    expect(call.system).toContain('CHECKLIST');
    expect(call.system).not.toContain('top-tier Senior HR Manager');
  });
  test('reviewTailoredCV returns FIX_REQUIRED with required_edits when the target company name leaked into the CV', async () => {
    mockTextResponse(JSON.stringify({
      checks: [{ item: 'Target company or role name appears anywhere in the CV body or summary', verdict: 'FAIL', evidence: 'Summary mentions "Acme Corp"', fix: 'Remove "Acme Corp" from the summary' }],
      verdict: 'FIX_REQUIRED',
      required_edits: ['Remove the company name "Acme Corp" from the summary'],
    }));
    const result = await recruiter.reviewTailoredCV({ tailoredCv: { summary: 'Excited to join Acme Corp as a TPM.' }, job: { job_title: 'TPM', employer_name: 'Acme Corp' }, sourceCvText: 'source cv text' });
    expect(result.verdict).toBe('FIX_REQUIRED');
    expect(result.required_edits.join(' ')).toMatch(/Acme Corp/);
  });
  test('reviewTailoredCV returns SHIP for a clean CV with no red flags', async () => {
    mockTextResponse(JSON.stringify({ checks: [{ item: 'Target company or role name', verdict: 'PASS', evidence: '', fix: '' }], verdict: 'SHIP', required_edits: [] }));
    const result = await recruiter.reviewTailoredCV({ tailoredCv: { summary: 'Senior TPM with deep RF background.' }, job: { job_title: 'TPM', employer_name: 'Acme Corp' }, sourceCvText: 'source cv text' });
    expect(result.verdict).toBe('SHIP');
    expect(result.required_edits).toEqual([]);
  });
  test('reviewCV and reviewTailoredCV do not pass temperature to the Claude API (regression: ERR-HR-003 on models that reject temperature)', async () => {
    mockTextResponse(JSON.stringify({ overall_match: 'Strong', strengths: [], recommended_sections: [], section_rationale: '', auto_changes: [] }));
    await recruiter.reviewCV('cv text', { job_title: 'TPM' }, [], {});
    client.messages.create.mock.calls.forEach(([params]) => {
      expect(params).not.toHaveProperty('temperature');
    });
    client.messages.create.mockClear();
    mockTextResponse(JSON.stringify({ checks: [], verdict: 'SHIP', required_edits: [] }));
    await recruiter.reviewTailoredCV({ tailoredCv: { summary: 'Senior TPM.' }, job: { job_title: 'TPM', employer_name: 'Acme' }, sourceCvText: 'cv text' });
    client.messages.create.mock.calls.forEach(([params]) => {
      expect(params).not.toHaveProperty('temperature');
    });
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
  test('rewriteCVWithChanges treats an unanswered gap (no status field) the same as an explicit skip — never "left undecided", never invented', async () => {
    mockTextResponse(JSON.stringify({
      cv: { name: 'Jane Doe', summary: 'Senior TPM.', experience: [], education: [] },
      modified_sections: ['summary'],
    }));
    const gapDiscussions = [
      { description: 'Mention PMP certification', rationale: 'Listed as preferred in JD' /* no status — left unanswered by the candidate */ },
      { description: 'Add leadership scope', rationale: 'Could strengthen fit', status: 'accepted', refinedDescription: 'Led a team of 5' },
    ];
    const fs = require('fs');
    const result = await cvWriter.rewriteCVWithChanges(
      'cv text', { job_title: 'TPM', employer_name: 'Acme' }, [], [], null, null, null, [], undefined, [], null, gapDiscussions
    );
    try {
      const summaryMessage = result.hrDisplayHistory[result.hrDisplayHistory.length - 1].text;
      expect(summaryMessage).toContain('Mention PMP certification** — skipped — not added');
      expect(summaryMessage).not.toContain('left undecided');
      expect(summaryMessage).toContain('Led a team of 5');
    } finally {
      fs.rmSync(result.filePath, { force: true });
    }
  });
  test('rewriteCVWithChanges renders this session\'s running AI cost on the tailored CV page, not the global daily total', async () => {
    mockTextResponse(JSON.stringify({
      cv: { name: 'Jane Doe', summary: 'Senior TPM.', experience: [], education: [] },
      modified_sections: ['summary'],
    }));
    const fs = require('fs');
    const { als, addSessionSpend } = require('../services/session');
    const result = await als.run('cost-display-test-sid', async () => {
      addSessionSpend(1.2345);
      return cvWriter.rewriteCVWithChanges('cv text', { job_title: 'TPM', employer_name: 'Acme' }, [], [], null, null, null, [], undefined, [], null, []);
    });
    try {
      const html = fs.readFileSync(result.filePath, 'utf8');
      expect(html).toContain('AI cost for this CV: $1.23');
    } finally {
      fs.rmSync(result.filePath, { force: true });
    }
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
  test('analyzeGaps does not pass temperature to the Claude API (regression: temperature deprecated on newer models)', async () => {
    mockTextResponse(JSON.stringify({ gaps: [] }));
    await coach.analyzeGaps('cv text', { job_title: 'TPM' });
    client.messages.create.mock.calls.forEach(([params]) => {
      expect(params).not.toHaveProperty('temperature');
    });
  });
});
