require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fse = require('fs-extra');
const {
  readCV, extractJobTitles, searchAllLocations, analyzeJobFit,
  parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText,
  generateComparisonTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
} = require('./agent');
const { scrapeJobPage } = require('./src/scraper');
const { generatePDF } = require('./src/pdf');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));

let appSession = {
  cvText: null, cvPath: null, cvData: null,
  jobs: null, rankedJobs: null,
  currentJob: null, hrReview: null,
  coachHistory: [], hrHistory: [],
  confirmedContact: null,
};

// ── API endpoints ─────────────────────────────────────────────────────────────

app.post('/upload-cv', upload.single('cv'), async (req, res) => {
  try {
    const cvPath = req.file.path;
    const cvText = await readCV(cvPath);
    const cvData = await parseCVStructure(cvText);
    appSession = { ...appSession, cvText, cvPath, cvData };
    res.json({ cvPath, cvData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/search/jobs', upload.single('cv'), async (req, res) => {
  try {
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
    appSession = { cvText, cvPath, jobs: uniqueJobs, rankedJobs: null };
    res.json({ count: uniqueJobs.length, cvPath, titlesFound: jobTitles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/search/analyze', async (req, res) => {
  try {
    if (!appSession.jobs) return res.status(400).json({ error: 'No search session.' });
    const country = req.body.country || 'US';
    const rankedJobs = await analyzeJobFit(appSession.cvText, appSession.jobs, country);
    appSession.rankedJobs = rankedJobs;
    res.json({ jobs: rankedJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/fetch-job', async (req, res) => {
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

app.post('/rewrite', async (req, res) => {
  try {
    const { job, cvPath, autoChanges, confirmedChanges } = req.body;
    const cvText = await readCV(cvPath || appSession.cvPath);
    const recommendedSections = (appSession.hrReview || {}).recommended_sections;
    const originalName = (appSession.cvData || {}).name;
    const { filePath, cvData, modified_sections } = await rewriteCVWithChanges(cvText, job, autoChanges || [], confirmedChanges || [], recommendedSections, originalName, appSession.confirmedContact);
    const pdfPath = await generatePDF(filePath);
    const company = (job.employer_name || job.company || 'Company').replace(/\s+/g, '_');
    const comparisonHtml = generateComparisonTemplate(appSession.cvData, cvData, job, modified_sections);
    const comparisonPath = `output/comparison_${company}.html`;
    await fse.outputFile(comparisonPath, comparisonHtml);
    res.json({ filePath, pdfPath, comparisonPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/confirm-contact', (req, res) => {
  const { name, title, email, phone, location, linkedin } = req.body;
  appSession.confirmedContact = { name, title, email, phone, location, linkedin };
  if (appSession.cvData) Object.assign(appSession.cvData, appSession.confirmedContact);
  res.json({ ok: true });
});

app.post('/review-cv', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { job } = req.body;
    if (!job) return res.status(400).json({ error: 'job is required.' });
    const review = await reviewCV(appSession.cvText, job);
    appSession.currentJob = job;
    appSession.hrReview = review;
    appSession.coachHistory = [];
    appSession.hrHistory = [];
    res.json(review);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/coach/discuss', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { message, gapIndex } = req.body;
    const gap = appSession.hrReview?.confirm_changes?.[gapIndex];
    const { reply, history } = await chatWithCoach(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      appSession.coachHistory, message, gap?.description
    );
    appSession.coachHistory = history;
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/hr/refine', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { gapIndex, conversation } = req.body;
    const gap = appSession.hrReview?.confirm_changes?.[gapIndex];
    if (!gap) return res.status(400).json({ error: 'Gap not found.' });
    const { result, history } = await refineWithHR(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      gap, conversation, appSession.hrHistory
    );
    appSession.hrHistory = history;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/coach/analyze', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { direction } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction is required.' });
    const result = await analyzeAndSuggestRoles(appSession.cvText, direction);
    if (!result) return res.status(500).json({ error: 'Analysis failed.' });
    const rankedJobs = appSession.rankedJobs || [];
    const marketMatches = rankedJobs.length > 0 ? await matchRolesToMarket(result.suggested_roles, rankedJobs) : [];
    res.json({ profile: result.profile, suggestedRoles: result.suggested_roles, marketMatches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/coach/path', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { roleTitle } = req.body;
    const path = await buildCareerPath(roleTitle, appSession.cvText);
    if (!path) return res.status(500).json({ error: 'Path analysis failed.' });
    res.json(path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(3000, () => console.log('Job Agent running at http://localhost:3000'));
}
module.exports = app;
