// My account's tab row stays inside the page, and the compliance pack and the
// Passport are one tab with two halves.
//
// Reported on an iPad: nine tabs ran off the right edge with "Subscription"
// cut in half. What is asserted is the drawn row at iPad and phone widths:
// every tab's right edge is inside the page, the merged tab is there once, its
// two halves each open their own panel, and the nav's Compliance pack entry
// still lands on the documents.
//
//   node --no-warnings scripts/acct-tabs-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-accttabs-test");
const WEB = 5571, API = 9271;
const t = tally();

const acct = () => ({
  id: "acc_gc", name: "Outerhome Roofing", subdomain: "outerhome",
  kind: "general_contractor", plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
});
const MY_COMPANY = {
  companyId: "cmp_gc", company: "Outerhome Roofing", contact: "Richard Braun",
  email: "rb@outerhome.test", phone: "2067778888", license: "OUTERHR881QT", ubi: "",
  city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_gc", openToHire: true, openAnswered: true,
  url: null, sharesSent: 0,
  licenseCheck: { found: true, status: "ACTIVE", expirationDate: "2027-12-31", checkedAt: "2026-10-20", licenseNumber: "OUTERHR881QT" },
};
let checks = 0;
const saves = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "PATCH" && path === "/api/my-company") {
    const b = typeof body === "string" ? JSON.parse(body || "{}") : (body || {});
    saves.push(b);
    return [200, { ...MY_COMPANY, ...b, licenseVerify: { checked: true },
      licenseCheck: { found: false, status: "NOT_FOUND", checkedAt: "2026-10-28", licenseNumber: b.license } }];
  }
  if (method === "POST" && path === "/api/my-company/verify-license") {
    checks++;
    return new Promise((res) => setTimeout(() => res([200, { found: true, status: "ACTIVE", expirationDate: "2028-06-30", checkedAt: "2026-10-28", licenseNumber: "OUTERHR881QT" }]), 700));
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return [200, MY_COMPANY];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_r", name: "Richard Braun", email: "rb@outerhome.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openAccount = async (page) => {
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(700);
};
const readRow = (page) => page.evaluate(() => {
  const row = document.querySelector(".ss-main .acct-tabs");
  if (!row) return null;
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector(".ss-main").getBoundingClientRect();
  const btns = [...row.querySelectorAll("button")].map((b) => {
    const r = b.getBoundingClientRect();
    return { text: b.innerText.trim(), right: Math.round(r.right), left: Math.round(r.left),
      clipped: b.scrollWidth > b.clientWidth + 1 };
  });
  return { vw, mainRight: Math.round(main.right), rowRight: Math.round(row.getBoundingClientRect().right),
    pageScroll: document.documentElement.scrollWidth > vw, btns };
});

try {
  for (const [w, h] of [[820, 1180], [1024, 1366], [1180, 820], [390, 844]]) {
    console.log(`\n-- ${w}px --`);
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_r", accountId: "acc_gc" }, viewport: { width: w, height: h } });
    await wait(2000);
    await openAccount(page);
    const r = await readRow(page);
    t.ck(`the tab row is drawn at ${w}px`, !!r && r.btns.length >= 7, JSON.stringify(r));
    const out = (r?.btns || []).filter((b) => b.right > r.vw || b.left < 0);
    t.ck(`every tab is inside the page at ${w}px`, !!r && r.btns.length > 0 && out.length === 0, JSON.stringify(out));
    t.ck(`the row ends inside the page at ${w}px`, !!r && r.rowRight <= r.vw, JSON.stringify({ row: r?.rowRight, vw: r?.vw }));
    t.ck(`no tab's label is cut at ${w}px`, !!r && r.btns.length > 0 && !r.btns.some((b) => b.clipped), JSON.stringify(r?.btns));
    t.ck(`Subscription is a whole tab at ${w}px`, !!r?.btns.find((b) => b.text === "Subscription" && b.right <= r.vw));
    t.ck(`the page does not scroll sideways at ${w}px`, r && !r.pageScroll);
    t.ck(`no page error at ${w}px`, crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- one tab, two halves --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_r", accountId: "acc_gc" }, viewport: { width: 820, height: 1180 } });
  await wait(2000);
  await openAccount(page);
  const tabs = (await readRow(page))?.btns.map((b) => b.text) || [];
  t.ck("the pack and the Passport are one tab", tabs.filter((x) => x === "Pack & Passport").length === 1, JSON.stringify(tabs));
  t.ck("neither is a top-level tab of its own", !tabs.includes("Compliance pack") && !tabs.includes("Passport"), JSON.stringify(tabs));
  t.ck("no sub-switch before the tab is opened", await page.evaluate(() => !document.querySelector(".acct-subtabs")));
  await page.evaluate(() => [...document.querySelectorAll(".acct-tabs button")].find((b) => b.innerText.trim() === "Pack & Passport")?.click());
  await wait(800);
  const s1 = await page.evaluate(() => ({
    sub: [...document.querySelectorAll(".acct-subtabs button")].map((b) => ({ t: b.innerText.trim(), on: b.classList.contains("on") })),
    docs: !!document.querySelector(".mydocs"),
    tabOn: [...document.querySelectorAll(".acct-tabs button.on")].map((b) => b.innerText.trim()),
  }));
  t.ck("it opens on the compliance pack", s1.docs && s1.sub.find((x) => x.t === "Compliance pack")?.on, JSON.stringify(s1));
  t.ck("with the Passport one press away", s1.sub.map((x) => x.t).join(",") === "Compliance pack,Passport", JSON.stringify(s1));
  await page.evaluate(() => [...document.querySelectorAll(".acct-subtabs button")].find((b) => b.innerText.trim() === "Passport")?.click());
  await wait(800);
  const s2 = await page.evaluate(() => ({
    docs: !!document.querySelector(".mydocs"),
    tabOn: [...document.querySelectorAll(".acct-tabs button.on")].map((b) => b.innerText.trim()),
    subOn: [...document.querySelectorAll(".acct-subtabs button.on")].map((b) => b.innerText.trim()),
  }));
  t.ck("the Passport half replaces the documents", !s2.docs && s2.subOn.join() === "Passport", JSON.stringify(s2));
  t.ck("and the merged tab stays lit", s2.tabOn.join() === "Pack & Passport", JSON.stringify(s2));

  console.log("\n-- the account's own license, on Company --");
  await page.evaluate(() => [...document.querySelectorAll(".acct-tabs button")].find((b) => b.innerText.trim() === "Company")?.click());
  await wait(900);
  const lic = await page.evaluate(() => ({
    text: document.querySelector(".own-lic")?.innerText || "",
    active: !!document.querySelector(".own-lic .lic-chip.s-active"),
    under: (() => { const a = document.querySelector(".fld-nums"), b = document.querySelector(".own-lic");
      return !!a && !!b && b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 6; })(),
  }));
  t.ck("the state register's answer is under License number", lic.active && /State register: Active/.test(lic.text) && lic.under, JSON.stringify(lic));
  await page.evaluate(() => [...document.querySelectorAll(".own-lic button")].find((b) => /Check now/.test(b.innerText))?.click());
  await wait(250);
  // Held open by the stub, so the screen can be read while it checks.
  const mid = await page.evaluate(() => ({
    chip: document.querySelector(".own-lic .lic-chip")?.innerText || "",
    spin: !!document.querySelector(".own-lic .own-lic-spin"),
    turning: getComputedStyle(document.querySelector(".own-lic .own-lic-spin") || document.body).animationName,
    btn: document.querySelector(".own-lic button")?.innerText.trim(),
  }));
  t.ck("while it checks, the line says who it is asking", /Checking with Washington L&I/.test(mid.chip), JSON.stringify(mid));
  t.ck("with a turning spinner", mid.spin && mid.turning !== "none", JSON.stringify(mid));
  t.ck("and the button says Checking", /Checking/.test(mid.btn || ""), JSON.stringify(mid));
  await wait(900);
  t.ck("once it answers, it says it just checked", /Checked just now/.test(await page.evaluate(() => document.querySelector(".own-lic")?.innerText || "")));
  const after = await page.evaluate(() => document.querySelector(".own-lic")?.innerText || "");
  t.ck("Check now asks the server", checks === 1, String(checks));
  t.ck("and draws the new answer", /Jun 30, 2028|2028/.test(after), after);
  // An edited number is not the one the answer is about.
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll(".fld-nums input")][0];
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(inp, "NEWNUMBER1"); inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(300);
  const edited = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".own-lic button")][0];
    return { label: b?.innerText.trim(), disabled: b?.disabled, line: document.querySelector(".own-lic .lic-chip")?.innerText || "" };
  });
  // Reported: the button was greyed out over an unsaved number, with the
  // reason drawn under the line, and read as a button that did nothing.
  t.ck("an unsaved new number offers Save and check, pressable", edited.label === "Save and check" && edited.disabled === false, JSON.stringify(edited));
  t.ck("and the line says it is not checked yet, not the old answer", /isn't saved/.test(edited.line) && !/Active/.test(edited.line), JSON.stringify(edited));
  await page.evaluate(() => [...document.querySelectorAll(".own-lic button")][0]?.click());
  await wait(900);
  t.ck("pressing it saves the new number", saves.at(-1)?.license === "NEWNUMBER1", JSON.stringify(saves.at(-1)));
  const done = await page.evaluate(() => document.querySelector(".own-lic")?.innerText || "");
  t.ck("and draws the check the save came back with", /Not found in the state register/.test(done), done);

  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
