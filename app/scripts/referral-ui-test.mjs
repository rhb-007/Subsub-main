// 075. GET YOUR GCs ON SUBSUB, AND REFER A GC, in a browser.
//
// What is pinned:
//
//   A SUB FINDS IT IN THE NAV; A HIRING ACCOUNT FINDS IT IN ACCOUNT. Both
//   branches in the same suite, because a screen wired on one is the diagonal
//   coverage that left hiresLabel half-wired.
//
//   THE CODE, THE LINK AND THE MESSAGE ARE ON THE SCREEN, and the badge only
//   for a sub who earned it.
//
//   EMAILS POST; TEXTS DO NOT. A phone number becomes an sms: link that opens
//   the sender's own messages app with the invite written, and the press is
//   only counted -- SubSub never texts anybody. The body of the POST is read.
//
//   THE CONSOLE'S LEDGER moves by hand, and asks for a reference to mark paid.
//
//   node --no-warnings scripts/referral-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-referral-test");
const WEB = 5453, API = 9153;
const t = tally();

let KIND = "subcontractor";
const posts = [];
const mine = () => (KIND === "subcontractor" ? {
  available: true, kind: "sub", code: "K7Q2MXRB", link: "https://subsub.work/gc?ref=K7Q2MXRB",
  from: "Cascade Apartment Services", preferredSub: true, opens: 4, invitesToday: 1, inviteLimit: 25,
  referred: [{ name: "Outerhome", kind: "general_contractor", joinedAt: "2026-09-30 10:00:00", via: "link",
    paying: true, reward: { kind: "sub_cash", status: "pending", amountCents: 10000 } }],
  rewards: [],
} : {
  available: true, kind: "gc", code: "GC4R7TQZ", link: "https://subsub.work/gc?ref=GC4R7TQZ",
  from: "Sound Property Management", preferredSub: false, opens: 0, invitesToday: 0, inviteLimit: 25,
  referred: [], rewards: [],
});
const acct = () => ({
  id: "acc_x", name: KIND === "subcontractor" ? "Cascade Apartment Services" : "Sound Property Management",
  subdomain: "cascade", kind: KIND, plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rb", name: "R Braun", email: "rb@cascade.test", role: "admin" },
});
const company = () => ({
  companyId: "cmp_cas", company: "Cascade Apartment Services", contact: "R Braun", email: "rb@cascade.test",
  phone: "2065550199", license: "", ubi: "", city: "Tacoma", state: "WA", zip: "98407",
  coverage: { mode: "cities", cities: ["Tacoma"], radii: [] }, docs: {}, findable: true, code: "c",
  openToHire: true, openAnswered: true, url: null, sharesSent: 0, crews: [],
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/referrals/mine") return [200, mine()];
  if (path === "/api/referrals/invites" && method === "POST") {
    posts.push(body);
    return [200, { ok: true, sent: (body.emails || []).length, texted: body.sms || 0, skipped: [], left: 20 }];
  }
  if (path === "/api/my-company") return KIND === "subcontractor" ? [200, company()] : [409, { error: "not_hireable" }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [{ id: "u_rb", name: "R Braun", email: "rb@cascade.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers", "/api/my-quotes",
    "/api/doc-shares", "/api/inspections", "/api/change-orders", "/api/tenants", "/api/agreements"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
const read = (page) => page.evaluate(() => {
  const r = document.querySelector(".refer");
  return {
    there: !!r,
    head: r?.querySelector(".page-head h2")?.innerText || "",
    code: r?.querySelector(".refer-codev")?.innerText || "",
    link: r?.querySelector(".refer-link")?.innerText || "",
    msg: r?.querySelector(".refer-msg")?.innerText || "",
    badge: !!r?.querySelector(".refer-badge"),
    qr: !!r?.querySelector(".refer-code svg.qr"),
    rows: [...(r?.querySelectorAll(".refer-rows li") || [])].map((li) => li.innerText.replace(/\s+/g, " ")),
    phones: [...(r?.querySelectorAll(".refer-phones a") || [])].map((a) => a.getAttribute("href")),
    emailBtn: [...(r?.querySelectorAll("button") || [])].find((b) => /^Email \d+ invite/.test(b.innerText.trim()))?.innerText.trim() || "",
  };
});
const typeInto = (page, sel, v) => page.evaluate(({ sel, v }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, { sel, v });

try {
  console.log("\n-- a subcontractor account --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_x" }, viewport: { width: 1200, height: 1700 } });
    await wait(2600);
    const items = await nav(page);
    t.ck("the app rendered", items.length > 0, JSON.stringify(items));
    t.ck("Get your GCs on SubSub is in the nav", items.some((x) => /^Get your GCs on SubSub/.test(x)), JSON.stringify(items));
    await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^Get your GCs/.test(b.innerText.trim()))?.click());
    await wait(1200);
    let r = await read(page);
    t.ck("it opens the screen", r.there && r.head === "Get your GCs on SubSub", JSON.stringify(r).slice(0, 300));
    t.ck("with the code and the link", r.code === "K7Q2MXRB" && r.link === "https://subsub.work/gc?ref=K7Q2MXRB");
    t.ck("and a QR code of the link", r.qr);
    t.ck("the pre-written message carries the link and the company",
      r.msg.includes("https://subsub.work/gc?ref=K7Q2MXRB") && r.msg.includes("Cascade Apartment Services"), r.msg);
    t.ck("a sub who earned it sees Preferred Sub", r.badge);
    t.ck("and who came in, with the reward in words", r.rows.some((x) => /Outerhome/.test(x) && /\$100 earned/.test(x)), JSON.stringify(r.rows));

    await typeInto(page, ".refer-send textarea", "boss@outerhome.test, (253) 555-0100\nnot-a-thing");
    await wait(500);
    r = await read(page);
    t.ck("a phone number becomes a text in the sender's own messages app",
      r.phones.length === 1 && r.phones[0].startsWith("sms:2535550100?&body=") && decodeURIComponent(r.phones[0]).includes("gc?ref=K7Q2MXRB"),
      JSON.stringify(r.phones));
    t.ck("an email becomes one press", r.emailBtn === "Email 1 invite", r.emailBtn);
    t.ck("and nonsense is named", /Not a phone number or an email: not-a-thing/.test(await page.evaluate(() => document.querySelector(".refer-send")?.innerText || "")));
    const before = posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".refer button")].find((b) => /^Email \d+ invite/.test(b.innerText.trim()))?.click());
    await wait(900);
    const sent = posts.slice(before);
    t.ck("emailing posts the addresses and nothing else",
      sent.length === 1 && JSON.stringify(sent[0].emails) === JSON.stringify(["boss@outerhome.test"]) && !sent[0].phones,
      JSON.stringify(sent));
    t.ck("and says it went", /Sent 1 invite/.test(await page.evaluate(() => document.querySelector(".refer-ok")?.innerText || "")));
    const b2 = posts.length;
    await page.evaluate(() => {
      const a = document.querySelector(".refer-phones a");
      a?.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
      a?.click();
    });
    await wait(700);
    t.ck("a text is only COUNTED -- no number reaches SubSub",
      posts.length === b2 + 1 && posts[b2].sms === 1 && !JSON.stringify(posts[b2]).includes("555"), JSON.stringify(posts.slice(b2)));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a hiring account --");
  KIND = "property_manager";
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_x" }, viewport: { width: 1200, height: 1700 } });
    await wait(2600);
    const items = await nav(page);
    t.ck("the app rendered for a property manager", items.length > 0);
    t.ck("there is no sub's entry in the nav", !items.some((x) => /^Get your GCs/.test(x)), JSON.stringify(items));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /My account/.test(b.innerText))?.click());
    await wait(1000);
    const tabs = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((x) => /^Refer a GC$/.test(x)));
    t.ck("Account has a Refer a GC tab", tabs.length === 1, JSON.stringify(tabs));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Refer a GC")?.click());
    await wait(1200);
    const r = await read(page);
    t.ck("it opens the same screen, worded for the hiring side",
      r.there && r.head === "Refer a GC" && r.code === "GC4R7TQZ", JSON.stringify(r).slice(0, 300));
    t.ck("and says what both sides earn",
      /month of Scale free/.test(await page.evaluate(() => document.querySelector(".refer-earn")?.innerText || "")));
    t.ck("no Preferred Sub badge on a hiring account", !r.badge);
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
