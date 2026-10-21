// The "not available yet" page for branded addresses that are not live:
// shared/unclaimed.js (the rule and the page), worker-unclaimed.js (the route
// Worker) and GET /api/account-by-subdomain/:s/live (the one question it asks).
import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { launch } from "./lib/stub-stack.mjs";
import { hostDecision, unclaimedPage, PRICING_URL } from "../shared/unclaimed.js";
import { NEVER_PROVISION } from "../worker/hostnames.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const { default: unclaimed, decide } = await import("../worker-unclaimed.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

console.log("\n-- which hosts it looks at --");
const D = (h) => hostDecision(h, "subsub.work", NEVER_PROVISION);
for (const h of ["app.subsub.work", "api.subsub.work", "admin.subsub.work", "www.subsub.work", "subsub.work",
  "a.b.subsub.work", "outerhome.example.com"]) ck(`${h} passes straight through`, D(h).pass === true, JSON.stringify(D(h)));
ck("a branded address is checked, by its label", D("CascadeExteriors.subsub.work").sub === "cascadeexteriors");

console.log("\n-- the question it asks --");
{
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan,comped) VALUES
    ('a1','Outerhome','outerhome','general_contractor','scale',0),
    ('a2','Cascade Exteriors','cascadeexteriors','subcontractor','basic',0),
    ('a3','Comped Co','comped','general_contractor','basic',1);`);
  const env = { DB: makeD1(db) };
  const live = async (s) => {
    const r = await worker.fetch(new Request(`https://api.subsub.work/api/account-by-subdomain/${s}/live`), env);
    return [r.status, await r.json().catch(() => null)];
  };
  ck("a Scale account is live, with no sign-in", JSON.stringify(await live("outerhome")) === '[200,{"live":true}]', JSON.stringify(await live("outerhome")));
  ck("a comped account is live", (await live("comped"))[1]?.live === true);
  const basic = await live("cascadeexteriors"), nobody = await live("nobody-here");
  ck("a Basic account is not", basic[1]?.live === false, JSON.stringify(basic));
  ck("and answers exactly as a name nobody has", JSON.stringify(basic) === JSON.stringify(nobody), `${JSON.stringify(basic)} ${JSON.stringify(nobody)}`);

  // The route Worker, with the API behind its binding.
  const routeEnv = { API: { fetch: (req) => worker.fetch(req, env) } };
  const asked = [];
  const routeWith = (api) => ({ API: { fetch: async (req) => { asked.push(req.url); return api(req); } } });
  ck("a live address passes through to the app", await decide(new Request("https://outerhome.subsub.work/"), routeEnv) === "pass");
  ck("a Basic one gets the page", await decide(new Request("https://cascadeexteriors.subsub.work/"), routeEnv) === "page");
  ck("so does a name nobody has", await decide(new Request("https://nobody-here.subsub.work/x"), routeEnv) === "page");
  asked.length = 0;
  ck("app passes without asking anybody",
    await decide(new Request("https://app.subsub.work/"), routeWith(() => { throw new Error("x"); })) === "pass" && asked.length === 0);
  ck("the API down: it passes through rather than covering a customer",
    await decide(new Request("https://outerhome.subsub.work/"), routeWith(() => { throw new Error("down"); })) === "pass");
  ck("a 500: passes", await decide(new Request("https://x1.subsub.work/"), routeWith(() => new Response("no", { status: 500 }))) === "pass");
  ck("an answer it does not know: passes",
    await decide(new Request("https://x2.subsub.work/"), routeWith(() => Response.json({ maybe: 1 }))) === "pass");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("the app", { status: 200 });
  const through = await unclaimed.fetch(new Request("https://outerhome.subsub.work/"), routeEnv);
  ck("passing through hands the request on", (await through.text()) === "the app");
  globalThis.fetch = realFetch;
  const pg = await unclaimed.fetch(new Request("https://cascadeexteriors.subsub.work/"), routeEnv);
  const html = await pg.text();
  ck("the page is a 404 and not indexed", pg.status === 404 && /noindex/.test(pg.headers.get("X-Robots-Tag") || ""));
  ck("it names the address and nobody's company", /cascadeexteriors\.subsub\.work/.test(html) && !/Cascade Exteriors/.test(html));
}

console.log("\n-- the page --");
ck("a typed address cannot write markup into it", !/<script>/.test(unclaimedPage("<script>.subsub.work")));
{
  const browser = await launch();
  try {
    for (const [w, h] of [[390, 844], [1024, 768]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      await page.setRequestInterception(true);
      page.on("request", (r) => (r.url().startsWith("https://subsub.work/") ? r.respond({ status: 404, body: "" }) : r.continue()));
      await page.setContent(unclaimedPage("cascadeexteriors.subsub.work"));
      const m = await page.evaluate(() => {
        const cta = document.querySelector(".cta").getBoundingClientRect();
        return { text: document.body.innerText, href: document.querySelector(".cta").href,
          ctaBottom: cta.bottom, ctaHeight: cta.height, sw: document.documentElement.scrollWidth,
          bg: getComputedStyle(document.body).backgroundColor };
      });
      ck(`${w}px: it says 404 // Site under construction`, /404\s*\/\/\s*Site under construction/i.test(m.text), m.text.slice(0, 120));
      ck(`${w}px: Not available yet!`, /Not available yet!/.test(m.text));
      ck(`${w}px: it offers to claim a branded SubSub URL`, /Claim your branded SubSub URL/.test(m.text));
      ck(`${w}px: the sign-up button goes to pricing`, m.href === PRICING_URL);
      ck(`${w}px: and is on screen, a thumb tall`, m.ctaBottom <= h && m.ctaHeight >= 44, JSON.stringify(m));
      ck(`${w}px: no sideways scroll`, m.sw <= w, String(m.sw));
      ck(`${w}px: SubSub's forest, not white`, m.bg === "rgb(16, 53, 40)", m.bg);
      await page.close();
    }
  } finally { await browser.close(); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
