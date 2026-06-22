const { readCV } = require('./src/cv');
const { searchAllLocations } = require('./src/jobs');
const { extractJobTitles, parseJobFromText } = require('./agents/extractor');
const { reviewCV, analyzeJobFit, refineWithHR, chatWithHRExpert, researchCvConventions, pinDisciplineSkill, reviewTailoredCV } = require('./agents/recruiter');
const { parseCVStructure, rewriteCVWithChanges, adjustLanguageLevel, applyConcernChange } = require('./agents/cvWriter');
const { analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps, chatWithCoach } = require('./agents/coach');
const { classify } = require('./agents/inputRouter');
const { generateCoverLetter } = require('./tasks/coverLetter');
const { generateInterviewQuestions } = require('./tasks/interviewPrep');
const { generateExecutiveTemplate } = require('./render/cvHtml');
const { generateComparisonTemplate } = require('./render/comparison');

module.exports = {
  readCV, searchAllLocations,
  extractJobTitles, analyzeJobFit, parseCVStructure, reviewCV, rewriteCVWithChanges, chatWithCoach, refineWithHR, parseJobFromText, chatWithHRExpert, adjustLanguageLevel, generateCoverLetter, generateInterviewQuestions, applyConcernChange, researchCvConventions, reviewTailoredCV,
  generateExecutiveTemplate, generateComparisonTemplate,
  analyzeAndSuggestRoles, matchRolesToMarket, buildCareerPath, analyzeGaps, selectTopGaps,
  classify, pinDisciplineSkill,
};
