'use strict';

// Item 8 — AI cost/token tracker: source-level assertions verifying that
// cv.routes.js and jobs.routes.js include the stageUsage/sessionUsage wiring
// and that GET /session/usage is exposed.

const fs   = require('fs');
const path = require('path');

const cvSrc   = fs.readFileSync(path.join(__dirname, 'cv.routes.js'),   'utf8');
const jobsSrc = fs.readFileSync(path.join(__dirname, 'jobs.routes.js'), 'utf8');

describe('Item 8 — GET /session/usage endpoint', () => {
  test('cv.routes.js exposes GET /session/usage', () => {
    expect(cvSrc).toMatch(/router\.get\s*\(\s*['"]\/session\/usage['"]/);
  });

  test('GET /session/usage calls getSessionUsage()', () => {
    expect(cvSrc).toMatch(/getSessionUsage\s*\(\s*\)/);
  });
});

describe('Item 8 — stageUsage wired into job results', () => {
  test('cv.routes.js reading_cv background job computes and stores stageUsage', () => {
    expect(cvSrc).toMatch(/stageUsage/);
    expect(cvSrc).toMatch(/snapshotSessionUsage/);
    expect(cvSrc).toMatch(/resetSessionUsage/);
  });

  test('cv.routes.js cv_tailor (rewrite) background job computes stageUsage', () => {
    // stageUsage must appear in the /rewrite background job result
    const rewriteSection = cvSrc.slice(cvSrc.indexOf('/rewrite'));
    expect(rewriteSection).toMatch(/stageUsage/);
  });

  test('jobs.routes.js parsing_job background job computes stageUsage', () => {
    expect(jobsSrc).toMatch(/stageUsage/);
    expect(jobsSrc).toMatch(/snapshotSessionUsage/);
  });

  test('cv.routes.js status endpoint includes sessionUsage in every response', () => {
    // getSessionUsage() is called and its result emitted as sessionUsage in the poll response
    expect(cvSrc).toMatch(/sessionUsage\s*[=:]/);
    expect(cvSrc).toMatch(/sessionUsage.*getSessionUsage|getSessionUsage.*sessionUsage/s);
  });
});

describe('GET /session/daily-usage endpoint', () => {
  test('cv.routes.js exposes GET /session/daily-usage', () => {
    expect(cvSrc).toMatch(/router\.get\s*\(\s*['"]\/session\/daily-usage['"]/);
  });

  test('GET /session/daily-usage calls getSpendToday()', () => {
    expect(cvSrc).toMatch(/getSpendToday\s*\(\s*\)/);
  });

  test('GET /session/daily-usage imports getSpendToday from core/claude', () => {
    expect(cvSrc).toMatch(/getSpendToday.*require.*core\/claude|require.*core\/claude.*getSpendToday/s);
  });
});

describe('POST /use-profile-cv endpoint', () => {
  test('cv.routes.js exposes POST /use-profile-cv', () => {
    expect(cvSrc).toMatch(/router\.post\s*\(\s*['"]\/use-profile-cv['"]/);
  });

  test('POST /use-profile-cv calls cvDataToText from agents/cvWriter', () => {
    expect(cvSrc).toMatch(/cvDataToText/);
    expect(cvSrc).toMatch(/agents\/cvWriter/);
  });

  test('POST /use-profile-cv sets appSession.cvText and appSession.cvData', () => {
    const useProfileSection = cvSrc.slice(cvSrc.indexOf('/use-profile-cv'));
    expect(useProfileSection).toMatch(/appSession\.cvText/);
    expect(useProfileSection).toMatch(/appSession\.cvData/);
  });
});

describe('buildGapInputs — undecided gaps get no-user-response status', () => {
  test('cv.routes.js defines buildGapInputs', () => {
    expect(cvSrc).toMatch(/function buildGapInputs/);
  });

  test('buildGapInputs emits no-user-response for undecided gaps', () => {
    expect(cvSrc).toMatch(/no-user-response/);
  });

  test('buildGapInputs collects agentDecideStatements for undecided gaps with proposedStatement', () => {
    expect(cvSrc).toMatch(/agentDecideStatements/);
    expect(cvSrc).toMatch(/proposedStatement/);
  });
});
