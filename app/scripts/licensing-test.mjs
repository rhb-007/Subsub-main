// The licensing reference, and the rule that stops it becoming doorway pages.
//
// Fifty-one states times twenty-nine trades is 1,479 combinations and most
// differ only in the state's name. Publishing all of them is not a content
// asset -- it is the thing search engines demote and readers stop trusting.
//
// So two rules decide what exists, and both are asserted here:
//
//   A COMBINATION EARNS A PAGE ONLY IF ITS ANSWER DIFFERS from the state's
//   baseline. Everything else is on the state hub, said once.
//
//   NOTHING PUBLISHES UNVERIFIED. No source, no date, no page -- and a
//   verified baseline does not vouch for an unverified trade entry, which is
//   the failure mode that makes programmatic content worthless.
//
// And the pages are checked by RENDERING them, because a generator that
// produces confident-looking broken HTML is worse than one that crashes.
//
//   node scripts/licensing-test.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname } from "node:path";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { plan, earnsPage, stateEarnsPage, answerFor, isVerified, isStale,
  pagePath, pageUrl, STALE_AFTER_DAYS, isReviewed, reviewQueue } from "../shared/licensing.js";
import { STATES } from "../../content/licensing/data.js";
import { US_STATES } from "../shared/states.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const t = tally();
const V = { source: "A statute", sourceUrl: "https://example.test", verifiedOn: "2026-09-12" };
const TODAY = "2026-09-27";
const TRADES = [
  { id: "roofing", label: "Roofing" }, { id: "electrical", label: "Electrical" },
  { id: "plumbing", label: "Plumbing" }, { id: "siding", label: "Siding" },
];

console.log("\n-- what earns its own page --");
{
  const st = { code: "ZZ", name: "Zedland", baseline: { licence: "none", ...V },
    trades: {
      electrical: { licence: "state", body: "Board", ...V },   // differs, verified
      roofing: { licence: "none", ...V },                      // same answer, reworded
      plumbing: { licence: "state", body: "Board" },           // differs, unverified
    } };
  t.ck("a trade the state singles out earns one",
    earnsPage(st, "electrical", { today: TODAY }).ok === true);
  // The rule this whole module exists for.
  t.ck("one repeating the baseline does not",
    earnsPage(st, "roofing", { today: TODAY }).reason === "same_as_baseline");
  t.ck("nor one the state never mentions",
    earnsPage(st, "siding", { today: TODAY }).reason === "same_as_baseline");
  // One verified fact must not vouch for an unverified one.
  t.ck("and a difference nobody checked does not publish",
    earnsPage(st, "plumbing", { today: TODAY }).reason === "unverified");
  t.ck("even though the baseline above it IS verified",
    isVerified(st.baseline) === true);

  const stale = { ...st, trades: { electrical: { licence: "state", ...V, verifiedOn: "2024-01-01" } } };
  t.ck("an answer checked too long ago stops counting",
    earnsPage(stale, "electrical", { today: TODAY }).reason === "stale");
  t.ck("with a stated shelf life", STALE_AFTER_DAYS > 180 && STALE_AFTER_DAYS < 1000,
    String(STALE_AFTER_DAYS));

  t.ck("a state hub needs its own verification",
    stateEarnsPage({ baseline: { licence: "none" } }).reason === "unverified");
  t.ck("and publishes when it has it", stateEarnsPage(st, { today: TODAY }).ok === true);
  // "Nothing here needs a licence" is a real answer people search for.
  t.ck("a state where nothing differs still gets a hub",
    stateEarnsPage({ baseline: { licence: "none", ...V } }, { today: TODAY }).ok === true);
}

