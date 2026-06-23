const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

// Number(process.env.X) || fallback would silently discard a legitimate "0" — same pattern
// used in core/claude.js, src/jobs.js, services/ratelimit.js.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

// One session per browser, keyed by a "sid" cookie. Routes still call the zero-arg
// getSession()/setSession() they always have — AsyncLocalStorage carries the current
// request's sessionId through the async call chain (much like a thread-local in
// Java/Python, but for an async callback chain instead of a thread), so the same call
// resolves to a different object per concurrent request without threading `req` through
// every function signature in routes/, agents/, services/.
const als = new AsyncLocalStorage();

const sessions = new Map();

// Same default shape that used to be the single module-level `appSession` — copied
// verbatim so behavior for any one user is unchanged, just no longer shared globally.
function createSession() {
  return {
    cvText: null, cvPath: null, cvData: null,
    jobs: null, rankedJobs: null,
    currentJob: null, hrReview: null,
    coachHistory: [], hrThread: [], hrDisplayHistory: [],
    confirmedContact: null,
    clientPreferences: {
      tone: 4, customInstructions: '', languageLevel: 2, extensiveSearch: false, conventionsResearch: '',
      gapSeverities: ['major', 'mild', 'minor'], refreshDiscipline: false, routedInstruction: null, routedInstructionApplied: false,
    },
    lastSeen: Date.now(),
  };
}

function getSession() {
  const sid = als.getStore();
  let session = sessions.get(sid);
  if (!session) {
    session = createSession();
    sessions.set(sid, session);
  }
  session.lastSeen = Date.now();
  return session;
}

function setSession(next) {
  const sid = als.getStore();
  next.lastSeen = Date.now();
  sessions.set(sid, next);
  return next;
}

