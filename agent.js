const { readCV } = require('./src/cv');
const { searchJobs, searchAllLocations } = require('./src/jobs');
const { extractJobTitles, analyzeJobFit, rewriteCV } = require('./src/ai');
const { generateExecutiveTemplate } = require('./src/templates');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('./src/coach');

module.exports = {
  readCV, searchJobs, searchAllLocations,
  extractJobTitles, analyzeJobFit, rewriteCV,
  generateExecutiveTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
};
