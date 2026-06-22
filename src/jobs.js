const COUNTRY_CITIES = {
  GB: { city: 'London',    country: 'GB' },
  SE: { city: 'Stockholm', country: 'SE' },
  DE: { city: 'Berlin',    country: 'DE' },
  NL: { city: 'Amsterdam', country: 'NL' },
};

// ── Daily job-search cap ──────────────────────────────────────────────────────
// Server-wide (not per-user) in-memory counter — resets on restart as well as at UTC
// midnight, same tradeoff as core/claude.js's spend cap: fine for v1, a DB-backed counter
// is the future hardening step if this needs to survive restarts/multiple processes.
// See core/claude.js for why this isn't `Number(process.env.X) || fallback` — a legitimate
// "0" cap would silently fall back to the default with that pattern.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

const DAILY_JOB_SEARCH_CAP = envNumber('DAILY_JOB_SEARCH_CAP', 50);

function utcDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC by construction
}

let searchDate = utcDateString();
let searchCountToday = 0;

function checkJobSearchCap() {
  const today = utcDateString();
  if (today !== searchDate) { searchDate = today; searchCountToday = 0; }
  if (searchCountToday >= DAILY_JOB_SEARCH_CAP) {
    throw new Error('Daily job-search limit reached.');
  }
  searchCountToday += 1;
}

// ── Jooble (primary source for US jobs) ──────────────────────────────────────

async function searchJooble(keywords, location) {
  const apiKey = process.env.JOOBLE_KEY;
  if (!apiKey) throw new Error('JOOBLE_KEY is not set in .env');

  const response = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      location,
      radius: 40,
      page: 1,
      ResultOnPage: 20,
    }),
  });

  const data = await response.json();
  return (data.jobs || []).map(normalizeJoobleJob);
}

function normalizeJoobleJob(job) {
  return {
    job_id:              job.id || String(Math.random()),
    job_title:           job.title || '',
    employer_name:       job.company || '',
    job_country:         'US',
    job_city:            job.location || '',
    job_description:     job.snippet || '',
    job_employment_type: job.type || '',
    job_apply_link:      job.link || '',
    job_salary:          job.salary || '',
    job_is_remote:       (job.type || '').toLowerCase().includes('remote') ||
                         (job.location || '').toLowerCase().includes('remote'),
  };
}

// ── JSearch (fallback for non-US countries) ───────────────────────────────────

async function searchJSearch(query, location, country) {
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&country=${encodeURIComponent(country)}&num_pages=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-rapidapi-host': 'jsearch.p.rapidapi.com',
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
  });
  const data = await response.json();
  return data.data || [];
}

// ── Public entry point ────────────────────────────────────────────────────────

async function searchAllLocations(jobTitle, countryCode = 'GB', usState = '') {
  checkJobSearchCap(); // before hitting Jooble/JSearch — this is the one public entry point both go through
  if (countryCode === 'US') {
    const location = usState ? usState : 'United States';
    const [stateJobs, remoteJobs] = await Promise.all([
      searchJooble(jobTitle, location),
      searchJooble(jobTitle, 'Remote'),
    ]);
    return [...stateJobs, ...remoteJobs];
  }

  // Non-US: use JSearch with London/GB as coverage fallback
  const target = COUNTRY_CITIES[countryCode] || COUNTRY_CITIES.GB;
  const searches = [
    searchJSearch(jobTitle, target.city, target.country),
    searchJSearch(jobTitle, 'Remote', ''),
  ];
  if (countryCode !== 'GB') {
    searches.push(searchJSearch(jobTitle, 'London', 'GB'));
  }
  const results = await Promise.all(searches);
  return results.flat();
}

module.exports = { searchAllLocations };
