// Smoke tests for tasks/* modules — confirm each task module exports the expected function
// and that the retry-once pattern works (regression guard for the systemic audit).

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

describe('tasks/coverLetter', () => {
  const { generateCoverLetter } = require('./coverLetter');
  test('exports generateCoverLetter', () => {
    expect(typeof generateCoverLetter).toBe('function');
  });
  test('generateCoverLetter resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ cover_letter: 'Dear Hiring Manager,\n\nI am excited to apply...' }));
    const result = await generateCoverLetter('cv text', { job_title: 'TPM', employer_name: 'Acme' }, { name: 'Jane', summary: 'Senior TPM.' });
    expect(result.coverLetter).toContain('Dear Hiring Manager');
  });
  test('generateCoverLetter retries once when Claude returns prose instead of JSON', async () => {
    client.messages.create
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sure, here is the cover letter in plain text...' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ cover_letter: 'Dear Hiring Manager,\n\nExcited to apply.' }) }] });
    const result = await generateCoverLetter('cv text', { job_title: 'TPM', employer_name: 'Acme' }, { name: 'Jane', summary: 'Senior TPM.' });
    expect(result.coverLetter).toContain('Dear Hiring Manager');
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});

describe('tasks/interviewPrep', () => {
  const { generateInterviewQuestions } = require('./interviewPrep');
  test('exports generateInterviewQuestions', () => {
    expect(typeof generateInterviewQuestions).toBe('function');
  });
  test('generateInterviewQuestions resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ questions: [{ question: 'Tell me about yourself.', answer_1: 'I have 10 years...', answer_2: 'I specialize in...' }] }));
    const result = await generateInterviewQuestions('cv text', { job_title: 'TPM' }, { name: 'Jane' });
    expect(result.questions).toHaveLength(1);
  });
  test('generateInterviewQuestions retries once when Claude returns prose instead of JSON', async () => {
    client.messages.create
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sure, here are the interview questions in plain text...' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ questions: [{ question: 'Tell me about yourself.', answer_1: 'I have 10 years...', answer_2: 'I specialize in...' }] }) }] });
    const result = await generateInterviewQuestions('cv text', { job_title: 'TPM' }, { name: 'Jane' });
    expect(result.questions).toHaveLength(1);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});

describe('tasks/docxPlacement', () => {
  const { planDocxPlacement } = require('./docxPlacement');
  test('exports planDocxPlacement', () => {
    expect(typeof planDocxPlacement).toBe('function');
  });
  test('planDocxPlacement resolves with a mocked response', async () => {
    mockTextResponse(JSON.stringify({ header_replacements: [], replacements: [], new_sections: [] }));
    const result = await planDocxPlacement([{ index: 0, text: 'John Smith' }], { name: 'Jane', title: 'TPM' }, 'cv text', { job_title: 'TPM' });
    expect(result.plan).toMatchObject({ header_replacements: [], replacements: [] });
  });
  test('planDocxPlacement retries once when Claude returns prose instead of JSON', async () => {
    client.messages.create
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sure, here is the placement plan in plain text...' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ header_replacements: [{ field: 'name', paragraph_index: 0 }], replacements: [], new_sections: [] }) }] });
    const result = await planDocxPlacement([{ index: 0, text: 'John Smith' }], { name: 'Jane', title: 'TPM' }, 'cv text', { job_title: 'TPM' });
    expect(result.plan.header_replacements).toHaveLength(1);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});
