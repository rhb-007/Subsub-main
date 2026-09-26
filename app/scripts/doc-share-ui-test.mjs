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
const sends = [], revokes = [];
// What the recipient's page is served.
let PACK = {
  company: "Ridge Roofing", contact: "Sam Ridge", where: "Seattle, WA",
  license: "RIDGERR891QZ", licenseVerified: true, licenseCheckedAt: "2026-09-12",
  sentTo: "Priya", note: "As asked on Tuesday.", expiresAt: "2026-10-10 00:00:00",
  docs: [
    { kind: "insurance", onFile: true, issuer: "Cascade Mutual", policyNo: "POL-44812",
      coverageCents: 200000000, expiresOn: "2027-03-14", readable: true, gated: false, id: "d_ins" },
    { kind: "bond", onFile: true, issuer: "Western Surety", policyNo: "BND-991",
      coverageCents: 3000000, expiresOn: null, readable: true, gated: false, id: "d_bond" },
    { kind: "contract", onFile: true, expiresOn: null, readable: true, gated: false, id: "d_con" },
    // THE ONE THAT MUST NOT BE OPENABLE.
    { kind: "w9", onFile: true, issuer: null, policyNo: null, coverageCents: null,
      expiresOn: null, readable: false, gated: true, id: "d_w9" },
  ],
};
let PACK_ERR = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  // The seat's own row. membership.companyId comes from subId here, and it is
  // what links this login to the contractor record -- without it the portal
  // says the login is not linked to one and none of their screens render.
  if (path === "/api/account-users") return [200, [
    { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", phone: null, role: "contractor",
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
      .find((b) => /^My Documents/.test(b.innerText.trim().split("\n")[0]))?.click());
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

  console.log("\n-- and the contractor who receives it --");
  {
    PACK_ERR = null;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    // No seat, no session, nothing. That is the whole point.
    await page.goto(`http://outerhome.subsub.work:${WEB}/?pack=TOKEN123`, { waitUntil: "networkidle2" });
    await wait(2200);

    const pack = await page.evaluate(() => {
      const el = document.querySelector(".pack-card");
      if (!el) return null;
      return { text: el.innerText.replace(/\s+/g, " ").trim(),
        docs: [...el.querySelectorAll(".pack-doc")].map((d) => ({
          text: d.innerText.replace(/\s+/g, " ").trim(),
          link: d.querySelector("a")?.getAttribute("href") || null })),
        links: [...el.querySelectorAll("a")].map((a) => a.getAttribute("href")) };
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
    t.ck("it can be opened", !!ins.link && /\/pack\/TOKEN123\/file\/d_ins/.test(ins.link), String(ins.link));

    // A document with no shelf life says so rather than looking unknown.
    const con = pack.docs.find((d) => /Signed subcontractor agreement/.test(d.text));
    t.ck("something that does not expire says so", /Does not expire/.test(con.text), con.text);

    // THE ONE THAT MATTERS.
    const w9 = pack.docs.find((d) => /W-9/.test(d.text));
    t.ck("the W-9 is listed as on file", /On file/.test(w9.text), w9.text);
    t.ck("with no way to open it", w9.link === null, String(w9.link));
    t.ck("and the page says why", /carries a tax number/i.test(pack.text), pack.text);
    t.ck("no file link anywhere points at it",
      !pack.links.some((h) => /d_w9/.test(h || "")), JSON.stringify(pack.links));

    // The hook.
    t.ck("it says the page stays current", /This page stays current/i.test(pack.text), pack.text);
    t.ck("and offers an account without demanding one",
      /Create a free account/i.test(pack.text), pack.text);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
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
