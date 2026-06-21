// The Curator owns the discipline knowledge store's quality: merging new findings (from the
// Researcher, or routed in from a user comment in Phase 6) into what's already known,
// without letting the store grow into an unbounded log. Recurring findings gain confidence
// and rise; one-off noise stays low. Pinned (user-sourced) entries are always-trusted
// overrides that this module never alters once added — only new merges can be skipped past
// them or replace a non-pinned duplicate when a new pinned item arrives.

const STALE_DAYS = 30;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

// A store is stale if it's never been researched, or its last update is older than the
// staleness window — either case tells agents/recruiter.js to run the Researcher again.
function isStale(store) {
  if (!store || !store.updated) return true;
  const ageMs = Date.now() - new Date(store.updated).getTime();
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

// Merges one category's findings (e.g. "skills") into the existing list for that category.
// `findings` entries may be plain strings (from the Researcher's web-search results) or
// pre-built objects with a `pinned: true` flag (from the Input Router routing a user's own
// stated skill, Phase 6) — both are normalized to the same stored shape.
function mergeList(existing, findings) {
  const list = [...(existing || [])];
  (findings || []).forEach(raw => {
    const incoming = typeof raw === 'string' ? { text: raw } : raw;
    const norm = normalize(incoming.text);
    if (!norm) return;
    const idx = list.findIndex(item => normalize(item.text) === norm);
    const match = idx >= 0 ? list[idx] : null;

    if (match && match.pinned) return; // pinned entries are user-authoritative — never touched by a merge

    if (incoming.pinned) {
      // User-sourced override — replaces any existing non-pinned duplicate, or adds new.
      const pinnedEntry = { confidence: 99, source_type: 'user', pinned: true, last_seen: today(), ...incoming };
      if (match) list[idx] = pinnedEntry; else list.push(pinnedEntry);
      return;
    }

    if (match) {
      match.confidence = (match.confidence || 1) + 1;
      match.last_seen = today();
    } else {
      list.push({ text: incoming.text, confidence: 1, source_type: incoming.source_type || 'search', last_seen: today() });
    }
  });
  return list;
}

// Merges a full findings object ({ skills, keywords, red_flags }) into the discipline store,
// dedupe-and-confidence-bump per category, and stamps the store as updated today. `store` may
// be null (brand-new field) — a fresh, empty store is created in that case.
function mergeFindings(store, findings) {
  const base = store || { field: null, updated: null, skills: [], keywords: [], red_flags: [] };
  return {
    ...base,
    updated: today(),
    skills:    mergeList(base.skills,    findings && findings.skills),
    keywords:  mergeList(base.keywords,  findings && findings.keywords),
    red_flags: mergeList(base.red_flags, findings && findings.red_flags),
  };
}

module.exports = { mergeFindings, isStale, STALE_DAYS };
