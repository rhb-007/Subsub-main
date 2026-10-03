// Sending your compliance pack from the menu, with an email address and
// nothing else.
//
// The panel on Compliance pack is for MANAGING what has been sent -- the list, the
// view counts, revoking. This is the other half of the same act: a general
// contractor asks for your insurance while you are standing on their site, and
// the answer should be six seconds long. It sits beside My QR code because they
// are the same kind of thing -- give somebody your details without a
// conversation. The code is how they add you; this is how they get your paper.
//
// What this covers:
//
//   ONE FIELD. Every extra box is a reason to do it later, and later is when
//   people go back to attaching PDFs.
//
//   GATED ON PRESENCE, NOT VERIFICATION, and the screen must agree with the
//   server -- which refuses with nothing_on_file.
//
//   THE W-9 CAVEAT IS SAID BEFORE SENDING, not discovered after. It carries a
//   tax number, and for a sole proprietor that is their social security number.
//
//   node scripts/quicksend-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-quicksend-test");
const WEB = 5241, API = 8953;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", role: "contractor" },
};
let SUB = {
  id: "cmp_ridge", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_gc",
  contact: "Sam Ridge", email: "sam@ridge.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "RIDGERR891QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
const sends = [];
let FAIL_WITH = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/account-users") return [200, [
    { id: "u_sam", name: "Sam Ridge", email: "sam@ridge.test", phone: null, role: "contractor",
      subId: "cmp_ridge", propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/connect/code") return [200, { code: "RIDGE-4821", url: "https://x.test" }];
  if (path === "/api/doc-shares" && method === "POST") {
    if (FAIL_WITH) return [FAIL_WITH.status, FAIL_WITH.body];
    sends.push(body);
    return [201, { id: "sh1", toEmail: body.toEmail, state: "active",
      expiresAt: "2026-10-11 00:00:00", viewCount: 0, sent: true }];
  }
  if (path === "/api/doc-shares") return [200, []];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers") return [200, []];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/my-quotes") return [200, []];
  return undefined;
} });

const browser = await launch();
const openMenu = async () => {
  const v = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_sam", accountId: "acc_gc" }, viewport: { width: 1280, height: 1100 } });
  await wait(2900);
  // The header's user menu, which is where this lives on a desktop width.
  await v.page.evaluate(() => document.querySelector(".user-btn")?.click());
  await wait(600);
  return v;
};

try {
  console.log("\n-- it sits beside the QR code, and takes one field --");
  {
    sends.length = 0; FAIL_WITH = null;
    const { ctx, page, crashes } = await openMenu();

    const items = await page.evaluate(() => [...document.querySelectorAll(".user-menu .um-qr")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("the QR code is in the menu", items.some((i) => /My QR code/.test(i)), JSON.stringify(items));
    t.ck("and sending documents is right beside it",
      items.some((i) => /Quick send/.test(i)), JSON.stringify(items));

    await page.evaluate(() => [...document.querySelectorAll(".user-menu .um-qr")]
      .find((b) => /Quick send/.test(b.innerText))?.click());
    await wait(500);

    const peek = await page.evaluate(() => {
      const el = document.querySelector(".qsend-peek");
      if (!el) return null;
      return { inputs: el.querySelectorAll("input").length,
        textareas: el.querySelectorAll("textarea").length,
        type: el.querySelector("input")?.type || null,
        text: el.innerText.replace(/\s+/g, " ").trim() };
    });
    t.ck("it opens in place, not on another screen", !!peek, String(peek));
    // The whole point of "quick".
    t.ck("exactly one field", peek.inputs === 1, String(peek.inputs));
    t.ck("no name, no note", peek.textareas === 0, String(peek.textareas));
    t.ck("and it asks for an email address", peek.type === "email", String(peek.type));
    t.ck("it says what is in the pack",
      /certificate of insurance/i.test(peek.text), peek.text.slice(0, 120));
    t.ck("and why it beats an attachment",
      /not an attachment that goes stale/i.test(peek.text), peek.text.slice(0, 200));
    // Said before, not discovered after.
    t.ck("the W-9 caveat is on the form",
      /W-9 shows as on file but stays behind a sign-in/i.test(peek.text), peek.text);

    await page.evaluate(() => {
      const el = document.querySelector(".qsend-row input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "pm@cascade.test");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".qsend-row button")]
      .find((b) => /^Send$/i.test(b.innerText.trim()))?.click());
    await wait(900);

    t.ck("it reaches the server", sends.length === 1, JSON.stringify(sends));
    t.ck("addressed to who they typed", sends[0]?.toEmail === "pm@cascade.test");
    t.ck("and sends nothing else", Object.keys(sends[0] || {}).join(",") === "toEmail",
      JSON.stringify(Object.keys(sends[0] || {})));

    const done = await page.evaluate(() =>
      document.querySelector(".qsend-done")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("and says so, by name", /Sent to pm@cascade.test/.test(done || ""), String(done));
    t.ck("with how long it lasts", /14 days/.test(done || ""), String(done));
    t.ck("and offers to send another", /Send another/.test(done || ""), String(done));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- nothing on file, nothing to send --");
  {
    // The server refuses this with nothing_on_file. The screen must agree, or
    // somebody types an address and gets an error for something they could
    // have been told before typing.
    SUB = { ...SUB, insurance: false, bond: false, contract: false, w9: false };
    const { ctx, page, crashes } = await openMenu();
    const items = await page.evaluate(() => [...document.querySelectorAll(".user-menu .um-qr")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("sending is not offered", !items.some((i) => /Quick send/.test(i)),
      JSON.stringify(items));
    t.ck("but the QR code still is", items.some((i) => /My QR code/.test(i)),
      JSON.stringify(items));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    SUB = { ...SUB, insurance: true, bond: true, contract: true, w9: true };
  }

  console.log("\n-- one document is enough, and presence is the test --");
  {
    // Not verification: whether some other account has reviewed a certificate
    // says nothing about whether there is one to send.
    SUB = { ...SUB, insurance: true, bond: false, contract: false, w9: false,
      docReview: { insurance: { status: "rejected" } } };
    const { ctx, page, crashes } = await openMenu();
    const items = await page.evaluate(() => [...document.querySelectorAll(".user-menu .um-qr")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("one document on file is enough to offer it",
      items.some((i) => /Quick send/.test(i)), JSON.stringify(items));
    t.ck("even unverified", true);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    SUB = { ...SUB, bond: true, contract: true, w9: true, docReview: {} };
  }

  console.log("\n-- a refusal is said in the panel, not swallowed --");
  {
    FAIL_WITH = { status: 429, body: { error: "rate_limited" } };
    const { ctx, page, crashes } = await openMenu();
    await page.evaluate(() => [...document.querySelectorAll(".user-menu .um-qr")]
      .find((b) => /Quick send/.test(b.innerText))?.click());
    await wait(500);
    await page.evaluate(() => {
      const el = document.querySelector(".qsend-row input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "pm@cascade.test");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".qsend-row button")]
      .find((b) => /^Send$/i.test(b.innerText.trim()))?.click());
    await wait(900);
    const err = await page.evaluate(() =>
      document.querySelector(".qsend-err")?.innerText.trim() || null);
    t.ck("the reason is shown", /lot of sending/i.test(err || ""), String(err));
    t.ck("and it does not claim to have sent",
      await page.evaluate(() => !document.querySelector(".qsend-done")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    FAIL_WITH = null;
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
