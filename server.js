require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, rewriteCV } = require('./agent');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use('/output', express.static('output'));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Agent</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f4f4; color: #333; }
  
  .header { background: #2C2C2A; color: white; padding: 24px 48px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 22px; font-weight: 500; }
  .header span { font-size: 13px; color: rgba(255,255,255,0.5); }
  .accent { width: 4px; height: 32px; background: #185FA5; border-radius: 2px; }

  .container { max-width: 900px; margin: 40px auto; padding: 0 24px; }

  .upload-card { background: white; border-radius: 12px; border: 0.5px solid #E0E0E0; padding: 32px; margin-bottom: 24px; }
  .upload-card h2 { font-size: 16px; font-weight: 500; margin-bottom: 20px; color: #2C2C2A; }
  
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 12px; color: #666; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase; }
  
  input[type="text"], select { padding: 10px 14px; border: 0.5px solid #E0E0E0; border-radius: 8px; font-size: 14px; color: #333; background: white; }
  input[type="file"] { padding: 10px 14px; border: 0.5px solid #E0E0E0; border-radius: 8px; font-size: 14px; color: #333; background: white; width: 100%; }
  
  .btn-primary { background: #185FA5; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; cursor: pointer; width: 100%; margin-top: 8px; }
  .btn-primary:hover { background: #0C447C; }
  .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
  
  .btn-secondary { background: white; color: #185FA5; border: 1px solid #185FA5; padding: 8px 20px; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .btn-secondary:hover { background: #f0f7ff; }

  .status { text-align: center; padding: 24px; color: #666; font-size: 14px; display: none; }
  .status.active { display: block; }
  .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #E0E0E0; border-top-color: #185FA5; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .results { display: none; }
  .results.active { display: block; }
  .results h2 { font-size: 16px; font-weight: 500; margin-bottom: 16px; color: #2C2C2A; }

  .job-card { background: white; border-radius: 12px; border: 0.5px solid #E0E0E0; padding: 20px 24px; margin-bottom: 12px; display: grid; grid-template-columns: 40px 1fr auto; gap: 16px; align-items: start; }
  .rank { font-size: 22px; font-weight: 600; color: #185FA5; }
  .job-title { font-size: 15px; font-weight: 500; color: #2C2C2A; margin-bottom: 4px; }
  .job-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .job-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .badge { font-size: 11px; padding: 3px 10px; border-radius: 20px; }
  .badge-score { background: #E6F1FB; color: #185FA5; }
  .badge-remote { background: #EAF3DE; color: #3B6D11; }
  .badge-location { background: #F1EFE8; color: #5F5E5A; }
  .reasons { font-size: 12px; color: #666; line-height: 1.6; }
  .reasons strong { color: #333; }

  .no-results { text-align: center; padding: 48px; color: #999; font-size: 14px; }
</style>
</head>
<body>

<div class="header">
  <div class="accent"></div>
  <div>
    <h1>Job Agent</h1>
    <span>AI-powered job search & CV tailoring</span>
  </div>
</div>

<div class="container">
  <div class="upload-card">
    <h2>Find matching jobs</h2>
    <div class="form-row">
      <div class="form-group">
        <label>CV (PDF)</label>
        <input type="file" id="cvFile" accept=".pdf" />
      </div>
      <div class="form-group">
        <label>Country</label>
        <select id="country">
          <option value="GB">United Kingdom</option>
          <option value="SE" selected>Sweden</option>
          <option value="US">United States</option>
          <option value="DE">Germany</option>
          <option value="NL">Netherlands</option>
        </select>
      </div>
    </div>
    <button class="btn-primary" onclick="searchJobs()">Search Jobs</button>
  </div>

  <div class="status" id="status">
    <span class="spinner"></span>
    <span id="statusText">Searching...</span>
  </div>

  <div class="results" id="results">
    <h2 id="resultsTitle">Job matches</h2>
    <div id="jobList"></div>
  </div>
</div>

<script>
async function searchJobs() {
  const fileInput = document.getElementById('cvFile');
  const country = document.getElementById('country').value;

  if (!fileInput.files[0]) {
    alert('Please upload your CV first');
    return;
  }

  document.getElementById('status').classList.add('active');
  document.getElementById('results').classList.remove('active');
  document.getElementById('statusText').textContent = 'Reading CV and searching for jobs...';

  const formData = new FormData();
  formData.append('cv', fileInput.files[0]);
  formData.append('country', country);

  try {
    const response = await fetch('/search', { method: 'POST', body: formData });
    const data = await response.json();

    document.getElementById('status').classList.remove('active');

    if (!data.jobs || data.jobs.length === 0) {
      document.getElementById('jobList').innerHTML = '<div class="no-results">No jobs found. Try a different country.</div>';
    } else {
      document.getElementById('resultsTitle').textContent = data.jobs.length + ' job matches found';
      document.getElementById('jobList').innerHTML = data.jobs.map(job => \`
        <div class="job-card">
          <div class="rank">#\${job.rank}</div>
          <div>
            <div class="job-title">\${job.job_title}</div>
            <div class="job-company">\${job.company} · \${job.location || 'Location not specified'}</div>
            <div class="job-meta">
              <span class="badge badge-score">Fit: \${job.fit_score}/10</span>
              \${job.location === 'Remote' ? '<span class="badge badge-remote">Remote</span>' : ''}
              \${job.apply_link ? '<a href="' + job.apply_link + '" target="_blank" style="font-size:12px; color:#185FA5;">View job ↗</a>' : ''}
            </div>
            <div class="reasons"><strong>✓</strong> \${job.reasons_for}</div>
            <div class="reasons"><strong>✗</strong> \${job.reasons_against}</div>
          </div>
          <button class="btn-secondary" onclick="rewriteCV(\${job.rank - 1})">Tailor CV</button>
        </div>
      \`).join('');
    }
    
    document.getElementById('results').classList.add('active');
    window._jobs = data.jobs;
    window._cvPath = data.cvPath;

  } catch (err) {
    document.getElementById('statusText').textContent = 'Error: ' + err.message;
  }
}

async function rewriteCV(index) {
  const job = window._jobs[index];
  document.getElementById('statusText').textContent = 'Tailoring CV for ' + job.company + '...';
  document.getElementById('status').classList.add('active');

  const response = await fetch('/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, cvPath: window._cvPath })
  });

  const data = await response.json();
  document.getElementById('status').classList.remove('active');
  
  if (data.filePath) {
    window.open('/' + data.filePath, '_blank');
  }
}
</script>
</body>
</html>`);
});

app.post('/search', upload.single('cv'), async (req, res) => {
  try {
    const cvPath = req.file.path;
    const country = req.body.country || 'GB';

    const cvText = await readCV(cvPath);
    const jobTitles = await extractJobTitles(cvText);

    let allJobs = [];
    for (const title of jobTitles) {
      const jobs = await searchAllLocations(title, country);
      allJobs = [...allJobs, ...jobs];
    }

    const uniqueJobs = [...new Map(allJobs.map(job => [job.job_id, job])).entries()].map(([, job]) => job);
    const rankedJobs = await analyzeJobFit(cvText, uniqueJobs);

    res.json({ jobs: rankedJobs, cvPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/rewrite', express.json(), async (req, res) => {
  try {
    const { job, cvPath } = req.body;
    const cvText = await readCV(cvPath);
    const filePath = await rewriteCV(cvText, job);
    res.json({ filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('🚀 Job Agent running at http://localhost:3000');
});