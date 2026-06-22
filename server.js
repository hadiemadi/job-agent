require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { sessionMiddleware, requestScope } = require('./services/session');
const cvRoutes = require('./routes/cv.routes');
const jobsRoutes = require('./routes/jobs.routes');
const hrRoutes = require('./routes/hr.routes');
const coachRoutes = require('./routes/coach.routes');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/templates', express.static('templates'));

app.use(cookieParser());
app.use(sessionMiddleware);

app.use(cvRoutes);
app.use(jobsRoutes);
app.use(hrRoutes);
app.use(coachRoutes);

// requestScope() wraps the whole request in one AsyncLocalStorage scope starting at the raw
// http.Server level — see services/session.js's comment on sessionMiddleware for why this
// can't just be app.listen(3000, ...): multer's multipart body parsing (used by
// /upload-cv) silently drops AsyncLocalStorage context if it's only established inside
// Express's own middleware chain.
const server = http.createServer(requestScope(app));

if (require.main === module) {
  server.listen(3000, () => console.log('Job Agent running at http://localhost:3000'));
}
module.exports = server;
