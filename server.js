require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const fse = require('fs-extra');
const PizZip = require('pizzip');
const {
  readCV, extractJobTitles, searchAllLocations, analyzeJobFit,
  parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText, chatWithHRExpert,
  generateComparisonTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
} = require('./agent');
const { scrapeJobPage } = require('./src/scraper');
const { generateWordCV, generateWordCVAlt } = require('./src/wordExport');
const { generateWordFromTemplate } = require('./src/wordTemplateExport');

const app = express();
const upload = multer({ dest: 'uploads/' });
const templateUpload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/templates/',
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.docx`),
  }),
  fileFilter: (req, file, cb) => cb(null, /\.docx$/i.test(file.originalname)),
});
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/templates', express.static('templates'));
fse.ensureDirSync('uploads/templates');

let appSession = {
  cvText: null, cvPath: null, cvData: null,
  jobs: null, rankedJobs: null,
  currentJob: null, hrReview: null,
  coachHistory: [], hrThread: [],
  confirmedContact: null,
  clientPreferences: { tone: 4, customInstructions: '' },
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
    const { filePath, cvData, modified_sections, thread } = await rewriteCVWithChanges(cvText, job, autoChanges || [], confirmedChanges || [], recommendedSections, originalName, appSession.confirmedContact, appSession.hrThread, appSession.clientPreferences);
    appSession.hrThread = thread;
    const company = (job.employer_name || job.company || 'Company').replace(/\s+/g, '_');
    const comparisonHtml = generateComparisonTemplate(appSession.cvData, cvData, job, modified_sections);
    const comparisonPath = `output/comparison_${company}.html`;
    await fse.outputFile(comparisonPath, comparisonHtml);
    res.json({ filePath, comparisonPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/export-word', async (req, res) => {
  try {
    const { cvData, job, templatePath, templateStyle } = req.body;
    if (!cvData || !job) return res.status(400).json({ error: 'cvData and job are required.' });

    if (templateStyle === 'alternate') {
      const wordPath = await generateWordCVAlt(cvData, job);
      return res.json({ wordPath });
    }
    if (templateStyle === 'original') {
      return res.status(501).json({ error: "Style mimicry from your original CV isn't available yet — your CV was read as a PDF, and this feature needs a Word-format source. Use 'Upload your own template' instead." });
    }
    if (templatePath) {
      const resolved = path.resolve(templatePath);
      const templatesDir = path.resolve('uploads/templates');
      if (!resolved.startsWith(templatesDir)) return res.status(400).json({ error: 'Invalid template path.' });
      const { wordPath, thread } = await generateWordFromTemplate(cvData, job, resolved, appSession.cvText, appSession.hrThread, appSession.clientPreferences);
      appSession.hrThread = thread;
      return res.json({ wordPath });
    }
    const wordPath = await generateWordCV(cvData, job);
    res.json({ wordPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload-template', templateUpload.single('template'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No .docx template file uploaded.' });
    new PizZip(await fse.readFile(req.file.path));
    res.json({ templatePath: req.file.path.replace(/\\/g, '/') });
  } catch (err) {
    res.status(400).json({ error: 'Invalid Word template file.' });
  }
});

app.post('/confirm-contact', (req, res) => {
  const { name, title, email, phone, location, linkedin, customInstructions, tone } = req.body;
  appSession.confirmedContact = { name, title, email, phone, location, linkedin };
  appSession.clientPreferences = { tone: tone || 4, customInstructions: customInstructions || '' };
  if (appSession.cvData) Object.assign(appSession.cvData, appSession.confirmedContact);
  res.json({ ok: true });
});

app.post('/review-cv', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { job } = req.body;
    if (!job) return res.status(400).json({ error: 'job is required.' });
    const { review, thread } = await reviewCV(appSession.cvText, job, [], appSession.clientPreferences);
    appSession.currentJob = job;
    appSession.hrReview = review;
    appSession.coachHistory = [];
    appSession.hrThread = thread;
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
      appSession.coachHistory, message, gap?.description, appSession.clientPreferences
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
    const { result, thread } = await refineWithHR(
      appSession.cvText, appSession.currentJob, appSession.hrReview,
      gap, conversation, appSession.hrThread, appSession.clientPreferences
    );
    appSession.hrThread = thread;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/hr/chat', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { message, model } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required.' });
    const { reply, thread } = await chatWithHRExpert(
      appSession.cvText, appSession.currentJob, appSession.hrThread, message, model, appSession.clientPreferences
    );
    appSession.hrThread = thread;
    res.json({ reply });
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
