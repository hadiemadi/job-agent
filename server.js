require('dotenv').config();
const express = require('express');
const multer = require('multer');
const {
  readCV, extractJobTitles, searchAllLocations, analyzeJobFit, rewriteCV,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
} = require('./agent');
const { generatePDF } = require('./src/pdf');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.json());
app.use('/output', express.static('output'));

// Persists for the lifetime of a single CV upload session
let appSession = { cvText: null, cvPath: null, jobs: null, rankedJobs: null };

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

  .container { max-width: 960px; margin: 40px auto; padding: 0 24px; }

  .upload-card { background: white; border-radius: 12px; border: 0.5px solid #E0E0E0; padding: 32px; margin-bottom: 24px; }
  .upload-card h2 { font-size: 16px; font-weight: 500; margin-bottom: 20px; color: #2C2C2A; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 12px; color: #666; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase; }
  select { padding: 10px 14px; border: 0.5px solid #E0E0E0; border-radius: 8px; font-size: 14px; color: #333; background: white; }
  input[type="file"] { padding: 10px 14px; border: 0.5px solid #E0E0E0; border-radius: 8px; font-size: 14px; color: #333; background: white; width: 100%; }

  .btn-primary { background: #185FA5; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; cursor: pointer; width: 100%; margin-top: 8px; }
  .btn-primary:hover { background: #0C447C; }
  .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
  .btn-secondary { background: white; color: #185FA5; border: 1px solid #185FA5; padding: 8px 20px; border-radius: 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .btn-secondary:hover { background: #f0f7ff; }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-cv-link { display: inline-block; margin-top: 8px; background: #1A7A3C; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; text-decoration: none; }
  .btn-cv-link:hover { background: #145c2d; }
  .btn-pdf-link { display: inline-block; margin-top: 6px; background: #185FA5; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; text-decoration: none; }
  .btn-pdf-link:hover { background: #0C447C; }
  .btn-coach-path { background: #5C35A0; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-top: 8px; }
  .btn-coach-path:hover { background: #47287d; }
  .btn-coach-path:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Status */
  .status { padding: 24px; display: none; }
  .status.active { display: block; }
  .status-step { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
  .status-step:last-child { border-bottom: none; }
  .step-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px; }
  .step-icon.waiting { background: #f0f0f0; color: #999; }
  .step-icon.running { background: #E6F1FB; color: #185FA5; }
  .step-icon.done { background: #EAF3DE; color: #1A7A3C; }
  .step-icon.warn { background: #fff8e6; color: #7a5500; }
  .step-icon.error { background: #fff0f0; color: #cc0000; }
  .spinner-sm { width: 14px; height: 14px; border: 2px solid #E0E0E0; border-top-color: #185FA5; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .step-text .label { font-size: 13px; color: #333; }
  .step-text .detail { font-size: 12px; margin-top: 2px; }
  .detail.ok { color: #1A7A3C; }
  .detail.warn { color: #cc5500; }
  .detail.info { color: #185FA5; }

  /* Tabs */
  .tabs { display: none; margin-bottom: 0; }
  .tabs.active { display: flex; }
  .tab-btn { padding: 10px 24px; font-size: 14px; border: none; background: #e8e8e6; color: #666; cursor: pointer; border-radius: 8px 8px 0 0; margin-right: 4px; }
  .tab-btn.active { background: white; color: #2C2C2A; font-weight: 500; }
  .tab-panel { display: none; background: white; border-radius: 0 12px 12px 12px; border: 0.5px solid #E0E0E0; padding: 24px; margin-bottom: 24px; }
  .tab-panel.active { display: block; }

  /* Job cards */
  .results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .results-header h2 { font-size: 16px; font-weight: 500; color: #2C2C2A; }
  .job-card { border-radius: 10px; border: 0.5px solid #E0E0E0; padding: 18px 20px; margin-bottom: 10px; display: grid; grid-template-columns: 40px 1fr auto; gap: 16px; align-items: start; }
  .rank { font-size: 22px; font-weight: 600; color: #185FA5; }
  .job-title { font-size: 15px; font-weight: 500; color: #2C2C2A; margin-bottom: 4px; }
  .job-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .job-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; align-items: center; }
  .badge { font-size: 11px; padding: 3px 10px; border-radius: 20px; }
  .badge-score { background: #E6F1FB; color: #185FA5; }
  .badge-remote { background: #EAF3DE; color: #3B6D11; }
  .badge-location { background: #F1EFE8; color: #5F5E5A; }
  .reasons { font-size: 12px; color: #666; line-height: 1.6; }
  .reasons strong { color: #333; }
  .card-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }

  /* Career Coach */
  .direction-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .direction-card { border: 1.5px solid #E0E0E0; border-radius: 10px; padding: 16px; cursor: pointer; text-align: center; transition: all 0.15s; }
  .direction-card:hover { border-color: #185FA5; background: #f5f9ff; }
  .direction-card.selected { border-color: #185FA5; background: #E6F1FB; }
  .direction-card .icon { font-size: 24px; margin-bottom: 6px; }
  .direction-card .title { font-size: 14px; font-weight: 600; color: #2C2C2A; }
  .direction-card .desc { font-size: 11px; color: #888; margin-top: 4px; }

  .coach-section { margin-top: 24px; }
  .coach-section-title { font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #E6F1FB; }

  .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
  .profile-item .key { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
  .profile-item .val { font-size: 13px; color: #333; margin-top: 2px; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .tag { background: #f0f0f0; border-radius: 4px; padding: 3px 8px; font-size: 12px; color: #555; }

  .role-card { border: 0.5px solid #E0E0E0; border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; }
  .role-card .role-title { font-size: 15px; font-weight: 600; color: #2C2C2A; margin-bottom: 8px; }
  .role-card .role-row { font-size: 12px; color: #666; line-height: 1.6; margin-bottom: 4px; }
  .role-card .role-row strong { color: #333; }
  .role-card .market-tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 20px; margin-bottom: 8px; }
  .market-tag.common { background: #EAF3DE; color: #3B6D11; }
  .market-tag.rare { background: #fff8e6; color: #7a5500; }

  .match-card { border: 0.5px solid #E0E0E0; border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; }
  .match-card .match-title { font-size: 14px; font-weight: 600; color: #2C2C2A; }
  .match-card .match-company { font-size: 12px; color: #888; margin-bottom: 8px; }
  .match-card .match-row { font-size: 12px; color: #666; line-height: 1.6; margin-bottom: 4px; }
  .match-card .match-row strong { color: #333; }
  .align-score { display: inline-block; font-size: 11px; background: #E6F1FB; color: #185FA5; padding: 2px 10px; border-radius: 20px; margin-bottom: 8px; }

  .path-panel { background: #fafafa; border: 0.5px solid #E0E0E0; border-radius: 10px; padding: 16px 18px; margin-top: 12px; }
  .path-section { margin-bottom: 14px; }
  .path-section:last-child { margin-bottom: 0; }
  .path-section .path-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #185FA5; margin-bottom: 6px; }
  .path-section ul { padding-left: 16px; }
  .path-section li { font-size: 13px; color: #555; line-height: 1.7; }
  .path-section p { font-size: 13px; color: #555; line-height: 1.7; }

  .no-results { text-align: center; padding: 48px; color: #999; font-size: 14px; }
  .alert-warn { background: #fff8e6; border: 1px solid #ffd980; color: #7a5500; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin-bottom: 12px; }
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
          <option value="SE">Sweden</option>
          <option value="US" selected>United States</option>
          <option value="DE">Germany</option>
          <option value="NL">Netherlands</option>
        </select>
      </div>
    </div>
    <div class="form-group" id="stateGroup" style="display:none;margin-bottom:16px;">
      <label>US State (optional — leave blank for all states)</label>
      <select id="usState">
        <option value="">All US States</option>
        <option value="Alabama">Alabama</option>
        <option value="Alaska">Alaska</option>
        <option value="Arizona">Arizona</option>
        <option value="Arkansas">Arkansas</option>
        <option value="California">California</option>
        <option value="Colorado">Colorado</option>
        <option value="Connecticut">Connecticut</option>
        <option value="Delaware">Delaware</option>
        <option value="Florida">Florida</option>
        <option value="Georgia">Georgia</option>
        <option value="Hawaii">Hawaii</option>
        <option value="Idaho">Idaho</option>
        <option value="Illinois">Illinois</option>
        <option value="Indiana">Indiana</option>
        <option value="Iowa">Iowa</option>
        <option value="Kansas">Kansas</option>
        <option value="Kentucky">Kentucky</option>
        <option value="Louisiana">Louisiana</option>
        <option value="Maine">Maine</option>
        <option value="Maryland">Maryland</option>
        <option value="Massachusetts">Massachusetts</option>
        <option value="Michigan">Michigan</option>
        <option value="Minnesota">Minnesota</option>
        <option value="Mississippi">Mississippi</option>
        <option value="Missouri">Missouri</option>
        <option value="Montana">Montana</option>
        <option value="Nebraska">Nebraska</option>
        <option value="Nevada">Nevada</option>
        <option value="New Hampshire">New Hampshire</option>
        <option value="New Jersey">New Jersey</option>
        <option value="New Mexico">New Mexico</option>
        <option value="New York">New York</option>
        <option value="North Carolina">North Carolina</option>
        <option value="North Dakota">North Dakota</option>
        <option value="Ohio">Ohio</option>
        <option value="Oklahoma">Oklahoma</option>
        <option value="Oregon">Oregon</option>
        <option value="Pennsylvania">Pennsylvania</option>
        <option value="Rhode Island">Rhode Island</option>
        <option value="South Carolina">South Carolina</option>
        <option value="South Dakota">South Dakota</option>
        <option value="Tennessee">Tennessee</option>
        <option value="Texas">Texas</option>
        <option value="Utah">Utah</option>
        <option value="Vermont">Vermont</option>
        <option value="Virginia">Virginia</option>
        <option value="Washington">Washington</option>
        <option value="West Virginia">West Virginia</option>
        <option value="Wisconsin">Wisconsin</option>
        <option value="Wyoming">Wyoming</option>
      </select>
    </div>
    <button class="btn-primary" id="searchBtn" onclick="startSearch()">Search Jobs</button>
  </div>

  <div class="status" id="status">
    <div class="status-step">
      <div class="step-icon waiting" id="icon1"><span>1</span></div>
      <div class="step-text">
        <div class="label">Reading CV &amp; extracting job titles</div>
        <div class="detail" id="detail1"></div>
      </div>
    </div>
    <div class="status-step">
      <div class="step-icon waiting" id="icon2"><span>2</span></div>
      <div class="step-text">
        <div class="label">Searching jobs</div>
        <div class="detail" id="detail2"></div>
      </div>
    </div>
    <div class="status-step">
      <div class="step-icon waiting" id="icon3"><span>3</span></div>
      <div class="step-text">
        <div class="label">Analyzing job fit with AI</div>
        <div class="detail" id="detail3"></div>
      </div>
    </div>
  </div>

  <div class="tabs" id="tabs">
    <button class="tab-btn active" onclick="showTab('jobs')">Job Matches</button>
    <button class="tab-btn" onclick="showTab('coach')">Career Coach</button>
  </div>

  <div class="tab-panel active" id="tab-jobs">
    <div class="results-header">
      <h2 id="resultsTitle">Job matches</h2>
    </div>
    <div id="jobList"></div>
  </div>

  <div class="tab-panel" id="tab-coach">
    <p style="font-size:13px;color:#666;margin-bottom:20px;">Select your preferred career direction, then get personalized coaching based on your CV and today's job market.</p>

    <div class="direction-row">
      <div class="direction-card" id="dir-specialist" onclick="selectDirection('specialist')">
        <div class="icon">⚙️</div>
        <div class="title">Specialist Track</div>
        <div class="desc">Deep expert · IC · Architect · Domain authority</div>
      </div>
      <div class="direction-card" id="dir-generalist" onclick="selectDirection('generalist')">
        <div class="icon">🔀</div>
        <div class="title">Generalist Track</div>
        <div class="desc">Program/Product Mgmt · Cross-functional</div>
      </div>
      <div class="direction-card" id="dir-leadership" onclick="selectDirection('leadership')">
        <div class="icon">🏛️</div>
        <div class="title">Leadership Track</div>
        <div class="desc">Team Lead · Manager · Director · VP</div>
      </div>
    </div>

    <button class="btn-primary" id="coachBtn" onclick="runCoach()" disabled>Get Career Advice</button>

    <div id="coachStatus" style="margin-top:16px;display:none;">
      <div class="status-step">
        <div class="step-icon waiting" id="cicon1"><span>1</span></div>
        <div class="step-text">
          <div class="label">Analyzing your profile &amp; suggesting ideal roles</div>
          <div class="detail" id="cdetail1"></div>
        </div>
      </div>
      <div class="status-step">
        <div class="step-icon waiting" id="cicon2"><span>2</span></div>
        <div class="step-text">
          <div class="label">Matching to today's job market</div>
          <div class="detail" id="cdetail2"></div>
        </div>
      </div>
    </div>

    <div id="coachResults"></div>
  </div>
</div>

<script>
const countryNames = { GB:'United Kingdom', SE:'Sweden', US:'United States', DE:'Germany', NL:'Netherlands' };
let selectedDirection = null;
document.getElementById('country').addEventListener('change', function() {
  document.getElementById('stateGroup').style.display = this.value === 'US' ? 'block' : 'none';
});
if (document.getElementById('country').value === 'US') {
  document.getElementById('stateGroup').style.display = 'block';
}

function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', ['jobs','coach'][i] === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}

function selectDirection(d) {
  selectedDirection = d;
  ['specialist','generalist','leadership'].forEach(x =>
    document.getElementById('dir-' + x).classList.toggle('selected', x === d)
  );
  document.getElementById('coachBtn').disabled = false;
}

function setStep(n, state, detail) {
  const icon = document.getElementById('icon' + n);
  const det = document.getElementById('detail' + n);
  const states = { waiting:'waiting', running:'running', done:'done', warn:'warn', error:'error' };
  const icons = { waiting: n, running: '<div class="spinner-sm"></div>', done:'✓', warn:'!', error:'✗' };
  icon.className = 'step-icon ' + (states[state] || 'waiting');
  icon.innerHTML = icons[state] || n;
  if (det && detail) { det.className = 'detail ' + (state === 'done' ? 'ok' : state === 'warn' ? 'warn' : 'info'); det.textContent = detail; }
}

function setCoachStep(n, state, detail) {
  const icon = document.getElementById('cicon' + n);
  const det = document.getElementById('cdetail' + n);
  const icons = { waiting: n, running: '<div class="spinner-sm"></div>', done:'✓', warn:'!', error:'✗' };
  icon.className = 'step-icon ' + state;
  icon.innerHTML = icons[state] || n;
  if (det && detail) { det.className = 'detail ' + (state === 'done' ? 'ok' : 'info'); det.textContent = detail; }
}

async function startSearch() {
  const fileInput = document.getElementById('cvFile');
  const country = document.getElementById('country').value;
  const usState = country === 'US' ? document.getElementById('usState').value : '';
  const locationLabel = country === 'US' && usState ? usState + ', US' : (countryNames[country] || country);
  if (!fileInput.files[0]) { alert('Please upload your CV first'); return; }

  document.getElementById('searchBtn').disabled = true;
  document.getElementById('status').classList.add('active');
  document.getElementById('tabs').classList.remove('active');
  document.getElementById('jobList').innerHTML = '';
  document.getElementById('coachResults').innerHTML = '';
  [1,2,3].forEach(n => setStep(n, 'waiting', ''));

  setStep(1, 'running');
  const formData = new FormData();
  formData.append('cv', fileInput.files[0]);
  formData.append('country', country);
  if (usState) formData.append('usState', usState);

  let jobsData;
  try {
    const res = await fetch('/search/jobs', { method: 'POST', body: formData });
    jobsData = await res.json();
  } catch (err) {
    setStep(1, 'error', err.message);
    document.getElementById('searchBtn').disabled = false;
    return;
  }
  if (jobsData.error) { setStep(1, 'error', jobsData.error); document.getElementById('searchBtn').disabled = false; return; }

  setStep(1, 'done', jobsData.titlesFound + ' job titles extracted');
  setStep(2, 'done', jobsData.count + ' jobs found in ' + locationLabel);

  if (jobsData.count === 0) {
    setStep(2, 'warn', 'No jobs found — try a different country');
    document.getElementById('searchBtn').disabled = false;
    return;
  }

  setStep(3, 'running');
  let analyzeData;
  try {
    const res = await fetch('/search/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ country }) });
    analyzeData = await res.json();
  } catch (err) {
    setStep(3, 'error', err.message);
    document.getElementById('searchBtn').disabled = false;
    return;
  }
  if (analyzeData.error) { setStep(3, 'error', analyzeData.error); document.getElementById('searchBtn').disabled = false; return; }

  setStep(3, 'done', analyzeData.jobs.length + ' jobs ranked');
  document.getElementById('searchBtn').disabled = false;

  window._jobs = analyzeData.jobs;
  window._cvPath = jobsData.cvPath;

  document.getElementById('resultsTitle').textContent = analyzeData.jobs.length + ' job matches in ' + locationLabel;
  document.getElementById('jobList').innerHTML = analyzeData.jobs.map((job, i) => \`
    <div class="job-card" id="card-\${i}">
      <div class="rank">#\${job.rank}</div>
      <div>
        <div class="job-title">\${job.job_title}</div>
        <div class="job-company">\${job.company} · \${job.location || 'Location not specified'}</div>
        <div class="job-meta">
          <span class="badge badge-score">Fit: \${job.fit_score}/10</span>
          \${job.location === 'Remote' ? '<span class="badge badge-remote">Remote</span>' : '<span class="badge badge-location">' + (job.location || '') + '</span>'}
          \${job.apply_link ? '<a href="' + job.apply_link + '" target="_blank" style="font-size:12px;color:#185FA5;">View job ↗</a>' : ''}
        </div>
        <div class="reasons"><strong>✓</strong> \${job.reasons_for}</div>
        <div class="reasons"><strong>✗</strong> \${job.reasons_against}</div>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" id="tailor-btn-\${i}" onclick="tailorCV(\${i})">Tailor CV</button>
        <div id="cv-link-\${i}"></div>
      </div>
    </div>
  \`).join('');

  document.getElementById('tabs').classList.add('active');
  showTab('jobs');
}

async function tailorCV(index) {
  const job = window._jobs[index];
  const btn = document.getElementById('tailor-btn-' + index);
  const linkDiv = document.getElementById('cv-link-' + index);
  btn.disabled = true; btn.textContent = 'Tailoring...';
  try {
    const res = await fetch('/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job, cvPath: window._cvPath }) });
    const data = await res.json();
    btn.textContent = 'Tailor CV'; btn.disabled = false;
    if (data.filePath) {
      linkDiv.innerHTML =
        '<a class="btn-cv-link" href="/' + data.filePath + '" target="_blank">Open CV ↗</a>' +
        (data.pdfPath ? '<br><a class="btn-pdf-link" href="/' + data.pdfPath + '" download>Download PDF ↓</a>' : '');
      window.open('/' + data.filePath, '_blank');
    }
  } catch (err) {
    btn.textContent = 'Tailor CV'; btn.disabled = false;
    linkDiv.innerHTML = '<span style="color:#cc0000;font-size:12px;">Failed</span>';
  }
}

async function runCoach() {
  if (!selectedDirection) return;
  document.getElementById('coachBtn').disabled = true;
  document.getElementById('coachResults').innerHTML = '';
  document.getElementById('coachStatus').style.display = 'block';
  [1,2].forEach(n => setCoachStep(n, 'waiting', ''));

  setCoachStep(1, 'running');
  let coachData;
  try {
    const res = await fetch('/coach/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: selectedDirection }) });
    coachData = await res.json();
  } catch (err) {
    setCoachStep(1, 'error', err.message);
    document.getElementById('coachBtn').disabled = false;
    return;
  }
  if (coachData.error) { setCoachStep(1, 'error', coachData.error); document.getElementById('coachBtn').disabled = false; return; }

  setCoachStep(1, 'done', coachData.suggestedRoles.length + ' ideal roles identified');
  setCoachStep(2, 'done', coachData.marketMatches.length + ' market matches found');
  document.getElementById('coachBtn').disabled = false;

  renderCoachResults(coachData);
}

function renderCoachResults(data) {
  const { profile, suggestedRoles, marketMatches } = data;

  const profileHtml = \`
    <div class="coach-section">
      <div class="coach-section-title">Your Profile</div>
      <div class="profile-grid">
        <div class="profile-item"><div class="key">Current Level</div><div class="val">\${profile.current_level}</div></div>
        <div class="profile-item"><div class="key">Experience</div><div class="val">\${profile.years_experience} years</div></div>
        <div class="profile-item" style="grid-column:1/-1"><div class="key">Career Trajectory</div><div class="val">\${profile.trajectory}</div></div>
        <div class="profile-item"><div class="key">Key Strengths</div><div class="tag-list">\${profile.key_strengths.map(s => '<span class="tag">'+s+'</span>').join('')}</div></div>
        <div class="profile-item"><div class="key">Domain Expertise</div><div class="tag-list">\${profile.domain_expertise.map(s => '<span class="tag">'+s+'</span>').join('')}</div></div>
      </div>
    </div>\`;

  const rolesHtml = \`
    <div class="coach-section">
      <div class="coach-section-title">Ideal Roles for You</div>
      \${suggestedRoles.map((role, i) => \`
        <div class="role-card" id="role-card-\${i}">
          <div class="role-title">\${role.title}</div>
          <span class="market-tag \${role.typical_in_market ? 'common' : 'rare'}">\${role.typical_in_market ? 'Common in market' : 'Rare / emerging role'}</span>
          <div class="role-row"><strong>Why you fit:</strong> \${role.why_fit}</div>
          <div class="role-row"><strong>Why now:</strong> \${role.why_next_step}</div>
          <button class="btn-coach-path" id="path-btn-\${i}" onclick="getCareerPath('\${role.title.replace(/'/g, "\\\\'")}', \${i})">Career Path →</button>
          <div id="path-panel-\${i}"></div>
        </div>
      \`).join('')}
    </div>\`;

  const marketHtml = marketMatches.length === 0 ? '' : \`
    <div class="coach-section">
      <div class="coach-section-title">Best Available Jobs for Your Next Step</div>
      \${marketMatches.map(m => \`
        <div class="match-card">
          <div class="match-title">\${m.job_title}</div>
          <div class="match-company">\${m.company}</div>
          <span class="align-score">Alignment: \${m.alignment_score}/10</span>
          <div class="match-row"><strong>Why it fits:</strong> \${m.why_it_fits}</div>
          <div class="match-row"><strong>Stepping stone to:</strong> \${m.stepping_stone_to}</div>
          \${m.caveats ? '<div class="match-row"><strong>Caveats:</strong> ' + m.caveats + '</div>' : ''}
        </div>
      \`).join('')}
    </div>\`;

  document.getElementById('coachResults').innerHTML = profileHtml + rolesHtml + marketHtml;
}

async function getCareerPath(roleTitle, index) {
  const btn = document.getElementById('path-btn-' + index);
  const panel = document.getElementById('path-panel-' + index);
  btn.disabled = true; btn.textContent = 'Loading...';

  try {
    const res = await fetch('/coach/path', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roleTitle }) });
    const data = await res.json();
    btn.textContent = 'Career Path →'; btn.disabled = false;

    if (data.error) { panel.innerHTML = '<p style="color:#cc0000;font-size:12px;">' + data.error + '</p>'; return; }

    panel.innerHTML = \`
      <div class="path-panel">
        <div class="path-section"><div class="path-label">Key Challenges</div><ul>\${data.key_challenges.map(c => '<li>'+c+'</li>').join('')}</ul></div>
        <div class="path-section"><div class="path-label">Skill Gaps to Address</div><ul>\${data.skill_gaps.map(g => '<li>'+g+'</li>').join('')}</ul></div>
        <div class="path-section"><div class="path-label">Quick Wins</div><ul>\${data.quick_wins.map(w => '<li>'+w+'</li>').join('')}</ul></div>
        <div class="path-section"><div class="path-label">Success at 6 Months</div><p>\${data.success_at_6_months}</p></div>
        <div class="path-section"><div class="path-label">Success at 12 Months</div><p>\${data.success_at_12_months}</p></div>
        <div class="path-section"><div class="path-label">Long-Term Trajectory (3–5 years)</div><p>\${data.long_term_trajectory}</p></div>
      </div>\`;
  } catch (err) {
    btn.textContent = 'Career Path →'; btn.disabled = false;
    panel.innerHTML = '<p style="color:#cc0000;font-size:12px;">' + err.message + '</p>';
  }
}
</script>
</body>
</html>`);
});

app.post('/search/jobs', upload.single('cv'), async (req, res) => {
  try {
    const cvPath = req.file.path;
    const country = req.body.country || 'GB';
    const usState = req.body.usState || '';
    const cvText = await readCV(cvPath);
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
    if (!appSession.jobs) return res.status(400).json({ error: 'No search session. Search first.' });
    const country = req.body.country || 'GB';
    const rankedJobs = await analyzeJobFit(appSession.cvText, appSession.jobs, country);
    appSession.rankedJobs = rankedJobs;
    res.json({ jobs: rankedJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/coach/analyze', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded. Run a job search first.' });
    const { direction } = req.body;
    if (!direction) return res.status(400).json({ error: 'direction is required.' });

    const coachResult = await analyzeAndSuggestRoles(appSession.cvText, direction);
    if (!coachResult) return res.status(500).json({ error: 'Career analysis failed. Please try again.' });

    const rankedJobs = appSession.rankedJobs || [];
    const marketMatches = rankedJobs.length > 0
      ? await matchRolesToMarket(coachResult.suggested_roles, rankedJobs)
      : [];

    res.json({
      profile: coachResult.profile,
      suggestedRoles: coachResult.suggested_roles,
      marketMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/coach/path', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded. Run a job search first.' });
    const { roleTitle } = req.body;
    if (!roleTitle) return res.status(400).json({ error: 'roleTitle is required.' });

    const path = await buildCareerPath(roleTitle, appSession.cvText);
    if (!path) return res.status(500).json({ error: 'Career path analysis failed. Please try again.' });
    res.json(path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/rewrite', async (req, res) => {
  try {
    const { job, cvPath } = req.body;
    const cvText = await readCV(cvPath);
    const filePath = await rewriteCV(cvText, job);
    const pdfPath = await generatePDF(filePath);
    res.json({ filePath, pdfPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Job Agent running at http://localhost:3000'));