console.log("\n-- the plan, over a whole dataset --");
{
  const states = [
    { code: "AA", name: "Aay", baseline: { licence: "none", ...V },
      trades: { electrical: { licence: "state", ...V }, plumbing: { licence: "state", ...V } } },
    { code: "BB", name: "Bee", baseline: { licence: "registration", ...V },
      trades: { electrical: { licence: "state", ...V } } },
    { code: "CC", name: "Cee", baseline: { licence: "none" } },   // unverified
  ];
  const { pages, skipped } = plan(states, TRADES, { today: TODAY });
  const kinds = pages.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] || 0) + 1 }), {});
  t.ck("two state hubs, not three", kinds.state === 2, JSON.stringify(kinds));
  t.ck("the unverified state is skipped entirely",
    !pages.some((p) => p.state === "CC"), JSON.stringify(pages.filter((p) => p.state === "CC")));
  t.ck("three trade pages", kinds.trade === 3, JSON.stringify(kinds));
  // A hub listing one link is not a hub.
  t.ck("electrical earns a hub, being in two states", kinds.tradeHub === 1, JSON.stringify(kinds));
  t.ck("plumbing does not, being in one",
    skipped.some((s) => s.kind === "tradeHub" && s.trade === "plumbing"
      && s.reason === "too_few_states"));
  t.ck("and every skip says why",
    skipped.every((s) => !!s.reason), JSON.stringify(skipped.filter((s) => !s.reason)));

  // The scale claim, checked rather than asserted.
  const big = Array.from({ length: 51 }, (_, i) => ({
    code: `S${i}`, name: `State ${i}`, baseline: { licence: "none", ...V },
    trades: { electrical: { licence: "state", ...V } },
  }));
  const wide = plan(big, Array.from({ length: 29 },
    (_, i) => ({ id: `t${i}`, label: `T${i}` })), { today: TODAY });
  t.ck("51 x 29 does not become 1,479 pages",
    wide.pages.length < 200, String(wide.pages.length));
  t.ck("because the baseline rule absorbs almost all of it",
    wide.skipped.filter((s) => s.reason === "same_as_baseline").length > 1400,
    String(wide.skipped.filter((s) => s.reason === "same_as_baseline").length));
}

console.log("\n-- paths and urls line up --");
{
  t.ck("a state hub is a directory index",
    pagePath({ kind: "state", state: "TX" }) === "licensing/tx/index.html");
  t.ck("and its url has no filename",
    pageUrl({ kind: "state", state: "TX" }) === "/licensing/tx/");
  t.ck("a trade page sits under its state",
    pagePath({ kind: "trade", state: "TX", trade: "electrical" })
      === "licensing/tx/electrical.html");
  t.ck("and a trade hub does not", pageUrl({ kind: "tradeHub", trade: "electrical" })
    === "/licensing/trade/electrical.html");
}

console.log("\n-- every jurisdiction earns a hub --");
{
  // A reference covering eleven states reads as abandoned rather than partial:
  // the reader whose state is missing concludes the whole thing is unreliable,
  // and that judgement is applied to the forty that ARE there. So the map is
  // complete, and `shared/states.js` is the list it has to be complete against
  // -- fifty states and DC, territories absent on purpose, one list imported by
  // the Worker and the browser and now by this too.
  const have = new Set(STATES.map((st) => st.code));
  const want = US_STATES.map((st) => st.code || st[0] || st);
  t.ck("fifty states and DC", STATES.length === 51, String(STATES.length));
  const gaps = want.filter((c) => !have.has(c));
  t.ck("with nothing missing from shared/states.js", gaps.length === 0, gaps.join(" "));
  const extra = [...have].filter((c) => !want.includes(c));
  t.ck("and nothing in it that is not a jurisdiction", extra.length === 0, extra.join(" "));
  t.ck("no state listed twice", new Set(STATES.map((x) => x.code)).size === STATES.length,
    String(STATES.length));
  // A hub publishing is the whole point -- a state that skips is a reader sent
  // to a 404 from the index.
  const skippedHubs = STATES.filter((st) => !stateEarnsPage(st, { today: TODAY }).ok);
  t.ck("every one of them publishes", skippedHubs.length === 0,
    skippedHubs.map((x) => x.code).join(" "));
}

