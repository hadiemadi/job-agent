const express = require('express');
const fse = require('fs-extra');
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, parseJobFromText } = require('../agent');
const { scrapeJobPage } = require('../src/scraper');
const { upload } = require('../services/uploads');
const { getSession, setSession } = require('../services/session');

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
    res.status(500).json({ error: err.message });
  }
});

router.post('/search/analyze', async (req, res) => {
  try {
    const appSession = getSession();
    if (!appSession.jobs) return res.status(400).json({ error: 'No search session.' });
    const country = req.body.country || 'US';
    const rankedJobs = await analyzeJobFit(appSession.cvText, appSession.jobs, country);
    appSession.rankedJobs = rankedJobs;
    res.json({ jobs: rankedJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fetch-job', async (req, res) => {
  try {
    const { url, jobText } = req.body;
    let rawText;
    if (jobText) {
      rawText = jobText;
    } else if (url) {
      try {
        rawText = await scrapeJobPage(url);
      } catch (err) {
        if (err.message === 'LOGIN_WALL') return res.status(422).json({ error: 'LinkedIn requires login.', loginWall: true });
        if (err.message === 'SCRAPER_DISABLED') return res.status(422).json({ error: 'URL scraping is off — paste the job description text instead.', scraperDisabled: true });
        throw err;
      }
    } else {
      return res.status(400).json({ error: 'Provide url or jobText.' });
    }
    const job = await parseJobFromText(rawText, url || '');
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
