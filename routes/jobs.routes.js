const express = require('express');
const fse = require('fs-extra');
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, parseJobFromText } = require('../agent');
const { scrapeJobPage } = require('../src/scraper');
const { upload } = require('../services/uploads');
const { getSession, setSession, als } = require('../services/session');
const { createJob, updateJob } = require('../services/jobQueue');
const { sendError } = require('../core/respondError');
const { logEvent } = require('../core/logger');

const router = express.Router();

router.post('/search/jobs', upload.single('cv'), async (req, res) => {
  try {
    const appSession = getSession();
    const country = req.body.country || 'US';
    const usState = req.body.usState || '';
    // Same rule as /upload-cv: a freshly uploaded file is read once for its text, then
    // deleted immediately — never left lingering on disk. No fresh upload in this request
    // (req.file absent) means there's nothing new to clean up here.
    const cvText = req.file ? await readCV(req.file.path) : appSession.cvText;
    if (req.file) await fse.remove(req.file.path);
    const jobTitles = await extractJobTitles(cvText);

    let allJobs = [];
    for (const title of jobTitles) {
      const jobs = await searchAllLocations(title, country, usState);
      allJobs = [...allJobs, ...jobs];
    }
    const uniqueJobs = [...new Map(allJobs.map(j => [j.job_id, j])).entries()].map(([, j]) => j);
    setSession({ cvText, cvPath: null, jobs: uniqueJobs, rankedJobs: null });
    res.json({ count: uniqueJobs.length, titlesFound: jobTitles.length });
  } catch (err) {
    sendError(res, '/search/jobs', 'ERR-JOB-001', err);
  }
});

router.post('/search/analyze', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.jobs) return sendError(res, '/search/analyze', 'ERR-JOB-002');
    const country = req.body.country || 'US';
    const rankedJobs = await analyzeJobFit(appSession.cvText, appSession.jobs, country);
    appSession.rankedJobs = rankedJobs;
    res.json({ jobs: rankedJobs });
  } catch (err) {
    sendError(res, '/search/analyze', 'ERR-JOB-003', err);
  }
});

// /fetch-job is now async (job-queue pattern, kind='parsing_job') so a tab close+reopen
// during job-description parsing can resume seamlessly. Returns { jobId } immediately;
// background task parses (or scrapes) the job, stores it in session, and updates the job row.
router.post('/fetch-job', async (req, res) => {
  try {
    const { url, jobText } = req.body;
    if (!jobText && !url) return sendError(res, '/fetch-job', 'ERR-JOB-006');

    const jobId = await createJob('parsing_job');
    const sid = als.getStore();
    // Capture mutable inputs before response ends the request scope.
    const rawText = jobText || null;
    const jobUrl  = url  || '';
    res.json({ jobId });

    als.run(sid, async () => {
      try {
        await updateJob(jobId, { status: 'running', current_step: 'Parsing job' });
        let text = rawText;
        if (!text) {
          try {
            text = await scrapeJobPage(jobUrl);
          } catch (err) {
            if (err.message === 'LOGIN_WALL') {
              await updateJob(jobId, { status: 'failed', current_step: '', result: { error: 'That site requires logging in — please paste the job description text instead.', code: 'ERR-JOB-004', kind: 'validation', loginWall: true } }).catch(() => {});
              return;
            }
            if (err.message === 'SCRAPER_DISABLED') {
              await updateJob(jobId, { status: 'failed', current_step: '', result: { error: 'Reading job pages from a URL is turned off — please paste the job description text instead.', code: 'ERR-JOB-005', kind: 'validation', scraperDisabled: true } }).catch(() => {});
              return;
            }
            throw err;
          }
        }
        const job = await parseJobFromText(text, jobUrl);
        const appSession = getSession();
        appSession.currentJob = job;
        await updateJob(jobId, { status: 'done', current_step: '', result: { job } });
        logEvent('job_parsed', { route: '/fetch-job', outcome: 'ok' });
      } catch (err) {
        await updateJob(jobId, {
          status: 'failed', current_step: '',
          result: { error: err.message, code: (err.code) || 'ERR-JOB-007' },
        }).catch(() => {});
      }
    });
  } catch (err) {
    sendError(res, '/fetch-job', 'ERR-JOB-007', err);
  }
});

module.exports = router;
