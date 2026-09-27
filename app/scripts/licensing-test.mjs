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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname } from "node:path";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { plan, earnsPage, stateEarnsPage, answerFor, isVerified, isStale,
  pagePath, pageUrl, STALE_AFTER_DAYS } from "../shared/licensing.js";
import { STATES } from "../../content/licensing/data.js";

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
  // Not a directory. No company names anywhere in the dataset.
  const flat = JSON.stringify(STATES);
  t.ck("no company is named in it",
    !/Roofing|Ridge|Bay Roofing|LLC\b/.test(flat), "");
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
  t.ck("and no escape sequence leaked", !/\\u[0-9a-f]{4}/i.test(page));

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
    t.ck("the index explains why there is not a page per combination",
      /Why there is not a page for every combination/i.test(idx), idx.slice(0, 120));
    await pg.close();
  } finally {
    await browser.close(); server.close();
  }
}

t.done();
