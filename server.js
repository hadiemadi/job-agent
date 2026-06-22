require('dotenv').config();
const http = require('http');
const express = require('express');
const fse = require('fs-extra');
const cookieParser = require('cookie-parser');
const { sessionMiddleware, requestScope } = require('./services/session');
const { globalLimiter, aiLimiter } = require('./services/ratelimit');
const cvRoutes = require('./routes/cv.routes');
const jobsRoutes = require('./routes/jobs.routes');
const hrRoutes = require('./routes/hr.routes');
const coachRoutes = require('./routes/coach.routes');

// Render's disk is ephemeral — these must exist fresh every boot, not just on first
// install. uploads/templates is ensured separately by services/uploads.js.
fse.ensureDirSync('uploads');
fse.ensureDirSync('output');

const app = express();
app.use(express.json());

// Mounted before cookieParser/sessionMiddleware/the routers on purpose: a platform health
// check should never depend on session state, rate limits, or any downstream router.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(cookieParser());
app.use(sessionMiddleware);
// Broad, app-wide cap — keyed by the same "sid" cookie as the session itself (see
// services/ratelimit.js), so it has to run after cookieParser/sessionMiddleware.
app.use(globalLimiter);

app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/templates', express.static('templates'));

// Stricter cap for the AI- and job-search-heavy routers, mounted ONCE ahead of all four —
// mounting it separately in front of each router would re-run (and re-count) it on every
// router a request falls through before finding its match, since Express routers call
// next() and keep walking the stack on a non-matching path.
app.use(aiLimiter);
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
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => console.log(`Job Agent running on port ${PORT}`));
}
module.exports = server;
