// THE FREE TOOLS AND THE REFERRAL COOKIE ON THE MARKETING SITE.
//
// Static half, run anywhere: one page per state for each tool, each with its
// own title and description; the sitemaps list exactly what was built; every
// page carries the legal line and the data's date; a state SubSub cannot
// check live never draws the live form; the referral snippet on the
// hand-written pages is the generated one, byte for byte.
//
// Browser half: the pages served as files, against a stubbed API. The check
// goes number -> preview -> email -> full record; a name lists matches; a
// state that is not live offers its own board and a notify; the calculator
// answers as the shared module does, including NO for a trade; a ?ref= link
// writes the cookie on the parent domain and counts the arrival.
//
//   node --no-warnings scripts/site-tools-test.mjs

import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serveApi, tally, wait } from "./lib/stub-stack.mjs";
import { plan } from "./build-tools.mjs";
import { REF_SNIPPET } from "../../content/tools/ref.mjs";
import { CODE_ALPHABET, REF_COOKIE, REF_COOKIE_DAYS, SUB_CASH_CENTS } from "../shared/referral.js";
import { FLYER_REFER_HEAD, FLYER_REFER_BODY, flyerHtml } from "./build-assets.mjs";
import { US_STATES } from "../shared/states.js";
import { HANDYCAP_AS_OF } from "../shared/handycap.js";
import { asOfLabel } from "../shared/handytool.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const t = tally();
const read = (p) => readFileSync(join(root, p), "utf8");

