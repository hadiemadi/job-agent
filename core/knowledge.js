const fs = require('fs');
const path = require('path');

const cache = {};

// Loads a hand-written persona/rules file from knowledge/<name>.md, caching it in memory so
// repeated calls (one per HR-thread or coach request) don't re-hit the filesystem. This is
// what lets the user improve the HR reviewer or Career Coach by editing text, not code —
// restart the server to pick up an edit (the cache is process-lifetime, not file-watching).
function loadCore(name) {
  if (cache[name]) return cache[name];
  const filePath = path.join(__dirname, '..', 'knowledge', `${name}.md`);
  const text = fs.readFileSync(filePath, 'utf8').trim();
  cache[name] = text;
  return text;
}

const DISCIPLINES_DIR = path.join(__dirname, '..', 'knowledge', 'disciplines');

// Turns a field name (e.g. "RF/Hardware Engineering") into a filesystem-safe slug
// (e.g. "rf-hardware-engineering.json") so the discipline store has one stable file per
// field regardless of how it was capitalized/punctuated when detected.
function disciplineFileName(field) {
  return String(field).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.json';
}

// Reads the self-improving per-field knowledge store (skills/keywords/red_flags, each
// confidence-scored — see Part D of the refactor plan). Returns null if this field has never
// been researched before; the caller (agents/recruiter.js) treats that the same as "stale."
function loadDiscipline(field) {
  if (!field) return null;
  const filePath = path.join(DISCIPLINES_DIR, disciplineFileName(field));
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Persists the discipline store after the Curator has merged new findings into it.
function saveDiscipline(field, store) {
  fs.mkdirSync(DISCIPLINES_DIR, { recursive: true });
  const filePath = path.join(DISCIPLINES_DIR, disciplineFileName(field));
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

// Returns all discipline stores on disk — used by GET /auth/my-data to show the user
// their accumulated field knowledge. Safe: returns [] if the directory doesn't exist yet.
function listDisciplines() {
  try {
    if (!fs.existsSync(DISCIPLINES_DIR)) return [];
    return fs.readdirSync(DISCIPLINES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(DISCIPLINES_DIR, f), 'utf8')); }
        catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = { loadCore, loadDiscipline, saveDiscipline, listDisciplines };
