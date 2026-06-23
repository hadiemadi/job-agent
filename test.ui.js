// test.ui.js — Fast functional tests (no Claude API calls, no Jooble calls)
// What these tests verify:
//   - Every route exists and accepts the right request shape
//   - The server returns the right HTTP status codes and response structure
//   - Error handling fires correctly (missing fields, empty session, login walls)
// What they do NOT verify:
//   - Quality or accuracy of AI output (that's test.js / test:content)
// Runtime: < 10 seconds   Cost: $0

require('dotenv').config();

// ── Mocks ─────────────────────────────────────────────────────────────────────
// jest.mock() is hoisted by Jest to run before any require().
// So when agent.js loads and calls require('./agents/recruiter') etc., it gets the mocks below.

jest.mock('./agents/extractor', () => ({
  extractJobTitles: jest.fn(),
  parseJobFromText: jest.fn(),
}));

jest.mock('./agents/recruiter', () => ({
  reviewCV:              jest.fn(),
  analyzeJobFit:         jest.fn(),
  refineWithHR:          jest.fn(),
  chatWithHRExpert:      jest.fn(),
  researchCvConventions: jest.fn(),
  pinDisciplineSkill:    jest.fn(),
  reviewTailoredCV:      jest.fn(),
}));

jest.mock('./agents/inputRouter', () => ({
  classify: jest.fn(),
}));

jest.mock('./agents/cvWriter', () => ({
  parseCVStructure:     jest.fn(),
  rewriteCVWithChanges: jest.fn(),
  adjustLanguageLevel:  jest.fn(),
  applyConcernChange:   jest.fn(),
}));

jest.mock('./agents/coach', () => ({
  analyzeAndSuggestRoles: jest.fn(),
  matchRolesToMarket:     jest.fn(),
  buildCareerPath:        jest.fn(),
  analyzeGaps:            jest.fn(),
  selectTopGaps:          jest.fn(),
  chatWithCoach:          jest.fn(),
}));

