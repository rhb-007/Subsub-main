// Lien waivers on screen: the link a supplier opens, and the hiring side
// asking for one from the work order.
//
// The server suite (test:lienwaiver) proves the rules. This one proves the
// pieces can be REACHED and say the right thing, which is the failure this
// project keeps recording: correct routes behind a screen nobody can get to.
//
//   * THE PREVIEW FOLLOWS THE DECLARATION. Section 5 of the document is the
//     signer's own sworn answer, and the hash is of the text with it in. A
//     page that showed the placeholder while recording "labor only" would be
//     showing one document and signing another.
//
//   * A STATUTORY STATE SHOWS NO GENERATED TEXT. It names the state and asks
//     for the state's own form, uploaded.
//
//   * WHAT IS SENT IS ASSERTED, not what is drawn: the body of the sign call
//     and the query of the upload, because a button that draws correctly and
//     posts the wrong declaration is the bug.
//
//   * THE HIRING SIDE CAN ASK FROM THE WORK ORDER, and cannot pick an
//     unconditional waiver before the money.
//
//   node --no-warnings scripts/lien-waiver-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { renderWaiver } from "../shared/waiverform.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-lienwaiver-test");
const WEB = 5351, API = 9047;
const t = tally();

const parties = { claimant: "ABC Supply — Ballard", customer: "Pacific Roofing",
  job: "Re-roof Press Apartments", property: "Press Apartments, 1620 Belmont, Seattle, WA 98122" };
const base = (over = {}) => {
  const w = { id: "lw_1", kind: "conditional_progress", tier: 1, status: "requested",
    title: "Conditional Waiver and Release on Progress Payment",
    amountCents: 0, throughDate: "2026-10-02", governingState: "WA", scopeKind: null,
    source: "subsub_standard", claimant: parties.claimant, customer: parties.customer,
    job: parties.job, property: parties.property, signedAt: null, signedByName: null,
    forms: { state: "WA", statutory: false, sources: ["subsub_standard", "uploaded"] },
    declaredCount: 0, ...over };
  w.document = w.source === "subsub_standard"
    ? renderWaiver({ kind: w.kind, parties, amountCents: w.amountCents, throughDate: w.throughDate, state: w.governingState })
    : null;
  return w;
};

let LINK = { tok_wa: base(), tok_ca: base({ id: "lw_2", tier: 0, source: "uploaded", governingState: "CA",
  amountCents: 500000, claimant: "Pacific Roofing", customer: "Alder Construction",
  forms: { state: "CA", statutory: true, sources: ["uploaded"], reason: "statutory_text_not_loaded" } }),
  tok_sub: base({ id: "lw_3", tier: 0, amountCents: 380000, claimant: "Pacific Roofing", customer: "Alder Construction" }),
  tok_unc: base({ id: "lw_4", tier: 0, kind: "unconditional_progress",
    title: "Unconditional Waiver and Release on Progress Payment", claimant: "Pacific Roofing",
    customer: "Alder Construction", amountCents: 380000 }) };
const sent = [];

