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

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let pass = 0, fail = 0;
const ck = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  ok  ${name}${detail ? `  -- ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

// Every page that carries the site footer. get-started.html is Disallow'd and
// 404.html is not a page anybody links to, so neither carries one.
const FOOTER_PAGES = ["index.html", "pricing.html", "book-a-demo.html",
  "for-general-contractors.html", "for-property-managers.html",
  "for-building-owners.html", "for-portfolio-managers.html",
  "privacy-policy.html", "terms-of-use.html"];

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

console.log("\nthe footer carries it, on every page that has a footer");
for (const name of FOOTER_PAGES) {
  const html = read(name);
  const foot = footerOf(html);
  ck(name, /<h4>Resources<\/h4>/.test(foot) && /href="licensing\/"/.test(foot));
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
