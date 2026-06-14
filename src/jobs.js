async function searchJobs(query, location, country) {
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

async function searchAllLocations(jobTitle) {
  const [stockholmJobs, remoteJobs, londonJobs] = await Promise.all([
    searchJobs(jobTitle, 'Stockholm', 'SE'),
    searchJobs(jobTitle, 'Remote', ''),
    searchJobs(jobTitle, 'London', 'GB'),
  ]);
  return [...stockholmJobs, ...remoteJobs, ...londonJobs];
}

module.exports = { searchJobs, searchAllLocations };
