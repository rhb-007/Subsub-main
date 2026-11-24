// subsub.work's front door (site-worker.js): plain HTTP and www are sent to
// https://subsub.work, and every answer carries HSTS and the security headers.
// deploy-site.yml asks the live site the same questions after each deploy.
//
//   node --no-warnings scripts/site-security-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { HSTS, SECURITY_HEADERS } from "../../site-worker.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ck = (name, ok, detail = "") => {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); }
};
const asked = [];
const env = { ASSETS: { fetch: async (req) => {
  asked.push(req.url);
  return new Response("<html>page</html>", { status: 200, headers: { "Content-Type": "text/html" } });
} } };
const go = (url) => worker.fetch(new Request(url), env);

console.log("\n-- plain HTTP --");
{
  const r = await go("http://subsub.work/pricing?x=1");
  ck("is a permanent redirect", r.status === 301, String(r.status));
  ck("to the same page over HTTPS, query kept", r.headers.get("Location") === "https://subsub.work/pricing?x=1",
    r.headers.get("Location"));
  ck("and never reaches the files", asked.length === 0);
}
console.log("\n-- www --");
{
  const r = await go("https://www.subsub.work/for-subcontractors");
  ck("goes to subsub.work", r.status === 301 && r.headers.get("Location") === "https://subsub.work/for-subcontractors",
    r.headers.get("Location"));
  const h = await go("http://www.subsub.work/");
  ck("and plain-HTTP www goes there in one hop", h.headers.get("Location") === "https://subsub.work/", h.headers.get("Location"));
}
console.log("\n-- HTTPS --");
{
  const r = await go("https://subsub.work/");
  ck("is served", r.status === 200 && (await r.text()).includes("page"));
  ck("with HSTS for a year", r.headers.get("Strict-Transport-Security") === HSTS && /max-age=31536000/.test(HSTS));
  ck("which makes no promise about other subdomains", !/includeSubDomains|preload/.test(HSTS));
  for (const k of Object.keys(SECURITY_HEADERS)) ck(`and ${k}`, r.headers.get(k) === SECURITY_HEADERS[k], r.headers.get(k));
  ck("the page type is kept", r.headers.get("Content-Type") === "text/html");
  ck("the CSP upgrades insecure requests and refuses framing",
    /upgrade-insecure-requests/.test(SECURITY_HEADERS["Content-Security-Policy"])
      && /frame-ancestors 'self'/.test(SECURITY_HEADERS["Content-Security-Policy"]));
}
console.log("\n-- local preview --");
{
  const r = await go("http://localhost:8788/");
  ck("is not redirected", r.status === 200);
}
console.log("\n-- the config --");
{
  const cfg = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  ck("the Worker is the site's main", /"main":\s*"site-worker\.js"/.test(cfg));
  ck("and runs before the files", /"run_worker_first":\s*true/.test(cfg));
  ck("with the ASSETS binding it reads", /"binding":\s*"ASSETS"/.test(cfg));
  const wf = readFileSync(join(root, ".github/workflows/deploy-site.yml"), "utf8");
  ck("a change to it deploys the site", wf.includes('"site-worker.js"'));
  ck("and the deploy checks the live redirect and HSTS", /strict-transport-security/i.test(wf) && /http:\/\/subsub\.work/.test(wf));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
