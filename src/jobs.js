const COUNTRY_CITIES = {
  GB: { city: 'London',    country: 'GB' },
  SE: { city: 'Stockholm', country: 'SE' },
  DE: { city: 'Berlin',    country: 'DE' },
  NL: { city: 'Amsterdam', country: 'NL' },
};

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
