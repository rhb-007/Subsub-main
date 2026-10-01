// Can anybody actually FIND the licensing reference?
//
// The generator shipped 13 correct pages that nothing on subsub.work linked to,
// that were absent from the root sitemap, and whose own sitemap was never
// declared in robots.txt. Every page was perfect and every page was invisible:
// no crawler reaches a directory nobody links and no sitemap announces.
//
// That is not a content bug, it is a wiring bug, and it is silent -- the pages
// render, the links inside them work, and the only symptom is traffic that
// never arrives. So the wiring gets a test of its own.
//
// Static: reads the files off disk, no browser and no server, because every
// claim here is about what is written in the HTML rather than how it renders.
//
//   node scripts/discover-test.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_PRESETS } from "../shared/crmsources.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let pass = 0, fail = 0;
const ck = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  ok  ${name}${detail ? `  -- ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

// Every page that carries the site footer, READ OFF DISK rather than listed.
//
// The list used to be hand-kept, with a comment saying get-started.html and
// 404.html carry no footer. Both do. So the two pages the list left out were
// exactly the two missing the Resources column, and the test said every page
// had it -- a list that decides what to check, written by the person who added
// the thing being checked, is the same record twice. The files are the record.
//
// A new page with a footer is now in scope the moment it exists, which is the
// point: "on every page" has to mean every page, not every page somebody
// remembered.
const FOOTER_PAGES = readdirSync(root)
  .filter((f) => f.endsWith(".html"))
  .filter((f) => read(f).includes('<footer class="site">'))
  .sort();

// The four audience pages, which get a link in the body as well: a footer link
// is how a crawler finds a section, a link with real anchor text next to
// relevant copy is how a reader does.
const AUDIENCE = ["for-general-contractors.html", "for-property-managers.html",
  "for-building-owners.html", "for-portfolio-managers.html"];

const footerOf = (html) => {
  const a = html.indexOf('<footer class="site">');
  const b = html.indexOf("</footer>", a);
  return a < 0 || b < 0 ? "" : html.slice(a, b);
};

// Where "Get started" goes, on every page that says it.
//
// It is the site's one call to action, repeated in the header of every page
// and in the body of several, and it has to land in the same place every
// time: the PLANS. Choosing one is the first question `get-started.html`
// asks, so a button that skips it drops somebody into a form whose first
// field is the thing the page they just left was there to help them decide.
// It is the same reasoning the app's own sign-in card already follows, where
// "Don't have an account? See plans and sign up" goes to /pricing rather
// than into setup.
//
// The exception is pricing.html itself, where the reader has ALREADY chosen
// and the button is the way onward -- a "Get started" there pointing back at
// the page it is on would be a button that does nothing.
//
// Read off disk, not from a list: a page that grows a Get started tomorrow is
// in scope the moment it exists. `developers.html` was the one that got this
// wrong, sending somebody who had just read an API reference straight into
// setup.
console.log("\nGet started goes to the plans, wherever it is said");
{
  const CTA = /<a\b[^>]*href="([^"]+)"[^>]*>\s*Get started[^<]*<\/a>/gi;
  const pages = readdirSync(root).filter((f) => f.endsWith(".html")).sort();
  const wrong = [];
  let found = 0;
  for (const name of pages) {
    const html = read(name);
    for (const m of html.matchAll(CTA)) {
      found++;
      const href = m[1];
      // On the plans page itself the button goes forward, not in a circle.
      const want = name === "pricing.html" ? "get-started.html" : "pricing.html";
      if (!href.startsWith(want)) wrong.push(`${name} -> ${href}`);
    }
  }
  ck("the site says it in several places", found >= 10, String(found));
  ck("and every one of them lands on the plans", wrong.length === 0, wrong.join(" | "));
}

console.log("\nthe footer carries it, on every page that has a footer");
ck("there are pages to check", FOOTER_PAGES.length >= 10, String(FOOTER_PAGES.length));
for (const name of FOOTER_PAGES) {
  const html = read(name);
  const foot = footerOf(html);
  ck(name, /<h4>Resources<\/h4>/.test(foot) && /href="licensing\/"/.test(foot));
}

// The API documentation is the second thing in Resources, and it is the only
// page on this site written for somebody who will go and build something
// against it -- so it has to be findable from wherever they landed, not only
// from the page that happens to mention it.
console.log("\nand the developer docs are in it");

// What the link SAYS is read off the destination, not written here twice.
//
// It used to be the literal "Developer tools", which was one of THREE names
// the same page went by: that in the footer, "SubSub API - post scheduled
// jobs from your CRM" in the tab, and "Post scheduled jobs into SubSub" as
// its own heading. Three names for one page is how somebody concludes there
// are three pages -- the same trap as a panel headed `Your code` under a menu
// entry reading `My QR code`.
//
// "Developer tools" was also the one of the three that could not be kept. The
// page says "no SDK" and names Zapier, Make and n8n in its first paragraph,
// so it is for anybody connecting a CRM; filing it under Developer tools
// tells a general contractor setting up a Zapier step that it is not for
// them, which is the reading error this repository already records about
// naming a screen after one CRM.
//
// Asserting the link against the page's own H1 means the two cannot drift,
// and a rename only has to be made in one place.
const DEV_NAME = (read("developers.html").match(/<h1>([^<]+)<\/h1>/) || [])[1];
ck("the developer page has a heading to be named after", !!DEV_NAME, String(DEV_NAME));
// A name is a name, not a sentence about what you can do with it.
ck("which is a name rather than a description",
  !!DEV_NAME && DEV_NAME.split(/\s+/).length <= 4, String(DEV_NAME));
// And the tab has to lead with it, or a row of open tabs names it a fourth way.
ck("and the title leads with the same name",
  read("developers.html").includes(`<title>${DEV_NAME}`), String(DEV_NAME));

for (const name of FOOTER_PAGES) {
  const foot = footerOf(read(name));
  ck(name, foot.includes(`<a href="developers.html">${DEV_NAME}</a>`),
    (foot.match(/<h4>Resources<\/h4>[\s\S]{0,200}/) || [""])[0].replace(/\s+/g, " ").slice(0, 120));
}

// The generated pages take the footer from the chrome slice, so a change to
// the site reaches all 71 of them -- but only after `npm run licensing` runs.
// Forgetting that leaves two thirds of the site's pages on last month's footer,
// which is silent: they render, and they are the pages a search engine sends
// people to.
console.log("\nincluding on the generated pages, which is a separate build");
{
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(join(dir, e.name))
      : e.name.endsWith(".html") ? [join(dir, e.name)] : []);
  const gen = walk("licensing");
  ck("there are generated pages", gen.length > 50, String(gen.length));
  // The link is relative and rewritten for depth, so what matters is whether it
  // RESOLVES -- not how many ../ it has. The first version of this counted the
  // path segments itself and got it wrong for every state hub, reporting 71
  // correct pages as broken. A test that recomputes what the generator already
  // computed is a second implementation to keep in step; resolving the href
  // against the file it sits in asks the only question worth asking.
  const bad = [];
  for (const f of gen) {
    const foot = footerOf(read(f));
    const m = foot.match(new RegExp(
      `<a href="((?:\\.\\./)*developers\\.html)">${DEV_NAME}</a>`));
    if (!m) { bad.push(`${f}: no link`); continue; }
    if (!existsSync(join(root, dirname(f), m[1]))) bad.push(`${f} -> ${m[1]}`);
  }
  ck("every one carries it, and it resolves from where that page sits",
    bad.length === 0, JSON.stringify(bad.slice(0, 3)));
}

console.log("\nand the grid has a column to put it in");
for (const name of FOOTER_PAGES) {
  const html = read(name);
  // Four columns now. A fifth <div> in a three-column grid wraps under the
  // brand blurb and reads as an orphan rather than a section.
  ck(name, /\.foot\{display:grid;grid-template-columns:1\.4fr 1fr 1fr 1fr;/.test(html));
}

console.log("\nthe audience pages link into it from the body");
for (const name of AUDIENCE) {
  const html = read(name);
  const body = html.slice(0, html.indexOf('<footer class="site">'));
  ck(name, /href="licensing\/"/.test(body));
}

console.log("\nthe crawler is told where to look");
const map = read("sitemap.xml");
ck("the root sitemap lists the hub",
  map.includes("<loc>https://subsub.work/licensing/</loc>"));
const robots = read("robots.txt");
ck("robots declares the root sitemap",
  robots.includes("Sitemap: https://subsub.work/sitemap.xml"));
// The generated sitemap is declared rather than merged: it is written from the
// same plan() the pages are, so it cannot list a page that does not exist. A
// hand-merged copy could, and would go stale the first time a state is added.
ck("robots declares the generated sitemap",
  robots.includes("Sitemap: https://subsub.work/licensing/sitemap.xml"));
ck("and the generated sitemap is actually there",
  existsSync(join(root, "licensing/sitemap.xml")));

console.log("\nnothing points at a page that is not there");
const dead = [];
for (const name of [...FOOTER_PAGES]) {
  for (const m of read(name).matchAll(/href="(licensing\/[^"]*)"/g)) {
    const target = join(root, m[1]);
    if (!existsSync(target.endsWith("/") ? join(target, "index.html") : target)) {
      dead.push(`${name} -> ${m[1]}`);
    }
  }
}
ck("every licensing link from the site resolves", dead.length === 0,
  JSON.stringify(dead.slice(0, 4)));

// ---- and the URLs the app links out to ---------------------------------
// The app is a separate bundle on a separate origin, so a link from it to the
// marketing site resolves or 404s with nothing in between -- no build step
// checks it and no test here would have noticed. The sign-in page's "Don't
// have an account?" is the only route into this product for somebody who typed
// the address in rather than being sent a link, so it is the worst one to get
// wrong.
console.log("\nand the app's links to this site land somewhere");
{
  const appSrc = readFileSync(join(root, "app/src/App.tsx"), "utf8");
  const outbound = [...appSrc.matchAll(/https:\/\/subsub\.work\/([A-Za-z0-9._\/-]*)/g)]
    .map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i);
  ck("the app links out at all", outbound.length > 0, JSON.stringify(outbound));

  const redirects = new Map();
  for (const line of readFileSync(join(root, "_redirects"), "utf8").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0].startsWith("/")) redirects.set(parts[0], parts[1]);
  }

  // Every path is a file in this repo, or a redirect to one -- and an
  // extensionless path counts, because Cloudflare Pages serves /pricing from
  // pricing.html. Modelling that here rather than demanding a redirect is the
  // whole lesson of this section: see below.
  const resolves = (p) => {
    const rel = p.replace(/^\/+/, "") || "index.html";
    const f = join(root, rel);
    return existsSync(f) || existsSync(f + ".html") || existsSync(join(f, "index.html"));
  };
  const broken = [];
  for (const path of outbound) {
    const p = "/" + path.replace(/^\/+/, "");
    const target = redirects.get(p) || p;
    if (!resolves(target)) broken.push(`${p}${redirects.has(p) ? ` -> ${target}` : ""}`);
  }
  ck("every one of them resolves to a page", broken.length === 0, JSON.stringify(broken));

  // Named outright, because this one is the signup funnel and a silent failure
  // on it looks exactly like nobody wanting to sign up.
  ck("the sign-up link is one of them",
    outbound.includes("pricing") || outbound.includes("pricing.html"),
    JSON.stringify(outbound));

  // AND THE RULE THAT REPLACED THE ONE THAT BROKE THE SITE.
  //
  // This used to assert the opposite -- that `/pricing` MUST have a redirect to
  // `/pricing.html`, added so the sign-up link would not "rest on a platform
  // default that is not in this repo". Pages' default turned out to be the
  // opposite of the assumption: it serves /pricing from pricing.html AND
  // redirects /pricing.html to /pricing. So the rule closed the circle, and the
  // pricing page answered "too many redirects occurred" until it was removed.
  //
  // A redirect whose target differs from its source only by ".html" is a loop,
  // whichever direction it is written in.
  const loops = [...redirects.entries()].filter(([from, to]) =>
    from.replace(/\.html$/, "") === to.replace(/\.html$/, ""));
  ck("no redirect differs from its source only by .html", loops.length === 0,
    JSON.stringify(loops));
}

console.log("\n-- the integrations tiers say what is true of each tier --");
{
  // A NAME IS A CLAIM, AND THE TIER DECIDES WHICH CLAIM IT IS.
  //
  // `SOURCE_PRESETS` already refuses to invent a receiver for a CRM whose real
  // payload nobody has seen -- "an integration that looks supported, fails on
  // first contact, and fails in the way that is hardest to debug". A NAME ON A
  // MARKETING PAGE IS A STRONGER CLAIM THAN A FIELD MAP, because nobody reads
  // the caveat under a list of names. So the Built-in tier is pinned to the
  // data rather than to whoever edited the HTML.
  //
  // Exact, in BOTH directions. A preset missing from the page is a receiver
  // nobody is told about; a name on the page with no preset is the failure
  // above with better typography. Checking only one direction would pass with
  // "ServiceTitan" sitting in that list.
  //
  // `generic` is excluded because it is not a system: it is the absence of
  // one, and it is the third tier's whole subject.
  const built = Object.entries(SOURCE_PRESETS)
    .filter(([id, p2]) => p2.verified && id !== "generic")
    .map(([id]) => id)
    .sort();
  ck("there is at least one built-in receiver to name", built.length > 0, built.join(","));

  for (const page of ["index.html", "developers.html"]) {
    const html = read(page);
    const named = [...html.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]).sort();
    ck(`${page} names exactly the verified presets as built in`,
      JSON.stringify(named) === JSON.stringify(built),
      `page: ${named.join(",") || "(none)"} | data: ${built.join(",")}`);

    // The tier LABELS, because the tiers are the honesty and a page that lost
    // them is a flat list of names again. Read case-insensitively: these are
    // uppercased by CSS on one page and not the other.
    const lower = html.toLowerCase();
    for (const tag of ["built in", "through an automation tool", "everything else"]) {
      ck(`${page} keeps the "${tag}" tier`, lower.includes(tag));
    }

    // The automation tier is only honest while it names tools that really do
    // reach SubSub today through the generic endpoint.
    for (const tool of ["Zapier", "Make", "n8n"]) {
      ck(`${page} names ${tool} as an automation route`, html.includes(`>${tool}<`));
    }
  }

  // AND THE TWO PAGES AGREE WORD FOR WORD ON THE TIER NAMES. Somebody arrives
  // at the developer page from the index, and a second vocabulary for one fact
  // reads as two different answers.
  const tagsOf = (page) =>
    [...read(page).matchAll(/class="(?:dev-)?int-tag">([^<]+)</g)].map((m) => m[1].trim());
  ck("both pages use the same three tier names, in the same order",
    JSON.stringify(tagsOf("index.html")) === JSON.stringify(tagsOf("developers.html")),
    `${tagsOf("index.html").join(" / ")} vs ${tagsOf("developers.html").join(" / ")}`);

  // The index sends somebody who wants the detail to the page that has it.
  ck("the index points at the CRM page", /href="developers\.html"/.test(read("index.html")));

  // THE NAMES ARE WHAT GETS SCANNED, so they line up across the three columns.
  // The paragraphs above them are different lengths, so the chip rows only
  // align because the card is a flex column pushing them to the bottom — and a
  // row that is almost aligned reads as a mistake rather than as a table.
  // Asserted as the mechanism, because the rendered position needs a browser
  // and this suite is static: `margin-top:auto` inside a flex column is the
  // whole of what does it, and either half alone does nothing.
  for (const [page, card, names] of [
    ["index.html", ".int{", ".int-names{"],
    ["developers.html", ".dev-int{", ".dev-int ul{"],
  ]) {
    const css = read(page);
    const rule = (sel) => (css.slice(css.indexOf(sel)).match(/^[^}]*\}/) || [""])[0];
    ck(`${page} lays the tier card out as a column`,
      /flex-direction:column/.test(rule(card)) && /display:flex/.test(rule(card)),
      rule(card).replace(/\s+/g, " ").slice(0, 90));
    ck(`${page} pushes the names to the bottom of it`,
      /margin:\s*auto 0 0/.test(rule(names)),
      rule(names).replace(/\s+/g, " ").slice(0, 90));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
