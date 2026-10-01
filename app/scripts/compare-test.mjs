// The comparison pages and the roundup.
//
// These are the pages that name OTHER COMPANIES' prices, which is what makes
// them different from everything else on this site: every other page describes
// SubSub, where being wrong is embarrassing, and these describe seven
// competitors, where being wrong is a reader quoting a figure at a salesperson
// who then corrects them. Two of the seven -- Buildertrend and Procore -- do
// not publish pricing at all, so those are ranges read off somebody's page on
// a particular day.
//
// So the assertions are about three things, in order of how badly they fail:
//
//   STALENESS, which is the whole reason the review date is data rather than a
//   line in a README. "Re-check quarterly" is a thing nobody does; a test that
//   goes red is a thing somebody does. It names the pages, because a count is
//   not a work queue.
//
//   WHAT THE PAGE CLAIMS, against what the product and the rest of the site
//   actually say. The licence check is the sharp one: only WA is
//   `fieldMappingVerified` in the Worker and the site says WA L&I, so a page
//   saying "the state registry" reads as true to a Texas GC and is not.
//
//   THAT THE RENDERER DID NOT QUIETLY DROP ANYTHING. It is hand-rolled -- a
//   closed subset, no dependency -- and the way that bites is silence: a table
//   row that does not render looks like a table row nobody wrote.
//
//   node --no-warnings scripts/compare-test.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, toHtml, faqPairs, inline, ldJson } from "../../content/compare/render.mjs";
import { planOf, daysSince, STALE_AFTER_DAYS } from "./build-compare.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(root, "content/compare/pages");
const read = (f) => readFileSync(join(root, f), "utf8");
const names = readdirSync(SRC).filter((f) => f.endsWith(".md"));
const plan = planOf(names);
// Everything between the tags, with the markup taken out -- what a reader sees.
const textOf = (html) => {
  const m = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  return m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

console.log("\n-- the pages exist and are where the URLs say --");
{
  ck("there are nine sources", names.length === 9, String(names.length));
  const missing = plan.filter((p) => !existsSync(join(root, p.dir, "index.html")));
  // A page in the plan with nothing on disk is the generator not having been
  // run -- which is silent, because the OLD pages still render.
  ck("every one is built", missing.length === 0, JSON.stringify(missing.map((m) => m.dir)));
  // The URL is the directory, so no `_redirects` entry is needed. That file's
  // own comment records why an extensionless rule there loops.
  ck("and needs no redirect rule",
    !/\/compare\b/.test(read("_redirects")) && !/\/blog\b/.test(read("_redirects")));
}

console.log("\n-- REVIEW QUEUE: these name other companies' prices --");
{
  const old = [];
  for (const p of plan) {
    const { meta } = parse(readFileSync(join(SRC, p.file), "utf8"));
    ck(`${p.file} says when it was checked`, /^\d{4}-\d{2}-\d{2}$/.test(meta.updated || ""), String(meta.updated));
    const age = daysSince(meta.updated);
    if (age > STALE_AFTER_DAYS) old.push(`${p.url} (${age}d)`);
  }
  // NAMED, not counted: a number is not a work queue.
  ck(`nothing is past its ${STALE_AFTER_DAYS}-day review window`, old.length === 0, old.join(" | "));
  // And the reader is told, because a price with no date on it is a price
  // somebody quotes back at a salesperson.
  const noDate = plan.filter((p) => !/Reviewed \w+ \d{4}/.test(read(join(p.dir, "index.html"))));
  ck("and every page says so where a reader can see it", noDate.length === 0,
    JSON.stringify(noDate.map((p) => p.dir)));
}

console.log("\n-- what the pages claim about licence checks --");
{
  // THE PRODUCT'S OWN ANSWER, read out of the Worker rather than remembered:
  // only WA carries `fieldMappingVerified: true`, and the comment above it
  // says the other six have never been exercised against a live response.
  const worker = read("app/worker/index.js");
  const verified = (worker.match(/fieldMappingVerified: true/g) || []).length;
  ck("exactly one state's licence parsing is verified", verified === 1, String(verified));
  ck("and it is Washington",
    /WA: \{[\s\S]{0,400}fieldMappingVerified: true/.test(worker));

  // So a page may not say "the state registry" flat. It names Washington, or
  // it does not make the claim at all.
  const bad = [];
  for (const p of plan) {
    const body = readFileSync(join(SRC, p.file), "utf8");
    for (const m of body.match(/[^.\n]*\bstate registry\b[^.\n]*/gi) || []) {
      if (!/washington|L&amp;I|L&I|WA\b/i.test(m)) bad.push(`${p.file}: ${m.trim().slice(0, 70)}`);
    }
  }
  ck("no page claims a registry check it cannot make everywhere", bad.length === 0,
    JSON.stringify(bad));
  // And at least one says the true thing, or the check above passes by the
  // subject never coming up -- the assertion that cannot fail.
  const says = plan.filter((p) => /washington/i.test(readFileSync(join(SRC, p.file), "utf8")));
  ck("and at least one names Washington", says.length > 0, String(says.length));
}

console.log("\n-- and about payment, which has not shipped --");
{
  // The site says "Coming soon" in three places. A comparison page listing
  // `pay` among what SubSub does is the screen-that-lies rule pointed at
  // marketing: somebody chooses it for a thing that is not there.
  ck("the site still says payments are coming", /Coming soon/.test(read("index.html")));
  // AN ALLOW LIST, AND THE FIRST VERSION WAS A DENY LIST THAT COULD NOT FAIL.
  // It kept only fragments containing the word "SubSub" -- on the reasoning
  // that the rest are about competitors -- and every one of these pages is
  // about SubSub throughout, so the subject is usually in the PREVIOUS
  // sentence. The mutation proving it: changing the hub to read "...dispatch,
  // warranty and paying your subcontractors" sailed through, because that
  // clause does not name SubSub and the sentence before it does.
  //
  // So unknown means FLAG IT. Every use of the word is listed, the senses
  // that are legitimately not a claim about shipped functionality are struck
  // out by name, and anything left is a page offering a feature that is not
  // there.
  const SAFE = [
    // Said with the qualifier, which is the whole point.
    /coming soon|not live/i,
    // Seat fees, which is a different question with a different answer: no,
    // subcontractor logins are free. Flagging this would have somebody edit
    // a true sentence to quieten a test.
    /pay to use|logins? (?:are |is )?free|count as users|never pay|subs never/i,
    // What the CATEGORY is, or what to judge any tool on -- not a list of
    // what SubSub does today.
    /what is subcontractor management software|software that helps a general contractor/i,
    /^\d+\.\s+\*\*Payment\.\*\*/,
  ];
  const bad = [];
  for (const p of plan) {
    const body = readFileSync(join(SRC, p.file), "utf8");
    for (const line of body.split("\n")) {
      if (!/\b(pay|paying|payment)s?\b/i.test(line)) continue;
      if (SAFE.some((re) => re.test(line))) continue;
      bad.push(`${p.file}: ${line.trim().slice(0, 90)}`);
    }
  }
  ck("no page offers paying subcontractors as a thing that works", bad.length === 0,
    JSON.stringify(bad));
}

console.log("\n-- SubSub's own prices match the pricing page --");
{
  const pricing = read("pricing.html");
  ck("the site charges $99 a month", /\$99 <em>\/month<\/em>/.test(pricing));
  ck("and free up to 3 subcontractors", /Up to <b>3 subcontractors<\/b>/.test(pricing));
  const wrong = [];
  for (const p of plan) {
    const body = readFileSync(join(SRC, p.file), "utf8");
    // Any dollar figure attached to SubSub has to be one of the two real ones.
    for (const m of body.match(/SubSub[^.\n]{0,120}?\$[\d,]+/gi) || []) {
      const n = (m.match(/\$([\d,]+)/) || [])[1];
      if (!["99", "990", "0"].includes(n)) wrong.push(`${p.file}: ${m.trim().slice(0, 70)}`);
    }
  }
  ck("and no page quotes a different one for SubSub", wrong.length === 0, JSON.stringify(wrong));
}

console.log("\n-- the renderer did not quietly drop anything --");
{
  // A HAND-ROLLED RENDERER FAILS BY SILENCE. A row it does not understand is
  // a row that is simply not there, which reads as a row nobody wrote. So
  // every heading and every table cell in the source is required on the page.
  const lost = [];
  for (const p of plan) {
    const body = readFileSync(join(SRC, p.file), "utf8");
    const text = textOf(read(join(p.dir, "index.html")));
    const want = [];
    for (const line of body.split("\n")) {
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) want.push(h[1]);
      else if (/^\|/.test(line) && !/^\|[\s:|-]+\|$/.test(line)) {
        for (const c of line.replace(/^\||\|$/g, "").split("|")) if (c.trim()) want.push(c.trim());
      }
    }
    for (const w of want) {
      const plain = w.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/&amp;/g, "&").trim();
      if (plain && !text.replace(/&amp;/g, "&").includes(plain)) lost.push(`${p.file}: ${plain.slice(0, 50)}`);
    }
  }
  ck("every heading and table cell reaches the page", lost.length === 0,
    JSON.stringify(lost.slice(0, 4)));

  // The constructs, each pinned once, because "it rendered" is satisfied by a
  // page of escaped asterisks.
  ck("bold becomes bold", toHtml("**x** y").includes("<b>x</b>"));
  {
    // The cell carries its column's heading, which is what the stacked phone
    // layout reads. Asserting the markup rather than only "a table appeared":
    // a td with no data-h renders a stacked row with two unlabelled answers.
    const t = toHtml("| x | h |\n|---|---|\n| a | b |");
    ck("a table becomes a table", /<table class="cmp-t">/.test(t) && /<th>a<\/th>/.test(t));
    ck("and each cell carries its column heading", /<td data-h="h">b<\/td>/.test(t), t.slice(-60));
  }
  ck("a bullet list becomes one", toHtml("- a\n- b") === "<ul><li>a</li><li>b</li></ul>");
  ck("an ordered list stays ordered", toHtml("1. a\n2. b") === "<ol><li>a</li><li>b</li></ol>");
  ck("a link becomes a link", toHtml("[t](/x/)").includes('<a href="/x/">t</a>'));
  // Prose with angle brackets must not become markup. These files are
  // hand-edited, and `<` in a price range or a company name is ordinary.
  ck("a stray angle bracket is escaped", toHtml("a < b").includes("a &lt; b"));
  ck("and an existing entity is not double-escaped",
    toHtml("L&amp;I").includes("L&amp;I") && !toHtml("L&amp;I").includes("&amp;amp;"));
  // JSON-LD sits in a <script> block, and the source is prose.
  ck("ldJson closes no script tag", !ldJson({ a: "</script>" }).includes("</script>"));
  // THE BACKTICK TRAP, for the seventh time in this repository and the second
  // time this week. PAGE_CSS is a template literal, so one backtick anywhere
  // inside it -- including in a comment explaining a CSS rule -- closes it and
  // the module fails to parse. Which it did, in the comment above `.cmp-tw`.
  // The guard CLAUDE.md prescribes is one line beside whatever the literal is
  // for: assert it contains none at all.
  {
    const src = readFileSync(join(root, "content/compare/render.mjs"), "utf8");
    const a = src.indexOf("`", src.indexOf("export const PAGE_CSS")) + 1;
    const b = src.indexOf("`;", a);
    ck("no backtick anywhere in the stylesheet literal",
      a > 0 && b > a && !src.slice(a, b).includes("`"));
  }
}