// The hiring side's fixtures.
const acct = () => ({
  id: "acc_gc", name: "Alder Construction", subdomain: "alder", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_a", name: "Chris Lane", email: "chris@alder.test", role: "admin" },
});
const verified = { status: "verified", checks: {}, limits: {} };
const SUBS = () => [{
  id: "cmp_sub", engagementId: "en_1", accountId: "acc_gc", company: "Pacific Roofing", contact: "Juan Soto",
  phone: "(206)555-0100", email: "juan@pacific.test", city: "Seattle", state: "WA", zip: "98122",
  license: "PACIFRC123", licenseCheck: null,
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [], warranty: null,
  insurance: 1, bond: 1, contract: 1, w9: 1, docFiles: {}, notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0, notes: "",
  status: "active", propertyIds: [], hasPortal: true, answersForItself: true, autoSchedule: false,
  engagedAs: "subcontractor", docs: {}, docState: "current", docAssignable: true, docSoonest: null,
}];
const JOBS = () => [{
  id: "job_1", accountId: "acc_gc", title: "Re-roof Press Apartments", address: "1620 Belmont",
  area: "Seattle", zip: "98122", propertyId: "p_wa", date: "2026-09-01", time: "09:00",
  trades: ["roofing"], status: "active", severity: null, notes: "", sqft: null, stories: null,
  materialsBy: null, createdAt: "2026-09-01", requestedBy: null, approvedAt: "2026-09-01",
  withdrawnAt: null, completedAt: null, measurementDocs: [], readOnly: false, scope: "",
  assignments: { roofing: { id: "wo_1", subId: "cmp_sub", company: "Pacific Roofing", wo: "WO-1001",
    value: 1000000, status: "accepted", crewName: "Crew 1", payKind: "fixed" } },
}];
let RELEASE_WAIVERS = { forms: { state: "WA", statutory: false, sources: ["subsub_standard", "uploaded"] },
  state: "WA", paid: false, isFinal: false, suggestedKind: "conditional_progress",
  claimant: "Pacific Roofing", claimantEmail: "juan@pacific.test", amountCents: 380000,
  throughDate: "2026-10-02", waivers: [], chain: { clear: false, reasons: ["no_waiver"] } };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  const m = /^\/api\/waiver\/([^/]+)(\/.*)?$/.exec(path);
  if (m) {
    const w = LINK[m[1]];
    if (!w) return [404, { error: "not_found" }];
    if (!m[2] && method === "GET") return [200, w];
    if (m[2] === "/sign") { sent.push({ path, body }); LINK[m[1]] = { ...w, status: "signed", signedByName: body.typedName, signedAt: "2026-10-05 10:00:00" }; return [200, { ok: true }]; }
    if (m[2]?.startsWith("/file/")) { sent.push({ path, body }); LINK[m[1]] = { ...w, status: "signed" }; return [200, { ok: true }]; }
    if (m[2] === "/decline") { sent.push({ path, body }); LINK[m[1]] = { ...w, status: "declined" }; return [200, { ok: true }]; }
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, [{ id: "usr_a", name: "Chris Lane", email: "chris@alder.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/subs") return [200, SUBS()];
  if (path === "/api/jobs" && method === "GET") return [200, JOBS()];
  if (path === "/api/work-orders/wo_1/plan") return [200, { workOrderId: "wo_1", valueCents: 1000000,
    scopeKind: "labor_materials", retainageBps: 500, events: [],
    milestones: [{ id: "ms_1", seq: 1, label: "Tear-off", amountCents: 400000, status: "verified",
      verifiedAt: "2026-10-02 10:00:00" }, { id: "ms_2", seq: 2, label: "Shingles", amountCents: 600000, status: "pending" }],
    releases: [{ id: "rel_1", workOrderId: "wo_1", milestoneId: "ms_1", grossCents: 400000, retainageCents: 20000,
      feeBps: 0, feeCents: 0, netCents: 380000, status: "due", createdAt: "2026-10-02 10:00:00" }] }];
  if (path === "/api/work-orders/wo_1/funding") return [200, { configured: false }];
  if (path === "/api/releases/rel_1/waivers") return [200, RELEASE_WAIVERS];
  if (path === "/api/releases/rel_1/waiver" && method === "POST") {
    sent.push({ path, body });
    RELEASE_WAIVERS = { ...RELEASE_WAIVERS, waivers: [{ id: "lw_9", kind: body.kind, status: "requested",
      title: "x", source: body.source, emailed: true, lowerTierSigned: 0, lowerTierTotal: 0 }] };
    return [201, { ok: true, emailed: true, waiver: RELEASE_WAIVERS.waivers[0] }];
  }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (/\/inspection$/.test(path)) return [404, { error: "not_found" }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const READ = () => ({
  title: document.querySelector(".wv-link h1")?.innerText || "",
  lede: document.querySelector(".pack-lede")?.innerText || "",
  heads: [...document.querySelectorAll(".agr-doc .agr-sec h5")].map((h) => h.innerText),
  decl: [...document.querySelectorAll(".agr-doc .agr-sec")].find((s) => /Who else/i.test(s.innerText))?.innerText || "",
  btn: (() => { const b = [...document.querySelectorAll(".wv-signer .form-actions .btn-solid")][0];
    return b ? { text: b.innerText.trim(), disabled: b.disabled } : null; })(),
  hint: document.querySelector(".wv-signer .cov-hint")?.innerText || "",
  warn: document.querySelector(".wv-warn")?.innerText || "",
  upload: !!document.querySelector(".wv-signer input[type=file]"),
  note: document.querySelector(".wv-upload-note")?.innerText || "",
  done: document.querySelector(".wv-done")?.innerText || "",
});
const typeIn = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
}, sel, v);
const pickScope = (page, label) => page.evaluate((l) => {
  const o = [...document.querySelectorAll(".wv-opt")].find((x) => x.innerText.includes(l));
  o?.querySelector("input")?.click(); return !!o;
}, label);

try {
  console.log("\n-- a supplier opens the link --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_wa" });
    await wait(2200);
    let r = await page.evaluate(READ);
    t.ck("the waiver opens with no account", /Conditional Waiver and Release on Progress Payment/.test(r.title), r.title);
    t.ck("and says who is asking", /Pacific Roofing asked ABC Supply/.test(r.lede), r.lede);
    t.ck("the whole document is there", r.heads.length === 6, r.heads.join(" | "));
    t.ck("signing waits on the declaration, and says so",
      r.btn?.disabled === true && /who else worked|supply/i.test(r.hint), JSON.stringify({ btn: r.btn, hint: r.hint }));
    // Below the first tier the question is what THEY supplied, not who else.
    t.ck("a supplier is asked what they supplied", await page.evaluate(() =>
      /What did you supply/.test(document.querySelector(".wv-decl-q")?.innerText || "")));
    t.ck("and section 5 says it is chosen at signing", /chooses its declaration/.test(r.decl), r.decl);

    await pickScope(page, "We supplied materials");
    await wait(300);
    r = await page.evaluate(READ);
    // THE PREVIEW FOLLOWS THE CHOICE, or the page shows one document and the
    // server hashes another.
    t.ck("the preview now carries their declaration", /has paid, or will pay/.test(r.decl), r.decl);
    t.ck("still waiting on a name", r.btn?.disabled === true && /name/i.test(r.hint), r.hint);
    await typeIn(page, ".agr-sign input", "Pat");
    await wait(200);
    r = await page.evaluate(READ);
    t.ck("one word is not a signature", r.btn?.disabled === true);
    await typeIn(page, ".agr-sign input", "Pat Ruiz");
    await wait(200);
    r = await page.evaluate(READ);
    t.ck("a full name is", r.btn?.disabled === false && /Sign waiver/.test(r.btn.text), JSON.stringify(r.btn));
    sent.length = 0;
    await page.evaluate(() => document.querySelector(".wv-signer .form-actions .btn-solid")?.click());
    await wait(900);
    const s = sent.find((x) => /\/sign$/.test(x.path));
    t.ck("what was SENT is the name and the declaration",
      s?.body?.typedName === "Pat Ruiz" && s.body.scopeKind === "materials_only", JSON.stringify(s?.body));
    r = await page.evaluate(READ);
    t.ck("and the page says it is done", /Signed by Pat Ruiz on Oct 5/.test(r.done) && !/10:00/.test(r.done), r.done);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the subcontractor names who supplied them --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_sub" });
    await wait(2200);
    await pickScope(page, "I bought materials");
    await wait(300);
    let r = await page.evaluate(READ);
    t.ck("choosing materials asks who", await page.evaluate(() => document.querySelectorAll(".wv-party").length) === 1);
    await typeIn(page, ".agr-sign input", "Juan Soto");
    await wait(200);
    r = await page.evaluate(READ);
    // A disabled control with no reason beside it is indistinguishable from a
    // broken one.
    t.ck("with nobody named, Sign is dead and says why",
      r.btn?.disabled === true && /Name who supplied/.test(r.hint), JSON.stringify({ btn: r.btn, hint: r.hint }));
    await typeIn(page, ".wv-party input:nth-child(1)", "ABC Supply");
    await typeIn(page, ".wv-party input:nth-child(2)", "yard@abc.test");
    await wait(200);
    r = await page.evaluate(READ);
    t.ck("naming one enables it", r.btn?.disabled === false);
    sent.length = 0;
    await page.evaluate(() => document.querySelector(".wv-signer .form-actions .btn-solid")?.click());
    await wait(900);
    const s = sent.find((x) => /\/sign$/.test(x.path));
    t.ck("the supplier goes with the signature",
      s?.body?.scopeKind === "labor_materials" && s.body.parties?.[0]?.name === "ABC Supply"
        && s.body.parties[0].email === "yard@abc.test", JSON.stringify(s?.body));
    await ctx.close();
  }

  console.log("\n-- an unconditional waiver warns before it is signed --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_unc" });
    await wait(2200);
    const r = await page.evaluate(READ);
    t.ck("it says it takes effect whether or not the money clears",
      /whether or not the payment clears/.test(r.warn), r.warn);
    await ctx.close();
    const { ctx: c2, page: p2 } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_sub" });
    await wait(2200);
    t.ck("and a conditional one does not", (await p2.evaluate(READ)).warn === "");
    await c2.close();
  }

  console.log("\n-- a statutory state: no generated text, an upload --");
  {
    const urls = [];
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_ca" });
    page.on("request", (q) => { if (q.method() === "PUT") urls.push(q.url()); });
    await wait(2200);
    let r = await page.evaluate(READ);
    t.ck("no SubSub document is drawn", r.heads.length === 0, r.heads.join("|"));
    t.ck("it names the state and why", /California sets the exact wording/.test(r.note), r.note);
    t.ck("and offers the upload", r.upload && /Upload signed waiver/.test(r.btn?.text || ""), JSON.stringify(r.btn));
    await pickScope(page, "Labor only");
    await typeIn(page, ".agr-sign input", "Juan Soto");
    await wait(200);
    r = await page.evaluate(READ);
    t.ck("waits on the file, and says so", r.btn?.disabled === true && /Choose the signed waiver/.test(r.hint), r.hint);
    const file = join(OUT, "signed.pdf");
    writeFileSync(file, "%PDF-1.4 signed");
    const input = await page.$(".wv-signer input[type=file]");
    await input.uploadFile(file);
    await wait(300);
    r = await page.evaluate(READ);
    t.ck("then it can go", r.btn?.disabled === false);
    await page.evaluate(() => document.querySelector(".wv-signer .form-actions .btn-solid")?.click());
    await wait(1000);
    const u = urls.find((x) => /\/api\/waiver\/tok_ca\/file\/signed\.pdf/.test(x)) || "";
    const q = new URL(u || "http://x/").searchParams;
    t.ck("the file went to the link's own upload route", !!u, urls.join(" | "));
    t.ck("carrying the signer's name", q.get("name") === "Juan Soto", q.get("name"));
    t.ck("and their declaration", JSON.parse(q.get("declaration") || "{}").scopeKind === "labor_only", q.get("declaration"));
    await ctx.close();
  }

  console.log("\n-- a link nobody recognises --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?waiver=tok_nope" });
    await wait(2000);
    const r = await page.evaluate(READ);
    t.ck("says it isn't valid and what to do", /isn't valid any more/.test(r.lede), r.lede);
    await ctx.close();
  }

  console.log("\n-- the hiring side asks, from the work order --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "alder", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    const opened = await page.evaluate(() => { const b = document.querySelector(".ta-wo-link"); b?.click(); return !!b; });
    await wait(1400);
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".modal .wop-row-acts button")].find((x) => /Lien waiver/.test(x.innerText));
      b?.click(); return !!b;
    });
    t.ck("the release row offers the lien waiver", opened && btn, JSON.stringify({ opened, btn }));
    await wait(900);
    let r = await page.evaluate(() => ({
      none: document.querySelector(".wv-release .cov-hint")?.innerText || "",
      ask: [...document.querySelectorAll(".wv-release button")].some((b) => /Ask for a lien waiver/.test(b.innerText)),
    }));
    t.ck("says nothing has been asked for yet", /No lien waiver asked for/.test(r.none), r.none);
    t.ck("and offers to ask", r.ask);
    await page.evaluate(() => [...document.querySelectorAll(".wv-release button")]
      .find((b) => /Ask for a lien waiver/.test(b.innerText))?.click());
    await wait(400);
    r = await page.evaluate(() => {
      const sel = document.querySelector(".wv-ask select");
      return {
        value: sel?.value,
        opts: [...(sel?.options || [])].map((o) => ({ v: o.value, d: o.disabled })),
        src: [...document.querySelectorAll(".wv-ask .wv-opt")].map((o) => o.innerText.split("\n")[0]),
        email: document.querySelector(".wv-ask input[type=email]")?.value,
      };
    });
    t.ck("all four kinds are offered", r.opts?.length === 4, JSON.stringify(r.opts));
    t.ck("the suggestion is preselected", r.value === "conditional_progress", r.value);
    // The one rule that protects the signer, on the screen as well.
    // Length first: every() over an empty list is true, so without it this
    // passed loudest on a form that never opened -- caught by mutation.
    t.ck("unconditional is not choosable before the money",
      r.opts.length === 4 && r.opts.filter((o) => o.v.startsWith("unconditional_")).every((o) => o.d)
      && r.opts.filter((o) => o.v.startsWith("conditional_")).every((o) => !o.d), JSON.stringify(r.opts));
    t.ck("in Washington, SubSub's form or their own", r.src.join() === "SubSub's form,Your own form", r.src.join());
    t.ck("addressed to the company by default", r.email === "juan@pacific.test", r.email);
    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".wv-ask button")]
      .find((b) => /Send the request/.test(b.innerText))?.click());
    await wait(1000);
    const s = sent.find((x) => x.path === "/api/releases/rel_1/waiver");
    t.ck("what was SENT is the kind, the form and the address",
      s?.body?.kind === "conditional_progress" && s.body.source === "subsub_standard"
        && s.body.toEmail === "juan@pacific.test", JSON.stringify(s?.body));
    r = await page.evaluate(() => ({
      item: document.querySelector(".wv-release .wv-item")?.innerText || "",
      acts: [...document.querySelectorAll(".wv-release .wv-item-acts .pick")].map((b) => b.innerText.trim()),
    }));
    t.ck("and it now reads as waiting on them", /Waiting on them to sign/.test(r.item), r.item);
    t.ck("with the three things to do about it",
      ["Send again", "Record a signed copy", "Withdraw"].every((x) => r.acts.includes(x)), r.acts.join());
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- California, from the hiring side --");
  {
    RELEASE_WAIVERS = { ...RELEASE_WAIVERS, state: "CA", waivers: [],
      forms: { state: "CA", statutory: true, sources: ["uploaded"], reason: "statutory_text_not_loaded" } };
    const { ctx, page } = await visitApp(browser, { host: "alder", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    await page.evaluate(() => document.querySelector(".ta-wo-link")?.click());
    await wait(1400);
    await page.evaluate(() => [...document.querySelectorAll(".modal .wop-row-acts button")]
      .find((x) => /Lien waiver/.test(x.innerText))?.click());
    await wait(900);
    await page.evaluate(() => [...document.querySelectorAll(".wv-release button")]
      .find((b) => /Ask for a lien waiver/.test(b.innerText))?.click());
    await wait(400);
    const r = await page.evaluate(() => ({
      src: document.querySelectorAll(".wv-ask .wv-opt").length,
      why: document.querySelector(".wv-ask .cov-hint")?.innerText || "",
      ask: !!document.querySelector(".wv-ask"),
    }));
    t.ck("the request form opened", r.ask);
    t.ck("no choice of SubSub's form is offered", r.src === 0, String(r.src));
    t.ck("and it says why, naming the state", /California sets the exact wording/.test(r.why), r.why);
    await ctx.close();
  }

  console.log("\n-- on Basic, the panel says Scale and offers nothing the server refuses --");
  {
    RELEASE_WAIVERS = { ...RELEASE_WAIVERS, onScale: false, state: "WA", waivers: [],
      forms: { state: "WA", statutory: false, sources: ["subsub_standard", "uploaded"] } };
    const { ctx, page } = await visitApp(browser, { host: "alder", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    await page.evaluate(() => document.querySelector(".ta-wo-link")?.click());
    await wait(1400);
    const opened = await page.evaluate(() => { const b = [...document.querySelectorAll(".modal .wop-row-acts button")]
      .find((x) => /Lien waiver/.test(x.innerText)); b?.click(); return !!b; });
    await wait(900);
    const r = await page.evaluate(() => ({
      panel: !!document.querySelector(".wv-release"),
      plan: document.querySelector(".wv-release .wv-plan")?.innerText || "",
      ask: [...document.querySelectorAll(".wv-release button")].some((b) => /Ask for a lien waiver/.test(b.innerText)),
    }));
    // The panel has to have opened, or "there is no Ask button" passes on a
    // screen that never rendered.
    t.ck("the waiver panel opened", opened && r.panel, JSON.stringify({ opened, panel: r.panel }));
    t.ck("it says lien waivers come with Scale, and where to move", /come with Scale/.test(r.plan)
      && /Account → Subscription/.test(r.plan), r.plan);
    t.ck("and offers no request the server would refuse", r.ask === false);
    await ctx.close();
  }
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
