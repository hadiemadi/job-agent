require('dotenv').config();
const express = require('express');
const multer = require('multer');
const {
  readCV, extractJobTitles, searchAllLocations, analyzeJobFit,
  rewriteCV, reviewCV, parseJobFromText,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
} = require('./agent');
const { scrapeJobPage } = require('./src/scraper');
const { generatePDF } = require('./src/pdf');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.json());
app.use('/output', express.static('output'));

let appSession = { cvText: null, cvPath: null, jobs: null, rankedJobs: null };

// ── HTML UI ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Agent</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Segoe UI',Arial,sans-serif; background:#f0f0ee; color:#333; }

.header { background:#2C2C2A; color:white; padding:20px 48px; display:flex; align-items:center; gap:14px; }
.header h1 { font-size:20px; font-weight:500; }
.header span { font-size:12px; color:rgba(255,255,255,0.45); }
.accent { width:4px; height:28px; background:#185FA5; border-radius:2px; }

.container { max-width:780px; margin:36px auto; padding:0 20px; }

.card { background:white; border-radius:12px; border:0.5px solid #E0E0E0; padding:28px 32px; margin-bottom:20px; }
.card h2 { font-size:15px; font-weight:600; color:#2C2C2A; margin-bottom:18px; }
.card h3 { font-size:13px; font-weight:600; color:#2C2C2A; margin-bottom:14px; }

.form-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
.form-group { display:flex; flex-direction:column; gap:5px; }
.form-group label { font-size:11px; color:#888; font-weight:600; letter-spacing:0.6px; text-transform:uppercase; }
.form-group label .opt { font-weight:400; color:#bbb; text-transform:none; letter-spacing:0; }
input[type="file"], input[type="url"], select, textarea {
  padding:10px 13px; border:0.5px solid #ddd; border-radius:8px; font-size:13px; color:#333; background:white; width:100%;
}
input[type="url"]:focus, select:focus, textarea:focus { outline:none; border-color:#185FA5; }
textarea { resize:vertical; height:100px; }

.btn { border:none; padding:11px 28px; border-radius:8px; font-size:14px; cursor:pointer; font-weight:500; }
.btn-go { background:#2C2C2A; color:white; width:100%; margin-top:4px; }
.btn-go:hover { background:#444; }
.btn-go:disabled { background:#bbb; cursor:not-allowed; }
.btn-blue { background:#185FA5; color:white; }
.btn-blue:hover { background:#0C447C; }
.btn-blue:disabled { background:#bbb; cursor:not-allowed; }
.btn-green { background:#1A7A3C; color:white; text-decoration:none; display:inline-block; }
.btn-green:hover { background:#145c2d; }
.btn-ghost { background:white; color:#185FA5; border:1px solid #185FA5; }
.btn-ghost:hover { background:#f0f7ff; }
.btn-ghost:disabled { opacity:0.5; cursor:not-allowed; }
.btn-sm { padding:7px 16px; font-size:12px; }

.link-btn { background:none; border:none; color:#185FA5; font-size:12px; cursor:pointer; padding:0; text-decoration:underline; }
.link-btn:hover { color:#0C447C; }

/* Progress steps */
.steps { padding:4px 0; }
.step { display:flex; gap:12px; align-items:flex-start; padding:9px 0; border-bottom:1px solid #f5f5f5; }
.step:last-child { border-bottom:none; }
.step-icon { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; margin-top:1px; }
.step-icon.wait { background:#f0f0f0; color:#aaa; }
.step-icon.run { background:#E6F1FB; color:#185FA5; }
.step-icon.ok { background:#EAF3DE; color:#1A7A3C; }
.step-icon.err { background:#fff0f0; color:#cc0000; }
.step-icon.warn { background:#fff8e6; color:#7a5500; }
.spinner { width:12px; height:12px; border:2px solid #ddd; border-top-color:#185FA5; border-radius:50%; animation:spin 0.8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.step-label { font-size:13px; color:#333; }
.step-detail { font-size:11px; margin-top:2px; }
.step-detail.ok { color:#1A7A3C; }
.step-detail.info { color:#185FA5; }
.step-detail.warn { color:#cc5500; }
.step-detail.err { color:#cc0000; }

/* Job list (search flow) */
.job-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:0.5px solid #f0f0f0; }
.job-row:last-child { border-bottom:none; }
.job-rank { font-size:18px; font-weight:600; color:#185FA5; min-width:28px; }
.job-info { flex:1; }
.job-title-sm { font-size:14px; font-weight:500; color:#2C2C2A; }
.job-meta-sm { font-size:12px; color:#888; margin-top:2px; }
.badge-fit { font-size:11px; background:#E6F1FB; color:#185FA5; padding:2px 8px; border-radius:12px; margin-left:6px; }
.job-row-actions { display:flex; flex-direction:column; align-items:flex-end; gap:6px; min-width:110px; }

/* Fetched job preview */
.job-preview { background:#fafafa; border:0.5px solid #E0E0E0; border-radius:8px; padding:14px 16px; margin-bottom:16px; }
.job-preview .jp-title { font-size:16px; font-weight:600; color:#2C2C2A; margin-bottom:4px; }
.job-preview .jp-company { font-size:13px; color:#666; margin-bottom:8px; }
.job-preview .jp-desc { font-size:12px; color:#888; line-height:1.6; max-height:72px; overflow:hidden; }

/* Result card */
.result-job { font-size:15px; font-weight:600; color:#2C2C2A; margin-bottom:3px; }
.result-company { font-size:13px; color:#666; margin-bottom:16px; }
.result-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:20px; }

/* HR Review panel */
.hr-panel { border-top:0.5px solid #eee; padding-top:18px; margin-top:4px; }
.hr-match { display:inline-block; font-size:12px; font-weight:600; padding:4px 12px; border-radius:20px; margin-bottom:14px; }
.hr-match.Strong { background:#EAF3DE; color:#1A7A3C; }
.hr-match.Moderate { background:#fff8e6; color:#7a5500; }
.hr-match.Weak { background:#fff0f0; color:#cc0000; }
.hr-section { margin-bottom:14px; }
.hr-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.8px; color:#888; margin-bottom:6px; }
.hr-list { padding-left:0; list-style:none; }
.hr-list li { font-size:13px; color:#444; line-height:1.6; padding:3px 0; padding-left:16px; position:relative; }
.hr-list li::before { content:'✓'; position:absolute; left:0; color:#1A7A3C; font-size:11px; top:4px; }
.hr-improve { margin-bottom:8px; }
.hr-improve .issue { font-size:13px; color:#cc5500; margin-bottom:2px; }
.hr-improve .fix { font-size:12px; color:#555; padding-left:12px; }

/* Career Coach (secondary) */
.coach-toggle-bar { text-align:center; padding:8px 0 20px; }
.direction-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:16px; }
.dir-card { border:1.5px solid #E0E0E0; border-radius:10px; padding:14px 12px; cursor:pointer; text-align:center; }
.dir-card:hover { border-color:#185FA5; background:#f5f9ff; }
.dir-card.sel { border-color:#185FA5; background:#E6F1FB; }
.dir-card .d-icon { font-size:20px; margin-bottom:4px; }
.dir-card .d-title { font-size:13px; font-weight:600; color:#2C2C2A; }
.dir-card .d-desc { font-size:10px; color:#999; margin-top:3px; }
.role-card { border:0.5px solid #E0E0E0; border-radius:8px; padding:14px 16px; margin-bottom:8px; }
.role-title { font-size:14px; font-weight:600; color:#2C2C2A; margin-bottom:6px; }
.role-row { font-size:12px; color:#666; line-height:1.6; margin-bottom:3px; }
.role-row strong { color:#444; }
.coach-section-title { font-size:11px; font-weight:600; letter-spacing:1.2px; text-transform:uppercase; color:#185FA5; margin:18px 0 10px; padding-bottom:4px; border-bottom:1px solid #E6F1FB; }
.path-panel { background:#fafafa; border:0.5px solid #E0E0E0; border-radius:8px; padding:14px 16px; margin-top:10px; }
.path-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.8px; color:#185FA5; margin-bottom:5px; }
.path-list { padding-left:16px; margin-bottom:12px; }
.path-list li { font-size:12px; color:#555; line-height:1.7; }
.path-p { font-size:12px; color:#555; line-height:1.7; margin-bottom:12px; }

.err-msg { color:#cc0000; font-size:12px; margin-top:6px; }
.info-msg { color:#185FA5; font-size:12px; margin-top:6px; }
</style>
</head>
<body>

<div class="header">
  <div class="accent"></div>
  <div>
    <h1>Job Agent</h1>
    <span>Tailor your CV to any job — instantly</span>
  </div>
</div>

<div class="container">

  <!-- ── Input card ─────────────────────────────── -->
  <div class="card" id="inputCard">
    <h2>Get started</h2>
    <div class="form-row">
      <div class="form-group">
        <label>Your CV <span class="opt">(PDF)</span></label>
        <input type="file" id="cvFile" accept=".pdf" />
      </div>
      <div class="form-group">
        <label>Job post URL <span class="opt">— optional</span></label>
        <input type="url" id="jobUrl" placeholder="LinkedIn, Indeed, company site…" />
      </div>
    </div>
    <button class="btn btn-go" id="goBtn" onclick="go()">Go →</button>
    <div id="goStatus" class="info-msg" style="display:none;margin-top:10px;"></div>

    <!-- Paste fallback (shown if scraping fails) -->
    <div id="pasteToggleRow" style="display:none;margin-top:12px;">
      <button class="link-btn" onclick="togglePaste()">LinkedIn blocked? Paste the job description instead</button>
      <div id="pasteArea" style="display:none;margin-top:10px;">
        <textarea id="jobText" placeholder="Paste the full job description here…"></textarea>
        <button class="btn btn-blue btn-sm" style="margin-top:8px;" onclick="parseManual()">Parse this text</button>
      </div>
    </div>

    <!-- Search panel (shown when no URL) -->
    <div id="searchPanel" style="display:none;border-top:0.5px solid #eee;margin-top:20px;padding-top:20px;">
      <h3>Search for jobs</h3>
      <div class="form-row">
        <div class="form-group">
          <label>Country</label>
          <select id="country" onchange="onCountryChange()">
            <option value="US" selected>United States</option>
            <option value="GB">United Kingdom</option>
            <option value="SE">Sweden</option>
            <option value="DE">Germany</option>
            <option value="NL">Netherlands</option>
          </select>
        </div>
        <div class="form-group" id="stateGroup">
          <label>State <span class="opt">— optional</span></label>
          <select id="usState">
            <option value="">All US States</option>
            <option value="Alabama">Alabama</option><option value="Alaska">Alaska</option>
            <option value="Arizona">Arizona</option><option value="Arkansas">Arkansas</option>
            <option value="California">California</option><option value="Colorado">Colorado</option>
            <option value="Connecticut">Connecticut</option><option value="Delaware">Delaware</option>
            <option value="Florida">Florida</option><option value="Georgia">Georgia</option>
            <option value="Hawaii">Hawaii</option><option value="Idaho">Idaho</option>
            <option value="Illinois">Illinois</option><option value="Indiana">Indiana</option>
            <option value="Iowa">Iowa</option><option value="Kansas">Kansas</option>
            <option value="Kentucky">Kentucky</option><option value="Louisiana">Louisiana</option>
            <option value="Maine">Maine</option><option value="Maryland">Maryland</option>
            <option value="Massachusetts">Massachusetts</option><option value="Michigan">Michigan</option>
            <option value="Minnesota">Minnesota</option><option value="Mississippi">Mississippi</option>
            <option value="Missouri">Missouri</option><option value="Montana">Montana</option>
            <option value="Nebraska">Nebraska</option><option value="Nevada">Nevada</option>
            <option value="New Hampshire">New Hampshire</option><option value="New Jersey">New Jersey</option>
            <option value="New Mexico">New Mexico</option><option value="New York">New York</option>
            <option value="North Carolina">North Carolina</option><option value="North Dakota">North Dakota</option>
            <option value="Ohio">Ohio</option><option value="Oklahoma">Oklahoma</option>
            <option value="Oregon">Oregon</option><option value="Pennsylvania">Pennsylvania</option>
            <option value="Rhode Island">Rhode Island</option><option value="South Carolina">South Carolina</option>
            <option value="South Dakota">South Dakota</option><option value="Tennessee">Tennessee</option>
            <option value="Texas">Texas</option><option value="Utah">Utah</option>
            <option value="Vermont">Vermont</option><option value="Virginia">Virginia</option>
            <option value="Washington">Washington</option><option value="West Virginia">West Virginia</option>
            <option value="Wisconsin">Wisconsin</option><option value="Wyoming">Wyoming</option>
          </select>
        </div>
      </div>
      <button class="btn btn-blue" id="searchBtn" onclick="runSearch()">Search Jobs</button>
    </div>
  </div>

  <!-- ── Progress card ──────────────────────────── -->
  <div class="card" id="progressCard" style="display:none;">
    <div class="steps" id="steps"></div>
  </div>

  <!-- ── Fetched job preview (URL flow) ─────────── -->
  <div class="card" id="fetchedCard" style="display:none;">
    <div class="job-preview">
      <div class="jp-title" id="fpTitle"></div>
      <div class="jp-company" id="fpCompany"></div>
      <div class="jp-desc" id="fpDesc"></div>
    </div>
    <button class="btn btn-blue" id="tailorFetchedBtn" onclick="tailorFetched()">Tailor my CV for this job</button>
  </div>

  <!-- ── Search results (search flow) ──────────── -->
  <div class="card" id="searchResultsCard" style="display:none;">
    <h3 id="searchResultsTitle">Jobs found</h3>
    <div id="jobList"></div>
  </div>

  <!-- ── Result card ────────────────────────────── -->
  <div class="card" id="resultCard" style="display:none;">
    <div class="result-job" id="resultTitle"></div>
    <div class="result-company" id="resultCompany"></div>
    <div class="result-actions">
      <a class="btn btn-green btn-sm" id="openCvBtn" href="#" target="_blank">Open CV ↗</a>
      <a class="btn btn-blue btn-sm" id="downloadPdfBtn" href="#" download>Download PDF ↓</a>
      <button class="btn btn-ghost btn-sm" id="hrBtn" onclick="getHRReview()">HR Review →</button>
    </div>
    <div id="hrStatus" class="info-msg" style="display:none;"></div>
    <div id="hrPanel" style="display:none;" class="hr-panel"></div>
  </div>

  <!-- ── Career Coach (secondary) ──────────────── -->
  <div class="coach-toggle-bar" id="coachToggleBar" style="display:none;">
    <button class="link-btn" onclick="toggleCoach()">Career advice for your next step →</button>
  </div>
  <div class="card" id="coachCard" style="display:none;">
    <h2>Career Coach</h2>
    <p style="font-size:12px;color:#888;margin-bottom:16px;">Pick your direction and get personalized career advice based on your CV and today's market.</p>
    <div class="direction-row">
      <div class="dir-card" id="dir-specialist" onclick="selectDir('specialist')">
        <div class="d-icon">⚙️</div>
        <div class="d-title">Specialist</div>
        <div class="d-desc">Deep expert · IC · Architect</div>
      </div>
      <div class="dir-card" id="dir-generalist" onclick="selectDir('generalist')">
        <div class="d-icon">🔀</div>
        <div class="d-title">Generalist</div>
        <div class="d-desc">Program/Product Mgmt</div>
      </div>
      <div class="dir-card" id="dir-leadership" onclick="selectDir('leadership')">
        <div class="d-icon">🏛️</div>
        <div class="d-title">Leadership</div>
        <div class="d-desc">Manager · Director · VP</div>
      </div>
    </div>
    <button class="btn btn-blue" id="coachBtn" onclick="runCoach()" disabled>Get advice</button>
    <div id="coachStatus" class="info-msg" style="display:none;margin-top:8px;"></div>
    <div id="coachResults"></div>
  </div>

</div>

<script>
let _cvPath = null;
let _fetchedJob = null;
let _currentJob = null;
let _selectedDir = null;
const countryNames = { US:'United States', GB:'United Kingdom', SE:'Sweden', DE:'Germany', NL:'Netherlands' };

// ── Utilities ─────────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function el(id) { return document.getElementById(id); }

function setGoStatus(msg, type) {
  const s = el('goStatus');
  s.textContent = msg;
  s.className = type === 'err' ? 'err-msg' : 'info-msg';
  s.style.display = msg ? 'block' : 'none';
}

function buildSteps(defs) {
  el('steps').innerHTML = defs.map((d, i) => \`
    <div class="step" id="step\${i}">
      <div class="step-icon wait" id="si\${i}">\${i+1}</div>
      <div>
        <div class="step-label">\${d}</div>
        <div class="step-detail" id="sd\${i}"></div>
      </div>
    </div>
  \`).join('');
}

function setStep(i, state, detail) {
  const icon = el('si' + i);
  const det = el('sd' + i);
  const iconMap = { wait: i+1, run: '<div class="spinner"></div>', ok:'✓', err:'✗', warn:'!' };
  icon.className = 'step-icon ' + state;
  icon.innerHTML = iconMap[state] || (i+1);
  if (det && detail) { det.className = 'step-detail ' + state; det.textContent = detail; }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function go() {
  const file = el('cvFile').files[0];
  const url  = el('jobUrl').value.trim();
  if (!file) { setGoStatus('Please select your CV file.', 'err'); return; }

  el('goBtn').disabled = true;
  hide('fetchedCard'); hide('searchResultsCard'); hide('resultCard');
  hide('hrPanel'); hide('coachToggleBar'); hide('coachCard');

  // Always upload CV first
  setGoStatus('Reading your CV…', 'info');
  show('progressCard');
  buildSteps(['Reading CV']);
  setStep(0, 'run');

  const fd = new FormData();
  fd.append('cv', file);
  const upRes = await fetch('/upload-cv', { method:'POST', body: fd });
  const upData = await upRes.json();
  if (upData.error) { setStep(0,'err', upData.error); setGoStatus(upData.error,'err'); el('goBtn').disabled=false; return; }
  _cvPath = upData.cvPath;
  setStep(0, 'ok', 'CV ready');
  setGoStatus('', '');

  if (url) {
    await urlFlow(url);
  } else {
    hide('progressCard');
    show('searchPanel');
    setGoStatus('No job URL — choose a location and search below.', 'info');
  }

  el('goBtn').disabled = false;
}

// ── URL flow ──────────────────────────────────────────────────────────────────

async function urlFlow(url) {
  buildSteps(['Reading CV', 'Fetching job post', 'Parsing job details']);
  setStep(0, 'ok', 'CV ready');
  setStep(1, 'run');

  let rawText;
  try {
    const res = await fetch('/fetch-job', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (data.error) {
      if (data.loginWall) {
        setStep(1, 'warn', 'LinkedIn requires login — paste the job text below');
        show('pasteToggleRow');
        el('pasteArea').style.display = 'block';
        hide('progressCard');
        return;
      }
      setStep(1, 'err', data.error); return;
    }
    if (!data.job) {
      setStep(1, 'err', 'Could not parse job details — please paste the text below');
      show('pasteToggleRow');
      return;
    }
    setStep(1, 'ok', 'Page fetched');
    setStep(2, 'ok', data.job.job_title || 'Job details extracted');
    await new Promise(r => setTimeout(r, 700));
    hide('progressCard');
    showFetchedJob(data.job);
  } catch (err) {
    setStep(1, 'err', err.message);
  }
}

function showFetchedJob(job) {
  _fetchedJob = job;
  el('fpTitle').textContent = job.job_title || 'Job post';
  el('fpCompany').textContent = [job.employer_name, job.job_city].filter(Boolean).join(' · ');
  el('fpDesc').textContent = (job.job_description || '').slice(0, 280) + '…';
  show('fetchedCard');
  el('fetchedCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function tailorFetched() {
  await tailorJob(_fetchedJob, 'tailorFetchedBtn');
}

async function parseManual() {
  const text = el('jobText').value.trim();
  if (!text) return;
  setGoStatus('Parsing job description…', 'info');
  const res = await fetch('/fetch-job', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ jobText: text }) });
  const data = await res.json();
  setGoStatus('', '');
  if (data.error) { setGoStatus(data.error, 'err'); return; }
  if (!data.job) { setGoStatus('Could not parse job text — try pasting more of the description.', 'err'); return; }
  hide('pasteToggleRow');
  showFetchedJob(data.job);
}

function togglePaste() {
  const p = el('pasteArea');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
}

// ── Search flow ───────────────────────────────────────────────────────────────

function onCountryChange() {
  el('stateGroup').style.display = el('country').value === 'US' ? '' : 'none';
}

async function runSearch() {
  if (!_cvPath) { setGoStatus('Please click Go first to upload your CV.', 'err'); return; }
  const country = el('country').value;
  const usState = country === 'US' ? el('usState').value : '';
  const locLabel = country === 'US' && usState ? usState : (countryNames[country] || country);

  hide('searchResultsCard'); hide('resultCard'); hide('coachToggleBar');
  el('searchBtn').disabled = true;
  show('progressCard');
  buildSteps(['Extracting job titles from CV', 'Searching ' + locLabel, 'Ranking by AI fit']);
  setStep(0, 'run');

  const searchFd = new FormData();
  searchFd.append('cv', el('cvFile').files[0]);
  searchFd.append('country', country);
  if (usState) searchFd.append('usState', usState);

  const sRes = await fetch('/search/jobs', { method:'POST', body: searchFd });
  const sData = await sRes.json();
  if (sData.error) { setStep(0,'err',sData.error); el('searchBtn').disabled=false; return; }

  setStep(0, 'ok', sData.titlesFound + ' job titles found');
  setStep(1, 'ok', sData.count + ' jobs in ' + locLabel);

  if (sData.count === 0) { setStep(1,'warn','No jobs found — try a different location'); el('searchBtn').disabled=false; return; }

  setStep(2, 'run');
  const aRes = await fetch('/search/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ country }) });
  const aData = await aRes.json();
  if (aData.error) { setStep(2,'err',aData.error); el('searchBtn').disabled=false; return; }

  setStep(2, 'ok', aData.jobs.length + ' jobs ranked');
  hide('progressCard');
  el('searchBtn').disabled = false;

  el('searchResultsTitle').textContent = aData.jobs.length + ' best matches in ' + locLabel;
  el('jobList').innerHTML = aData.jobs.map((job, i) => \`
    <div class="job-row" id="jrow-\${i}">
      <div class="job-rank">#\${job.rank}</div>
      <div class="job-info">
        <div class="job-title-sm">
          \${job.job_title}
          <span class="badge-fit">\${job.fit_score}/10</span>
        </div>
        <div class="job-meta-sm">\${job.company || ''}\${job.location ? ' · ' + job.location : ''}
          \${job.apply_link ? ' · <a href="' + job.apply_link + '" target="_blank" style="color:#185FA5;">View ↗</a>' : ''}
        </div>
      </div>
      <div class="job-row-actions">
        <button class="btn btn-ghost btn-sm" id="tailor-\${i}" onclick="tailorSearchJob(\${i})">Tailor CV</button>
        <div id="tailor-result-\${i}"></div>
      </div>
    </div>
  \`).join('');

  window._searchJobs = aData.jobs;
  show('searchResultsCard');
  show('coachToggleBar');
}

async function tailorSearchJob(i) {
  const job = window._searchJobs[i];
  const btn = el('tailor-' + i);
  const resultDiv = el('tailor-result-' + i);
  btn.disabled = true; btn.textContent = 'Tailoring…';
  try {
    const res = await fetch('/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job, cvPath: _cvPath }) });
    const data = await res.json();
    btn.textContent = 'Tailor CV'; btn.disabled = false;
    if (data.filePath) {
      _currentJob = job;
      showResult(job.job_title, job.company, data.filePath, data.pdfPath);
      resultDiv.innerHTML = '<span style="color:#1A7A3C;font-size:11px;">✓ Done — see result below</span>';
    }
  } catch (err) {
    btn.textContent = 'Tailor CV'; btn.disabled = false;
    resultDiv.innerHTML = '<span class="err-msg">' + err.message + '</span>';
  }
}

// ── Tailor (URL flow) ─────────────────────────────────────────────────────────

async function tailorJob(job, btnId) {
  if (!_cvPath) { setGoStatus('CV not loaded — click Go first.', 'err'); return; }
  const btn = el(btnId);
  btn.disabled = true; btn.textContent = 'Tailoring + PDF…';
  show('progressCard');
  buildSteps(['Tailoring CV to this job', 'Generating PDF']);
  setStep(0, 'run');

  try {
    const res = await fetch('/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job, cvPath: _cvPath }) });
    const data = await res.json();
    btn.textContent = 'Tailor my CV for this job'; btn.disabled = false;
    if (data.error) { setStep(0,'err',data.error); return; }
    setStep(0, 'ok', 'CV tailored');
    setStep(1, 'ok', 'PDF ready');
    hide('progressCard');
    _currentJob = job;
    showResult(job.job_title, job.employer_name, data.filePath, data.pdfPath);
  } catch (err) {
    btn.textContent = 'Tailor my CV for this job'; btn.disabled = false;
    setStep(0, 'err', err.message);
  }
}

// ── Result ────────────────────────────────────────────────────────────────────

function showResult(title, company, filePath, pdfPath) {
  el('resultTitle').textContent = title || 'Tailored CV';
  el('resultCompany').textContent = company || '';
  el('openCvBtn').href = '/' + filePath;
  if (pdfPath) { el('downloadPdfBtn').href = '/' + pdfPath; el('downloadPdfBtn').style.display = ''; }
  else el('downloadPdfBtn').style.display = 'none';
  hide('hrPanel'); hide('hrStatus');
  el('hrBtn').textContent = 'HR Review →';
  show('resultCard');
  show('coachToggleBar');
  el('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── HR Review ─────────────────────────────────────────────────────────────────

async function getHRReview() {
  if (!_currentJob) return;
  const btn = el('hrBtn');
  btn.disabled = true; btn.textContent = 'Getting review…';
  el('hrStatus').textContent = 'Asking HR expert…';
  el('hrStatus').className = 'info-msg';
  show('hrStatus');
  hide('hrPanel');

  try {
    const res = await fetch('/review-cv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ job: _currentJob }) });
    const data = await res.json();
    btn.disabled = false; btn.textContent = 'HR Review ↑';
    hide('hrStatus');

    if (data.error) { el('hrStatus').textContent = data.error; el('hrStatus').className='err-msg'; show('hrStatus'); return; }

    const matchClass = data.overall_match || 'Moderate';
    el('hrPanel').innerHTML = \`
      <span class="hr-match \${matchClass}">Match: \${matchClass}</span>
      <div class="hr-section">
        <div class="hr-label">Strengths</div>
        <ul class="hr-list">\${(data.strengths||[]).map(s=>'<li>'+s+'</li>').join('')}</ul>
      </div>
      <div class="hr-section">
        <div class="hr-label">Top 3 improvements</div>
        \${(data.top_3_improvements||[]).map((t,i)=>\`
          <div class="hr-improve">
            <div class="issue">\${i+1}. \${t.issue}</div>
            <div class="fix">→ \${t.fix}</div>
          </div>
        \`).join('')}
      </div>
    \`;
    show('hrPanel');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'HR Review →';
    el('hrStatus').textContent = err.message; el('hrStatus').className='err-msg'; show('hrStatus');
  }
}

// ── Career Coach (secondary) ──────────────────────────────────────────────────

function toggleCoach() {
  const c = el('coachCard');
  c.style.display = c.style.display === 'none' ? '' : 'none';
}

function selectDir(d) {
  _selectedDir = d;
  ['specialist','generalist','leadership'].forEach(x =>
    el('dir-' + x).classList.toggle('sel', x === d)
  );
  el('coachBtn').disabled = false;
}

async function runCoach() {
  if (!_selectedDir) return;
  el('coachBtn').disabled = true;
  el('coachResults').innerHTML = '';
  el('coachStatus').textContent = 'Analyzing your profile…';
  show('coachStatus');

  const res = await fetch('/coach/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ direction: _selectedDir }) });
  const data = await res.json();
  el('coachBtn').disabled = false;
  hide('coachStatus');

  if (data.error) { el('coachStatus').textContent = data.error; el('coachStatus').className='err-msg'; show('coachStatus'); return; }

  el('coachResults').innerHTML = \`
    <div class="coach-section-title">Ideal roles for you</div>
    \${data.suggestedRoles.map((r, i) => \`
      <div class="role-card">
        <div class="role-title">\${r.title}</div>
        <div class="role-row"><strong>Why you fit:</strong> \${r.why_fit}</div>
        <div class="role-row"><strong>Why now:</strong> \${r.why_next_step}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="pth-\${i}" onclick="getCareerPath('\${r.title.replace(/'/g,"\\\\'")}',\${i})">Career path →</button>
        <div id="pp-\${i}"></div>
      </div>
    \`).join('')}
    \${data.marketMatches.length ? \`
      <div class="coach-section-title">Best available jobs for your next step</div>
      \${data.marketMatches.map(m=>\`
        <div class="role-card">
          <div class="role-title">\${m.job_title} · <span style="font-weight:400;color:#888">\${m.company||''}</span></div>
          <div class="role-row"><strong>Why it fits:</strong> \${m.why_it_fits}</div>
          <div class="role-row"><strong>Stepping stone to:</strong> \${m.stepping_stone_to}</div>
        </div>
      \`).join('')}
    \` : ''}
  \`;
}

async function getCareerPath(title, i) {
  const btn = el('pth-'+i), panel = el('pp-'+i);
  btn.disabled=true; btn.textContent='Loading…';
  const res = await fetch('/coach/path', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roleTitle: title }) });
  const d = await res.json();
  btn.textContent='Career path →'; btn.disabled=false;
  if (d.error) { panel.innerHTML='<p class="err-msg">'+d.error+'</p>'; return; }
  panel.innerHTML=\`<div class="path-panel">
    <div class="path-label">Key Challenges</div>
    <ul class="path-list">\${d.key_challenges.map(c=>'<li>'+c+'</li>').join('')}</ul>
    <div class="path-label">Skill Gaps</div>
    <ul class="path-list">\${d.skill_gaps.map(g=>'<li>'+g+'</li>').join('')}</ul>
    <div class="path-label">Success at 12 months</div>
    <p class="path-p">\${d.success_at_12_months}</p>
    <div class="path-label">Long-term trajectory</div>
    <p class="path-p">\${d.long_term_trajectory}</p>
  </div>\`;
}
</script>
</body>
</html>`);
});

// ── API endpoints ─────────────────────────────────────────────────────────────

app.post('/upload-cv', upload.single('cv'), async (req, res) => {
  try {
    const cvPath = req.file.path;
    const cvText = await readCV(cvPath);
    appSession = { ...appSession, cvText, cvPath };
    res.json({ cvPath });
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
    const { job, cvPath } = req.body;
    const cvText = await readCV(cvPath || appSession.cvPath);
    const filePath = await rewriteCV(cvText, job);
    const pdfPath = await generatePDF(filePath);
    res.json({ filePath, pdfPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/review-cv', async (req, res) => {
  try {
    if (!appSession.cvText) return res.status(400).json({ error: 'No CV loaded.' });
    const { job } = req.body;
    if (!job) return res.status(400).json({ error: 'job is required.' });
    const review = await reviewCV(appSession.cvText, job);
    res.json(review);
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

app.listen(3000, () => console.log('Job Agent running at http://localhost:3000'));