jest.mock('./src/cv',       () => ({ readCV: jest.fn() }));
jest.mock('./src/jobs',     () => ({ searchAllLocations: jest.fn() }));
jest.mock('./src/scraper',  () => ({ scrapeJobPage: jest.fn() }));
jest.mock('./render/cvHtml', () => ({
  generateExecutiveTemplate: jest.fn().mockReturnValue('<html>cv</html>'),
}));
jest.mock('./render/comparison', () => ({
  generateComparisonTemplate: jest.fn().mockReturnValue('<html>compare</html>'),
}));
jest.mock('./src/wordExport', () => ({ generateWordCV: jest.fn(), generateWordCVAlt: jest.fn() }));
jest.mock('./src/wordTemplateExport', () => ({ generateWordFromTemplate: jest.fn() }));
jest.mock('fs-extra', () => ({
  outputFile: jest.fn(),
  ensureDirSync: jest.fn(),
  readFile: jest.fn().mockResolvedValue(Buffer.from('')),
  remove: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('pizzip', () => jest.fn().mockImplementation(() => ({})));

// ── Test fixtures ──────────────────────────────────────────────────────────────

const MOCK_CV_DATA = {
  name: 'Hadi Emadi', title: 'Technical Program Manager',
  email: 'h@test.com', phone: '+1 555 0000',
  location: 'San Jose, CA', linkedin: '',
  summary: 'Experienced TPM with RF hardware background.',
  key_qualifications: ['RF Systems', 'Cross-functional leadership'],
  experience: [{ role: 'Sr TPM', company: 'Qualcomm', period: '2019-2024', bullets: ['Led RF programs'] }],
  education: [{ degree: 'BSc EE', school: 'Test University', year: '2015' }],
  skills: ['RF Systems', 'Program Management', 'JIRA'],
  additional_sections: [],
};

const MOCK_JOB = {
  job_id: 'imported-1',
  job_title: 'Technical Program Manager',
  employer_name: 'Apple',
  job_city: 'Cupertino',
  job_country: 'US',
  job_description: 'Senior TPM role at Apple hardware division. Requirements: RF, ASIC, JIRA.',
  job_employment_type: 'Full-time',
  job_apply_link: 'https://apple.com/jobs',
  job_is_remote: false,
};

const MOCK_REVIEW = {
  overall_match: 'Strong',
  strengths: ['RF background matches JD', 'TPM experience is directly relevant'],
  recommended_sections: ['summary', 'skills', 'experience', 'education'],
  section_rationale: 'Standard structure works well for senior hardware TPM roles.',
  auto_changes: [{ description: 'Move ASIC to top of skills list', rationale: 'First keyword in JD' }],
};

// confirm_changes now comes from the Coach's analyzeGaps + selectTopGaps, not reviewCV —
// selectTopGaps is mocked as an identity passthrough below, so this is what ends up in
// review.confirm_changes.
const MOCK_GAPS = [
  { description: 'Mention PMP certification', rationale: 'Listed as preferred in JD', severity: 'mild' },
];

// ── Module references (for setting return values in beforeEach / beforeAll) ────

const { parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange } = require('./agents/cvWriter');
const { reviewCV, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV } = require('./agents/recruiter');
const { parseJobFromText } = require('./agents/extractor');
const { classify } = require('./agents/inputRouter');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach } = require('./agents/coach');
const { readCV }        = require('./src/cv');
const { scrapeJobPage } = require('./src/scraper');
const { generateWordCV, generateWordCVAlt } = require('./src/wordExport');
const { generateWordFromTemplate } = require('./src/wordTemplateExport');
const fse               = require('fs-extra');
const request           = require('supertest');
const app               = require('./server');

// services/session.js now keys sessions off a "sid" cookie (AsyncLocalStorage per request),
// so multiple users no longer share one global appSession. These tests were written when
// there WAS one global session and deliberately chain several requests expecting state
// (cvText, confirmedContact, hrThread, coachHistory...) to persist between them — that's
// still true for one real browser, since it sends the same cookie on every request. A plain
// `request(app)` call doesn't carry cookies between calls, so it now looks like a fresh user
// each time. `request.agent(app)` is supertest's cookie jar — it keeps the "sid" cookie
// returned by the first response and resends it on every subsequent call, exactly
// reproducing one continuous browser session. Every former `request(app)` call below now
// uses this shared `agent` instead.
const agent              = request.agent(app);

// ── Default return values — reset before every test ───────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  readCV.mockResolvedValue('Hadi Emadi\nTPM\nh@test.com\n+1 555 0000\nlinkedin.com/in/hadi');
  parseCVStructure.mockResolvedValue(MOCK_CV_DATA);
  reviewCV.mockResolvedValue({ review: MOCK_REVIEW, thread: [] });
  classify.mockResolvedValue({ bucket: 'none', text: '' });
  analyzeGaps.mockResolvedValue(MOCK_GAPS);
  selectTopGaps.mockImplementation(gaps => gaps);
  rewriteCVWithChanges.mockResolvedValue({
    filePath: 'output/cv_Apple.html',
    cvData: MOCK_CV_DATA,
    modified_sections: ['summary', 'skills'],
    thread: [],
    hrDisplayHistory: [],
  });
  reviewTailoredCV.mockResolvedValue({ checks: [], verdict: 'SHIP', required_edits: [] });
  parseJobFromText.mockResolvedValue(MOCK_JOB);
  // Mirrors real behavior of growing the thread (instead of a static value) so tests can
  // detect whether the server is still wiping appSession.coachHistory between calls.
  chatWithCoach.mockImplementation((cvText, job, hrReview, history, userMessage) => Promise.resolve({
    reply: 'Highlight your RF work on 5G programs.',
    history: [...(history || []), { role: 'user', content: userMessage }, { role: 'assistant', content: 'Highlight your RF work on 5G programs.' }],
  }));
  refineWithHR.mockResolvedValue({
    result: { refined_description: 'Add PMP certification', rationale: 'JD prefers it', verdict: 'candidate_decides' },
    thread: [],
  });
  chatWithHRExpert.mockResolvedValue({ reply: 'Your PMP progress should resolve that gap.', thread: [] });
  adjustLanguageLevel.mockResolvedValue({
    cvData: { ...MOCK_CV_DATA, summary: 'Polished senior-level summary.' },
    templateSuggestion: '',
    filePath: 'output/cv_Apple.html',
    thread: [],
    hrDisplayHistory: [],
  });
  generateWordCV.mockResolvedValue('output/cv_word_Apple.docx');
  generateWordCVAlt.mockResolvedValue('output/cv_word_alt_Apple.docx');
  generateWordFromTemplate.mockResolvedValue({ wordPath: 'output/cv_word_custom_Apple.docx', thread: [] });
  fse.outputFile.mockResolvedValue(undefined);
  fse.readFile.mockResolvedValue(Buffer.from(''));
  scrapeJobPage.mockResolvedValue('Technical Program Manager at Apple. Requirements: RF, ASIC.');
  analyzeAndSuggestRoles.mockResolvedValue({
    profile: { current_level: 'Senior', key_strengths: ['RF'], domain_expertise: ['Hardware'], years_experience: 10, trajectory: 'Leadership' },
    suggested_roles: [{ title: 'Director of Engineering', why_fit: 'Strong leadership track record', why_next_step: 'Natural progression', typical_in_market: true }],
  });
  matchRolesToMarket.mockResolvedValue([]);
  buildCareerPath.mockResolvedValue({
    key_challenges: ['Expanding team size beyond 5'], skill_gaps: ['P&L ownership'],
    quick_wins: ['Get PMP certification'], success_at_6_months: 'Own a full product line',
    success_at_12_months: 'Launched first product as director', long_term_trajectory: 'VP Engineering in 3 years',
  });
});

