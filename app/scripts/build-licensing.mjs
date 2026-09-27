// Generate the licensing reference.
//
//   npm run licensing         write the pages
//   npm run licensing -- --dry   report what would be written, write nothing
//
// The report is the useful half. It says how many combinations were skipped
// and why, which is the work queue: `unverified` is somebody's afternoon with
// a statute, `same_as_baseline` is the rule doing its job and needs nothing.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readChrome, atDepth } from "../../content/licensing/chrome.mjs";
import { STATES } from "../../content/licensing/data.js";
import { plan, pagePath, pageUrl, baselineOf, reviewQueue } from "../shared/licensing.js";
import { statePage, tradePage, tradeHubPage, indexPage } from "../../content/licensing/render.mjs";
import { readFileSync } from "node:fs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");
const today = new Date().toISOString().slice(0, 10);

// The trade list lives in App.tsx with a React icon attached to each entry, so
// it cannot simply be imported here. Read the ids and labels out of it instead
// of keeping a second copy that drifts.
const TRADES = (() => {
  const src = readFileSync(join(root, "app/src/App.tsx"), "utf8");
  const block = src.match(/const CATEGORIES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("CATEGORIES not found in App.tsx");
  const out = [...block[1].matchAll(/id: "([a-z_]+)", label: "([^"]+)"/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
  if (!out.length) throw new Error("no trades parsed from App.tsx");
  return out;
})();

const chrome = { ...readChrome(join(root, "for-general-contractors.html")), atDepth };
const { pages, skipped } = plan(STATES, TRADES, { today });

const byState = Object.fromEntries(STATES.map((s) => [s.code, s]));
const byTrade = Object.fromEntries(TRADES.map((t) => [t.id, t]));

const html = (p) => {
  if (p.kind === "state") {
    return statePage({ chrome, state: byState[p.state], trades: TRADES, today });
  }
  if (p.kind === "trade") {
    const state = byState[p.state];
    return tradePage({ chrome, state, trade: byTrade[p.trade], others: {
      sameState: pages.filter((x) => x.kind === "trade" && x.state === p.state)
        .map((x) => byTrade[x.trade]),
      otherStates: pages.filter((x) => x.kind === "trade" && x.trade === p.trade
        && x.state !== p.state).map((x) => byState[x.state]),
    } });
  }
  if (p.kind === "tradeHub") {
    return tradeHubPage({ chrome, trade: byTrade[p.trade], states: STATES, today });
  }
  return indexPage({ chrome, states: STATES, trades: TRADES, today });
};

const all = [{ kind: "index" }, ...pages];
let bytes = 0;
if (!dry) {
  // Rebuilt from scratch, so a state removed from the dataset does not leave a
  // page behind claiming to be current.
  if (existsSync(join(root, "licensing"))) rmSync(join(root, "licensing"), { recursive: true });
  for (const p of all) {
    const file = join(root, pagePath(p));
    mkdirSync(dirname(file), { recursive: true });
    const out = html(p);
    writeFileSync(file, out);
    bytes += out.length;
  }
  // Only the pages that exist, so nothing is submitted that is not there.
  writeFileSync(join(root, "licensing/sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + all.map((p) => `  <url><loc>https://subsub.work${pageUrl(p)}</loc>`
      + `<lastmod>${today}</lastmod></url>`).join("\n")
    + `\n</urlset>\n`);
}

const why = {};
for (const s of skipped) why[s.reason] = (why[s.reason] || 0) + 1;
const combos = STATES.length * TRADES.length;

console.log(`\n${dry ? "Would write" : "Wrote"} ${all.length} pages`
  + (dry ? "" : ` (${Math.round(bytes / 1024)} KB)`));
console.log(`  ${STATES.length} states × ${TRADES.length} trades = ${combos} combinations`);
console.log(`  ${all.filter((p) => p.kind === "trade").length} earned their own page`);
for (const [reason, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
  const note = reason === "same_as_baseline"
    ? "covered by the state hub — nothing to do"
    : reason === "unverified" ? "needs a source and a date before it can publish"
    : reason === "stale" ? "checked too long ago to claim to be current"
    : reason === "too_few_states" ? "only one state differs, so a hub would list one link"
    : "";
  console.log(`  ${String(n).padStart(4)} skipped: ${reason}${note ? ` — ${note}` : ""}`);
}

// The work queue, named rather than counted.
const needWork = skipped.filter((s) => s.reason === "unverified" || s.reason === "stale");
if (needWork.length) {
  console.log(`\nWaiting on somebody reading a statute:`);
  for (const s of needWork.slice(0, 20)) {
    console.log(`  ${s.state}${s.trade ? ` · ${s.trade}` : ""} (${s.reason})`);
  }
  if (needWork.length > 20) console.log(`  …and ${needWork.length - 20} more`);
}

const missing = STATES.filter((s) => !baselineOf(s).source);
if (missing.length) console.log(`\n${missing.length} state(s) have no baseline source at all.`);

// And the OTHER queue, which is the one that grows quietly. An entry naming a
// real agency and a real URL, dated today, written by somebody who did not open
// the statute reads exactly like one that was read line by line -- so `reviewed`
// says which, and this prints what is still owed a read. Unlike the skip report
// above, none of these is holding a page back: they are published, and this is
// the list of pages whose numbers nobody has checked yet.
const owed = reviewQueue(STATES);
if (owed.length) {
  const byState = new Map();
  for (const r of owed) byState.set(r.state, (byState.get(r.state) || 0) + 1);
  console.log(`\n${owed.length} published entr${owed.length === 1 ? "y" : "ies"} across `
    + `${byState.size} state(s) not yet checked against the source:`);
  const codes = [...byState.keys()];
  for (let i = 0; i < codes.length; i += 13) {
    console.log(`  ${codes.slice(i, i + 13).join(" ")}`);
  }
  console.log("  Dollar thresholds first: a figure set in statute gets amended, and a");
  console.log("  page naming last year's is worse than one that named none.");
}
console.log("");
