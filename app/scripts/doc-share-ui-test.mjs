// Sending your paperwork, and the page it lands on.
//
// Two screens that never meet. The subcontractor's is a panel on a screen they
// already visit, because sending documents is what they came to that screen to
// DO. The recipient's has no nav, no sign-in and nothing to join -- the moment
// it asks for a password it stops being better than the email attachment it
// replaces.
//
// The assertion that matters most is on the second one: the W-9 says it is on
// file and offers no way to open it. It carries a TIN, and for a sole
// proprietor that is their social security number.
//
//   node scripts/doc-share-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docshare-test");
const WEB = 5227, API = 8939;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", role: "contractor" },
};
const SUB = {
  id: "cmp_ridge", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_gc",
  contact: "Sam Ridge", email: "sam@ridge.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "RIDGERR891QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};

let SHARES = [];
const sends = [], revokes = [], fileAsks = [], adds = [];
// What the recipient's page is served.
// Upload days counted back from today, so "N days ago" is checkable.
const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 15:30:00`; };
let PACK = {
  company: "Ridge Roofing", contact: "Sam Ridge", where: "Seattle, WA",
  license: "RIDGERR891QZ", licenseVerified: true, licenseCheckedAt: "2026-09-12",
  sentTo: "Priya", note: "As asked on Tuesday.", expiresAt: "2026-10-10 00:00:00",
  trades: [{ id: "roofing", label: "Roofing" }, { id: "gutters", label: "Gutters" }],
  badge: { verified: true, name: "SubSub Verified", line: "WA L&I registration active · Insurance on file through Mar 14, 2027" },
  passportUrl: "https://app.subsub.work/p/ridge-roofing-k7q2m",
  docs: [
    { kind: "insurance", onFile: true, issuer: "Cascade Mutual", policyNo: "POL-44812",
      coverageCents: 200000000, expiresOn: "2027-03-14", readable: true, gated: false, id: "d_ins",
      fileName: "ridge-coi-2026.pdf", uploadedAt: daysBack(3) },
    { kind: "bond", onFile: true, issuer: "Western Surety", policyNo: "BND-991",
      coverageCents: 3000000, expiresOn: null, readable: true, gated: false, id: "d_bond",
      fileName: "ridge-bond.pdf", uploadedAt: daysBack(40) },
    { kind: "contract", onFile: true, expiresOn: null, readable: true, gated: false, id: "d_con", uploadedAt: daysBack(1) },
    // THE ONE THAT MUST NOT BE OPENABLE.
    { kind: "w9", onFile: true, issuer: null, policyNo: null, coverageCents: null,
      expiresOn: null, readable: false, gated: true, id: "d_w9", uploadedAt: daysBack(200) },
  ],
};
let PACK_ERR = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  // The seat's own row. membership.companyId comes from subId here, and it is
  // what links this login to the contractor record -- without it the portal
  // says the login is not linked to one and none of their screens render.
  if (path === "/api/account-users") return [200, [
    { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", phone: null, role: GC.user.role,
      subId: "cmp_ridge", propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/doc-shares" && method === "POST") {
    sends.push(body);
    const row = { id: `sh${sends.length}`, toEmail: body.toEmail, toName: body.toName || null,
      note: body.note || null, createdAt: new Date().toISOString(),
      expiresAt: "2026-10-10 00:00:00", revokedAt: null, viewCount: 0,
      lastViewedAt: null, state: "active" };
    SHARES = [row, ...SHARES];
    return [201, row];
  }
  if (path === "/api/doc-shares") return [200, SHARES];
  const rv = /^\/api\/doc-shares\/([^/]+)\/revoke$/.exec(path);
  if (rv && method === "POST") {
    revokes.push(rv[1]);
    SHARES = SHARES.map((s) => s.id === rv[1] ? { ...s, state: "revoked" } : s);
    return [200, { ok: true }];
  }
  if (/^\/api\/pack\/[^/]+\/file\//.test(path)) { fileAsks.push(path); return [200, { pdf: true }]; }
  if (/^\/api\/pack\/[^/]+\/add$/.test(path) && method === "POST") { adds.push(path); return [200, { ok: true, added: true }]; }
  if (/^\/api\/pack\//.test(path)) {
    if (PACK_ERR) return [PACK_ERR.status, PACK_ERR.body];
    return [200, PACK];
  }
  if (path === "/api/jobs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/property-transfers") return [200, []];
  return undefined;
} });

const browser = await launch();

try {
  console.log("\n-- the contractor sends it --");
  {
    SHARES = []; sends.length = 0;
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_sam", accountId: "acc_gc" }, viewport: { width: 1200, height: 1400 } });
    await wait(2800);
    // Their own documents screen.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Compliance pack/.test(b.innerText.trim().split("\n")[0]))?.click());
    await wait(1200);

    const panel = await page.evaluate(() => {
      const el = document.querySelector(".pack-panel");
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim(),
        buttons: [...el.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    });
    t.ck("the send panel is on their documents screen", !!panel, String(panel));
    // The pitch, in their words rather than ours.
    t.ck("it says what it is for",
      /contractor asking for your insurance/i.test(panel.text), panel.text);
    t.ck("and why it beats an attachment",
      /when you renew, what they are looking at renews with it/i.test(panel.text), panel.text);
    t.ck("sending is offered", panel.buttons.some((b) => /send it/i.test(b)), JSON.stringify(panel.buttons));

    await page.evaluate(() => [...document.querySelectorAll(".pack-panel button")]
      .find((b) => /send it/i.test(b.innerText))?.click());
    await wait(600);
    // Said BEFORE they send, not discovered after.
    const form = await page.evaluate(() =>
      document.querySelector(".pack-form")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("the form warns the W-9 is held back",
      /W-9 is shown as on file but stays behind a sign-in/i.test(form || ""), form);
    t.ck("and says why", /tax number/i.test(form || ""), form);

    await page.evaluate(() => {
      const f = document.querySelector(".pack-form");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const em = f.querySelector('input[type=email]');
      set.call(em, "pm@cascade.test");
      em.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".pack-form .form-actions button")]
      .find((b) => /^Send$/i.test(b.innerText.trim()))?.click());
    await wait(1200);
    t.ck("it reaches the server", sends.length === 1, JSON.stringify(sends));
    t.ck("addressed to who they typed", sends[0]?.toEmail === "pm@cascade.test", String(sends[0]?.toEmail));

    // And the thing that makes this better than an attachment: you find out.
    const sent = await page.evaluate(() =>
      document.querySelector(".pack-sent")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("the sent list shows it", /pm@cascade.test/.test(sent || ""), sent);
    t.ck("and says nobody has opened it yet", /not opened yet/i.test(sent || ""), sent);
    t.ck("withdrawing is offered", /withdraw/i.test(sent || ""), sent);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a signed-in reader is offered their account --");
  {
    PACK_ERR = null;
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_sam", accountId: "acc_gc" }, viewport: { width: 1200, height: 1200 }, path: "/?pack=TOKEN123" });
    await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
    await wait(2200);
    const top = await page.evaluate(() => {
      const a = document.querySelector(".pack-top .pack-signin");
      return { card: !!document.querySelector(".pack-card"),
        link: a ? { text: a.innerText.replace(/\s+/g, " ").trim(), href: a.getAttribute("href") } : null };
    });
    t.ck("the pack still shows to somebody signed in", top.card);
    t.ck("and the top line says which account and goes there",
      /^Go to /.test(top.link?.text || "") && top.link.href === "/", JSON.stringify(top.link));
    await ctx.close();
  }

  console.log("\n-- signed in as an admin, the files open and the sender can be added --");
  {
    PACK_ERR = null; fileAsks.length = 0; adds.length = 0;
    GC.user.role = "admin";
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_sam", accountId: "acc_gc" }, viewport: { width: 1200, height: 1200 }, path: "/?pack=TOKEN123" });
    await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
    await wait(2400);
    const v = await page.evaluate(() => ({
      rows: [...document.querySelectorAll(".pack-doc")].map((d) => ({
        text: d.innerText.replace(/\s+/g, " ").trim(),
        open: d.querySelector("a")?.getAttribute("href") || null,
        cta: !!d.querySelector(".pack-doc-cta") })),
      gate: !!document.querySelector(".pack-gate"),
      addBtn: document.querySelector(".pack-add button")?.innerText || "",
    }));
    const ins = v.rows.find((r) => /Certificate of insurance/.test(r.text));
    const w9 = v.rows.find((r) => /W-9/.test(r.text));
    t.ck("signed in, the files are fetched with the session", fileAsks.some((p) => /\/file\/d_ins$/.test(p))
      && fileAsks.some((p) => /\/file\/d_bond$/.test(p)), JSON.stringify(fileAsks));
    t.ck("and never the W-9", !fileAsks.some((p) => /d_w9/.test(p)), JSON.stringify(fileAsks));
    t.ck("each row opens its own file from what was fetched", /^blob:/.test(ins?.open || ""), JSON.stringify(ins));
    t.ck("no sign-up buttons for somebody signed in", !v.rows.some((r) => r.cta) && !v.gate, JSON.stringify(v));
    t.ck("the W-9 still opens from the roster, not here", w9 && w9.open === null, JSON.stringify(w9));
    t.ck("an admin is offered to add the sender", /Add Ridge Roofing/.test(v.addBtn), v.addBtn);
    await page.evaluate(() => document.querySelector(".pack-add button")?.click());
    await wait(900);
    const done = await page.evaluate(() => document.querySelector(".pack-add")?.innerText || "");
    t.ck("pressing it adds them, once", adds.length === 1 && /on Outerhome roster now/.test(done), `${adds.length} ${done}`);
    GC.user.role = "contractor";
    await ctx.close();
  }

  console.log("\n-- and the contractor who receives it --");
  {
    PACK_ERR = null;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    fileAsks.length = 0;
    // No seat, no session, nothing. That is the whole point.
    await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
    await wait(2200);

    const pack = await page.evaluate(() => {
      const el = document.querySelector(".pack-card");
      if (!el) return null;
      return { text: el.innerText.replace(/\s+/g, " ").trim(),
        docs: [...el.querySelectorAll(".pack-doc")].map((d) => ({
          text: d.innerText.replace(/\s+/g, " ").trim(),
          link: d.querySelector("a")?.getAttribute("href") || null,
          open: d.querySelector("button.pack-open")?.innerText.trim() || null,
          ctaLinks: d.querySelectorAll(".pack-cta-solid, .pack-cta-ghost").length })),
        gate: document.querySelector(".pack-gate")?.innerText.replace(/\s+/g, " ") || "",
        w9Link: document.querySelector(".pack-w9 a")?.getAttribute("href") || null,
        links: [...el.querySelectorAll("a")].map((a) => a.getAttribute("href")),
        lede: el.querySelector(".pack-lede")?.innerText || "",
        trades: [...el.querySelectorAll(".pack-trade")].map((x) => x.innerText),
        seal: el.querySelector(".pack-badge")?.innerText.replace(/\s+/g, " ").trim() || "",
        headLogo: !!document.querySelector(".pack-page > .pack-top .pack-brand .ss-logo"),
        // On the LEFT, level with the card's own left edge, not centered.
        headLogoLeft: (() => { const g = document.querySelector(".pack-top .pack-brand")?.getBoundingClientRect();
          return !!g && Math.abs(g.left - el.getBoundingClientRect().left) < 4; })(),
        logoInCard: !!el.querySelector(".ss-logo"),
        poweredInCard: /Powered by/i.test(el.innerText),
        h1Size: parseFloat(getComputedStyle(el.querySelector("h1")).fontSize),
        h1Weight: Number(getComputedStyle(el.querySelector("h1")).fontWeight),
        what: el.querySelector(".pack-what")?.innerText || "",
        updated: el.querySelector(".pack-updated")?.innerText.replace(/\s+/g, " ").trim() || "",
        lic: (() => { const l = el.querySelector(".pack-lic"); return l ? { cls: l.className,
          text: l.innerText.replace(/\s+/g, " "), border: getComputedStyle(l).borderColor } : null; })(),
        ad: (() => { const a = document.querySelector(".pack-page > .pack-ad"); return a ? {
          head: a.querySelector("h2")?.innerText || "", headSize: parseFloat(getComputedStyle(a.querySelector("h2")).fontSize),
          href: a.querySelector(".pack-ad-btn")?.getAttribute("href") || "",
          btn: a.querySelector(".pack-ad-btn")?.innerText || "" } : null; })(),
        signin: (() => { const a = document.querySelector(".pack-top .pack-signin"); return a
          ? { text: a.innerText.trim(), href: a.getAttribute("href") } : null; })(),
        pageText: document.body.innerText,
        footLogo: !!document.querySelector(".pack-page > .pack-sign .ss-logo"),
        footText: document.querySelector(".pack-page > .pack-sign")?.innerText || "" };
    });
    t.ck("the page opens with no account at all", !!pack, String(pack));
    t.ck("naming the subcontractor", /Ridge Roofing/.test(pack.text), pack.text.slice(0, 80));
    t.ck("and nothing asks them to sign in first",
      !/password|sign in to continue/i.test(pack.text), pack.text.slice(0, 120));

    // What a contractor writes into their own compliance file.
    const ins = pack.docs.find((d) => /Certificate of insurance/.test(d.text));
    t.ck("the carrier is shown", /Cascade Mutual/.test(ins.text), ins.text);
    t.ck("the policy number", /POL-44812/.test(ins.text), ins.text);
    t.ck("the coverage", /\$2,000,000/.test(ins.text), ins.text);
    t.ck("and the expiry, which is the whole point",
      /Current through Mar 14, 2027/.test(ins.text), ins.text);
    // THE FUNNEL: signed out, nothing downloads. Every row is Create account
    // and Sign in, and both carry the token.
    t.ck("signed out, no row links to a file", !pack.links.some((h) => /\/file\//.test(h || "")), JSON.stringify(pack.links));
    t.ck("every row keeps its Open button", pack.docs.length > 0 && pack.docs.every((d) => d.open === "Open"),
      JSON.stringify(pack.docs.map((d) => d.open)));
    t.ck("and no row carries the sign-in buttons inline", pack.docs.every((d) => d.ctaLinks === 0),
      JSON.stringify(pack.docs.map((d) => d.ctaLinks)));
    // Pressing Open asks them to sign in or create an account, in a window.
    t.ck("no window before the press", !(await page.$(".pack-gate-modal")));
    await page.click(".pack-doc button.pack-open");
    await wait(300);
    const gm = await page.evaluate(() => {
      const m = document.querySelector(".modal.pack-gate-modal");
      return m ? { text: m.innerText.replace(/\s+/g, " "),
        create: m.querySelector(".pack-cta-solid")?.getAttribute("href") || null,
        signin: m.querySelector(".pack-cta-ghost")?.getAttribute("href") || null } : null;
    });
    t.ck("pressing Open opens a sign-in window", !!gm, String(gm));
    t.ck("it names the document pressed", gm && /Sign in to open/.test(gm.text), gm?.text);
    t.ck("Create account goes to signup with the pack", gm?.create === "https://subsub.work/get-started.html?pack=TOKEN123", gm?.create);
    t.ck("and Sign in comes back to this pack", gm?.signin === "/?pack=TOKEN123&signin=1", gm?.signin);
    await page.click(".pack-gate-modal .modal-close");
    await wait(200);
    t.ck("closing it leaves the page as it was", !(await page.$(".pack-gate-modal")));
    t.ck("the page says why, above the documents", pack.gate && /create a free account to open these/i.test(pack.gate), pack.gate);
    const bond = pack.docs.find((d) => /Surety bond/.test(d.text));
    t.ck("each row names the file it holds", /ridge-coi-2026\.pdf/.test(ins.text) && /ridge-bond\.pdf/.test(bond.text),
      JSON.stringify([ins.text, bond.text]));
    t.ck("no file was fetched", fileAsks.length === 0, JSON.stringify(fileAsks));

    // WHAT THE PAGE IS, FOR SOMEBODY WHO HAS NEVER HEARD OF SUBSUB.
    t.ck("it says it is a subcontractor's compliance pack", /Subcontractor compliance pack/i.test(pack.text), pack.text.slice(0, 400));
    t.ck("the summary names what is in it, in the order asked for",
      /In this compliance pack you'll find Ridge Roofing's surety bond, certificate of insurance, signed subcontractor agreement and IRS Form W-9\./.test(pack.what), pack.what);
    t.ck("with an agreement on file, it says nothing about connecting", !/connect/i.test(pack.what), pack.what);
    t.ck("the newest upload is the pack's last update, with days since",
      /^Last updated .+ · yesterday$/.test(pack.updated), pack.updated);
    t.ck("each row says when it was updated", /Updated .+ \(3 days ago\)/.test(ins.text)
      && /\(40 days ago\)/.test(bond.text), JSON.stringify([ins.text, bond.text]));
    t.ck("the sub's note to the recipient is not on the page (it is in the email)",
      !/As asked on Tuesday/.test(pack.pageText), pack.text.slice(0, 300));
    t.ck("the name is a big bold headline", pack.h1Size >= 30 && pack.h1Weight >= 700, `${pack.h1Size} ${pack.h1Weight}`);
    t.ck("a verified license is green with a check", pack.lic && /\bok\b/.test(pack.lic.cls)
      && /License verified/.test(pack.lic.text) && /RIDGERR891QZ/.test(pack.lic.text)
      && pack.lic.border === "rgb(46, 139, 87)", JSON.stringify(pack.lic));
    t.ck("with the trades they do", pack.trades.join(",") === "Roofing,Gutters", JSON.stringify(pack.trades));
    t.ck("the contact line has no empty separator", !/·\s*·/.test(pack.lede) && !/·\s*$/.test(pack.lede.trim()), pack.lede);
    t.ck("the SubSub Verified seal shows when earned, with what it rests on",
      /SubSub Verified/.test(pack.seal) && /registration active/.test(pack.seal), pack.seal);
    t.ck("and links to their Passport", pack.links.includes(PACK.passportUrl), JSON.stringify(pack.links));
    t.ck("SubSub's own logo is at the top, outside the card", pack.headLogo);
    t.ck("and on the left, not the middle", pack.headLogoLeft);
    // Whoever opens a pack is often somebody with an account who is signed
    // out on this device; the link came by email.
    t.ck("signed out, the top line offers Sign in, to the sign-in page",
      pack.signin?.text === "Sign in" && pack.signin.href === "/", JSON.stringify(pack.signin));
    // One name for one thing: the sender's "who is it for" box is not a label.
    t.ck("it does not print the share's typed recipient name", !/Sent to /.test(pack.text), pack.text.slice(0, 300));
    t.ck("and nothing on the page calls it paperwork", !/paperwork/i.test(pack.pageText),
      (pack.pageText.match(/.{0,40}paperwork.{0,40}/i) || [""])[0]);
    t.ck("the email-me box speaks of subcontractor compliance packs",
      /compliance packs by more than one subcontractor/.test(pack.pageText) && /every subcontractor compliance pack/.test(pack.pageText),
      (pack.pageText.match(/Been sent.{0,160}/) || [""])[0]);
    t.ck("and nothing in the card says Powered by", !pack.poweredInCard && !pack.logoInCard, pack.text.slice(0, 200));
    t.ck("and closes the page, Powered by SubSub", pack.footLogo && /Powered by/.test(pack.footText), pack.footText);

    // A document with no shelf life says so rather than looking unknown.
    const con = pack.docs.find((d) => /Signed subcontractor agreement/.test(d.text));
    t.ck("something that does not expire says so", /Does not expire/.test(con.text), con.text);

    // THE ONE THAT MATTERS.
    const w9 = pack.docs.find((d) => /W-9/.test(d.text));
    t.ck("the W-9 is listed", /IRS Form W-9/.test(w9.text), w9.text);
    t.ck("and the page says why", /carries a tax number/i.test(pack.text), pack.text);
    t.ck("the word account in that line signs them up", pack.w9Link === "https://subsub.work/get-started.html?pack=TOKEN123", String(pack.w9Link));
    t.ck("no file link anywhere points at it",
      !pack.links.some((h) => /d_w9/.test(h || "")), JSON.stringify(pack.links));

    // The hook.
    t.ck("under the card, an ad speaks to the people who hire", pack.ad
      && /organized in one place/i.test(pack.ad.head) && pack.ad.headSize >= 24, JSON.stringify(pack.ad));
    t.ck("and its button signs them up, carrying the pack", pack.ad
      && pack.ad.href === "https://subsub.work/get-started.html?pack=TOKEN123" && /Create your free account/i.test(pack.ad.btn), JSON.stringify(pack.ad));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a pack with no seal earned and no contact or town --");
  {
    const keep = PACK;
    PACK = { ...PACK, contact: null, where: null, passportUrl: null, trades: [], licenseVerified: false,
      docs: PACK.docs.filter((d) => d.kind !== "contract"),
      badge: { verified: false, name: null, line: "License not verified by SubSub · Insurance on file, no expiry date given" } };
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
    await wait(2200);
    const v = await page.evaluate(() => {
      const el = document.querySelector(".pack-card");
      return el ? { seal: !!el.querySelector(".pack-badge"), lede: !!el.querySelector(".pack-lede"),
        lic: !!el.querySelector(".pack-lic"), licBad: !!el.querySelector(".pack-lic.bad"),
        licBorder: el.querySelector(".pack-lic") ? getComputedStyle(el.querySelector(".pack-lic")).borderColor : "",
        licText: el.querySelector(".pack-lic")?.innerText || "", name: el.querySelector("h1")?.innerText || "",
        pass: /Passport/.test(el.innerText), what: el.querySelector(".pack-what")?.innerText || "" } : null;
    });
    t.ck("the page still draws", !!v && v.name === "Ridge Roofing", JSON.stringify(v));
    t.ck("no seal is drawn when it is not earned", v && !v.seal, JSON.stringify(v));
    t.ck("the license line stands in for it", v && v.lic, JSON.stringify(v));
    t.ck("an unverified license is red with a cross", v && v.licBad && v.licBorder === "rgb(198, 47, 42)"
      && /License not verified/.test(v.licText), JSON.stringify(v));
    t.ck("and no empty contact line", v && !v.lede, JSON.stringify(v));
    t.ck("and no Passport link when none is published", v && !v.pass, JSON.stringify(v));
    t.ck("with no agreement, the summary leaves it out and says when it comes",
      v && /find Ridge Roofing's surety bond, certificate of insurance and IRS Form W-9\./.test(v.what)
      && /added once you connect and sign one/.test(v.what), v && v.what);
    PACK = keep;
    await ctx.close();
  }

  console.log("\n-- a link that is no longer any good --");
  {
    for (const [err, phrase] of [
      [{ status: 410, body: { error: "revoked", company: "Ridge Roofing" } }, /withdrawn/i],
      [{ status: 410, body: { error: "expired", company: "Ridge Roofing" } }, /expired/i],
      [{ status: 404, body: { error: "not_found" } }, /couldn.t find/i],
    ]) {
      PACK_ERR = err;
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
      await wait(1800);
      const text = await page.evaluate(() =>
        document.querySelector(".pack-card")?.innerText.replace(/\s+/g, " ").trim() || "");
      t.ck(`a ${err.body.error} link says so`, phrase.test(text), text);
      // And nothing of the paperwork leaks on the way past.
      t.ck(`and shows no documents`, !/Cascade Mutual|POL-44812/.test(text), text);
      await ctx.close();
    }
    PACK_ERR = null;
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
