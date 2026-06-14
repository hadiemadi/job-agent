const COUNTRY_CITIES = {
  GB: { city: 'London',    country: 'GB' },
  SE: { city: 'Stockholm', country: 'SE' },
  US: { city: 'New York',  country: 'US' },
  DE: { city: 'Berlin',    country: 'DE' },
  NL: { city: 'Amsterdam', country: 'NL' },
};

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

async function searchAllLocations(jobTitle, countryCode = 'GB') {
  const target = COUNTRY_CITIES[countryCode] || COUNTRY_CITIES.GB;

  const searches = [
    searchJobs(jobTitle, target.city, target.country),
    searchJobs(jobTitle, 'Remote', ''),
  ];

  // London/GB has the best JSearch coverage — always include as fallback
  if (countryCode !== 'GB') {
    searches.push(searchJobs(jobTitle, 'London', 'GB'));
  }

  const results = await Promise.all(searches);
  return results.flat();
}

module.exports = { searchJobs, searchAllLocations };
