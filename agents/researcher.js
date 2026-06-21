// The Researcher's job (per the refactor plan) is to web-search a field/discipline and
// return candidate skills/keywords/red-flags for the Curator to merge into that field's
// knowledge store — the source of the "learns over time" loop.
//
// TODO: enable web_search — wire this to Anthropic's server-side web_search tool (see
// agents/recruiter.js's researchCvConventions for the existing pattern) once the cost
// tradeoff of live search on every new/stale field is approved. Until then this agent is a
// deliberate no-op: it always returns empty findings and makes zero network calls, so the
// rest of the learning loop (Curator merge logic, discipline store, staleness checks) is
// fully built and testable without any live-search cost.
async function research(field) {
  return { skills: [], keywords: [], red_flags: [] };
}

module.exports = { research };
