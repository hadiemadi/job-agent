const express = require('express');
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, parseJobFromText } = require('../agent');
const { scrapeJobPage } = require('../src/scraper');
const { upload } = require('../services/uploads');
const { getSession, setSession } = require('../services/session');

const router = express.Router();

router.post('/search/jobs', upload.single('cv'), async (req, res) => {
  try {
    const appSession = getSession();
    const cvPath = req.file ? req.file.path : appSession.cvPath;
    const country = req.body.country || 'US';
    const usState = req.body.usState || '';
    const cvText = req.file ? await readCV(cvPath) : appSession.cvText;
    const jobTitles = await extractJobTitles(cvText);

    let allJobs = [];
    for (const title of jobTitles) {
      const jobs = await searchAllLocations(title, country, usState);
      allJobs = [...allJobs, ...jobs];
    }
    const uniqueJobs = [...new Map(allJobs.map(j => [j.job_id, j])).entries()].map(([, j]) => j);
    setSession({ cvText, cvPath, jobs: uniqueJobs, rankedJobs: null });
    res.json({ count: uniqueJobs.length, cvPath, titlesFound: jobTitles.length });
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