console.log("\n-- the structured answers are answers the reader can see --");
{
  // THE RULE THE LICENSING PAGES ALREADY RUN ON. A fabricated answer in
  // JSON-LD is the worst thing a page can carry, because only a crawler reads
  // it -- so each pair is checked against the page's own visible text.
  let pairs = 0;
  const bad = [];
  for (const p of plan) {
    const html = read(join(p.dir, "index.html"));
    const text = textOf(html);
    const ld = JSON.parse((html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s) || [])[1]
      .replace(/\\u003c/g, "<"));
    const faq = (ld["@graph"] || []).find((g) => g["@type"] === "FAQPage");
    if (!faq) continue;
    for (const q of faq.mainEntity) {
      pairs += 1;
      for (const part of [q.name, q.acceptedAnswer.text]) {
        // Word by word rather than verbatim: the body sets a question in bold
        // and the answer as a paragraph, so whitespace differs -- but a
        // fabricated sentence scores near zero.
        const words = part.replace(/[^\w\s$.]/g, " ").split(/\s+/).filter((w) => w.length > 3);
        const hit = words.filter((w) => text.includes(w)).length;
        if (hit / Math.max(words.length, 1) < 0.9) bad.push(`${p.file}: ${part.slice(0, 50)}`);
      }
    }
  }
  ck("there are question/answer pairs to check", pairs >= 10, String(pairs));
  ck("and every one is on the page in words the reader sees", bad.length === 0,
    JSON.stringify(bad.slice(0, 3)));
  // Read off the body, never written twice. A hand-kept list is how a page
  // ends up claiming an answer it does not give.
  ck("they are read out of the source", faqPairs("## FAQ\n**Q?**\nA.").length === 1);
  ck("and only from the FAQ section",
    faqPairs("## Other\n**Q?**\nA.\n").length === 0);
}

