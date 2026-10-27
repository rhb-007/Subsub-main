// A SECOND BUSINESS, ON SCREEN (099).
//
// A general contractor that also manages buildings adds the other business
// from Account -> Company. What only a browser can answer:
//
//   It is offered on the Company tab, names the kinds that are the OTHER side
//   only, and creating it posts what the form shows.
//
//   Once linked the panel names the other business, and the way there is the
//   profile menu and the drawer, not a button inside Company,
//   and the Subscription tab says which of the two is discounted.
//
//   node --no-warnings scripts/linked-business-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-linked-test");
const WEB = 5387, API = 9087;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

let LINKED = null;
const posted = [];
const ACCOUNT = () => ({
  id: "acc_gc", name: "Rudd Development", subdomain: "rudddev", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"], logoKey: null,
  subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_marc", name: "Marc Rudd", email: "marc@rudd.test", role: "admin" },
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/account/second-business" && method === "POST") {
    posted.push(body);
    LINKED = { other: { id: "acc_pm", name: body.name, subdomain: body.subdomain, kind: body.kind },
      discountOn: null, cheaper: "this", discountPercent: 50 };
    return [201, { id: "acc_pm", name: body.name, subdomain: body.subdomain, kind: body.kind,
      plan: "basic", connected: true, discountPercent: 50 }];
  }
  if (path === "/api/account/second-business") return [200, { linked: LINKED,
    allowed: ["property_manager", "portfolio_manager", "building_owner"], discountPercent: 50 }];
  if (path === "/api/billing") return [200, { plan: "scale", cycle: "monthly", status: "active", invoices: [],
    configured: true, linked: LINKED && { ...LINKED, discountOn: "this" } }];
  if (path === "/api/account/owner" && method === "POST") { posted.push({ owner: body.userId }); return [200, { ok: true, ownerId: body.userId }]; }
  if (path === "/api/account-users") return [200, [{ id: "u_marc", name: "Marc Rudd", email: "marc@rudd.test",
    role: "admin", propertyIds: [], hasLogin: true, isOwner: true },
    { id: "u_jo", name: "Jo Admin", email: "jo@rudd.test", role: "admin", propertyIds: [], hasLogin: true, isOwner: false }]];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_gc", company: "Rudd Development",
    contact: "Marc Rudd", docs: {}, sharesSent: 0, openToHire: true }];
  if (["/api/subs", "/api/jobs", "/api/properties"].includes(path)) return [200, []];
  if (path === "/api/weather") return [200, {}];
  return undefined;
} });

const browser = await launch();
const openTab = async (page, label) => {
  await page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
  await wait(900);
  await page.evaluate((l) => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === l)?.click(), label);
  await wait(1000);
};
const panel = (page) => page.evaluate(() => {
  const el = document.querySelector(".sb-panel");
  if (!el) return null;
  return {
    head: el.querySelector("h4")?.innerText.trim(),
    text: el.innerText.replace(/\s+/g, " "),
    kinds: [...el.querySelectorAll("select option")].map((o) => o.value),
  };
});
const setVal = (page, sel, v) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, sel, v);

