require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const fse = require('fs-extra');
const cookieParser = require('cookie-parser');
const { sessionMiddleware, requestScope, isOwnedOutputFile, getOutputDownloadName } = require('./services/session');
const { globalLimiter, aiLimiter } = require('./services/ratelimit');
const cvRoutes = require('./routes/cv.routes');
const jobsRoutes = require('./routes/jobs.routes');
const hrRoutes = require('./routes/hr.routes');
const coachRoutes = require('./routes/coach.routes');
const { sendError } = require('./core/respondError');
const { logError } = require('./core/logger');
const { TRIAL_MODE } = require('./core/config');
const { getPool } = require('./core/db');

// Process-level safety net — these fire OUTSIDE any request's try/catch (e.g. a bug in a
// timer/event callback). Per the task's hardening goal, a logging/DB failure (or any other
// uncaught error) must never silently crash the whole site without at least a server-side
// trace and a best-effort, sanitized DB record.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  logError('ERR-SYS-001', 'process', { errName: err && err.name });
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  logError('ERR-SYS-001', 'process', { errName: reason && reason.name });
});

// Render's disk is ephemeral — these must exist fresh every boot, not just on first
// install. uploads/templates is ensured separately by services/uploads.js.
fse.ensureDirSync('uploads');
fse.ensureDirSync('output');

const app = express();
app.use(express.json());

// Mounted before cookieParser/sessionMiddleware/the routers on purpose: a platform health
// check should never depend on session state, rate limits, or any downstream router.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// public/ is otherwise fully static (express.static below) — this is the one piece of
// server-computed config the front end needs (core/config.js's TRIAL_MODE), served as plain
// JS so index.html can load it with a normal synchronous <script> tag, no fetch/race needed.
// Flipping TRIAL_MODE off in the environment is the only change required to stop sending it.
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(`window.TRIAL_MODE = ${JSON.stringify(TRIAL_MODE)};`);
});

// TEMPORARY DIAGNOSTIC — REMOVE AFTER DB VERIFICATION. Render's free tier has no Shell access,
// so this is the only way to confirm the Postgres logging path (core/db.js's getPool — the
// exact pool core/logger.js uses, not a second connection) actually reaches the DB and the
// `events` table exists. Read-only: a plain row count, nothing written, nothing logged. Always
// 200 (never 500) so Render's generic error page can't mask the DB_ERR text.
app.get('/__dbcheck', async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.type('text/plain').send('DB_ERR: DATABASE_URL is not set.');
    const result = await pool.query('SELECT count(*) FROM events');
    res.type('text/plain').send(`EVENTS_ROWS: ${result.rows[0].count}`);
  } catch (err) {
    res.type('text/plain').send(`DB_ERR: ${err.message}`);
  }
});

app.use(cookieParser());
app.use(sessionMiddleware);
// Broad, app-wide cap — keyed by the same "sid" cookie as the session itself (see
// services/ratelimit.js), so it has to run after cookieParser/sessionMiddleware.
app.use(globalLimiter);

app.use(express.static('public'));
app.use('/templates', express.static('templates'));

// output/ holds generated CVs/cover letters/comparisons — these contain a candidate's
// full name, email, phone, and work history, so they must NEVER be served as plain static
// files (that used to be `app.use('/output', express.static('output'))` — anyone who
// guessed/knew a filename like output/cv_Rivian.html could open it, no session check at
// all). Every file is now named `<sid>_<random>.<ext>` (services/session.js's
// registerOutputFile) and recorded on the session that generated it; this route is the
// only way to read one back, and only for the session that owns it.
const OUTPUT_DIR = path.resolve('output');

// Builds a safe Content-Disposition value for a friendly download name (e.g. "Tailored
// CV.docx") instead of the random on-disk filename — the random name is what makes the
// file unguessable (see registerOutputFile), there's no reason the candidate has to see it
// in their downloads folder. downloadName can ultimately trace back to AI-parsed job/
// company text, so this strips anything that could break or inject into the header (CRLF,
// quotes) and provides both a plain-ASCII fallback and a UTF-8 form (RFC 6266/5987) for
// names with accented/non-ASCII characters.
function contentDispositionFor(downloadName, ext) {
  const full = `${downloadName}.${ext}`.replace(/[\r\n]/g, '');
  const ascii = full.replace(/"/g, '').replace(/[^\x20-\x7E]/g, '_');
  const utf8 = encodeURIComponent(full);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

app.get('/output/:file', (req, res) => {
  const { file } = req.params;
  // Only the exact shape registerOutputFile() generates — also rules out '/', '\', and
  // '..' outright, so there's no path-traversal surface here regardless of the resolve()
  // check below.
  if (!/^[A-Za-z0-9_-]+\.(html|docx)$/.test(file)) return res.status(404).end();
  // 404, not 403 — a 403 would confirm the file exists for someone without access to it.
  if (!isOwnedOutputFile(file)) return res.status(404).end();
  const resolved = path.join(OUTPUT_DIR, file);
  if (path.dirname(resolved) !== OUTPUT_DIR) return res.status(404).end(); // defense in depth
  const isHtml = file.endsWith('.html');
  res.type(isHtml ? 'text/html' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // HTML pages (the standalone editable CV, the comparison page) open inline in a tab — no
  // Content-Disposition. .docx files are always downloads (the frontend's <a download> /
  // export buttons), so they get the friendly suggested filename.
  if (!isHtml) {
    const downloadName = getOutputDownloadName(file) || 'Tailored CV';
    res.set('Content-Disposition', contentDispositionFor(downloadName, 'docx'));
  }
  res.sendFile(resolved);
});

// Stricter cap for the AI- and job-search-heavy routers, mounted ONCE ahead of all four —
// mounting it separately in front of each router would re-run (and re-count) it on every
// router a request falls through before finding its match, since Express routers call
// next() and keep walking the stack on a non-matching path.
app.use(aiLimiter);
app.use(cvRoutes);
app.use(jobsRoutes);
app.use(hrRoutes);
app.use(coachRoutes);

// Fallback for anything that escapes a route's own try/catch (e.g. express.json() rejecting
// malformed request bodies before a route handler ever runs) — every other error path already
// goes through core/respondError.js's sendError directly from inside its route.
app.use((err, req, res, next) => {
  sendError(res, req.path, 'ERR-SYS-002', err);
});

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