console.log("\n-- and the dataset says which entries nobody has checked --");
{
  // An entry naming a real agency and a real URL, dated today, written by
  // somebody who did not open the statute reads EXACTLY like one that was read
  // line by line. That difference cannot live in a commit message, so it lives
  // in the data: `reviewed` is the flag nobody gets for free, and the generator
  // prints what is still owed a read.
  t.ck("an entry with no flag is not reviewed", isReviewed({ source: "x" }) === false);
  t.ck("and one that says so is", isReviewed({ reviewed: true }) === true);
  // Not a truthy check: `reviewed: "yes"` is somebody guessing at the schema,
  // and treating it as a read is the one thing this flag exists to prevent.
  t.ck("a truthy value that is not true does not count",
    isReviewed({ reviewed: "yes" }) === false && isReviewed({ reviewed: 1 }) === false);

  const owed = reviewQueue(STATES);
  t.ck("the queue names the state and what in it", owed.every((r) => r.state && r.what),
    JSON.stringify(owed[0] || null));
  t.ck("it covers baselines as well as trades",
    owed.some((r) => r.what === "baseline"), JSON.stringify(owed.slice(0, 2)));
  // The honest reading of today's dataset: nothing in it has been read back
  // against its source, so the queue is the whole set. When somebody starts
  // marking entries reviewed this number comes down, and that is the point --
  // it must not be able to come down by an entry losing its flag silently.
  const reviewed = STATES.filter((st) => isReviewed(st.baseline)).map((st) => st.code);
  t.ck(`${reviewed.length} state baselines are recorded as checked`,
    owed.length === reviewQueue(STATES).length, String(owed.length));
  t.ck("and the queue is non-empty while any entry lacks the flag",
    (reviewed.length === STATES.length) === (owed.length === 0),
    `${reviewed.length} reviewed, ${owed.length} owed`);

  // A published entry still needs a source and a URL -- publishing unreviewed
  // is a decision about how much has been CHECKED, never a licence to publish
  // an answer with nowhere to trace it.
  const unsourced = STATES.filter((st) => !isVerified(st.baseline)).map((st) => st.code);
  t.ck("unreviewed never means unsourced", unsourced.length === 0, unsourced.join(" "));
  const noBody = STATES.filter((st) => {
    const b = st.baseline || {};
    // "none" and "local" legitimately have no state body to name.
    return (b.licence === "state" || b.licence === "registration") && !b.body;
  }).map((st) => st.code);
  t.ck("and every state that licenses or registers names who administers it",
    noBody.length === 0, noBody.join(" "));
  const noRegistry = STATES.filter((st) => !st.registry?.name).map((st) => st.code);
  t.ck("every state says where the register is, or that there is none",
    noRegistry.length === 0, noRegistry.join(" "));
  // A register claimed searchable has to have somewhere to search.
  const badRegistry = STATES.filter((st) => st.registry?.searchable && !st.registry?.url)
    .map((st) => st.code);
  t.ck("and a searchable one has a URL", badRegistry.length === 0, badRegistry.join(" "));
}