console.log("\n-- the pages, on disk --");
{
  const pages = plan();
  t.ck("a hub and 51 state pages for each tool", pages.length === 104
    && pages.filter((p) => p.dir.startsWith("check/")).length === 51
    && pages.filter((p) => p.dir.startsWith("handyman-limits/")).length === 51);
  const missing = pages.filter((p) => !existsSync(join(root, p.dir, "index.html")));
  t.ck("every planned page was built (run npm run tools)", missing.length === 0, missing.map((p) => p.dir).slice(0, 5).join(", "));
  const titles = new Map(), descs = new Map();
  for (const p of pages) {
    if (!existsSync(join(root, p.dir, "index.html"))) continue;
    const h = read(`${p.dir}/index.html`);
    const title = (h.match(/<title>([^<]+)<\/title>/) || [])[1];
    const desc = (h.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    titles.set(title, (titles.get(title) || 0) + 1);
    descs.set(desc, (descs.get(desc) || 0) + 1);
  }
  t.ck("every page has its own title", [...titles.values()].every((n) => n === 1) && titles.size === 104,
    [...titles].filter(([, n]) => n > 1).map(([k]) => k).slice(0, 3).join(" | "));
  t.ck("and its own description", [...descs.values()].every((n) => n === 1) && descs.size === 104,
    [...descs].filter(([, n]) => n > 1).map(([k]) => k).slice(0, 3).join(" | "));
  const wa = read("handyman-limits/wa/index.html");
  t.ck("a state page leads with that state's own figure", /a handyman can take on jobs up to \$500/.test(wa)
    && /L&amp;I contractor registration/.test(wa));
  const tx = read("handyman-limits/tx/index.html");
  t.ck("and a state that licenses nobody says so rather than naming a figure", /does not license contractors at the state level/.test(tx));
  const allCalc = pages.filter((p) => p.dir.startsWith("handyman-limits"));
  t.ck("every calculator page says it is not legal advice",
    allCalc.every((p) => /Not legal advice\.<\/b> Verify with your state licensing board/.test(read(`${p.dir}/index.html`))));
  t.ck("and when its data was last updated",
    allCalc.every((p) => read(`${p.dir}/index.html`).includes(`Data last updated ${asOfLabel(HANDYCAP_AS_OF)}`)),
    asOfLabel(HANDYCAP_AS_OF));
  const or = read("check/or/index.html");
  t.ck("a state SubSub cannot check live draws no live form", !/id="tlQuery"/.test(or) && /id="tlCheck"/.test(or));
  t.ck("and names its own board's lookup", /Oregon Construction Contractors Board|CCB|ccb/i.test(or) && /rel="noopener"/.test(or));
  t.ck("Washington's draws the live form", /id="tlQuery"/.test(read("check/wa/index.html")));
  t.ck("no page claims a registry check outside Washington",
    pages.filter((p) => p.dir.startsWith("check/") && p.dir !== "check/wa").every((p) => !/verified against the state registry/i.test(read(`${p.dir}/index.html`))));
  for (const d of ["check", "handyman-limits"]) {
    const sm = read(`${d}/sitemap.xml`);
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const want = pages.filter((p) => p.dir === d || p.dir.startsWith(`${d}/`)).map((p) => p.url);
    t.ck(`${d}/sitemap.xml lists exactly what was built`, JSON.stringify(locs.sort()) === JSON.stringify(want.sort()));
  }
  const robots = read("robots.txt");
  t.ck("robots.txt declares both sitemaps", robots.includes("Sitemap: https://subsub.work/check/sitemap.xml")
    && robots.includes("Sitemap: https://subsub.work/handyman-limits/sitemap.xml"));
  const sm = read("sitemap.xml");
  t.ck("the root sitemap lists both hubs", sm.includes("<loc>https://subsub.work/check/</loc>") && sm.includes("<loc>https://subsub.work/handyman-limits/</loc>"));
  const footless = ["index.html", "pricing.html", "get-started.html", "for-subcontractors.html", "404.html"]
    .filter((f) => !read(f).includes('href="check/"') || !read(f).includes('href="handyman-limits/"'));
  t.ck("the footer links both tools", footless.length === 0, footless.join(", "));
  t.ck("the publish allow-list carries both directories",
    read(".assetsignore").includes("!/check/**") && read(".assetsignore").includes("!/handyman-limits/**"));
}

console.log("\n-- the referral snippet is one thing --");
{
  t.ck("its alphabet, cookie and life are the shared module's",
    REF_SNIPPET.includes(`^[${CODE_ALPHABET}]{8}$`) && REF_SNIPPET.includes(`'${REF_COOKIE}='`)
    && REF_SNIPPET.includes(`max-age=${REF_COOKIE_DAYS * 86400}`));
  const hand = ["get-started.html", "pricing.html", "gc.html", "subs.html"].filter((f) => existsSync(join(root, f)));
  const off = hand.filter((f) => !read(f).includes(REF_SNIPPET));
  t.ck("every hand-written page carries the generated snippet byte for byte", hand.length >= 2 && off.length === 0,
    `${hand.join(",")} | differs: ${off.join(",")}`);
  t.ck("and the generated pages do too", read("check/index.html").includes(REF_SNIPPET) && read("handyman-limits/wa/index.html").includes(REF_SNIPPET));
  const gs = read("get-started.html");
  t.ck("the signup form sends the cookie and the typed code", /referral: ssReadRef\(\)/.test(gs) && /refCode:/.test(gs) && /id="refCode"/.test(gs));
}

console.log("\n-- the referral money, on the flyer and on /subs --");
{
  // The flyer prints one line about the $100 and sends people to /subs for
  // the terms, because a flyer cannot change when the offer does. Both read
  // the amount off the constant the ledger pays, and both say the GC has to
  // start PAYING: "$100 for every GC you bring" would promise money on
  // signups the ledger never pays.
  const amount = `$${SUB_CASH_CENTS / 100}`;
  const flyer = flyerHtml();
  t.ck("the flyer names the amount the ledger pays", FLYER_REFER_HEAD.includes(amount) && FLYER_REFER_BODY.includes(amount)
    && flyer.includes(FLYER_REFER_HEAD) && flyer.includes(FLYER_REFER_BODY));
  t.ck("and pays on the GC starting to pay, never on a signup", /starts paying/.test(FLYER_REFER_BODY) && !/sign(s|ed)? ?up/i.test(FLYER_REFER_BODY), FLYER_REFER_BODY);
  t.ck("and points at the page that holds the terms", FLYER_REFER_BODY.includes("Terms at subsub.work/subs"));
  const subs = read("subs.html");
  const terms = (subs.match(/<section class="tl-card" id="refer">[\s\S]*?<\/section>/) || [""])[0];
  t.ck("/subs carries the terms the flyer points at (run npm run tools)", !!terms);
  t.ck("with the same amount, and only that amount", terms.includes(amount) && (terms.match(/\$\d+/g) || []).every((m) => m === amount), terms.match(/\$\d+/g)?.join(","));
  t.ck("saying a signup alone earns nothing", /has to start paying/.test(terms) && /pays for SubSub for the first time/.test(terms));
  t.ck("and how long a link is remembered, off the cookie's own life", terms.includes(`remembered for ${REF_COOKIE_DAYS} days`));
  t.ck("and that it has to be a company that hires", /has to be a company that hires/.test(terms) && /Another sub signing up does not count/.test(terms));
}

console.log("\n-- in a browser --");
const WEB = 5457, API = 9157;
const MIME = { ".html": "text/html", ".xml": "application/xml", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon" };
const site = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = join(root, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  else if (!existsSync(f) && existsSync(f + ".html")) f = f + ".html";
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(WEB);
const posts = [];
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "POST") posts.push({ path, body });
  if (path === "/api/referrals/touch") return [200, { ok: true, from: "Bay Roofing", kind: "sub" }];
  if (path === "/api/public/leads") return [200, { ok: true }];
  if (path === "/api/public/license-lookup") {
    if (body.name) return [200, { state: "WA", source: "Washington State L&I", matches: [
      { name: "BAY ROOFING LLC", license: "BAYRR*222", city: "TACOMA" }, { name: "BAY VIEW HOMES", license: "BAYVH*111", city: null }] }];
    if (!body.email) return body.license === "NOPE*1"
      ? [200, { state: "WA", found: false, preview: null }]
      : [200, { state: "WA", found: true, preview: { name: "BAY ROOFING LLC", license: body.license, city: "TACOMA" } }];
    return [200, { state: "WA", source: "Washington State L&I", leadSaved: true,
      verdict: { tone: "ok", head: "Active registration", why: "Good through 2027-01-02, according to the state." },
      full: { found: true, name: "BAY ROOFING LLC", license: body.license, status: "ACTIVE", active: true,
        licenseType: "Construction Contractor", expirationDate: "2027-01-02",
        bond: { surety: "Western Surety", amount: 15000, expires: "2027-01-02" },
        insurance: { carrier: "Cascade Mutual", coverage: 1000000, expires: "2027-03-01" } } }];
  }
  return undefined;
} });
const browser = await launch();
const open = async (path, width = 1200) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 1400 });
  await page.evaluateOnNewDocument((api) => { window.SUBSUB_API = api; }, `http://127.0.0.1:${API}/api`);
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e.message || e)));
  await page.goto(`http://www.subsub.work:${WEB}${path}`, { waitUntil: "domcontentloaded" });
  await wait(700);
  return { ctx, page, crashes };
};
const setVal = (page, sel, v) => page.evaluate(({ sel, v }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  if (el.tagName === "SELECT") el.value = v;
  else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}, { sel, v });
