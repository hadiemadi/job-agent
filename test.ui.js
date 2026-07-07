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
  reviewCV:                  jest.fn(),
  analyzeJobFit:             jest.fn(),
  refineWithHR:              jest.fn(),
  chatWithHRExpert:          jest.fn(),
  researchCvConventions:     jest.fn(),
  pinDisciplineSkill:        jest.fn(),
  reviewTailoredCV:          jest.fn(),
  draftFromSidebarDiscussion: jest.fn(),
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

// services/auth is mocked to prevent real DB calls during tests.
// All write functions (saveCv, saveCoachMemory, saveConversationHistory) are
// captured as jest spies so write-path tests can assert they are called correctly.
jest.mock('./services/auth', () => ({
  createUser:               jest.fn().mockResolvedValue({ id: 'test-user-42', email: 'writer@test.com', created_at: new Date().toISOString() }),
  findUserByEmail:          jest.fn().mockResolvedValue(null),
  findUserByGoogleId:       jest.fn().mockResolvedValue(null),
  findUserById:             jest.fn().mockResolvedValue(null),
  hashPassword:             jest.fn().mockResolvedValue('hashed-pw'),
  verifyPassword:           jest.fn().mockResolvedValue(true),
  setUserPreference:        jest.fn().mockResolvedValue(undefined),
  getUserPreference:        jest.fn().mockResolvedValue(null),
  saveCv:                   jest.fn().mockResolvedValue(undefined),
  listSavedCvs:             jest.fn().mockResolvedValue([]),
  deleteSavedCv:            jest.fn().mockResolvedValue(true),
  listConversationHistory:  jest.fn().mockResolvedValue([]),
  saveConversationHistory:  jest.fn().mockResolvedValue(undefined),
  listCoachMemory:          jest.fn().mockResolvedValue([]),
  saveCoachMemory:          jest.fn().mockResolvedValue(undefined),
  getLatestSavedCv:         jest.fn().mockResolvedValue(null),
  saveProfilePreferences:   jest.fn().mockResolvedValue(undefined),
  getProfilePreferences:    jest.fn().mockResolvedValue(null),
  deleteUserAccount:        jest.fn().mockResolvedValue(undefined),
}));

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
const { reviewCV, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV, draftFromSidebarDiscussion } = require('./agents/recruiter');
const { parseJobFromText } = require('./agents/extractor');
const { classify } = require('./agents/inputRouter');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach } = require('./agents/coach');
const { readCV }        = require('./src/cv');
const { scrapeJobPage } = require('./src/scraper');
const { generateWordCV, generateWordCVAlt } = require('./src/wordExport');
const { generateWordFromTemplate } = require('./src/wordTemplateExport');
const { saveCv } = require('./services/auth');
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

