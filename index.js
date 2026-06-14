require('dotenv').config();
const { readCV, extractJobTitles, searchAllLocations, analyzeJobFit, rewriteCV } = require('./agent');

async function main() {
  console.log('📄 Reading CV...');
  const cvText = await readCV('./cv.pdf');
  console.log('✅ CV loaded successfully\n');

  console.log('🤖 Extracting job titles from CV...');
  const jobTitles = await extractJobTitles(cvText);
  console.log('🎯 Extracted job titles:', jobTitles);

  let allJobs = [];
  for (const title of jobTitles) {
    console.log(`\n🔍 Searching for: ${title}`);
    const jobs = await searchAllLocations(title);
    allJobs = [...allJobs, ...jobs];
  }

  const uniqueJobs = [...new Map(allJobs.map(job => [job.job_id, job])).entries()].map(([, job]) => job);
  console.log(`\n✅ Found ${uniqueJobs.length} unique jobs. Analyzing fit with Claude...`);

  const rankedJobs = await analyzeJobFit(cvText, uniqueJobs);
  console.log('\n📊 Job Analysis Result:\n');
  console.log(JSON.stringify(rankedJobs, null, 2));

  console.log('\n✍️  Rewriting CV for top 3 jobs...');
  for (const job of rankedJobs.slice(0, 3)) {
    const filePath = await rewriteCV(cvText, job);
    if (filePath) console.log(`✅ CV saved as: ${filePath}`);
  }
}

main().catch(console.error);