const result = (page, sel = "#tlResult") => page.evaluate((s) => (document.querySelector(s)?.innerText || "").replace(/\s+/g, " "), sel);
const submit = (page, sel) => page.evaluate((s) => { const f = document.querySelector(s); f?.requestSubmit ? f.requestSubmit() : f?.submit(); }, sel);

try {
  console.log("\n-- the checker, Washington --");
  {
    const { ctx, page, crashes } = await open("/check/wa/?ref=k7q2-mxrb");
    const cookie = await page.evaluate(() => document.cookie);
    t.ck("a ?ref link writes the last-touch cookie", /ss_ref=K7Q2MXRB\.link\.\d{10}/.test(cookie), cookie);
    t.ck("and counts the arrival", posts.some((p) => p.path === "/api/referrals/touch" && p.body.code === "K7Q2MXRB" && p.body.channel === "link"));
    await setVal(page, "#tlQuery", "BAYRR*222"); await submit(page, "#tlCheck"); await wait(700);
    let r = await result(page);
    t.ck("a number finds the record and names it", /Found: BAY ROOFING LLC/.test(r) && /Registration #BAYRR\*222/.test(r), r);
    t.ck("and holds the status back behind an email", !/ACTIVE|Western Surety/.test(r) && !!(await page.$("#tlGate")));
    await setVal(page, "#tlEmail", "gc@build.test"); await submit(page, "#tlGate"); await wait(700);
    r = await result(page);
    const sent = posts.filter((p) => p.path === "/api/public/license-lookup" && p.body.email);
    t.ck("the email goes with the number, and the referral code", sent.length === 1 && sent[0].body.license === "BAYRR*222"
      && sent[0].body.ref === "K7Q2MXRB", JSON.stringify(sent));
    t.ck("then the full record: status, expiry, bond, insurance", /Active registration/.test(r) && /Expires 2027-01-02/.test(r)
      && /Western Surety · \$15,000 · until 2027-01-02/.test(r) && /Cascade Mutual · \$1,000,000/.test(r), r);
    t.ck("and it says where the data came from and to confirm it with the state", /From Washington State L&I, checked today/.test(r) && /confirm it/.test(r));
    await page.evaluate(() => { document.querySelector('input[name=tlMode][value=name]').click(); });
    await setVal(page, "#tlQuery", "Bay"); await submit(page, "#tlCheck"); await wait(700);
    r = await result(page);
    t.ck("a name lists the matches to pick from", /2 matches/.test(r) && /BAY VIEW HOMES/.test(r), r);
    await page.evaluate(() => document.querySelector("#tlResult button[data-i='1']")?.click()); await wait(400);
    t.ck("and picking one goes to the same gate", /Found: BAY VIEW HOMES/.test(await result(page)));
    await page.evaluate(() => { document.querySelector('input[name=tlMode][value=license]').click(); });
    await setVal(page, "#tlQuery", "NOPE*1"); await submit(page, "#tlCheck"); await wait(700);
    t.ck("a number the state does not know is a plain no", /No Washington record for that number/.test(await result(page)));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  console.log("\n-- the checker, a state that is not live --");
  {
    const { ctx, page, crashes } = await open("/check/or/");
    let r = await result(page);
    t.ck("it says Oregon is not live and links its own board", /Oregon is not live yet/.test(r)
      && !!(await page.$("#tlResult a[href^='http']")), r);
    await setVal(page, "#tlNotifyEmail", "pm@flats.test"); await submit(page, "#tlNotify"); await wait(600);
    const lead = posts.filter((p) => p.path === "/api/public/leads").pop();
    t.ck("asking to be told posts a lead tagged with the tool and the state",
      lead?.body.tool === "check" && lead.body.state === "OR" && lead.body.detail?.notifyWhenLive === true, JSON.stringify(lead));
    t.ck("and says so", /We.ll email you when Oregon is live/.test(await result(page)));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  console.log("\n-- the calculator --");
  {
    const { ctx, page, crashes } = await open("/handyman-limits/wa/");
    await setVal(page, "#tlValue", "400"); await wait(200);
    let r = await result(page, "#tlCalcOut");
    t.ck("$400 of general repairs in Washington is under the limit", /Yes — under the state's handyman limit/.test(r), r);
    t.ck("and still says Washington's own caveat", /Exemption void if you advertise/.test(r));
    await setVal(page, "#tlValue", "800"); await wait(200);
    r = await result(page, "#tlCalcOut");
    t.ck("$800 is over it, by how much", /No — over/.test(r) && /\$300 over/.test(r), r);
    await setVal(page, "#tlValue", "100"); await setVal(page, "#tlType", "plumbing"); await wait(200);
    r = await result(page, "#tlCalcOut");
    t.ck("plumbing is a no at any amount", /No — this trade needs its own license/.test(r), r);
    await setVal(page, "#tlCalcEmail", "pm@flats.test"); await submit(page, "#tlEmailForm"); await wait(600);
    const lead = posts.filter((p) => p.path === "/api/public/leads").pop();
    t.ck("the email posts a lead with the question", lead?.body.tool === "handyman_limits" && lead.body.state === "WA"
      && lead.body.detail?.jobValue === 100 && lead.body.detail?.jobType === "plumbing", JSON.stringify(lead));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  {
    const { ctx, page, crashes } = await open("/handyman-limits/");
    t.ck("the hub starts with no state chosen", /Choose a state to see its limit/.test(await result(page, "#tlCalcOut")));
    await setVal(page, "#tlState", "TX"); await setVal(page, "#tlValue", "50000"); await wait(200);
    t.ck("Texas hands the question to the city", /No state license needed — check your city and county/.test(await result(page, "#tlCalcOut")));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  console.log("\n-- the landing pages --");
  {
    for (const [path, href] of [["/subs", "get-started.html?as=subcontractor"], ["/gc", "pricing.html"]]) {
      const { ctx, page, crashes } = await open(path);
      const ctas = await page.evaluate(() => [...document.querySelectorAll("main a.tl-btn")].map((a) => a.getAttribute("href")));
      t.ck(`${path} has one call to action`, ctas.length === 1 && ctas[0] === href, JSON.stringify(ctas));
      t.ck(`${path}: no page error`, crashes.length === 0, crashes.join(" | "));
      await ctx.close();
    }
    const { ctx, page } = await open("/gc?ref=K7Q2MXRB");
    await wait(500);
    const from = await page.evaluate(() => { const el = document.querySelector("[data-ref-from]"); return el && !el.hidden ? el.innerText : ""; });
    t.ck("a referral link names who invited them", from === "Bay Roofing invited you to SubSub.", from);
    const plain = await open("/gc");
    t.ck("and with no referral says nothing", await plain.page.evaluate(() => document.querySelector("[data-ref-from]")?.hidden === true));
    await plain.ctx.close();
    // A Passport's CTA lands here with &via=passport, and that is the channel
    // the cookie and the count carry -- crediting it as a plain link would
    // lose which of the sub's doors brought the GC in.
    const pass = await open("/gc?ref=K7Q2MXRB&via=passport");
    await wait(300);
    const pc = await pass.page.evaluate(() => document.cookie);
    t.ck("a Passport's CTA writes the passport channel", /ss_ref=K7Q2MXRB\.passport\.\d{10}/.test(pc), pc);
    t.ck("and counts it as one", posts.some((p) => p.path === "/api/referrals/touch" && p.body.channel === "passport"));
    const odd = await open("/gc?ref=K7Q2MXRB&via=claim");
    t.ck("any other via is a plain link", /ss_ref=K7Q2MXRB\.link\./.test(await odd.page.evaluate(() => document.cookie)));
    await pass.ctx.close(); await odd.ctx.close();
    await ctx.close();
  }

  console.log("\n-- on a phone --");
  for (const path of ["/check/", "/check/wa/", "/handyman-limits/", "/handyman-limits/wa/", "/subs", "/gc"]) {
    const { ctx, page } = await open(path, 390);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t.ck(`${path} does not scroll sideways at 390px`, over <= 1, `${over}px`);
    await ctx.close();
  }
} finally {
  await browser.close();
  site.close(); api.close();
}
t.done();