// ── 1. Error handling (session is empty at this point — no upload has run) ────

describe('Error handling — no CV in session', () => {
  test('POST /review-cv → 400 when no CV is loaded', async () => {
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /coach/discuss → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/discuss').send({ message: 'Hello', gapId: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /hr/refine → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/refine').send({ gapId: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /hr/chat → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/chat').send({ message: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /hr/apply-concern → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/apply-concern').send({ fieldText: 'x', selectedText: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /coach/analyze → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/analyze').send({ direction: 'leadership' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /coach/path → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/path').send({ roleTitle: 'Director of Engineering' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /adjust-language → 400 when no CV is loaded', async () => {
    const res = await agent.post('/adjust-language').send({ cvData: MOCK_CV_DATA, job: MOCK_JOB, languageLevel: 3 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /build-comparison → 400 when no CV has been tailored yet', async () => {
    const res = await agent.post('/build-comparison').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── 2. Error handling — missing required fields (stateless) ───────────────────

describe('Error handling — missing required fields', () => {
  test('POST /fetch-job → 400 when neither url nor jobText is provided', async () => {
    const res = await agent.post('/fetch-job').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /review-cv → 400 when job field is missing', async () => {
    // Even if CV is loaded, omitting `job` must return 400
    const res = await agent.post('/review-cv').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /coach/analyze → 400 when direction field is missing', async () => {
    const res = await agent.post('/coach/analyze').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── 3. POST /upload-cv ────────────────────────────────────────────────────────

describe('POST /upload-cv', () => {
  test('returns 200 with cvPath and cvData when a PDF is uploaded', async () => {
    const res = await agent.post('/upload-cv').attach('cv', 'cv.pdf');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cvPath');
    expect(res.body).toHaveProperty('cvData');
    expect(res.body.cvData.name).toBe('Hadi Emadi');
    expect(res.body.cvData).toHaveProperty('experience');
    expect(res.body.cvData).toHaveProperty('skills');
  });
});

// ── 4. POST /fetch-job ────────────────────────────────────────────────────────

describe('POST /fetch-job', () => {
  test('returns 200 with job object when jobText is pasted directly', async () => {
    const res = await agent
      .post('/fetch-job')
      .send({ jobText: 'Technical Program Manager at Apple. Requirements: RF, ASIC.' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('job');
    expect(res.body.job).toHaveProperty('job_title');
    expect(res.body.job).toHaveProperty('employer_name');
    expect(res.body.job).toHaveProperty('job_description');
  });

  test('returns 200 when a job URL is provided (scraper mocked)', async () => {
    const res = await agent
      .post('/fetch-job')
      .send({ url: 'https://linkedin.com/jobs/view/tpm-apple-123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('job');
  });

  test('returns 422 with loginWall flag when scraper hits a LinkedIn login wall', async () => {
    scrapeJobPage.mockRejectedValue(new Error('LOGIN_WALL'));
    const res = await agent
      .post('/fetch-job')
      .send({ url: 'https://linkedin.com/jobs/view/private-123' });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('loginWall', true);
  });
});

// ── 5. Session-dependent happy paths ──────────────────────────────────────────

describe('Session-dependent endpoints (CV uploaded + HR review done)', () => {
  // Populate the session once before running this group.
  // We re-set mock return values here so beforeAll doesn't rely on state from
  // a previous test's beforeEach call.
  beforeAll(async () => {
    readCV.mockResolvedValue('Hadi Emadi\nTPM\nh@test.com\n+1 555 0000');
    parseCVStructure.mockResolvedValue(MOCK_CV_DATA);
    reviewCV.mockResolvedValue({ review: MOCK_REVIEW, thread: [] });
    analyzeGaps.mockResolvedValue(MOCK_GAPS);
    selectTopGaps.mockImplementation(gaps => gaps);
    await agent.post('/upload-cv').attach('cv', 'cv.pdf');
    await agent.post('/review-cv').send({ job: MOCK_JOB });
  });

  // Gaps are persisted server-side with a generated id (services/gapStore.js), and several
  // tests in this block call /review-cv for unrelated reasons (clientPreferences pass-through,
  // gapSeverities filtering, etc.) — each call regenerates the gap list with fresh ids. So
  // gap-dependent tests fetch a current id right before they need one, rather than reusing one
  // captured once in beforeAll, which would go stale the moment any intervening test re-runs
  // /review-cv.
  async function currentGapId() {
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    return res.body.confirm_changes[0].id;
  }

  test('POST /review-cv returns 200 with full review structure', async () => {
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall_match');
    expect(res.body).toHaveProperty('strengths');
    expect(res.body).toHaveProperty('auto_changes');
    expect(res.body).toHaveProperty('confirm_changes');
    expect(Array.isArray(res.body.auto_changes)).toBe(true);
    expect(Array.isArray(res.body.confirm_changes)).toBe(true);
    // Each gap gets a stable, server-assigned id (services/gapStore.js) — the contract
    // /coach/discuss, /hr/refine, and /gap-decision all key off now.
    expect(res.body.confirm_changes[0]).toHaveProperty('id');
    expect(typeof res.body.confirm_changes[0].id).toBe('string');
  });

  test('POST /confirm-contact stores clientPreferences and /review-cv passes them through', async () => {
    const contactRes = await agent.post('/confirm-contact').send({
      name: 'Hadi Emadi', customInstructions: 'Never mention my current employer by name', tone: 2,
    });
    expect(contactRes.status).toBe(200);

    await agent.post('/review-cv').send({ job: MOCK_JOB });
    const lastCall = reviewCV.mock.calls[reviewCV.mock.calls.length - 1];
    expect(lastCall[3]).toEqual({
      tone: 2, customInstructions: 'Never mention my current employer by name', languageLevel: 2,
      extensiveSearch: false, conventionsResearch: '', gapSeverities: ['major'],
      refreshDiscipline: false, routedInstruction: { bucket: 'none', text: '' }, routedInstructionApplied: false,
    });
  });

  test('POST /confirm-contact routes a discipline-bucket comment, and /review-cv pins it once a field is known', async () => {
    classify.mockResolvedValue({ bucket: 'discipline', text: 'Hands-on GaN PA tuning experience' });
    reviewCV.mockResolvedValue({ review: MOCK_REVIEW, field: { field: 'RF/Hardware Engineering', seniority: 'senior' }, thread: [] });

    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', customInstructions: 'Hands-on GaN PA tuning experience' });
    await agent.post('/review-cv').send({ job: MOCK_JOB });

    expect(pinDisciplineSkill).toHaveBeenCalledWith(
      { field: 'RF/Hardware Engineering', seniority: 'senior' },
      'Hands-on GaN PA tuning experience'
    );

    // A second /review-cv in the same contact-confirmation session must not re-pin.
    const callsBefore = pinDisciplineSkill.mock.calls.length;
    await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(pinDisciplineSkill.mock.calls.length).toBe(callsBefore);
  });

  test('POST /confirm-contact with a general-bucket comment does not call pinDisciplineSkill', async () => {
    classify.mockResolvedValue({ bucket: 'general', text: 'Prefer a one-page CV.' });
    reviewCV.mockResolvedValue({ review: MOCK_REVIEW, field: { field: 'RF/Hardware Engineering', seniority: 'senior' }, thread: [] });

    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', customInstructions: 'Prefer a one-page CV.' });
    await agent.post('/review-cv').send({ job: MOCK_JOB });

    expect(pinDisciplineSkill).not.toHaveBeenCalled();
  });

  test('POST /confirm-contact with gapSeverities filters which severities selectTopGaps sees', async () => {
    selectTopGaps.mockClear();
    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', gapSeverities: ['major'] });
    await agent.post('/review-cv').send({ job: MOCK_JOB });
    const lastCall = selectTopGaps.mock.calls[selectTopGaps.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(['major']);
  });

  test('POST /confirm-contact with extensiveSearch makes /review-cv research conventions once and cache the result', async () => {
    researchCvConventions.mockResolvedValue('In Sweden, hobbies are commonly listed; photos are common.');
    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', extensiveSearch: true });

    await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(researchCvConventions).toHaveBeenCalledWith(MOCK_JOB, expect.any(String));
    let lastCall = reviewCV.mock.calls[reviewCV.mock.calls.length - 1];
    expect(lastCall[3].conventionsResearch).toBe('In Sweden, hobbies are commonly listed; photos are common.');

    const callsBefore = researchCvConventions.mock.calls.length;
    await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(researchCvConventions.mock.calls.length).toBe(callsBefore); // cached — not re-researched
  });

  test('POST /rewrite returns 200 with filePath only — comparison is built lazily, not here', async () => {
    const res = await agent.post('/rewrite').send({
      job: MOCK_JOB,
      cvPath: 'cv.pdf',
      autoChanges: [{ description: 'Move ASIC to top of skills' }],
      confirmedChanges: [],
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('filePath');
    expect(res.body).not.toHaveProperty('comparisonPath');
  });

  test('POST /rewrite runs the independent review loop: a FIX_REQUIRED verdict triggers one targeted revision, then ships clean', async () => {
    const dirtyCv = { ...MOCK_CV_DATA, summary: 'Excited to join Apple as a TPM.' };
    const cleanCv = { ...MOCK_CV_DATA, summary: 'Senior TPM with deep RF hardware background.' };
    rewriteCVWithChanges
      .mockResolvedValueOnce({ filePath: 'output/cv_Apple.html', cvData: dirtyCv, modified_sections: ['summary'], thread: [], hrDisplayHistory: [] })
      .mockResolvedValueOnce({ filePath: 'output/cv_Apple.html', cvData: cleanCv, modified_sections: ['summary'], thread: [], hrDisplayHistory: [] });
    reviewTailoredCV
      .mockResolvedValueOnce({ checks: [], verdict: 'FIX_REQUIRED', required_edits: ['Remove the company name "Apple" from the summary'] })
      .mockResolvedValueOnce({ checks: [], verdict: 'SHIP', required_edits: [] });

    const res = await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.reviewIssues).toEqual([]);
    expect(rewriteCVWithChanges).toHaveBeenCalledTimes(2);
    expect(reviewTailoredCV).toHaveBeenCalledTimes(2);
    // the second writer call is the targeted revision — it carries the required edit forward,
    // not a from-scratch regeneration
    const secondCallChanges = rewriteCVWithChanges.mock.calls[1][3];
    expect(secondCallChanges).toEqual([{ description: 'Remove the company name "Apple" from the summary' }]);
  });

  test('POST /rewrite surfaces remaining review issues after exhausting the 2-pass revision limit', async () => {
    reviewTailoredCV.mockResolvedValue({ checks: [], verdict: 'FIX_REQUIRED', required_edits: ['Remove the company name "Apple" from the summary'] });

    const res = await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.reviewIssues).toEqual(['Remove the company name "Apple" from the summary']);
    // 1 initial write + 2 revision passes = 3; 3 reviews, one per write
    expect(rewriteCVWithChanges).toHaveBeenCalledTimes(3);
    expect(reviewTailoredCV).toHaveBeenCalledTimes(3);
  });

  test('POST /build-comparison returns 200 with comparisonPath after a CV has been tailored', async () => {
    await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });
    const res = await agent.post('/build-comparison').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('comparisonPath');
  });

  test('POST /coach/discuss returns 200 with a reply string', async () => {
    const gapId = await currentGapId();
    const res = await agent
      .post('/coach/discuss')
      .send({ message: 'I have 10 years of RF hardware experience.', gapId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(typeof res.body.reply).toBe('string');
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  test('POST /hr/refine returns 200 with verdict and refined_description', async () => {
    // The conversation /hr/refine reads now comes from the server-side gap record, not a
    // client-submitted transcript — populate it via /coach/discuss first.
    const gapId = await currentGapId();
    await agent.post('/coach/discuss').send({ message: 'I am studying for PMP right now.', gapId });
    const res = await agent.post('/hr/refine').send({ gapId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('refined_description');
    expect(res.body).toHaveProperty('verdict');
    expect(['add', 'skip', 'candidate_decides']).toContain(res.body.verdict);
  });

  test('POST /hr/refine → 400 when gapId does not exist', async () => {
    const res = await agent.post('/hr/refine').send({ gapId: 'no-such-gap' });
    expect(res.status).toBe(400);
  });

  test('POST /gap-decision marks a gap accepted, and /rewrite picks it up without any client-submitted change list', async () => {
    const gapId = await currentGapId();
    const res = await agent.post('/gap-decision').send({ gapId, status: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await agent.post('/rewrite').send({ job: MOCK_JOB });
    const lastCall = rewriteCVWithChanges.mock.calls[rewriteCVWithChanges.mock.calls.length - 1];
    const confirmedChanges = lastCall[3];
    expect(confirmedChanges.some(c => c.description === MOCK_GAPS[0].description)).toBe(true);
  });

  test('POST /gap-decision → 400 for an invalid status value', async () => {
    const gapId = await currentGapId();
    const res = await agent.post('/gap-decision').send({ gapId, status: 'maybe' });
    expect(res.status).toBe(400);
  });

  test('POST /hr/chat returns 200 with a reply string', async () => {
    const res = await agent.post('/hr/chat').send({ message: 'Why was PMP flagged as a gap?' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(typeof res.body.reply).toBe('string');
  });

  test('POST /hr/chat → 400 when message is missing', async () => {
    const res = await agent.post('/hr/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /hr/chat with a concern injects the selected excerpt and first-turn quote instruction', async () => {
    await agent.post('/hr/chat').send({
      message: 'Should I mention this differently?',
      concern: { selectedText: 'led RF integration', isFirst: true },
    });
    const lastCall = chatWithHRExpert.mock.calls[chatWithHRExpert.mock.calls.length - 1];
    expect(lastCall[3]).toContain('led RF integration');
    expect(lastCall[3]).toContain('quote or restate');
  });

  test('POST /hr/apply-concern returns 200 with revisedText and changed flag', async () => {
    applyConcernChange.mockResolvedValue({ revisedText: 'Led RF integration across 3 product lines.', changed: true, thread: [] });
    const res = await agent.post('/hr/apply-concern').send({
      job: MOCK_JOB, fieldText: 'Led RF integration.', selectedText: 'RF integration',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revisedText');
    expect(res.body.changed).toBe(true);
  });

  test('POST /hr/apply-concern propagates changed:false when the discussion concluded no edit was needed', async () => {
    applyConcernChange.mockResolvedValue({ revisedText: 'Led RF integration.', changed: false, thread: [] });
    const res = await agent.post('/hr/apply-concern').send({
      job: MOCK_JOB, fieldText: 'Led RF integration.', selectedText: 'RF integration',
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
  });

  test('POST /hr/apply-concern → 400 when fieldText or selectedText is missing', async () => {
    const res = await agent.post('/hr/apply-concern').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /coach/analyze returns 200 with profile and suggestedRoles array', async () => {
    const res = await agent.post('/coach/analyze').send({ direction: 'leadership' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profile');
    expect(res.body).toHaveProperty('suggestedRoles');
    expect(Array.isArray(res.body.suggestedRoles)).toBe(true);
  });

  test('POST /coach/path returns 200 with key_challenges and skill_gaps', async () => {
    const res = await agent.post('/coach/path').send({ roleTitle: 'Director of Engineering' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('key_challenges');
    expect(res.body).toHaveProperty('skill_gaps');
    expect(res.body).toHaveProperty('long_term_trajectory');
  });

  test('POST /adjust-language returns 200 with updated cvData and filePath', async () => {
    const res = await agent.post('/adjust-language').send({
      cvData: MOCK_CV_DATA, job: MOCK_JOB, languageLevel: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cvData');
    expect(res.body).toHaveProperty('filePath');
    expect(adjustLanguageLevel).toHaveBeenCalled();
    const lastCall = adjustLanguageLevel.mock.calls[adjustLanguageLevel.mock.calls.length - 1];
    expect(lastCall[3]).toBe(5); // languageLevel argument
  });

  test('POST /adjust-language → 400 when cvData or job is missing', async () => {
    const res = await agent.post('/adjust-language').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('HR sidebar display history survives a wording regeneration (not cleared)', async () => {
    await agent.post('/hr/chat').send({ message: 'Why was the summary reworded?' });

    await agent.post('/adjust-language').send({ cvData: MOCK_CV_DATA, job: MOCK_JOB, languageLevel: 3 });
    const lastCall = adjustLanguageLevel.mock.calls[adjustLanguageLevel.mock.calls.length - 1];
    const historyPassedIn = lastCall[6]; // hrDisplayHistory argument

    // would be [] if the server reset appSession.hrDisplayHistory instead of accumulating it
    expect(historyPassedIn.length).toBeGreaterThan(0);
  });

  test('Career Coach thread persists across /review-cv calls (not reset per job)', async () => {
    const firstGapId = await currentGapId();
    await agent.post('/coach/discuss').send({ message: 'I led a 12-person RF team.', gapId: firstGapId });
    // /review-cv regenerates the gap list (and its ids) from scratch for the new job — grab
    // the fresh id rather than reusing one from before this call.
    const secondGapId = await currentGapId();
    await agent.post('/coach/discuss').send({ message: 'Anything else I should mention?', gapId: secondGapId });

    // The history passed into this last call would be [] if /review-cv still wiped
    // appSession.coachHistory — instead it must carry over the first exchange.
    const lastCallArgs = chatWithCoach.mock.calls[chatWithCoach.mock.calls.length - 1];
    expect(lastCallArgs[3].length).toBeGreaterThan(0);
  });
});

// ── 6. POST /export-word (stateless — no session needed) ──────────────────────

describe('POST /export-word', () => {
  test('returns 200 with wordPath when cvData and job are provided', async () => {
    const res = await agent.post('/export-word').send({ cvData: MOCK_CV_DATA, job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wordPath');
  });

  test('returns 400 when cvData is missing', async () => {
    const res = await agent.post('/export-word').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when job is missing', async () => {
    const res = await agent.post('/export-word').send({ cvData: MOCK_CV_DATA });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('uses the custom template renderer when templatePath is provided', async () => {
    const res = await agent.post('/export-word').send({
      cvData: MOCK_CV_DATA, job: MOCK_JOB, templatePath: 'uploads/templates/fake.docx',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wordPath', 'output/cv_word_custom_Apple.docx');
    expect(generateWordFromTemplate).toHaveBeenCalled();
    expect(generateWordCV).not.toHaveBeenCalled();
  });

  test('returns 400 when templatePath escapes uploads/templates', async () => {
    const res = await agent.post('/export-word').send({
      cvData: MOCK_CV_DATA, job: MOCK_JOB, templatePath: '../../etc/passwd',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('uses the alternate built-in template when templateStyle is "alternate"', async () => {
    const res = await agent.post('/export-word').send({
      cvData: MOCK_CV_DATA, job: MOCK_JOB, templateStyle: 'alternate',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wordPath', 'output/cv_word_alt_Apple.docx');
    expect(generateWordCVAlt).toHaveBeenCalled();
    expect(generateWordCV).not.toHaveBeenCalled();
  });

  test('returns 501 when templateStyle is "original"', async () => {
    const res = await agent.post('/export-word').send({
      cvData: MOCK_CV_DATA, job: MOCK_JOB, templateStyle: 'original',
    });
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
  });
});

// ── 7. POST /upload-template (stateless — no session needed) ──────────────────

describe('POST /upload-template', () => {
  test('returns 200 with templatePath for a valid .docx upload', async () => {
    const res = await agent
      .post('/upload-template')
      .attach('template', 'templates/word/starter_template.docx');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templatePath');
    expect(res.body.templatePath).toMatch(/\.docx$/);
  });

  test('returns 400 when no file is attached', async () => {
    const res = await agent.post('/upload-template');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── 8. Contact page markup — Advanced options panel ────────────────────────────

describe('#contactCard Advanced options panel (public/index.html)', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, 'public', 'index.html'), 'utf8');

  test('ci-refresh-discipline checkbox is present and unchecked by default', () => {
    const match = html.match(/<input[^>]*id="ci-refresh-discipline"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toMatch(/\bchecked\b/);
  });

  test('ci-extensive-search remains present and unchecked by default (unaffected by this change)', () => {
    const match = html.match(/<input[^>]*id="ci-extensive-search"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toMatch(/\bchecked\b/);
  });
});

// ── 9. Per-browser session isolation (services/session.js) ─────────────────────

describe('Per-browser session isolation', () => {
  test('two requests with no cookie each get their own distinct "sid" cookie', async () => {
    const resA = await request(app).post('/confirm-contact').send({ name: 'AAA', customInstructions: '' });
    const resB = await request(app).post('/confirm-contact').send({ name: 'BBB', customInstructions: '' });
    const sidA = (resA.headers['set-cookie'] || []).find(c => c.startsWith('sid='));
    const sidB = (resB.headers['set-cookie'] || []).find(c => c.startsWith('sid='));
    expect(sidA).toBeDefined();
    expect(sidB).toBeDefined();
    expect(sidA).not.toBe(sidB);
  });

  test('two different session cookies (two browsers) get two independent sessions — confirmedContact does not leak between them', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    await agentA.post('/confirm-contact').send({ name: 'AAA', customInstructions: '' });
    await agentB.post('/confirm-contact').send({ name: 'BBB', customInstructions: '' });

    await agentA.post('/rewrite').send({ job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [] });
    await agentB.post('/rewrite').send({ job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [] });

    const calls = rewriteCVWithChanges.mock.calls;
    const confirmedContactA = calls[calls.length - 2][6]; // 7th positional arg = confirmedContact
    const confirmedContactB = calls[calls.length - 1][6];

    expect(confirmedContactA.name).toBe('AAA');
    expect(confirmedContactB.name).toBe('BBB');
  });
});

// ── 10. GET /output/:file — session-scoped access only (PII leak fix) ──────────
// output/ used to be served via plain express.static — anyone who guessed a filename like
// output/cv_Rivian.html could open another candidate's full CV (name, email, phone, work
// history), no session check at all. Now every file is named <sid>_<random>.<ext>
// (services/session.js's registerOutputFile) and only servable to the session that
// generated it, via this route.

describe('GET /output/:file — session-scoped access only', () => {
  const realFs = require('fs');
  const realPath = require('path');
  const writtenFiles = [];

  afterAll(() => {
    writtenFiles.forEach(f => { try { realFs.unlinkSync(f); } catch (e) { /* already gone */ } });
  });

  // fse.outputFile is mocked in this test file, so the route handler's "write" never touches
  // real disk. Write the real bytes ourselves via Node's built-in fs (NOT the mocked
  // fs-extra) at the exact session-scoped path the real registerOutputFile() returned, so
  // GET /output/:file has something genuine to find.
  async function tailorAndBuildComparisonFor(ownerAgent) {
    await ownerAgent.post('/rewrite').send({ job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [] });
    const res = await ownerAgent.post('/build-comparison').send({ job: MOCK_JOB });
    const comparisonPath = res.body.comparisonPath; // e.g. "output/<sid>_<hex>.html"
    const absolute = realPath.resolve(comparisonPath);
    realFs.mkdirSync(realPath.dirname(absolute), { recursive: true });
    realFs.writeFileSync(absolute, '<html><body>test comparison</body></html>');
    writtenFiles.push(absolute);
    return comparisonPath;
  }

  test('the owning session can fetch its own generated file (200)', async () => {
    const owner = request.agent(app);
    const comparisonPath = await tailorAndBuildComparisonFor(owner);
    const res = await owner.get('/' + comparisonPath);
    expect(res.status).toBe(200);
  });

  test('a different session requesting the same file gets 404', async () => {
    const owner = request.agent(app);
    const stranger = request.agent(app);
    const comparisonPath = await tailorAndBuildComparisonFor(owner);
    const res = await stranger.get('/' + comparisonPath);
    expect(res.status).toBe(404);
  });

  test('a guessed/old-style filename (e.g. output/cv_Rivian.html) gets 404, not the file', async () => {
    const someone = request.agent(app);
    const res = await someone.get('/output/cv_Rivian.html');
    expect(res.status).toBe(404);
  });

  test('a path-traversal attempt is rejected, never served', async () => {
    const someone = request.agent(app);
    const res = await someone.get('/output/..%2f..%2fserver.js');
    expect(res.status).not.toBe(200);
    expect(res.text || '').not.toMatch(/require\(/);
  });
});