try {
  const { page, crashes } = await visitApp(browser, { host: "rudddev", webPort: WEB,
    seat: { userId: "u_marc", accountId: "acc_gc" }, viewport: { width: 1180, height: 1600 } });
  await wait(2200);
  console.log("\n-- 100: the account owner, on Users --");
  await openTab(page, "Users");
  const rows = await page.evaluate(() => [...document.querySelectorAll(".user-row")].map((r) => ({
    name: r.querySelector("h4")?.innerText.trim(),
    owner: !!r.querySelector(".owner-badge"),
    make: [...r.querySelectorAll("button")].some((b) => /Make owner/.test(b.innerText)),
    trash: !!r.querySelector(".icon-x"),
  })));
  const marc = rows.find((r) => r.name === "Marc Rudd"), jo = rows.find((r) => r.name === "Jo Admin");
  t.ck("both admins are listed", !!marc && !!jo, JSON.stringify(rows));
  t.ck("the owner carries the badge, and only the owner", marc?.owner && !jo?.owner, JSON.stringify(rows));
  t.ck("the owner may hand it to the other admin", jo?.make && !marc?.make, JSON.stringify(rows));
  t.ck("the note says who owns it", await page.evaluate(() => /You own this account/.test(document.querySelector(".owner-note")?.innerText || "")));
  await page.evaluate(() => [...document.querySelectorAll(".user-row button")].find((b) => /Make owner/.test(b.innerText))?.click());
  await wait(400);
  t.ck("handing it on asks first", await page.evaluate(() => /Make Jo Admin the account owner/.test(document.body.innerText)));
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.innerText.trim() === "Make owner")?.click());
  await wait(900);
  t.ck("and posts who", posted.some((p) => p.owner === "u_jo"), JSON.stringify(posted));
  const after = await page.evaluate(() => [...document.querySelectorAll(".user-row")].map((r) => ({
    name: r.querySelector("h4")?.innerText.trim(), owner: !!r.querySelector(".owner-badge"),
    trash: !!r.querySelector(".icon-x") })));
  t.ck("after which Jo is the owner and cannot be removed by Marc",
    after.find((r) => r.name === "Jo Admin")?.owner && !after.find((r) => r.name === "Jo Admin")?.trash, JSON.stringify(after));

  console.log("\n-- offered on the Company tab --");
  await openTab(page, "Company");
  const p = await panel(page);
  t.ck("the panel is there", !!p, JSON.stringify(p));
  t.ck("asking whether they also run a second business", /second business/i.test(p?.head || ""), p?.head);
  t.ck("and saying the cheaper one is half off while both are on Scale",
    /cheaper of the two is 50% off while both are on Scale/.test(p?.text || ""), p?.text);
  await page.evaluate(() => [...document.querySelectorAll(".sb-panel button")]
    .find((b) => /Add a second business/.test(b.innerText))?.click());
  await wait(300);
  const f = await panel(page);
  t.ck("the kinds offered are the management side only",
    JSON.stringify(f?.kinds) === JSON.stringify(["property_manager", "portfolio_manager", "building_owner"]), JSON.stringify(f?.kinds));
  t.ck("the address starts from theirs", await page.evaluate(() =>
    [...document.querySelectorAll(".sb-panel input")][1]?.value === "rudddevpm"));
  await setVal(page, ".sb-panel input", "Rudd Property Management");
  await wait(150);
  await page.evaluate(() => [...document.querySelectorAll(".sb-panel button")]
    .find((b) => /Create the second business/.test(b.innerText))?.click());
  await wait(1500);
  t.ck("it posts the name, address and kind", JSON.stringify(posted.find((p) => p.kind)) ===
    JSON.stringify({ kind: "property_manager", name: "Rudd Property Management", subdomain: "rudddevpm" }), JSON.stringify(posted));

  console.log("\n-- once linked --");
  await openTab(page, "Company");
  const l = await panel(page);
  t.ck("the panel names the other business", /Rudd Property Management/.test(l?.text || "")
    && /Property manager/.test(l?.text || ""), l?.text);
  t.ck("and no Open button of its own, because the way there is the menu", await page.evaluate(() =>
    ![...document.querySelectorAll(".sb-panel button")].some((b) => /^Open /.test(b.innerText.trim()))));
  t.ck("it says where it is opened from", /menu under your name/.test(l?.text || ""), l?.text);
  await page.evaluate(() => { if (!document.querySelector(".user-menu")) document.querySelector(".user-btn")?.click(); });
  await wait(500);
  const m = await page.evaluate(() => [...document.querySelectorAll(".um-linked")].map((b) => b.innerText.replace(/\s+/g, " ")));
  t.ck("the profile menu carries the other business, once", m.length === 1
    && /Rudd Property Management/.test(m[0]) && /Your other business/.test(m[0]), JSON.stringify(m));
  t.ck("the drawer carries it too", await page.evaluate(() =>
    /Rudd Property Management/.test(document.querySelector(".drawer-linked")?.textContent || "")));
  await openTab(page, "Subscription");
  const sub = await page.evaluate(() => document.querySelector(".linked-discount")?.innerText.replace(/\s+/g, " ") || "");
  t.ck("the Subscription tab says this one is half off, and why",
    /50% off/.test(sub) && /Rudd Property Management pays for SubSub too/.test(sub), sub);

  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
