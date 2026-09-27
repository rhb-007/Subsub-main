// The licensing reference, and the rule that stops it becoming doorway pages.
//
// Fifty-one states times twenty-nine trades is 1,479 combinations, and most of
// them differ only in the state's name. Publishing all of them is not a content
// asset -- it is the thing search engines demote and readers stop trusting. So
// a combination earns its own URL only when its answer actually DIFFERS from
// the state's baseline; everything else is covered by the state hub, which
// says the baseline once.
//
// The second rule matters more. Nothing publishes without a named source and a
// date it was checked. A wrong licensing answer costs more trust than the
// traffic is worth, and this product's whole pitch is that it knows whether
// somebody is allowed on a roof. `unverified` is the default, and the generator
// counts what it skipped rather than quietly shipping it.
//
// Imported by the generator and the tests, so "which pages exist" has one
// answer.

// What a state can say about a trade. Ordered loosest to strictest, because
// several comparisons below want that.
export const LICENCE_LEVELS = ["none", "registration", "local", "state"];
export const levelRank = (l) => Math.max(0, LICENCE_LEVELS.indexOf(l));

export const LEVEL_LABEL = {
  none: "No licence required",
  registration: "Registration required",
  local: "Set by each city",
  state: "State licence required",
};

// Nothing goes out without these. A page that cannot say where its answer came
// from and when it was last looked at is a liability, not an asset.
export function isVerified(entry = {}) {
  return !!(entry.source && entry.sourceUrl && /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedOn || ""));
}

// How stale an answer may be before it stops counting. Licensing changes
// slowly, but a page claiming to be a current reference cannot be two years
// old and silent about it.
export const STALE_AFTER_DAYS = 400;

// Checked against the source, or written from somebody's knowledge of it?
//
// These are not the same claim and the difference cannot live in a commit
// message. An entry naming a real agency and a real URL, dated today, written
// by somebody who did not open the statute, is indistinguishable from one that
// was read line by line -- and "one checked fact vouching for twenty-eight
// unchecked ones" is the failure mode this schema exists to prevent. So an
// entry says which it is, `reviewed` is the default nobody gets for free, and
// the generator counts the ones still owed a read.
//
// It deliberately does NOT gate publishing. Fifty-one hubs where forty read
// "we have not got to your state" is a worse reference than fifty-one that
// name the right agency and carry a review queue, and a state hub's claim --
// does this state license contractors, and who administers it -- is a
// different order of claim from a trade-specific dollar threshold. What it
// buys is that the queue is in the data, findable, per entry, rather than in
// somebody's memory.
export const isReviewed = (entry = {}) => entry.reviewed === true;
export function reviewQueue(states = []) {
  const out = [];
  for (const st of states || []) {
    for (const [what, entry] of [["baseline", st.baseline], ["quirk", st.quirk],
      ...Object.entries(st.trades || {}).map(([id, e]) => [`trade:${id}`, e])]) {
      if (!entry) continue;
      if (!isReviewed(entry)) out.push({ state: st.code, what, source: entry.source || null });
    }
  }
  return out;
}

export function isStale(entry = {}, today) {
  if (!entry.verifiedOn || !today) return false;
  const a = Date.parse(`${entry.verifiedOn}T00:00:00Z`);
  const b = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return (b - a) / 86400000 > STALE_AFTER_DAYS;
}

// The state's answer for a trade it does not single out.
export const baselineOf = (state = {}) => state.baseline || { licence: "none" };

// What this state says about this trade, falling back to the baseline.
//
// `specific` means the trade entry says something DIFFERENT, not merely that a
// trade entry exists. A row repeating the baseline in other words is the
// duplicate this whole module is built to refuse, and an early version counted
// it as a difference because it only checked whether the key was present.
//
// `own` is the trade entry's own verification, never the baseline's. Merging
// them would let one checked fact vouch for twenty-eight unchecked ones, which
// is exactly the failure mode that makes programmatic content worthless.
export function answerFor(state = {}, tradeId) {
  const base = baselineOf(state);
  const own = (state.trades || {})[tradeId] || null;
  const differs = !!own && (
    (own.licence && own.licence !== base.licence)
    || (own.body && own.body !== base.body)
    || !!own.detail);
  return { ...base, ...(own || {}), specific: differs, own };
}

