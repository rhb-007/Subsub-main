// Turning somebody else's CRM vocabulary into SubSub trades.
//
// JobNimbus has no concept of a trade. What it has is a job `type`, a
// `record_type_name`, a `status_name` and free-text tags -- all of them the
// customer's own words, different at every company: "Roof Replacement",
// "Full Reroof", "RR-Insurance", "Gutter Only". Nothing in that payload maps
// to `roofing` without somebody saying so.
//
// So the account says so, once, and every job after that lands with its
// trades already on it.
//
// THE FAILURE THIS IS WRITTEN AROUND. The obvious version refuses a job whose
// type has no rule. That is the worst possible answer: the CRM does not get a
// 200, so it retries, so it keeps not getting a 200 -- and NOBODY IS TOLD.
// The job never arrives, the account never learns it did not, and the only
// symptom is work that quietly is not in SubSub. Every other dead end in this
// product has the same shape and the same fix: let it arrive, and put what is
// missing somewhere a person will see it.
//
// So an unmapped job is still a job. It lands with no trades, it is counted
// as needing them, and the VALUES THAT DID NOT MATCH ARE KEPT -- because
// "three jobs arrived with type Roof Replacement" is a question somebody can
// answer in one tap, where "some jobs had no trades" is a mystery.

// What a rule can match on. Deliberately not a free-text search across the
// whole payload: a rule matches ONE named field, so a customer can read their
// own rules back and know what they do.
export const MATCH_KINDS = ["type", "status", "tag"];

// Whole values, case-insensitive, trimmed. Not prefixes: a rule for "Roof"
// silently catching "Roof Inspection — no work" is the kind of surprise that
// puts a roofer on a job nobody is roofing, and it is the same instinct the
// connect lookup follows for a different reason.
const norm = (v) => String(v ?? "").trim().toLowerCase();

// Every value in the payload a rule could match, as {kind, value} pairs.
// One place, so the matcher and the "what did we not understand" report
// cannot disagree about what was even looked at.
export function matchableValues(payload) {
  const out = [];
  const add = (kind, v) => {
    const value = String(v ?? "").trim();
    if (value && !out.some((o) => o.kind === kind && norm(o.value) === norm(value))) {
      out.push({ kind, value });
    }
  };
  // JobNimbus sends `type` on a job and `record_type_name` on everything;
  // both are read because which one carries the useful word differs by
  // account, and an account that has only ever filled one in should not have
  // to know which.
  add("type", payload?.type);
  add("type", payload?.record_type_name);
  add("status", payload?.status_name);
  const tags = Array.isArray(payload?.tags)
    ? payload.tags
    // Some payloads send tags as one comma-separated string.
    : typeof payload?.tags === "string" ? payload.tags.split(",") : [];
  for (const t of tags) add("tag", t);
  return out;
}

// The trades a payload earns, and what went unrecognised.
//
// UNION, not first-match. A job tagged both `roof` and `gutters` needs both
// trades, and picking one would silently drop a slot somebody has to fill --
// which they would discover when the gutter crew never turned up.
//
// `unmatched` is only interesting when NOTHING matched. A job correctly
// mapped to roofing by its type has not got a problem because its status
// said "Approved", and reporting that would bury the real gaps in noise.
export function tradesFor(payload, rules, { tradeIds }) {
  const seen = matchableValues(payload);
  const trades = [];
  const matchedBy = [];

  for (const r of rules || []) {
    const kind = String(r?.match || "").trim();
    if (!MATCH_KINDS.includes(kind)) continue;
    const want = norm(r?.value);
    if (!want) continue;
    if (!seen.some((s) => s.kind === kind && norm(s.value) === want)) continue;

    matchedBy.push({ match: kind, value: r.value });
    for (const raw of r.trades || []) {
      const id = String(raw ?? "").trim();
      // A rule naming a trade that no longer exists is skipped rather than
      // failing the job. The rule is the account's data and can be stale; the
      // job is real work arriving now.
      if (tradeIds.has(id) && !trades.includes(id)) trades.push(id);
    }
  }

  return {
    trades,
    matchedBy,
    // What to offer them a rule for, when there is nothing to go on.
    unmatched: trades.length ? [] : seen,
  };
}

// A rule on the way in. Same shape of check as everything else that lands in
// a shared row: validated, never trusted.
export function validRule(r, { tradeIds }) {
  const match = String(r?.match || "").trim();
  if (!MATCH_KINDS.includes(match)) return null;
  const value = String(r?.value ?? "").trim().slice(0, 120);
  if (!value) return null;
  const trades = [];
  for (const raw of Array.isArray(r?.trades) ? r.trades : []) {
    const id = String(raw ?? "").trim();
    if (!tradeIds.has(id)) return null;
    if (!trades.includes(id)) trades.push(id);
  }
  // A rule with no trades is a rule that does nothing, and saving one would
  // look like it had been set up.
  if (!trades.length) return null;
  return { match, value, trades };
}
