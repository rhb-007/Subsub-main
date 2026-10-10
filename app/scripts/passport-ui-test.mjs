// 077. THE SUB PASSPORT, drawn in a browser.
//
// What is pinned is what the server suite cannot see:
//
//   THE PUBLIC PAGE IS A PHONE PAGE: no sideways scroll at 390px, the badge
//   with its own line under it, the trades, the license, the insurer and its
//   date, "W-9 On file" and nothing more, a QR code of its own address, and
//   share by text, email and copy.
//
//   THE BADGE IS DRAWN ONLY WHEN THE SERVER SAYS IT IS EARNED -- a page that
//   is not verified says so rather than wearing the badge.
//
//   THE CTA SAYS THE WORDS ASKED FOR and carries the sub's own code with the
//   passport channel, which is what credits the sub.
//
//   THE FILES ARE ASKED FOR, NOT SHOWN: signed out, the page offers sign-in;
//   a hiring admin asks and the POST goes; approved, the two files open.
//
//   THE SUB'S OWN SCREEN publishes, and answers a request in one press.
//
//   node --no-warnings scripts/passport-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-passport-test");
const WEB = 5461, API = 9161;
const t = tally();

const SLUG = "bay-roofing-k7q2m";
const S = { verified: true, access: { status: "none", mayRequest: true, files: [] }, kind: "general_contractor",
  published: false, posts: [], pendingReq: true };