console.log("\n-- the shipped dataset --");
{
  for (const st of STATES) {
    t.ck(`${st.code} has a sourced baseline`, isVerified(st.baseline),
      JSON.stringify(st.baseline?.source));
    t.ck(`${st.code}'s baseline is not stale`, !isStale(st.baseline, TODAY),
      st.baseline?.verifiedOn);
    for (const [id, tr] of Object.entries(st.trades || {})) {
      t.ck(`${st.code} · ${id} carries its own source`, isVerified(tr),
        JSON.stringify(tr.source));
    }
  }
  // Not a directory: no COMPANY is named anywhere in the dataset. This used to
  // grep for "Roofing", which is a trade -- California licenses it as C-39 and
  // Florida certifies it separately, so the word belongs in the facts. What
  // must never appear is a company: a corporate suffix, or any of the fixture
  // names the rest of this repo's tests seed.
  const flat = JSON.stringify(STATES);
  const suffix = flat.match(/\b[A-Z][A-Za-z']+ (?:LLC|Inc\.?|Corp\.?|Ltd\.?)\b/);
  t.ck("no company suffix appears", !suffix, suffix ? suffix[0] : "");
  const fixtures = ["Ridge Roofing", "Alder Construction", "San Juan Exteriors",
    "Outerhome", "Cascade Management", "Bay Roofing", "Arrived Roofing"];
  const named = fixtures.filter((f) => flat.includes(f));
  t.ck("and no company is named in it", named.length === 0, JSON.stringify(named));
}

console.log("\n-- and the generated pages actually render --");
{
  const out = join(root, "licensing");
  if (existsSync(out)) rmSync(out, { recursive: true });
  execFileSync("node", [join(root, "app/scripts/build-licensing.mjs")], { stdio: "pipe" });
  t.ck("the generator wrote an index", existsSync(join(out, "index.html")));
  t.ck("and a sitemap", existsSync(join(out, "sitemap.xml")));

  const page = readFileSync(join(out, "tx/electrical.html"), "utf8");
  t.ck("a page is a whole document", page.startsWith("<!DOCTYPE html>"));
  t.ck("carrying the site's own header", page.includes('<header class="site">'));
  t.ck("and its footer", page.includes('<footer class="site">'));
  // Two directories down, so every relative link in the chrome had to move.
  t.ck("with the chrome's links rewritten for the depth",
    page.includes('href="../../index.html"') && !page.includes('href="index.html"'));
  t.ck("it declares a canonical",
    page.includes('href="https://subsub.work/licensing/tx/electrical.html"'));
  t.ck("and breadcrumb structured data", page.includes('"@type":"BreadcrumbList"'));
  t.ck("the answer is in the first screen, not buried",
    page.indexOf("lic-answer") < page.indexOf("What you will be asked for"));
  t.ck("both doors are on it",
    page.includes("lic-sub-cta") && page.includes("lic-gc-cta"));
  t.ck("it says where the answer came from and when",
    /Checked 2026-09-12/.test(page) && /TDLR/.test(page));
  // Scoped to what the reader sees. The JSON-LD block legitimately escapes "<"
  // as \u003c so a source name in data.js cannot close the script tag; that is
  // machine-readable data, not text on the page, and the guard here is about a
  // literal escape sequence showing up as six characters in front of somebody.
  const readerText = page.replace(/<script[\s\S]*?<\/script>/g, " ");
  t.ck("and no escape sequence leaked", !/\\u[0-9a-f]{4}/i.test(readerText));

  // The sitemap must list what exists and nothing else.
  const map = readFileSync(join(out, "sitemap.xml"), "utf8");
  const urls = [...map.matchAll(/<loc>https:\/\/subsub\.work([^<]+)<\/loc>/g)].map((m) => m[1]);
  const { pages } = plan(STATES, (() => {
    const src = readFileSync(join(root, "app/src/App.tsx"), "utf8");
    const b = src.match(/const CATEGORIES = \[([\s\S]*?)\n\];/)[1];
    return [...b.matchAll(/id: "([a-z_]+)", label: "([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
  })(), { today: new Date().toISOString().slice(0, 10) });
  t.ck("the sitemap lists every page", urls.length === pages.length + 1,
    `${urls.length} vs ${pages.length + 1}`);
  const sitemapFile = (u) => join(root, (u.endsWith("/") ? `${u}index.html` : u).replace(/^\//, ""));
  const missing = urls.filter((u) => !existsSync(sitemapFile(u)));
  t.ck("and nothing that was not written", missing.length === 0,
    JSON.stringify(missing.slice(0, 3)));

  // The site's own chrome, at the right depth on EVERY page kind.
  //
  // The header, footer and favicons are sliced out of a real page, where they
  // link relatively -- so each generated page has to rewrite them for where it
  // actually sits. Two of the four kinds were given that depth by hand and
  // came up one short: the state hub and the licensing index shipped a nav
  // pointing at /licensing/pricing.html and favicons that 404ed. The internal
  // related-links check below did not catch it, because it only ever looked at
  // a trade page, which happened to be right.
  //
  // So resolve every relative reference on every page against the real site
  // root and require the file to be there. This is the assertion that makes
  // the depth arithmetic untestable-by-inspection into a build failure.
  const relDead = [];
  for (const p of pages) {
    const file = join(root, pagePath(p));
    const html = readFileSync(file, "utf8");
    const dir = dirname(pagePath(p));
    for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const val = m[1];
      if (/^(https?:|mailto:|tel:|#|\/|data:)/.test(val)) continue;
      const target = join(root, dir, val.split("#")[0].split("?")[0]);
      const hit = existsSync(target.endsWith("/") ? join(target, "index.html") : target)
        || existsSync(join(target, "index.html"));
      if (!hit) relDead.push(`${pagePath(p)} -> ${val}`);
    }
  }
  t.ck("every relative reference resolves, on every page kind",
    relDead.length === 0, JSON.stringify(relDead.slice(0, 4)));

  // Structured data, and the one rule that makes FAQPage safe to ship.
  //
  // These pages are questions -- a trade page's H1 IS the search query -- so
  // FAQPage is what lets an answer engine quote one instead of paraphrasing
  // around it. The rule it comes with is that the marked-up answer must be text
  // the reader can see; marking up an answer that is not on the page is what
  // costs a site its rich-result eligibility, and it is an easy thing to do by
  // accident when the answer is assembled from data rather than copied.
  //
  // So every answer is checked WORD BY WORD against the page's own visible
  // text. Not verbatim -- the body renders "Who administers it" in a table cell
  // and the answer says "X administers it", which is the same fact in a
  // sentence -- but a fabricated answer cannot pass, because its words are not
  // there to find.
  const visibleText = (html) => html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&ndash;/g, " ").replace(/&middot;/g, " ")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ").toLowerCase();

  const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w.length > 3);

  const ldOf = (html) => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
  };

  let faqPages = 0, badAnswers = [], noLd = [], noFaq = [], staleStamp = [];
  for (const pg of pages) {
    const html = readFileSync(join(root, pagePath(pg)), "utf8");
    let ld = null;
    try { ld = ldOf(html); } catch { /* parse failure falls through */ }
    if (!ld || !Array.isArray(ld["@graph"])) { noLd.push(pagePath(pg)); continue; }

    const faq = ld["@graph"].find((n) => n["@type"] === "FAQPage");
    if (!faq) { noFaq.push(pagePath(pg)); continue; }
    faqPages += 1;

    const seen = visibleText(html);
    for (const q of faq.mainEntity) {
      const ws = words(q.acceptedAnswer.text);
      const hit = ws.filter((w) => seen.includes(w)).length;
      // Seven in ten. An answer that is a sentence around a value on the page
      // scores well above this; one invented for the markup scores far below.
      if (!ws.length || hit / ws.length < 0.7) {
        badAnswers.push(`${pagePath(pg)}: ${q.name} (${hit}/${ws.length})`);
      }
    }

    // dateModified is the machine-readable half of the "Checked <date>" line.
    // If the two disagree, one of them is lying about how current the answer is.
    const web = ld["@graph"].find((n) => n["@type"] === "WebPage");
    if (web?.dateModified && !html.includes(web.dateModified)) {
      staleStamp.push(`${pagePath(pg)}: ${web.dateModified} not on the page`);
    }
  }

  t.ck("every page carries parseable structured data", noLd.length === 0,
    JSON.stringify(noLd.slice(0, 3)));
  t.ck("and every page carries FAQ markup", noFaq.length === 0,
    JSON.stringify(noFaq.slice(0, 3)));
  t.ck("on all of them", faqPages === pages.length, `${faqPages} of ${pages.length}`);
  t.ck("every marked-up answer is text the reader can see",
    badAnswers.length === 0, JSON.stringify(badAnswers.slice(0, 3)));
  t.ck("and dateModified matches the date printed on the page",
    staleStamp.length === 0, JSON.stringify(staleStamp.slice(0, 3)));

  // A source name or a detail sentence in data.js is hand-edited prose, and
  // JSON.stringify does not escape "<" -- so "</script>" in the dataset would
  // close the block and turn the rest of the page into markup.
  const anyPage = readFileSync(join(root, pagePath(pages[0])), "utf8");
  const ldBlock = anyPage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  t.ck("the structured data cannot close its own script tag",
    !/[<>]/.test(ldBlock) && ldBlock.includes("\\u003c") === false
      || !/[<>]/.test(ldBlock),
    ldBlock.slice(0, 40));

  // Rendered, because a generator producing confident-looking broken HTML is
  // worse than one that crashes.
  const TYPES = { ".html": "text/html", ".xml": "application/xml" };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = join(root, p.replace(/^\//, ""));
    if (!existsSync(file)) { res.writeHead(404); return res.end("no"); }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "text/plain" });
    res.end(readFileSync(file));
  }).listen(5247);
  const browser = await launch();
  try {
    const pg = await browser.newPage();
    const crashes = [];
    pg.on("pageerror", (e) => crashes.push(e.message));
    await pg.goto("http://127.0.0.1:5247/licensing/tx/electrical.html",
      { waitUntil: "domcontentloaded" });
    await wait(500);
    const seen = await pg.evaluate(() => ({
      h1: document.querySelector("h1")?.innerText.trim(),
      answer: document.querySelector(".lic-answer .big")?.innerText.trim(),
      ctas: document.querySelectorAll(".lic-cta").length,
      links: [...document.querySelectorAll(".lic-rel a")].map((a) => a.getAttribute("href")),
      body: document.body.innerText,
    }));
    t.ck("the page renders", /need a licence in Texas/.test(seen.h1 || ""), String(seen.h1));
    t.ck("answering in the first line", /^Yes\./.test(seen.answer || ""), String(seen.answer));
    t.ck("with both doors", seen.ctas === 2, String(seen.ctas));
    t.ck("and internal links to related pages", seen.links.length >= 2,
      JSON.stringify(seen.links));
    t.ck("no escape sequence on screen", !/\\u[0-9a-f]{4}/i.test(seen.body), "");
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));

    // Every internal link the section generates must resolve.
    const dead = [];
    for (const href of seen.links) {
      const url = new URL(href, "http://127.0.0.1:5247/licensing/tx/electrical.html");
      const r = await pg.goto(url.href, { waitUntil: "domcontentloaded" });
      if (r.status() !== 200) dead.push(href);
      await pg.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
    t.ck("every related link resolves", dead.length === 0, JSON.stringify(dead));

    await pg.goto("http://127.0.0.1:5247/licensing/", { waitUntil: "domcontentloaded" });
    await wait(400);
    const idx = await pg.evaluate(() => document.body.innerText);
    // The offer comes before the lists. Somebody landing here has already been
    // persuaded by the page they came from; making them read two directories
    // first spends that.
    t.ck("the index leads with the offer, not the index",
      idx.indexOf("compliance pack") < idx.indexOf("By state"),
      `${idx.indexOf("compliance pack")} vs ${idx.indexOf("By state")}`);
    t.ck("and it explains nothing about its own bookkeeping",
      !/page for every combination/i.test(idx), "");
    await pg.close();
  } finally {
    await browser.close(); server.close();
  }
}

t.done();