// THE RULE. A state-and-trade page exists only when the answer is not the
// state's baseline -- otherwise the state hub already said it, and a second
// page saying the same thing in different words is the doorway page this is
// built to avoid.
//
// And never without verification, whatever the difference.
export function earnsPage(state = {}, tradeId, { today } = {}) {
  const a = answerFor(state, tradeId);
  if (!a.specific) return { ok: false, reason: "same_as_baseline" };
  // The trade entry's OWN source and date, not the baseline's.
  if (!isVerified(a.own)) return { ok: false, reason: "unverified" };
  if (isStale(a.own, today)) return { ok: false, reason: "stale" };
  return { ok: true };
}

// A state hub is worth publishing when the state itself is verified. It exists
// even where no trade differs: "nothing here needs a state licence" is a real
// answer people search for, and it is the page every skipped combination
// points at.
export function stateEarnsPage(state = {}, { today } = {}) {
  const b = baselineOf(state);
  if (!isVerified(b)) return { ok: false, reason: "unverified" };
  if (isStale(b, today)) return { ok: false, reason: "stale" };
  return { ok: true };
}

// Every page this dataset produces, decided in one place so the generator, the
// sitemap and the tests cannot disagree about what exists.
export function plan(states = [], trades = [], { today } = {}) {
  const pages = [], skipped = [];
  for (const st of states) {
    const hub = stateEarnsPage(st, { today });
    if (!hub.ok) { skipped.push({ kind: "state", state: st.code, reason: hub.reason }); continue; }
    pages.push({ kind: "state", state: st.code });
    for (const tr of trades) {
      const earns = earnsPage(st, tr.id, { today });
      if (earns.ok) pages.push({ kind: "trade", state: st.code, trade: tr.id });
      else skipped.push({ kind: "trade", state: st.code, trade: tr.id, reason: earns.reason });
    }
  }
  // A trade hub is worth having once more than one state says something
  // specific about it -- below that it is a page listing one link.
  for (const tr of trades) {
    const n = states.filter((st) => earnsPage(st, tr.id, { today }).ok).length;
    if (n > 1) pages.push({ kind: "tradeHub", trade: tr.id, states: n });
    else skipped.push({ kind: "tradeHub", trade: tr.id, reason: "too_few_states" });
  }
  return { pages, skipped };
}

export const pagePath = (p) =>
  p.kind === "state" ? `licensing/${p.state.toLowerCase()}/index.html`
  : p.kind === "trade" ? `licensing/${p.state.toLowerCase()}/${p.trade}.html`
  : p.kind === "tradeHub" ? `licensing/trade/${p.trade}.html`
  : "licensing/index.html";

export const pageUrl = (p) =>
  p.kind === "state" ? `/licensing/${p.state.toLowerCase()}/`
  : p.kind === "trade" ? `/licensing/${p.state.toLowerCase()}/${p.trade}.html`
  : p.kind === "tradeHub" ? `/licensing/trade/${p.trade}.html`
  : "/licensing/";

// The four documents every hiring account asks for whatever the state says.
// This is the bridge from "what does the law require" to "what will actually
// be asked of you", which is the only reason either kind of reader converts.
export const ASKED_ANYWAY = [
  ["insurance", "Certificate of insurance",
    "General liability, naming them as additional insured."],
  ["bond", "Surety bond",
    "Often required by cities that register your trade, and by plenty of hiring contractors regardless."],
  ["contract", "Signed subcontractor agreement",
    "Theirs, not yours. Scope, payment terms, and who carries what."],
  ["w9", "W-9",
    "So they can 1099 you. It carries your TIN, so it is the one to be careful with."],
];