// ── Session-scoped output files (CVs, cover letters, comparisons — anything written to
// output/ and served back to the browser) ──────────────────────────────────────────────
// A filename built from the company/job title (e.g. output/cv_Rivian.html) is guessable —
// anyone could open another user's tailored CV by guessing it, with no session check at
// all (server.js used to serve output/ as plain express.static). registerOutputFile()
// replaces that with an unguessable, per-call random name AND records it on the current
// session, so the new GET /output/:file route (server.js) can verify ownership before
// serving anything. Every agents/src call site that writes into output/ should go through
// this instead of building its own filename — one place to get the security property
// right, instead of eight.
// Map<fileName, { createdAt, downloadName }> rather than a Set — createdAt backs the
// retention-TTL sweep below, so a file expires even if its session stays active for a long
// time; downloadName (optional) is what GET /output/:file suggests via Content-Disposition
// when the file is downloaded, e.g. "Tailored CV.docx" instead of the random on-disk name —
// the random name is what makes the file unguessable, but there's no reason the CANDIDATE
// has to see it.
function registerOutputFile(extension, downloadName = null) {
  const sid = als.getStore() || 'no-session'; // direct calls outside a request (e.g. test.js) have no sid
  const fileName = `${sid}_${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const session = getSession();
  if (!session.outputFiles) session.outputFiles = new Map();
  session.outputFiles.set(fileName, { createdAt: Date.now(), downloadName });
  return `output/${fileName}`;
}

// Used by the GET /output/:file route to decide 404 vs serve — true only if the CURRENT
// session (resolved the same way as everything else, via the "sid" cookie) generated this
// exact file. fileName here is the basename only (the route validates that shape first).
function isOwnedOutputFile(fileName) {
  const session = getSession();
  return !!(session.outputFiles && session.outputFiles.has(fileName));
}

// The friendly name registerOutputFile() was given for this file, if any — null for files
// that don't need one (e.g. the standalone/comparison HTML pages, which open inline in a
// tab rather than download).
function getOutputDownloadName(fileName) {
  const session = getSession();
  const meta = session.outputFiles && session.outputFiles.get(fileName);
  return meta ? meta.downloadName : null;
}

// Deletes every output/ file a session generated, both on disk and from its own
// bookkeeping. Used when a session is dropped (idle sweep) and by purgeSessionData()
// (the "Delete my data now" control). Best-effort — a file that's already gone is fine.
function deleteOutputFiles(session) {
  if (!session.outputFiles) return;
  for (const fileName of session.outputFiles.keys()) {
    try { fs.unlinkSync(path.join('output', fileName)); } catch (e) { /* already gone */ }
  }
  session.outputFiles.clear();
}

// "Delete my data now": wipes the CURRENT session back to a blank slate — same sid (the
// cookie/identity isn't revoked, just the data behind it), output files removed from disk.
function purgeSessionData() {
  const sid = als.getStore();
  const session = sessions.get(sid);
  if (session) deleteOutputFiles(session);
  sessions.set(sid, createSession());
}

// Runs on every request: assigns/reads the "sid" cookie and binds it to AsyncLocalStorage
// for the lifetime of that request, so every getSession()/setSession() call further down
// the chain (in routes, agents, services) resolves to this browser's session.
//
// Express middleware alone isn't reliable here: third-party middleware that consumes the
// request body as a raw stream (multer's busboy-based multipart parsing, used by
// /upload-cv) does its own internal stream piping that can silently drop the
// AsyncLocalStorage context set by an earlier middleware — als.getStore() comes back
// undefined partway through, and getSession() falls through to a bogus session keyed
// `undefined` instead of the real sid. Wrapping the ENTIRE request at the raw
// http.Server level in requestScope() (below), before Express even starts its own
// middleware dispatch, makes every async operation tied to this request — including
// multer's — a descendant of one continuous AsyncLocalStorage scope. This middleware
// then narrows that scope down from the placeholder requestScope() establishes to the
// real per-browser sid, via als.enterWith().
const SID_COOKIE = 'sid';
const SID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sessionMiddleware(req, res, next) {
  let sid = req.cookies && req.cookies[SID_COOKIE];
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie(SID_COOKIE, sid, { httpOnly: true, sameSite: 'lax', maxAge: SID_MAX_AGE_MS });
  }
  als.enterWith(sid);
  // A request body delivered over a real socket (as opposed to an in-process test client)
  // arrives in separate chunks across separate event-loop turns. A multipart parser like
  // multer/busboy attaches its OWN 'data'/'end' listeners to `req` to consume those chunks —
  // and in practice that chain of native socket I/O callbacks doesn't reliably keep
  // AsyncLocalStorage's context alive that many turns out from the one als.enterWith() call
  // above. Re-asserting it on every chunk, via a listener attached here (before multer's
  // own, since this middleware runs first) closes that gap: `prependListener` guarantees
  // ours runs before any listener a downstream middleware adds to the same event, so the
  // context is freshly correct by the time multer's own handler sees each chunk.
  req.prependListener('data', () => als.enterWith(sid));
  req.prependListener('end', () => als.enterWith(sid));
  next();
}

// Establishes the outer AsyncLocalStorage scope for one request, at the http.Server
// 'request' level — see the comment on sessionMiddleware above for why this has to start
// here rather than purely inside Express's middleware chain. Wrap the request handler
// passed to http.createServer() with this (see server.js), instead of calling
// app.listen() directly.
function requestScope(handler) {
  return (req, res) => als.run(null, () => handler(req, res));
}

// Memory-leak protection: drop sessions nobody has touched in 24h. Minimal by design —
// single in-memory Map, single-process app (see CLAUDE.md Phase 5 for real multi-user
// infra/DB work), this just stops it growing unbounded on a long-running server.
const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

// Generated CVs/cover letters/comparisons must not outlive this window even if the
// session that made them is still active (someone could leave the tab open for days) —
// the privacy notice on the upload screen promises auto-deletion "after your session
// ends," but a long-lived session shouldn't mean indefinite retention either.
const OUTPUT_RETENTION_MS = envNumber('OUTPUT_RETENTION_MINUTES', 180) * 60 * 1000;

const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastSeen > IDLE_LIMIT_MS) {
      deleteOutputFiles(session);
      sessions.delete(sid);
      continue;
    }
    if (!session.outputFiles) continue;
    for (const [fileName, meta] of session.outputFiles) {
      if (now - meta.createdAt > OUTPUT_RETENTION_MS) {
        try { fs.unlinkSync(path.join('output', fileName)); } catch (e) { /* already gone */ }
        session.outputFiles.delete(fileName);
      }
    }
  }
}, SWEEP_INTERVAL_MS);
// Don't let the sweep timer keep a test runner or short-lived script process alive.
if (sweepInterval.unref) sweepInterval.unref();

module.exports = {
  getSession, setSession, als, sessionMiddleware, requestScope, createSession,
  registerOutputFile, isOwnedOutputFile, getOutputDownloadName, purgeSessionData,
};
