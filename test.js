require('dotenv').config();
const fs = require('fs');
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, rewriteCVWithChanges } = require('./agent');

const TEST_CV_PATH = './cv.pdf';
const TIMEOUT = 60000;

test('CV file exists', () => {
  const exists = fs.existsSync(TEST_CV_PATH);
  expect(exists).toBe(true);
});

test('CV reading returns non-empty text', async () => {
  const text = await readCV(TEST_CV_PATH);
  expect(typeof text).toBe('string');
  expect(text.length).toBeGreaterThan(100);
  console.log('CV length: ' + text.length + ' characters');
}, TIMEOUT);

test('Claude extracts job titles from CV', async () => {
  const text = await readCV(TEST_CV_PATH);
  const titles = await extractJobTitles(text);
  expect(Array.isArray(titles)).toBe(true);
  expect(titles.length).toBeGreaterThanOrEqual(1);
  console.log('Extracted titles: ' + titles.join(', '));
}, TIMEOUT);

test('Job search returns results for London/GB', async () => {
  const jobs = await searchAllLocations('RF Engineer', 'GB');
  expect(Array.isArray(jobs)).toBe(true);
  console.log('Jobs found: ' + jobs.length);
}, TIMEOUT);

test('Each job has required fields', async () => {
  const jobs = await searchAllLocations('Program Manager', 'GB');
  if (jobs.length > 0) {
    const job = jobs[0];
    expect(job).toHaveProperty('job_id');
    expect(job).toHaveProperty('job_title');
    expect(job).toHaveProperty('employer_name');
    console.log('Job structure valid: ' + job.job_title + ' at ' + job.employer_name);
  }
}, TIMEOUT);

test('Claude ranks jobs and returns valid JSON array', async () => {
  const text = await readCV(TEST_CV_PATH);
  const jobs = await searchAllLocations('Technical Program Manager', 'GB');

  if (jobs.length === 0) {
    console.log('No jobs found — skipping analysis test');
    return;
  }

  const ranked = await analyzeJobFit(text, jobs.slice(0, 3));
  expect(Array.isArray(ranked)).toBe(true);
  expect(ranked.length).toBeGreaterThan(0);

  const first = ranked[0];
  expect(first).toHaveProperty('rank');
  expect(first).toHaveProperty('job_title');
  expect(first).toHaveProperty('company');
  expect(first).toHaveProperty('fit_score');
  expect(first.fit_score).toBeGreaterThanOrEqual(1);
  expect(first.fit_score).toBeLessThanOrEqual(10);
  console.log('Top ranked: ' + first.job_title + ' at ' + first.company + ' — Score: ' + first.fit_score + '/10');
}, TIMEOUT);

test('CV rewrite generates HTML file', async () => {
  const text = await readCV(TEST_CV_PATH);
  const mockJob = {
    job_title: 'Technical Program Manager',
    company: 'Test Company',
    location: 'London',
    description: 'Looking for an experienced TPM with RF and hardware background.',
    apply_link: 'https://example.com'
  };

  const { filePath } = await rewriteCVWithChanges(text, mockJob, [], [], null, null, null, [], undefined, [], null, []);
  expect(filePath).toBeTruthy();
  expect(fs.existsSync(filePath)).toBe(true);

  const content = fs.readFileSync(filePath, 'utf8');
  expect(content).toContain('<!DOCTYPE html>');
  expect(content).toContain('Test Company');
  console.log('CV file generated: ' + filePath);
}, TIMEOUT);

test('Rewritten CV contains job-specific keywords', async () => {
  const text = await readCV(TEST_CV_PATH);
  const mockJob = {
    job_title: 'RF Hardware Program Manager',
    company: 'Nokia',
    location: 'Stockholm',
    description: 'Senior RF hardware program manager with RFIC and ASIC experience needed.',
    apply_link: 'https://nokia.com'
  };

  const { filePath } = await rewriteCVWithChanges(text, mockJob, [], [], null, null, null, [], undefined, [], null, []);
  const rewrittenHTML = fs.readFileSync(filePath, 'utf8');

  expect(rewrittenHTML).toContain('Nokia');
  expect(rewrittenHTML.length).toBeGreaterThan(1000);
  console.log('Rewritten CV length: ' + rewrittenHTML.length + ' characters');
  console.log('Original CV length: ' + text.length + ' characters');
}, TIMEOUT);