// ── Shared polling helpers ────────────────────────────────────────────────────
// Polls /job/:id/status until the job settles (done or failed). Background jobs use
// all-mocked dependencies that resolve immediately, so the first poll almost always
// returns a terminal state — retries guard against the rare case where microtasks
// haven't flushed yet by the time the HTTP round-trip completes.
async function waitForJob(jobId) {
  for (let i = 0; i < 20; i++) {
    const r = await agent.get('/job/' + jobId + '/status');
    if (r.body.status === 'done' || r.body.status === 'failed') return r.body;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job ' + jobId + ' did not settle in time');
}

// Agent-specific variant — polls using a given supertest agent (for isolation tests that
// create their own agent with a separate cookie jar, rather than the shared `agent`).
async function waitForJobWith(a, jobId) {
  for (let i = 0; i < 20; i++) {
    const r = await a.get('/job/' + jobId + '/status');
    if (r.body.status === 'done' || r.body.status === 'failed') return r.body;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job ' + jobId + ' did not settle in time (agent-specific)');
}

// Seeds a fresh agent's session with CV text by running the full /upload-cv → poll flow.
// Required before calling /rewrite on any agent that hasn't uploaded a CV yet, since
// the null-cvText guard in /rewrite returns 400 when the session is empty.
async function uploadCVFor(a) {
  const r = await a.post('/upload-cv').attach('cv', 'cv.pdf');
  await waitForJobWith(a, r.body.jobId);
}

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
    result: { refined_description: 'Add PMP certification', rationale: 'JD prefers it', lean: 'add' },
    thread: [],
  });
  chatWithHRExpert.mockResolvedValue({ reply: 'Your PMP progress should resolve that gap.', thread: [] });
  // Default: no new sidebar conversation to consider — most tests never touch /hr/chat first.
  draftFromSidebarDiscussion.mockResolvedValue(null);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
    // build.txt: a missing-CV precondition is a friendly nudge, not a "Something went wrong"
    // failure — confirmed at the catalog level too (core/errorCodes.test.js).
    expect(res.body.error_code).toBe('ERR-HR-001');
    expect(res.body).toHaveProperty('kind', 'validation');
  });

  test('POST /coach/discuss → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/discuss').send({ message: 'Hello', gapId: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /hr/refine → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/refine').send({ gapId: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /hr/chat → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/chat').send({ message: 'Hello' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /hr/apply-concern → 400 when no CV is loaded', async () => {
    const res = await agent.post('/hr/apply-concern').send({ fieldText: 'x', selectedText: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /coach/analyze → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/analyze').send({ direction: 'leadership' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /coach/path → 400 when no CV is loaded', async () => {
    const res = await agent.post('/coach/path').send({ roleTitle: 'Director of Engineering' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /adjust-language → 400 when no CV is loaded', async () => {
    const res = await agent.post('/adjust-language').send({ cvData: MOCK_CV_DATA, job: MOCK_JOB, languageLevel: 3 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /build-comparison → 400 when no CV has been tailored yet', async () => {
    const res = await agent.post('/build-comparison').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /rewrite → 400 validation when session has no CV text (expired/never uploaded)', async () => {
    // Fresh agent = empty session — no cvText in scope, simulating session expiry.
    // Previously this would crash inside extractContactInfo with
    //   "Cannot read properties of null (reading 'replace')" (ERR-CV-004).
    // After the fix it must return a clean 400 validation error, not a 500 crash.
    const freshAgent = request.agent(app);
    const res = await freshAgent.post('/rewrite').send({ job: MOCK_JOB });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error_code', 'ERR-CV-012');
    expect(res.body).toHaveProperty('kind', 'validation');
  });
});

// ── 2. Error handling — missing required fields (stateless) ───────────────────

describe('Error handling — missing required fields', () => {
  test('POST /fetch-job → 400 when neither url nor jobText is provided', async () => {
    const res = await agent.post('/fetch-job').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /review-cv → 400 when job field is missing', async () => {
    // Even if CV is loaded, omitting `job` must return 400
    const res = await agent.post('/review-cv').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('POST /coach/analyze → 400 when direction field is missing', async () => {
    const res = await agent.post('/coach/analyze').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });
});

// ── 3. POST /upload-cv ────────────────────────────────────────────────────────

describe('POST /upload-cv', () => {
  test('returns 200 with jobId; poll returns cvData when done', async () => {
    const res = await agent.post('/upload-cv').attach('cv', 'cv.pdf');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).not.toHaveProperty('cvPath');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toHaveProperty('cvData');
    expect(job.result.cvData.name).toBe('Hadi Emadi');
    expect(job.result.cvData).toHaveProperty('experience');
    expect(job.result.cvData).toHaveProperty('skills');
  });
});

// ── 4. POST /fetch-job ────────────────────────────────────────────────────────

describe('POST /fetch-job', () => {
  test('returns 200 with jobId; poll returns job object when jobText is pasted directly', async () => {
    const res = await agent
      .post('/fetch-job')
      .send({ jobText: 'Technical Program Manager at Apple. Requirements: RF, ASIC.' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).not.toHaveProperty('job');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toHaveProperty('job');
    expect(job.result.job).toHaveProperty('job_title');
    expect(job.result.job).toHaveProperty('employer_name');
    expect(job.result.job).toHaveProperty('job_description');
  });

  test('returns 200 with jobId when a job URL is provided (scraper mocked)', async () => {
    const res = await agent
      .post('/fetch-job')
      .send({ url: 'https://linkedin.com/jobs/view/tpm-apple-123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toHaveProperty('job');
  });

  test('job fails with loginWall flag when scraper hits a LinkedIn login wall', async () => {
    scrapeJobPage.mockRejectedValue(new Error('LOGIN_WALL'));
    const res = await agent
      .post('/fetch-job')
      .send({ url: 'https://linkedin.com/jobs/view/private-123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('failed');
    expect(job.result).toHaveProperty('loginWall', true);
    expect(job.result).toHaveProperty('code', 'ERR-JOB-004');
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
    // /upload-cv is now async — returns { jobId }; wait for the background task to settle
    // so the session has cvText/cvData before the review-cv call below.
    const uploadRes = await agent.post('/upload-cv').attach('cv', 'cv.pdf');
    await waitForJob(uploadRes.body.jobId);
    // /review-cv is now async — returns { jobId }; wait for the background task to settle
    // so the session has gaps/hrReview/hrThread before the first test runs.
    const reviewRes = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(reviewRes.body.jobId);
  });

  // Gaps are persisted server-side with a generated id (services/gapStore.js), and several
  // tests in this block call /review-cv for unrelated reasons (clientPreferences pass-through,
  // gapSeverities filtering, etc.) — each call regenerates the gap list with fresh ids. So
  // gap-dependent tests fetch a current id right before they need one, rather than reusing one
  // captured once in beforeAll, which would go stale the moment any intervening test re-runs
  // /review-cv.
  async function currentGapId() {
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    const job = await waitForJob(res.body.jobId);
    return job.result.hrReview.confirm_changes[0].id;
  }

  test('POST /review-cv returns 200 with jobId; poll returns full review structure when done', async () => {
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toHaveProperty('hrReview');
    const review = job.result.hrReview;
    expect(review).toHaveProperty('overall_match');
    expect(review).toHaveProperty('strengths');
    expect(review).toHaveProperty('auto_changes');
    expect(review).toHaveProperty('confirm_changes');
    expect(Array.isArray(review.auto_changes)).toBe(true);
    expect(Array.isArray(review.confirm_changes)).toBe(true);
    // Each gap gets a stable, server-assigned id (services/gapStore.js).
    expect(review.confirm_changes[0]).toHaveProperty('id');
    expect(typeof review.confirm_changes[0].id).toBe('string');
  });

  // An unhandled rejection deep inside reviewCV must surface as a failed job with the correct
  // error code — not swallowed silently or returned as a raw 500 from the route.
  test('POST /review-cv → job fails with ERR-HR-003 when the HR review agent call fails', async () => {
    reviewCV.mockRejectedValueOnce(new Error('Anthropic API unreachable'));
    const res = await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('failed');
    expect(job.result).toHaveProperty('error');
    expect(job.result).toHaveProperty('code', 'ERR-HR-003');
  });

  test('POST /confirm-contact stores clientPreferences and /review-cv passes them through', async () => {
    const contactRes = await agent.post('/confirm-contact').send({
      name: 'Hadi Emadi', customInstructions: 'Never mention my current employer by name', tone: 2,
    });
    expect(contactRes.status).toBe(200);

    const reviewRes = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(reviewRes.body.jobId);
    const lastCall = reviewCV.mock.calls[reviewCV.mock.calls.length - 1];
    expect(lastCall[3]).toMatchObject({
      tone: 2, customInstructions: 'Never mention my current employer by name', languageLevel: 2,
      extensiveSearch: false, conventionsResearch: '', gapSeverities: ['major'],
      refreshDiscipline: false, routedInstruction: { bucket: 'none', text: '' }, routedInstructionApplied: false,
    });
  });

  test('POST /confirm-contact with model picker + POST /review-cv → job succeeds (regression: ERR-HR-003 on temperature-rejecting models)', async () => {
    // Bug: reviewCV passed temperature:0 to the API; meteredCreate overrides the model to the
    // picker's selection; newer models reject temperature → API error → ERR-HR-003 job failure.
    // Fix: remove temperature from all agent calls. This test confirms the full flow succeeds.
    const contactRes = await agent.post('/confirm-contact').send({
      name: 'Hadi Emadi', model: 'claude-sonnet-5',
    });
    expect(contactRes.status).toBe(200);
    const reviewRes = await agent.post('/review-cv').send({ job: MOCK_JOB });
    expect(reviewRes.status).toBe(200);
    const job = await waitForJob(reviewRes.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).not.toHaveProperty('code');
  });

  test('POST /confirm-contact routes a discipline-bucket comment, and /review-cv pins it once a field is known', async () => {
    classify.mockResolvedValue({ bucket: 'discipline', text: 'Hands-on GaN PA tuning experience' });
    reviewCV.mockResolvedValue({ review: MOCK_REVIEW, field: { field: 'RF/Hardware Engineering', seniority: 'senior' }, thread: [] });

    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', customInstructions: 'Hands-on GaN PA tuning experience' });
    const r1 = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r1.body.jobId);

    expect(pinDisciplineSkill).toHaveBeenCalledWith(
      { field: 'RF/Hardware Engineering', seniority: 'senior' },
      'Hands-on GaN PA tuning experience'
    );

    // A second /review-cv in the same contact-confirmation session must not re-pin.
    const callsBefore = pinDisciplineSkill.mock.calls.length;
    const r2 = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r2.body.jobId);
    expect(pinDisciplineSkill.mock.calls.length).toBe(callsBefore);
  });

  test('POST /confirm-contact with a general-bucket comment does not call pinDisciplineSkill', async () => {
    classify.mockResolvedValue({ bucket: 'general', text: 'Prefer a one-page CV.' });
    reviewCV.mockResolvedValue({ review: MOCK_REVIEW, field: { field: 'RF/Hardware Engineering', seniority: 'senior' }, thread: [] });

    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', customInstructions: 'Prefer a one-page CV.' });
    const r = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r.body.jobId);

    expect(pinDisciplineSkill).not.toHaveBeenCalled();
  });

  test('POST /confirm-contact with gapSeverities filters which severities selectTopGaps sees', async () => {
    selectTopGaps.mockClear();
    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', gapSeverities: ['major'] });
    const r = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r.body.jobId);
    const lastCall = selectTopGaps.mock.calls[selectTopGaps.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(['major']);
  });

  test('POST /confirm-contact with extensiveSearch makes /review-cv research conventions once and cache the result', async () => {
    researchCvConventions.mockResolvedValue('In Sweden, hobbies are commonly listed; photos are common.');
    await agent.post('/confirm-contact').send({ name: 'Hadi Emadi', extensiveSearch: true });

    const r1 = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r1.body.jobId);
    expect(researchCvConventions).toHaveBeenCalledWith(MOCK_JOB, expect.any(String));
    let lastCall = reviewCV.mock.calls[reviewCV.mock.calls.length - 1];
    expect(lastCall[3].conventionsResearch).toBe('In Sweden, hobbies are commonly listed; photos are common.');

    const callsBefore = researchCvConventions.mock.calls.length;
    const r2 = await agent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJob(r2.body.jobId);
    expect(researchCvConventions.mock.calls.length).toBe(callsBefore); // cached — not re-researched
  });

  test('POST /rewrite returns 200 with jobId — pipeline runs in background, result available via /job/:id/status', async () => {
    const res = await agent.post('/rewrite').send({
      job: MOCK_JOB,
      cvPath: 'cv.pdf',
      autoChanges: [{ description: 'Move ASIC to top of skills' }],
      confirmedChanges: [],
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).not.toHaveProperty('comparisonPath');
    const job = await waitForJob(res.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toHaveProperty('filePath');
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

    const postRes = await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });
    expect(postRes.status).toBe(200);
    const job = await waitForJob(postRes.body.jobId);
    expect(job.result.reviewIssues).toEqual([]);
    expect(rewriteCVWithChanges).toHaveBeenCalledTimes(2);
    expect(reviewTailoredCV).toHaveBeenCalledTimes(2);
    // the second writer call is the targeted revision — it carries the required edit forward,
    // not a from-scratch regeneration
    const secondCallChanges = rewriteCVWithChanges.mock.calls[1][3];
    expect(secondCallChanges).toEqual([{ description: 'Remove the company name "Apple" from the summary' }]);
  });

  test('POST /rewrite surfaces remaining review issues after exhausting the 2-pass revision limit', async () => {
    reviewTailoredCV.mockResolvedValue({ checks: [], verdict: 'FIX_REQUIRED', required_edits: ['Remove the company name "Apple" from the summary'] });

    const postRes = await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });
    expect(postRes.status).toBe(200);
    const job = await waitForJob(postRes.body.jobId);
    expect(job.result.reviewIssues).toEqual(['Remove the company name "Apple" from the summary']);
    // 1 initial write + 2 revision passes = 3; 3 reviews, one per write
    expect(rewriteCVWithChanges).toHaveBeenCalledTimes(3);
    expect(reviewTailoredCV).toHaveBeenCalledTimes(3);
  });

  test('POST /build-comparison returns 200 with comparisonPath after a CV has been tailored', async () => {
    const postRes = await agent.post('/rewrite').send({
      job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [],
    });
    // Polling status applies session state (lastTailoredCvData etc.) so /build-comparison works.
    await waitForJob(postRes.body.jobId);
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

  test('POST /hr/refine returns 200 with status=proposed, a proposedStatement, and HR\'s lean — coach discussion is optional, not required first', async () => {
    // No /coach/discuss call before this — HR may draft directly from 'open' (locked decision #1).
    const gapId = await currentGapId();
    const res = await agent.post('/hr/refine').send({ gapId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('proposedStatement');
    expect(typeof res.body.proposedStatement).toBe('string');
    expect(res.body.status).toBe('proposed');
    expect(res.body).toHaveProperty('lean');
    expect(['add', 'leave-out']).toContain(res.body.lean);
  });

  test('POST /hr/refine → 400 when gapId does not exist', async () => {
    const res = await agent.post('/hr/refine').send({ gapId: 'no-such-gap' });
    expect(res.status).toBe(400);
  });

  test('POST /gap-decision "added" → 400 when the gap has no drafted statement yet', async () => {
    const gapId = await currentGapId();
    const res = await agent.post('/gap-decision').send({ gapId, decision: 'added' });
    expect(res.status).toBe(400);
  });

  test('POST /gap-decision allows an early "left-out" straight from open, before ever asking HR to draft anything', async () => {
    const gapId = await currentGapId();
    const res = await agent.post('/gap-decision').send({ gapId, decision: 'left-out' });
    expect(res.status).toBe(200);
    expect(res.body.userDecision).toBe('left-out');
  });

  test('POST /gap-decision "added" only succeeds once HR has proposed a statement, and /rewrite inserts that exact statement — never the raw slogan', async () => {
    const gapId = await currentGapId();
    const refineRes = await agent.post('/hr/refine').send({ gapId });
    const proposedStatement = refineRes.body.proposedStatement;

    const res = await agent.post('/gap-decision').send({ gapId, decision: 'added' });
    expect(res.status).toBe(200);
    expect(res.body.userDecision).toBe('added');

    await agent.post('/rewrite').send({ job: MOCK_JOB });
    const lastCall = rewriteCVWithChanges.mock.calls[rewriteCVWithChanges.mock.calls.length - 1];
    const confirmedChanges = lastCall[3];
    expect(confirmedChanges.some(c => c.description === proposedStatement)).toBe(true);
    // The raw HR-review slogan (MOCK_GAPS[0].description) must never be what gets inserted —
    // only the HR-drafted, candidate-accepted sentence is.
    expect(confirmedChanges.some(c => c.description === MOCK_GAPS[0].description)).toBe(false);
  });

  test('POST /gap-decision overriding a decision is allowed — re-deciding "left-out" after "added" succeeds', async () => {
    const gapId = await currentGapId();
    await agent.post('/hr/refine').send({ gapId });
    await agent.post('/gap-decision').send({ gapId, decision: 'added' });
    const res = await agent.post('/gap-decision').send({ gapId, decision: 'left-out' });
    expect(res.status).toBe(200);
    expect(res.body.userDecision).toBe('left-out');
  });

  test('POST /gap-decision → 400 for an invalid decision value', async () => {
    const gapId = await currentGapId();
    const res = await agent.post('/gap-decision').send({ gapId, decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  // #29/#31, build.txt's USER-OVERRIDE-WINS case: HR's lean is informational only — the
  // candidate's own decision is final regardless of which way HR leaned. /regenerate-cv must
  // honor that exactly like /rewrite does (buildGapInputs in routes/cv.routes.js filters on
  // userDecision, never on hrConclusion.lean).
  test('POST /regenerate-cv excludes a gap HR leaned "add" on, once the candidate explicitly overrides to "left-out" — user decision wins, not HR\'s lean', async () => {
    const gapId = await currentGapId();
    refineWithHR.mockResolvedValue({
      result: { refined_description: 'Add PMP certification', rationale: 'JD prefers it', lean: 'add', targetSection: 'Certifications' },
      thread: [],
    });
    const refineRes = await agent.post('/hr/refine').send({ gapId });
    expect(refineRes.body.lean).toBe('add');
    const proposedStatement = refineRes.body.proposedStatement;

    // Candidate overrides HR's "add" lean.
    await agent.post('/gap-decision').send({ gapId, decision: 'left-out' });

    const res = await agent.post('/regenerate-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('filePath');

    const lastCall = rewriteCVWithChanges.mock.calls[rewriteCVWithChanges.mock.calls.length - 1];
    const confirmedChanges = lastCall[3];
    expect(confirmedChanges.some(c => c.description === proposedStatement)).toBe(false);
  });

  // #31's other override path: the candidate directly instructs a change against HR's stated
  // opinion in the Tailored-CV sidebar (not the gap-decision card flow above). That instruction
  // must reach the CV writer and take priority over HR's contrary stance — exercised via
  // /hr/chat -> draftFromSidebarDiscussion -> /regenerate-cv.
  test('POST /regenerate-cv prioritizes the candidate\'s sidebar directive over HR\'s contrary stance', async () => {
    chatWithHRExpert.mockResolvedValueOnce({
      reply: "I'd recommend leaving the MBA off the CV — it's not relevant to this technical role.",
      thread: [],
    });
    await agent.post('/hr/chat').send({ message: 'I want my MBA included anyway — please add it.' });

    // draftFromSidebarDiscussion (mocked at the module boundary) is what decides whether this
    // sidebar exchange produced a CV-ready statement — simulate it concluding the candidate's
    // own instruction is what should reach the CV writer, not HR's contrary recommendation.
    draftFromSidebarDiscussion.mockResolvedValueOnce({
      description: 'Include MBA in education section per candidate request',
      rationale: 'Candidate explicitly requested it despite HR recommending against it',
      targetSection: 'Education',
    });

    const res = await agent.post('/regenerate-cv').send({ job: MOCK_JOB });
    expect(res.status).toBe(200);

    // draftFromSidebarDiscussion must have been given the new sidebar conversation to weigh.
    const draftCall = draftFromSidebarDiscussion.mock.calls[draftFromSidebarDiscussion.mock.calls.length - 1];
    const newMessages = draftCall[2];
    expect(newMessages.some(m => m.text.includes('I want my MBA included anyway'))).toBe(true);

    // The candidate's directive — not HR's contrary stance — is what reaches the CV writer.
    const lastCall = rewriteCVWithChanges.mock.calls[rewriteCVWithChanges.mock.calls.length - 1];
    const confirmedChanges = lastCall[3];
    expect(confirmedChanges.some(c => c.description === 'Include MBA in education section per candidate request')).toBe(true);
    expect(confirmedChanges.some(c => c.description.includes('leaving the MBA off'))).toBe(false);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
  });

  test('returns 400 when job is missing', async () => {
    const res = await agent.post('/export-word').send({ cvData: MOCK_CV_DATA });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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
    expect(res.body).toHaveProperty('error_code');
    expect(res.body.error_code).toMatch(/^ERR-[A-Z]+-\d+$/);
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

  // build.txt: "Disable the 'Request HR review' control until a CV is present" — goBtn is
  // that control (it kicks off upload -> /fetch-job -> /review-cv). Starts disabled with a
  // tooltip; public/app.js's updateGoBtnAvailability() enables it once a file is chosen.
  test('goBtn starts disabled with a tooltip explaining why', () => {
    const match = html.match(/<button[^>]*id="goBtn"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/\bdisabled\b/);
    expect(match[0]).toMatch(/title="Upload your CV first\."/);
  });
});

// ── 8b. Trial-mode config endpoint (core/config.js, server.js) ────────────────

describe('GET /config.js', () => {
  test('serves window.TRIAL_MODE as plain JS, defaulting to true', async () => {
    const res = await request(app).get('/config.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toBe('window.TRIAL_MODE = true;');
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

    // Seed cvText in each session — /rewrite guards against null cvText (ERR-CV-012).
    await uploadCVFor(agentA);
    await uploadCVFor(agentB);

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
    // Seed cvText — /rewrite guards against null cvText (ERR-CV-012) before creating the job.
    await uploadCVFor(ownerAgent);
    const postRes = await ownerAgent.post('/rewrite').send({ job: MOCK_JOB, cvPath: 'cv.pdf', autoChanges: [], confirmedChanges: [] });
    // Poll until done so session state (lastTailoredCvData) is applied before /build-comparison.
    const { jobId } = postRes.body;
    for (let i = 0; i < 20; i++) {
      const s = await ownerAgent.get('/job/' + jobId + '/status');
      if (s.body.status === 'done' || s.body.status === 'failed') break;
      await new Promise(r => setTimeout(r, 10));
    }
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

// ── 11. Write paths — saveCv fires for logged-in users (regression) ─────────────
// These tests confirm that the fire-and-forget DB write in /rewrite fires when a user
// is authenticated (appSession.userId set) and stays silent for guest sessions.
// services/auth is fully mocked (see top of file), so no real DB connection is needed.

describe('Write paths — saveCv fires for logged-in users', () => {
  const authAgent = request.agent(app);

  beforeAll(async () => {
    // Seed the session: upload CV, register (sets appSession.userId), run HR review.
    const uploadRes = await authAgent.post('/upload-cv').attach('cv', 'cv.pdf');
    await waitForJobWith(authAgent, uploadRes.body.jobId);
    // /auth/register calls mocked createUser → returns { id: 'test-user-42' } and sets userId.
    await authAgent.post('/auth/register').send({ email: 'writer@test.com', password: 'pass1234' });
    const reviewRes = await authAgent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJobWith(authAgent, reviewRes.body.jobId);
  });

  test('saveCv is called once after /rewrite for a logged-in user, with userId and label', async () => {
    saveCv.mockClear();
    const rewriteRes = await authAgent.post('/rewrite').send({ job: MOCK_JOB });
    expect(rewriteRes.status).toBe(200);
    const job = await waitForJobWith(authAgent, rewriteRes.body.jobId);
    expect(job.status).toBe('done');
    expect(saveCv).toHaveBeenCalledTimes(1);
    expect(saveCv).toHaveBeenCalledWith(
      'test-user-42',
      expect.objectContaining({ label: expect.any(String) })
    );
  });

  test('saveCv is NOT called for a guest session (no userId)', async () => {
    saveCv.mockClear();
    const guestAgent = request.agent(app);
    await uploadCVFor(guestAgent);
    const reviewRes = await guestAgent.post('/review-cv').send({ job: MOCK_JOB });
    await waitForJobWith(guestAgent, reviewRes.body.jobId);
    const rewriteRes = await guestAgent.post('/rewrite').send({ job: MOCK_JOB });
    const job = await waitForJobWith(guestAgent, rewriteRes.body.jobId);
    expect(job.status).toBe('done');
    expect(saveCv).not.toHaveBeenCalled();
  });
});