console.log("\n-- findable: the footer, the sitemaps, the index --");
{
  // Pages nobody links are pages nobody reads -- the orphan failure the
  // licensing pages shipped with.
  const footerPages = readdirSync(root).filter((f) => f.endsWith(".html"))
    .filter((f) => read(f).includes('<footer class="site">'));
  ck("there are pages with a footer", footerPages.length >= 10, String(footerPages.length));
  const noLink = footerPages.filter((f) => {
    const foot = read(f).slice(read(f).indexOf('<footer class="site">'));
    return !/<h4>Resources<\/h4>[\s\S]{0,300}href="compare\/"/.test(foot);
  });
  ck("and every one links Compare from Resources", noLink.length === 0, JSON.stringify(noLink));

  // The generated pages take the footer from the chrome slice, so they only
  // get it after `npm run compare` -- the same forget-to-rebuild trap the
  // licensing pages record.
  const stale = plan.filter((p) => {
    const html = read(join(p.dir, "index.html"));
    const foot = html.slice(html.indexOf('<footer class="site">'));
    return !/href="(?:\.\.\/)+compare\/"/.test(foot);
  });
  ck("including the generated ones, which is a separate build", stale.length === 0,
    JSON.stringify(stale.map((p) => p.dir)));

  // Declared beside the root sitemap rather than merged into it: this one is
  // written from the same plan the pages are, and a hand-kept copy goes stale
  // the first time a comparison is added.
  ck("the generated sitemap is declared in robots.txt",
    read("robots.txt").includes("https://subsub.work/compare/sitemap.xml"));
  ck("the hub and the roundup are in the root sitemap",
    read("sitemap.xml").includes("https://subsub.work/compare/</loc>".replace("</loc>", ""))
    && read("sitemap.xml").includes("/blog/best-subcontractor-management-software/"));
  const sm = read("compare/sitemap.xml");
  ck("and the generated one lists every page", plan.every((p) => sm.includes(p.url)),
    String((sm.match(/<loc>/g) || []).length));

  // The hub has to reach each comparison, or six of them are orphans with a
  // sitemap entry.
  const hub = read("compare/index.html");
  const unlinked = plan.filter((p) => p.dir.startsWith("compare/"))
    .filter((p) => !hub.includes(`${p.dir.replace("compare/", "")}/`));
  ck("the hub links every comparison", unlinked.length === 0, JSON.stringify(unlinked.map((p) => p.dir)));
}

