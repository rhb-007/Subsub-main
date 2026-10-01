// Build the comparison pages and the roundup.
//
//   npm run compare
//
// Reads content/compare/pages/*.md, writes compare/ and blog/ at the repo
// root, and writes compare/sitemap.xml from the same plan the pages are
// written from -- so it cannot list a page that does not exist. Generated
// output: wiped and rewritten, never hand-edited.
//
// IT PRINTS A REVIEW QUEUE, which is the half that matters. These pages name
// other companies' prices, and two of those companies do not publish one --
// Buildertrend and Procore are quoted -- so every figure here is a reading of
// somebody's pricing page on a particular day. A stale price is worse than no
// price, because it is read and believed, and "re-check quarterly" written in
// a README is a thing nobody does. So the review date is DATA, it is rendered
// on the page where a reader can weigh it, and `test:compare` fails once a
// page is past STALE_AFTER_DAYS. The same rule the licensing dataset runs on.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readChrome, atDepth } from "../../content/licensing/chrome.mjs";
import { parse, page, faqPairs } from "../../content/compare/render.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(root, "content/compare/pages");
export const STALE_AFTER_DAYS = 100; // a quarter, plus a fortnight to act on it
const SITE = "https://subsub.work";

// Where each source file lands. The URL is the directory, with an index.html
// inside it, which is how the licensing pages already work and needs no
// `_redirects` entry -- the extensionless rules in that file loop.
export function planOf(names) {
  return names.filter((f) => f.endsWith(".md")).sort().map((f) => {
    const slug = f.replace(/\.md$/, "");
    const dir = slug === "index" ? "compare"
      : slug.startsWith("subsub-vs-") ? `compare/${slug}`
        : `blog/${slug}`;
    return { file: f, dir, url: `${SITE}/${dir}/` };
  });
}

export function daysSince(iso, now = new Date()) {
  const then = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.floor((now - then) / 86400000);
}

export function build({ quiet = false } = {}) {
  const chrome = readChrome(join(root, "for-general-contractors.html"));
  const plan = planOf(readdirSync(SRC));
  const stale = [];

  for (const dir of ["compare", "blog"]) rmSync(join(root, dir), { recursive: true, force: true });

  for (const p of plan) {
    const { meta, body } = parse(readFileSync(join(SRC, p.file), "utf8"));
    const depth = p.dir.split("/").length;
    // A site-root link in the source (/compare/, /blog/...) has to become a
    // relative one, because these pages are served from a directory and the
    // chrome around them is rewritten the same way.
    const rewrite = (href) => (href.startsWith("/") && !href.startsWith("//")
      ? "../".repeat(depth) + href.replace(/^\//, "") : href);
    const html = page({
      meta, body, depth, rewrite,
      chrome: {
        css: chrome.css,
        icons: atDepth(chrome.icons, depth),
        fonts: chrome.fonts,
        header: atDepth(chrome.header, depth),
        footer: atDepth(chrome.footer, depth),
      },
      canonical: p.url,
      faq: faqPairs(body),
      reviewed: new Date(`${meta.updated}T00:00:00Z`)
        .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
    mkdirSync(join(root, p.dir), { recursive: true });
    writeFileSync(join(root, p.dir, "index.html"), html);
    const age = daysSince(meta.updated);
    if (age > STALE_AFTER_DAYS) stale.push({ url: p.url, age });
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${plan.map((p) => {
    const { meta } = parse(readFileSync(join(SRC, p.file), "utf8"));
    return `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${meta.updated}</lastmod>\n`
      + "    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>";
  }).join("\n")}
</urlset>
`;
  writeFileSync(join(root, "compare/sitemap.xml"), sitemap);

  if (!quiet) {
    console.log(`Wrote ${plan.length} pages and compare/sitemap.xml`);
    for (const p of plan) console.log(`  ${p.url}`);
    if (stale.length) {
      console.log("\nREVIEW QUEUE -- these name competitors' prices and are past due:");
      for (const s of stale) console.log(`  ${s.url}  (${s.age} days since it was checked)`);
      console.log("\nRe-read each vendor's pricing page, correct the figures, and move");
      console.log("`updated:` on in the source file. Buildertrend and Procore do not");
      console.log("publish pricing, so those two are ranges and need the most care.");
    } else {
      console.log("\nEvery page is within its review window.");
    }
  }
  return { plan, stale };
}

if (import.meta.url === `file://${process.argv[1]}`) build();
