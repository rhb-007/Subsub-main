// A path list that misses a file is a change that does not ship and says
// nothing about it.
//
// The customer app and the staff console are ONE bundle built twice: same
// app/src, same app/shared, same index.html, same vite config, and only
// VITE_BUILD decides which comes out. So their two deploy workflows have to
// agree about which files a deploy depends on -- and they are separate files,
// edited months apart, by somebody fixing one of them.
//
// That is the same shape as schema.sql against the migrations, and it failed
// the same way: two records of one thing with nothing comparing them. The cost
// here is the one this repo has already paid once. A day of content changes
// went in, every deploy reported success, and none of it reached anybody --
// and the only symptom of a missing path entry is identical: green runs, an
// unchanged screen, and nothing anywhere saying a deploy did not happen.
//
// What this covers:
//
//   THE SHARED PATHS ARE THE SAME SET. Anything that is not admin-specific
//   and is not a workflow's own filename must appear in both.
//
//   EVERY PATTERN MATCHES SOMETHING ON DISK. A glob for a directory that was
//   renamed is a guard that can no longer fire, and it looks exactly like one
//   that can.
//
//   AND THE CUSTOMER DEPLOY NEVER SETS VITE_BUILD. App.tsx reads
//   VITE_BUILD === "platform", so setting it in deploy-app.yml would put the
//   staff sign-in in front of every customer. The workflow greps the built
//   bundle for that afterwards, which is the check that matters; this is the
//   cheaper one that says so before a runner is spent.
//
//   node --no-warnings scripts/deploypaths-test.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const read = (f) => readFileSync(resolve(root, ".github/workflows", f), "utf8");

// The push paths, read off the block rather than a YAML dependency this repo
// does not have. Anchored on `push:` so a `paths:` under something else -- a
// pull_request trigger, say -- cannot be mistaken for it.
function pushPaths(src) {
  const m = src.match(/\n  push:\n    paths:\n((?:      - "[^"]+"\n)+)/);
  if (!m) return null;
  return m[1].trim().split("\n").map((l) => l.trim().replace(/^- "/, "").replace(/"$/, ""));
}

const app = pushPaths(read("deploy-app.yml"));
const admin = pushPaths(read("deploy-admin.yml"));
const api = pushPaths(read("deploy-api.yml"));

ck("deploy-app.yml deploys on push", Array.isArray(app) && app.length > 0,
  app ? `${app.length} paths` : "no push.paths block");
ck("deploy-admin.yml deploys on push", Array.isArray(admin) && admin.length > 0);
ck("deploy-api.yml deploys on push", Array.isArray(api) && api.length > 0);

// Admin-specific files and each workflow's own filename are the legitimate
// differences. Everything else is the shared bundle.
const own = (p) => p.startsWith(".github/workflows/");
const adminOnly = (p) => /admin/.test(p);
const shared = (list) => [...new Set(list.filter((p) => !own(p) && !adminOnly(p)))].sort();

const a = shared(app || []);
const b = shared(admin || []);
ck("the customer app and the console agree on the shared source paths",
  a.join("|") === b.join("|"),
  a.join("|") === b.join("|") ? `${a.length} shared` :
    `only in app: [${a.filter((p) => !b.includes(p))}] · only in admin: [${b.filter((p) => !a.includes(p))}]`);

// Every workflow watches its own file, so an edit to a deploy ships through
// that deploy rather than waiting for an unrelated change to carry it.
for (const [f, list] of [["deploy-app.yml", app], ["deploy-admin.yml", admin], ["deploy-api.yml", api]]) {
  ck(`${f} watches itself`, (list || []).includes(`.github/workflows/${f}`));
}

// A pattern matching nothing is a guard that cannot fire.
const onDisk = (pat) => {
  const base = pat.replace(/\/\*\*$/, "");
  if (!existsSync(resolve(root, base))) return false;
  if (base !== pat) return readdirSync(resolve(root, base)).length > 0;
  return true;
};
for (const list of [app, admin, api]) {
  for (const pat of list || []) {
    if (own(pat)) continue;
    ck(`${pat} exists`, onDisk(pat));
  }
}

// The consequence of getting this one wrong is the whole product's front door.
const appSrc = read("deploy-app.yml");

// THE OUTAGE THIS PINS. api.js falls back to a relative "/api" so a dev build
// can let Vite proxy it. The customer app in production is static files on
// Pages with nothing behind them to proxy that, so "/api" hits the static site
// and every call 404s -- sign-in included, which presents as "Couldn't reach
// SubSub" and as every tenant subdomain wearing SubSub's own branding, because
// the branding lookup is one of the calls that cannot land.
//
// The console next door does NOT need this and that is exactly what hid it:
// worker-admin.js forwards /api/* over a service binding, so the same default
// is correct there. A workflow written by reading that one inherits the gap.
ck("the customer deploy sets VITE_API_BASE", /VITE_API_BASE/.test(appSrc));
ck("and proves it reached the bundle rather than trusting the variable",
  /grep -rqF "\$API_BASE" dist\/assets/.test(appSrc));
ck("and refuses a relative one, which is the default and the failure",
  /must be absolute/.test(appSrc));
ck("the customer deploy never sets VITE_BUILD",
  !/^\s+VITE_BUILD\s*:/m.test(appSrc));
ck("and it still proves what it built from the bundle",
  appSrc.includes('grep -rqF "SubSub internal console"'));

// The console deploy is the mirror: it MUST set it, or it deploys the
// customer app to the staff hostname.
ck("the console deploy does set VITE_BUILD", /^\s+VITE_BUILD\s*:/m.test(read("deploy-admin.yml")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
