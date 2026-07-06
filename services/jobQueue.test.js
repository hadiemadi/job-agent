// Unit tests for services/jobQueue.js. All tests use the in-memory fallback (no DATABASE_URL
// set) — getPool() returns null, so the Map-backed path exercises the same logic contract
// without any real DB calls.
const { createJob, updateJob, getJob, _resetMemJobs } = require('./jobQueue');

beforeEach(() => {
  _resetMemJobs();
  delete process.env.DATABASE_URL; // ensure in-memory path
});

test('createJob returns a UUID-shaped id and the job starts as pending', async () => {
  const id = await createJob();
  expect(typeof id).toBe('string');
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  const job = await getJob(id);
  expect(job).not.toBeNull();
  expect(job.status).toBe('pending');
  expect(job.current_step).toBe('');
  expect(job.result).toBeNull();
});

test('updateJob changes status and current_step', async () => {
  const id = await createJob();
  await updateJob(id, { status: 'running', current_step: 'Writing CV' });
  const job = await getJob(id);
  expect(job.status).toBe('running');
  expect(job.current_step).toBe('Writing CV');
});

test('updateJob stores a result object', async () => {
  const id = await createJob();
  const result = { filePath: 'output/test.html', reviewIssues: [], hrThread: [] };
  await updateJob(id, { status: 'done', current_step: '', result });
  const job = await getJob(id);
  expect(job.status).toBe('done');
  expect(job.result).toEqual(result);
});

test('updateJob on a failed job stores error info', async () => {
  const id = await createJob();
  await updateJob(id, { status: 'failed', current_step: '', result: { error: 'boom', code: 'ERR-CV-004' } });
  const job = await getJob(id);
  expect(job.status).toBe('failed');
  expect(job.result.error).toBe('boom');
  expect(job.result.code).toBe('ERR-CV-004');
});

test('getJob returns null for an unknown id', async () => {
  const job = await getJob('00000000-0000-0000-0000-000000000000');
  expect(job).toBeNull();
});

test('multiple independent jobs do not bleed into each other', async () => {
  const id1 = await createJob();
  const id2 = await createJob();
  await updateJob(id1, { status: 'running', current_step: 'Step A' });
  await updateJob(id2, { status: 'done', current_step: 'Step B', result: { filePath: 'output/b.html' } });
  const j1 = await getJob(id1);
  const j2 = await getJob(id2);
  expect(j1.status).toBe('running');
  expect(j1.current_step).toBe('Step A');
  expect(j2.status).toBe('done');
  expect(j2.result.filePath).toBe('output/b.html');
});

test('createJob defaults kind to cv_tailor', async () => {
  const id = await createJob();
  const job = await getJob(id);
  expect(job.kind).toBe('cv_tailor');
});

test('createJob stores a custom kind (hr_review)', async () => {
  const id = await createJob('hr_review');
  const job = await getJob(id);
  expect(job.kind).toBe('hr_review');
});

describe('status polling contract (/job/:id/status)', () => {
  // These verify the data shape that the GET route and the frontend expect.
  test('pending job has null result', async () => {
    const id = await createJob();
    const job = await getJob(id);
    expect(job.status).toBe('pending');
    expect(job.result).toBeNull();
  });

  test('done job has result with filePath', async () => {
    const id = await createJob();
    await updateJob(id, { status: 'done', current_step: '', result: { filePath: 'output/cv.html', reviewIssues: [] } });
    const job = await getJob(id);
    expect(job.status).toBe('done');
    expect(job.result.filePath).toBe('output/cv.html');
    expect(Array.isArray(job.result.reviewIssues)).toBe(true);
  });
});