const PAGE = () => ({
  slug: SLUG, name: "Bay Roofing", city: "Tacoma", state: "WA",
  trades: [{ id: "roofing", label: "Roofing" }, { id: "gutters", label: "Gutters" }],
  area: "Tacoma, Seattle", foundedYear: 2012, years: "In business since 2012 · 14 years",
  about: "Residential re-roofs, two crews.",
  license: { number: "BAYROR*123", text: S.verified ? "Washington L&I registration active" : "License not verified by SubSub", ok: S.verified },
  insurance: { carrier: "Acme Mutual", expiresOn: "2027-03-04", text: "Insurance on file through Mar 4, 2027" },
  w9: true, photos: [{ id: "ph1", caption: "New roof, Tacoma" }],
  badge: S.verified
    ? { verified: true, name: "SubSub Verified", line: "Washington L&I registration active · Insurance on file through Mar 4, 2027" }
    : { verified: false, name: null, line: "License not verified by SubSub · Insurance on file through Mar 4, 2027" },
  refCode: "K7Q2MXRB",
});
const acct = () => ({
  id: "acc_x", name: S.kind === "subcontractor" ? "Bay Roofing" : "Outerhome", subdomain: "bayroof", kind: S.kind,
  plan: "basic", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"], logoKey: null,
  subscriptionStatus: "active", user: { id: "u_rb", name: "R Braun", email: "rb@x.test", role: "admin" },
});
const MINE = () => ({
  passport: { slug: SLUG, url: `https://app.subsub.work/p/${SLUG}`, published: S.published, trades: ["roofing"],
    foundedYear: 2012, about: "Residential re-roofs.", viewCount: 3 },
  preview: PAGE(), photos: [],
  access: S.pendingReq ? [{ id: "pa1", accountId: "acc_gc", accountName: "Outerhome", requesterName: "Dana Ruiz",
    message: "For the Pine St job", status: "pending", requestedAt: "2026-10-09 10:00:00" }]
    : [{ id: "pa1", accountId: "acc_gc", accountName: "Outerhome", status: "approved", requestedAt: "2026-10-09 10:00:00" }],
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === `/api/public/passport/${SLUG}`) return [200, PAGE()];
  if (path.startsWith("/api/public/passport/")) return [404, { error: "not_found" }];
  if (path === `/api/passport/${SLUG}/access` && method === "GET") return [200, S.access];
  if (path === `/api/passport/${SLUG}/access` && method === "POST") {
    S.posts.push({ path, body }); S.access = { status: "pending", mayRequest: false, files: [] };
    return [201, { ok: true, status: "pending" }];
  }
  if (path === "/api/my-passport" && method === "GET") return [200, MINE()];
  if (path === "/api/my-passport" && method === "PUT") {
    S.posts.push({ path, body }); if (typeof body.published === "boolean") S.published = body.published;
    return [200, { passport: MINE().passport }];
  }
  if (path === "/api/my-passport/access/pa1" && method === "POST") {
    S.posts.push({ path, body }); S.pendingReq = false; return [200, { ok: true, status: "approved" }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return S.kind === "subcontractor" ? [200, { companyId: "cmp_bay", company: "Bay Roofing",
    contact: "R", email: "rb@x.test", phone: "", license: "", ubi: "", city: "Tacoma", state: "WA", zip: "98407",
    coverage: { mode: "cities", cities: [], radii: [] }, docs: {}, findable: true, code: "c", openToHire: true,
    openAnswered: true, url: null, sharesSent: 0, crews: [] }] : [200, { companyId: "cmp_gc", company: "Outerhome",
    contact: "", email: "", phone: "", license: "", ubi: "", city: "", state: "", zip: "", coverage: { mode: "cities", cities: [], radii: [] },
    docs: {}, findable: false, code: "c", openToHire: true, openAnswered: true, url: null, sharesSent: 0, crews: [] }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [{ id: "u_rb", name: "R Braun", email: "rb@x.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers", "/api/my-quotes",
    "/api/doc-shares", "/api/inspections", "/api/change-orders", "/api/tenants", "/api/agreements"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const PHONE = { width: 390, height: 844 };

const readPage = (page) => page.evaluate(() => {
  const c = document.querySelector(".pp-card");
  const cta = c?.querySelector(".pp-cta a");
  const share = [...(c?.querySelectorAll(".pp-share a, .pp-share button") || [])];
  return {
    there: !!c, h1: c?.querySelector("h1")?.innerText || "",
    badge: c?.querySelector(".pp-badge-name")?.innerText.trim() || "",
    badgeOn: !!c?.querySelector(".pp-badge.on"),
    line: c?.querySelector(".pp-badge-line")?.innerText || "",
    trades: [...(c?.querySelectorAll(".pp-trades li") || [])].map((l) => l.innerText),
    facts: (c?.querySelector(".pp-facts")?.innerText || "").replace(/\s+/g, " "),
    qr: !!c?.querySelector(".pp-qrrow svg.qr"),
    share: share.map((x) => ({ t: x.innerText.trim(), href: x.getAttribute("href"), h: x.getBoundingClientRect().height })),
    cta: cta ? { t: cta.innerText.trim(), href: cta.getAttribute("href") } : null,
    access: (c?.querySelector(".pp-access")?.innerText || "").replace(/\s+/g, " "),
    photos: c?.querySelectorAll(".pp-photo img").length || 0,
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    robots: document.querySelector('meta[name="robots"]')?.content || "",
    text: (c?.innerText || "").replace(/\s+/g, " "),
  };
});

try {
  console.log("\n-- the public page, signed out, on a phone --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/p/${SLUG}` });
    await wait(2000);
    const r = await readPage(page);
    t.ck("the page opens on the sub", r.there && r.h1 === "Bay Roofing", r.h1);
    t.ck("the badge is drawn, with what it rests on under it",
      r.badgeOn && /SubSub Verified/.test(r.badge) && /Washington L&I registration active/.test(r.line) && /through Mar 4, 2027/.test(r.line), r.line);
    t.ck("the trades", r.trades.join() === "Roofing,Gutters", r.trades.join());
    t.ck("the license, the insurer and the W-9 as Yes",
      /BAYROR\*123/.test(r.facts) && /Acme Mutual/.test(r.facts) && /W-9 On file/.test(r.facts), r.facts);
    t.ck("never a contact, an email or a file name", !/@|\.pdf/.test(r.text), r.text);
    t.ck("a QR code of its own address", r.qr);
    t.ck("share by text, email and copy",
      r.share.some((s) => s.t === "Text" && s.href?.startsWith("sms:?&body=") && decodeURIComponent(s.href).includes(`/p/${SLUG}`))
      && r.share.some((s) => s.t === "Email" && s.href?.startsWith("mailto:?subject="))
      && r.share.some((s) => /Copy link/.test(s.t)), JSON.stringify(r.share));
    t.ck("thumb-sized share buttons", r.share.length >= 3 && r.share.every((s) => s.h >= 44), JSON.stringify(r.share.map((s) => s.h)));
    t.ck("the CTA says the words asked for", r.cta?.t === "Manage your whole sub network like this", r.cta?.t);
    t.ck("and credits this sub through the passport channel",
      r.cta?.href === "https://subsub.work/gc?ref=K7Q2MXRB&via=passport", r.cta?.href);
    t.ck("signed out, the files are offered behind a sign-in", /Sign in to ask/.test(r.access) && !/Open the certificate/.test(r.access), r.access);
    t.ck("photos of their work", r.photos === 1);
    t.ck("no sideways scroll at 390px", !r.wide);
    t.ck("noindex on the page", r.robots === "noindex");
    await page.evaluate(() => [...document.querySelectorAll(".pp-access button")].find((b) => /Sign in/.test(b.innerText))?.click());
    await wait(800);
    t.ck("signing in remembers where to come back to",
      await page.evaluate(() => sessionStorage.getItem("ss_after_login")) === `/p/${"bay-roofing-k7q2m"}`);
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- not verified --");
  {
    S.verified = false;
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/p/${SLUG}` });
    await wait(1800);
    const r = await readPage(page);
    t.ck("the page is there", r.there);
    t.ck("it does not wear the badge", !r.badgeOn && !/SubSub Verified/.test(r.badge) && /Not verified yet/.test(r.badge), r.badge);
    t.ck("and still says what is and is not on file", /License not verified by SubSub/.test(r.line), r.line);
    S.verified = true;
    await ctx.close();
  }

  console.log("\n-- an unknown address --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: "/p/nobody-here-zzzzz" });
    await wait(1600);
    const txt = await page.evaluate(() => document.body.innerText);
    t.ck("it says so", /couldn't find that Passport/.test(txt), txt.slice(0, 200));
    await ctx.close();
  }

  console.log("\n-- a hiring admin asks --");
  {
    S.kind = "general_contractor";
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE,
      seat: { userId: "u_rb", accountId: "acc_x" }, path: `/p/${SLUG}` });
    await wait(2400);
    let r = await readPage(page);
    t.ck("signed in, the page offers to ask", /Ask to see the files/.test(r.access), r.access);
    await page.evaluate(() => {
      const i = document.querySelector(".pp-access input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "For the Pine St job");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-access button")].find((b) => /Ask to see/.test(b.innerText))?.click());
    await wait(900);
    const sent = S.posts.slice(before);
    t.ck("asking posts the note", sent.length === 1 && sent[0].body.message === "For the Pine St job", JSON.stringify(sent));
    r = await readPage(page);
    t.ck("and then says it is waiting", /waiting on their answer/.test(r.access), r.access);
    S.access = { status: "approved", mayRequest: false, files: [{ kind: "insurance", fileName: "coi.pdf" }, { kind: "w9", fileName: "w9.pdf" }] };
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2200);
    r = await readPage(page);
    t.ck("approved, the two files are offered", /Open the certificate/.test(r.access) && /Open the W-9/.test(r.access), r.access);
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the sub's own screen --");
  {
    S.kind = "subcontractor"; S.published = false; S.pendingReq = true;
    const { ctx, page, crashes } = await visitApp(browser, { host: "bayroof", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_x" }, viewport: { width: 1200, height: 1700 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^(My account|Account)$/.test(b.innerText.trim()))?.click());
    await wait(900);
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".pane-tabs button, .acc-tabs button, .tabs button")].map((b) => b.innerText.trim()));
    const hasTab = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Passport");
      if (b) b.click();
      return !!b;
    });
    t.ck("Account has a Passport tab", hasTab, JSON.stringify(tabs));
    await wait(1200);
    const edit = await page.evaluate(() => ({
      there: !!document.querySelector(".pp-edit"),
      url: document.querySelector(".pp-url")?.innerText || "",
      pub: [...document.querySelectorAll(".pp-pub button")].map((b) => b.innerText.trim()),
      req: (document.querySelector(".pp-requests")?.innerText || "").replace(/\s+/g, " "),
    }));
    t.ck("it opens the editor with the address", edit.there && edit.url.endsWith(`/p/${SLUG}`), JSON.stringify(edit));
    t.ck("private until published", edit.pub.some((x) => /Publish my Passport/.test(x)));
    t.ck("a waiting request names who asked and why", /Outerhome/.test(edit.req) && /Dana Ruiz/.test(edit.req) && /Pine St/.test(edit.req), edit.req);
    let before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-pub button")].find((b) => /Publish/.test(b.innerText))?.click());
    await wait(900);
    let sent = S.posts.slice(before);
    t.ck("publishing posts published:true", sent.some((p) => p.path === "/api/my-passport" && p.body.published === true), JSON.stringify(sent));
    before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-requests button")].find((b) => /Share them/.test(b.innerText))?.click());
    await wait(900);
    sent = S.posts.slice(before);
    t.ck("sharing is one press, and it approves", sent.length === 1 && sent[0].path === "/api/my-passport/access/pa1"
      && sent[0].body.action === "approve", JSON.stringify(sent));
    const after = await page.evaluate(() => (document.querySelector(".pp-edit")?.innerText || "").replace(/\s+/g, " "));
    t.ck("and then it can be stopped", /Stop sharing/.test(after), after.slice(-300));
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
