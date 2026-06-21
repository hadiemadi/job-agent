require('dotenv').config();
const express = require('express');
const cvRoutes = require('./routes/cv.routes');
const jobsRoutes = require('./routes/jobs.routes');
const hrRoutes = require('./routes/hr.routes');
const coachRoutes = require('./routes/coach.routes');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/templates', express.static('templates'));

app.use(cvRoutes);
app.use(jobsRoutes);
app.use(hrRoutes);
app.use(coachRoutes);

if (require.main === module) {
  app.listen(3000, () => console.log('Job Agent running at http://localhost:3000'));
}
module.exports = app;
