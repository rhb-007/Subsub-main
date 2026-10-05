// What subsub.work publishes, checked before anything deploys.
//
// The marketing site is a Worker serving the repository ROOT as static files,
// so without .assetsignore it publishes the whole repository: the app's source,
// the Worker, every migration, CLAUDE.md. The ignore file is an allow-list, and
// this suite applies it exactly the way wrangler does -- the same `ignore`
// package, the same three default patterns, the same recursive walk -- to the
// tree as it actually is, then checks both directions:
//
//   * nothing private is published, by name AND by shape (every published path
//     must be a site file), because a list of names would only catch the files
//     somebody thought of;
//   * nothing the site links to is held back, because an allow-list that is too
//     tight is a broken stylesheet or a missing hero image on the live page.
//
//   node --no-warnings scripts/site-assets-test.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ignore from "ignore";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const rules = readFileSync(join(root, ".assetsignore"), "utf8");
// wrangler's own defaults, then the file's lines -- see createAssetsIgnoreFunction.
const ig = ignore().add(["/.assetsignore", "/_redirects", "/_headers", ...rules.split("\n")]);
const ignored = (p) => ig.test(p).ignored;

// The walk wrangler does: readdir recursive, files only. node_modules and .git
// are walked too, as they would be in a build that installed dependencies.
const files = readdirSync(root, { recursive: true })
  .map((p) => p.split("\\").join("/"))
  .filter((p) => { try { return statSync(join(root, p)).isFile(); } catch { return false; } });
const published = files.filter((p) => !ignored(p));
const set = new Set(published);

console.log("\n-- nothing private --");
for (const p of ["CLAUDE.md", "EASY-PAY.md", "LAUNCH.md", "README.md", "wrangler.jsonc",
  "app/worker/index.js", "app/worker/migrations/CHECK.sql", "app/worker/schema.sql",
  "app/package.json", "app/src/App.tsx", "app/index.html", "content/compare/pages/subsub-vs-procore.md",
  "zapier/index.js", "zapier/.zapierapprc", ".github/workflows/deploy-site.yml", ".git/config",
  "app/node_modules/react/package.json", "app/dist/index.html"]) {
  ck(`${p} is not published`, ignored(p));
}
// BY SHAPE, which is the assertion a new private file cannot slip past: every
// published path is a root-level site file or lives under one of the three
// generated sections.
const SITE = /^(?:[^/]+\.(?:html|png|webp|ico|svg|webmanifest)|robots\.txt|sitemap\.xml|(?:licensing|compare|blog)\/.+)$/;
const stray = published.filter((p) => !SITE.test(p));
ck("everything published is a site file", stray.length === 0, stray.slice(0, 8).join(", "));
const markdown = published.filter((p) => /\.(md|js|mjs|ts|tsx|sql|json|jsonc|yml|toml)$/.test(p));
ck("no source, notes or config of any kind", markdown.length === 0, markdown.slice(0, 8).join(", "));

console.log("\n-- nothing the site needs is held back --");
for (const p of ["index.html", "404.html", "pricing.html", "developers.html", "hero-crew.webp",
  "hero-crew@2x.png", "favicon.ico", "favicon.svg", "og-image.png", "site.webmanifest",
  "robots.txt", "sitemap.xml", "licensing/index.html", "compare/index.html", "compare/sitemap.xml"]) {
  ck(`${p} is published`, set.has(p));
}
ck("every generated licensing page is published",
  files.filter((p) => p.startsWith("licensing/")).every((p) => set.has(p)));
ck("every comparison page and article is published",
  files.filter((p) => p.startsWith("compare/") || p.startsWith("blog/")).every((p) => set.has(p)));

// Every local file a root page points at -- a stylesheet, an image, another
// page -- has to be in what goes up, or the live page breaks.
const missing = [];
for (const page of files.filter((p) => /^[^/]+\.html$/.test(p))) {
  const html = readFileSync(join(root, page), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    let u = m[1].split("#")[0].split("?")[0];
    if (!u || /^(?:[a-z]+:|\/\/)/i.test(u)) continue;
    u = u.replace(/^\.?\//, "");
    const target = u.endsWith("/") ? `${u}index.html` : u;
    // Extensionless links are _redirects' business and not files.
    if (!/\.[a-z0-9]+$/i.test(target)) continue;
    if (existsSync(join(root, target)) && !set.has(target)) missing.push(`${page} -> ${target}`);
  }
}
ck("nothing a page links to is held back", missing.length === 0, missing.slice(0, 8).join(", "));
ck("and the published set is not empty", published.length > 50, String(published.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