console.log("\n-- and they wear the site, not a copy of it --");
{
  const html = read("compare/subsub-vs-procore/index.html");
  ck("the header is the site's", html.includes('<header class="site">'));
  ck("the footer is the site's", html.includes('<footer class="site">'));
  ck("it carries a canonical", /<link rel="canonical" href="https:\/\/subsub\.work\/compare\/subsub-vs-procore\/">/.test(html));
  ck("and a description", /<meta name="description" content="[^"]{60,}"/.test(html));
  // Relative links are rewritten for depth. A root-relative /compare/ left
  // alone would work on the live site and break nowhere visible until it is
  // opened from a file or a preview; rewriting is what the chrome does too.
  ck("no site-root link survives in the body",
    !/href="\/(?!\/)/.test(html.slice(html.indexOf("<main"), html.indexOf("</main>"))));
  // The disclosure stays. These pages are written by the company they
  // recommend, and saying so is the only thing that makes the rest readable.
  const noDisc = plan.filter((p) => !/we make SubSub/i.test(read(join(p.dir, "index.html"))));
  ck("every page discloses who wrote it", noDisc.length === 0, JSON.stringify(noDisc.map((p) => p.dir)));
}

// ---- and it is actually STYLED, which no static check could see -----------
//
// THIS IS THE ONE THAT CAUGHT A REAL BUG. `readChrome().css` is a whole
// `<style>...</style>` block, not its contents, and this renderer wrapped it
// in another `<style>` -- so the inner closing tag ended the block, the rest
// of the site's stylesheet rendered to the page AS TEXT, and every page came
// out unstyled with 4KB of CSS printed across the top.
//
// Every static assertion above passed: the header was present, the footer was
// present, the headings were present. "Present in the source" and "in force in
// a browser" are different questions, and only the second one is the one
// anybody cares about.
console.log("\n-- and the site's stylesheet is in force, not printed on the page --");
{
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium",
    args: ["--no-sandbox"], headless: "new" });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 900 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`file://${join(root, "compare/subsub-vs-procore/index.html")}`,
      { waitUntil: "domcontentloaded" });
    const seen = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const body = document.body;
      return {
        // A stylesheet that parsed has rules in it. One that was closed early
        // by a stray tag has almost none.
        rules: [...document.styleSheets].reduce((n, s) => {
          try { return n + s.cssRules.length; } catch { return n; }
        }, 0),
        // The giveaway: CSS source visible as text on the page.
        leak: /\.cmp-wrap\{|font-size:clamp\(/.test(body.innerText),
        h1Size: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
        bodyFont: getComputedStyle(body).fontFamily,
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    ck("the stylesheet parsed", seen.rules > 200, String(seen.rules));
    // The symptom, named on its own: a page can have rules AND leak, if only
    // one of two blocks broke.
    ck("and no CSS is printed on the page as text", seen.leak === false);
    // PAGE_CSS is in the second block, so this is the half the first version
    // of the template destroyed.
    ck("the page's own rules applied too", seen.h1Size >= 28, String(seen.h1Size));
    ck("and the site's font came with it", /[A-Za-z]/.test(seen.bodyFont)
      && !/^(Times|serif)$/i.test(seen.bodyFont.trim()), seen.bodyFont);
    ck("nothing threw", errs.length === 0, errs.join(" | "));

    // A table of seven rows against a phone is the obvious way these break.
    // `developers.html` already scrolls sideways at 390 and it is recorded as
    // open; these must not add a second one.
    await page.setViewport({ width: 390, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const narrow = await page.evaluate(() => ({
      wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      sw: document.documentElement.scrollWidth,
    }));
    ck("and it does not scroll sideways on a phone", narrow.wide === false, JSON.stringify(narrow));
    // NOT SCROLLING SIDEWAYS IS HALF OF IT. The first version put the table in
    // an overflow box, so the page was fine and the table clipped its last
    // column mid-word -- "Mid-size to enterprise commercial constructio" --
    // which reads as a broken page, not as a table with more to the right.
    // So the cells are measured too, and the stacked row has to say which
    // product each answer belongs to or it is two bare values under a label.
    const stacked = await page.evaluate(() => ({
      clipped: [...document.querySelectorAll(".cmp-t td")]
        .filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      labelled: [...document.querySelectorAll(".cmp-t td")].every((e) => {
        if (!e.dataset.h) return true;
        return getComputedStyle(e, ":before").content.includes(e.dataset.h);
      }),
      cells: document.querySelectorAll(".cmp-t td").length,
    }));
    ck("no cell is cut off", stacked.clipped === 0, JSON.stringify(stacked));
    ck("and every stacked answer names its column", stacked.labelled === true,
      JSON.stringify(stacked));
    ck("there are cells to have checked", stacked.cells > 10, String(stacked.cells));

    // And a wide screen still gets a table, not a column of cards.
    await page.setViewport({ width: 1100, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    ck("a wide screen still gets a real table", await page.evaluate(() =>
      getComputedStyle(document.querySelector(".cmp-t")).display === "table"));
  } finally {
    await browser.close().catch(() => {});
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
