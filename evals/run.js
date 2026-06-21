// Eval harness (Part H of the refactor plan): runs the recruiter agent against a small,
// fixed CV+job set and writes the output for diffing. Without this, "did that prompt edit
// help or hurt" is a feeling, not a fact — the .claude/agents/prompt-tester.md dev subagent
// automates running this before/after a knowledge/ or agent prompt change.
//
// NOTE: this makes real Anthropic API calls (one reviewCV + one analyzeGaps per case) — not
// a Jest test, a standalone script. Run it deliberately, not in a loop.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const { readCV, reviewCV, analyzeGaps, selectTopGaps } = require('../agent');

const CASES_DIR = path.join(__dirname, 'cases');
const OUTPUT_DIR = path.join(__dirname, 'output');
const CV_PATH = path.join(__dirname, '..', 'cv.pdf');

async function runCase(caseFile, cvText) {
  const { name, job } = JSON.parse(fs.readFileSync(path.join(CASES_DIR, caseFile), 'utf8'));
  const [{ review, field }, gaps] = await Promise.all([
    reviewCV(cvText, job, [], { tone: 4, languageLevel: 2 }),
    analyzeGaps(cvText, job),
  ]);
  const result = {
    case: name,
    job: { job_title: job.job_title, employer_name: job.employer_name },
    field,
    overall_match: review.overall_match,
    strengths: review.strengths,
    recommended_sections: review.recommended_sections,
    auto_changes: review.auto_changes,
    confirm_changes: selectTopGaps(gaps),
  };
  const outFile = path.join(OUTPUT_DIR, caseFile);
  await fse.outputJson(outFile, result, { spaces: 2 });
  console.log(`OK  ${name} -> ${path.relative(process.cwd(), outFile)} (${review.overall_match})`);
}

(async () => {
  fse.ensureDirSync(OUTPUT_DIR);
  const caseFiles = fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.json'));
  if (!caseFiles.length) {
    console.error('No eval cases found in evals/cases/.');
    process.exit(1);
  }
  const cvText = await readCV(CV_PATH);
  for (const file of caseFiles) {
    try {
      await runCase(file, cvText);
    } catch (err) {
      console.error(`FAIL ${file}:`, err.message);
      process.exitCode = 1;
    }
  }
})();
