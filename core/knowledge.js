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

module.exports = { loadCore };
