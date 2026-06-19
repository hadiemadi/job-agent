const { readCV } = require('./src/cv');
const { searchAllLocations } = require('./src/jobs');
const { extractJobTitles, analyzeJobFit, parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText, chatWithHRExpert, adjustLanguageLevel, generateCoverLetter } = require('./src/ai');
const { generateExecutiveTemplate, generateComparisonTemplate } = require('./src/templates');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath } = require('./src/coach');

module.exports = {
  readCV, searchAllLocations,
  extractJobTitles, analyzeJobFit, parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText, chatWithHRExpert, adjustLanguageLevel, generateCoverLetter,
  generateExecutiveTemplate, generateComparisonTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath,
};
