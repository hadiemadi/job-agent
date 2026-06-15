const { readCV } = require('./src/cv');
const { searchAllLocations } = require('./src/jobs');
const { extractJobTitles, analyzeJobFit, rewriteCV, reviewCV, parseJobFromText } = require('./src/ai');
const { generateExecutiveTemplate } = require('./src/templates');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('./src/coach');

module.exports = {
  readCV, searchAllLocations,
  extractJobTitles, analyzeJobFit, rewriteCV, reviewCV, parseJobFromText,
  generateExecutiveTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
};
