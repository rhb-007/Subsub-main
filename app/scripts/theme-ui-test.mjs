// Dark mode: a Theme picker (System, Dark, Light) in the profile menu and the
// drawer, remembered on this device, with the dark sheet derived from the light
// one (lib/darkcss.js).
//
// What is asserted is the drawn page, read through getComputedStyle: the page
// and a card really go dark, the text really goes light, the choice survives a
// reload, System follows the device, and a signed-out page stays light because
// it wears a company's colors.
//
//   node --no-warnings scripts/theme-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-theme-test");
const WEB = 5561, API = 9261;
const SHOTS = process.env.THEME_SHOTS || "";
const t = tally();

const ACCOUNT = {
  id: "acc_s", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing", "plumbing"],
  logoKey: "logos/acc_s.png", subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_c", name: "Chris Lee", email: "chris@sound.test", role: "admin" },
};
const today = new Date().toISOString().slice(0, 10);
const JOBS = [{
  id: "job_1", accountId: "acc_s", title: "Leaking kitchen faucet", address: "12 Pine St, Seattle, WA",
  date: today, trades: ["plumbing"], assignments: {}, status: "active", approvedAt: today, createdAt: today,
  propertyId: null, severity: null, notes: "", measurementDocs: [],
}];

const markFilter = (page) => page.evaluate(() => {
  const i = document.querySelector(".header-top .brand-logo img");
  return i ? getComputedStyle(i).filter : null;
});
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/jobs") return [200, JOBS];
  if (["/api/subs", "/api/invites", "/api/connect-requests", "/api/my-connect-requests",
    "/api/properties", "/api/tenants", "/api/clients", "/api/agreements", "/api/visits"].includes(path)) return [200, []];
  if (path === "/api/account-users") return [200, [{ id: "usr_c", name: "Chris Lee", email: "chris@sound.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// Relative luminance of a computed rgb() string.
const lum = (rgb) => {
  const n = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => {
    const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return n.length === 3 ? 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] : NaN;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const read = (page) => page.evaluate(() => {
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const root = document.querySelector(".ss-root");
  const header = document.querySelector(".ss-header");
  return {
    theme: document.documentElement.dataset.theme || "",
    page: cs(root, "backgroundColor"), text: cs(root, "color"), header: cs(header, "backgroundColor"),
    scheme: getComputedStyle(document.documentElement).colorScheme,
  };
});
// The theme lives in My account -> Settings now, not in the profile menu.
const openMenu = async (page) => {
  await page.evaluate(() => document.querySelector(".user-btn")?.click());
  await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^Settings$/.test(b.innerText.trim()))?.click());
  await wait(400);
};
const pick = (page, label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll(".set-opt")].find((x) => x.innerText.trim() === l);
  b?.click(); return !!b;
}, label);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

try {
  console.log("\n-- light by default on a light device --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "usr_c", accountId: "acc_s" }, viewport: { width: 1100, height: 900 } });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await wait(2200);
  let r = await read(page);
  t.ck("the app is really drawn", !!r.page, JSON.stringify(r));
  t.ck("System on a light device is light", r.theme === "" && lum(r.page) > 0.8, JSON.stringify(r));
  // The account's own uploaded mark keeps its colors in light...
  const lightMark = await markFilter(page);
  t.ck("the account's own mark is in the header, in its own colors", lightMark === "none", String(lightMark));
  await shot(page, "light-dash");
  // Where the seat lands, so the test can come back to it after Settings.
  const home = await page.evaluate(() => document.querySelector("nav.tabs button.on")?.innerText.trim().split("\n")[0] || "");

  console.log("\n-- the picker --");
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  t.ck("the profile menu no longer carries the theme",
    await page.evaluate(() => !!document.querySelector(".user-menu") && !document.querySelector(".user-menu .theme-opt")));
  await page.evaluate(() => document.querySelector(".add-scrim")?.click()); await wait(200);
  await openMenu(page);
  const opts = await page.evaluate(() => [...document.querySelectorAll(".set-opt")]
    .map((b) => ({ label: b.innerText.trim(), on: b.getAttribute("aria-checked") === "true" })));
  t.ck("My account -> Settings offers System, Dark and Light in that order",
    opts.map((o) => o.label).join(",") === "System,Dark,Light", JSON.stringify(opts));
  t.ck("System is the default", opts[0]?.on && !opts[1]?.on && !opts[2]?.on, JSON.stringify(opts));
  await shot(page, "light-menu");

  console.log("\n-- dark --");
  t.ck("Dark can be pressed", await pick(page, "Dark"));
  await wait(300);
  r = await read(page);
  t.ck("the page goes dark", r.theme === "dark" && lum(r.page) < 0.03, JSON.stringify(r));
  t.ck("the header goes dark", lum(r.header) < 0.05, r.header);
  // ...and goes white in dark, because a dark mark on a dark bar disappears.
  const darkMark = await markFilter(page);
  t.ck("and the account's mark goes white", /brightness\(0\).*invert\(1\)/.test(darkMark || ""), String(darkMark));
  t.ck("the text goes light, readable at AA", contrast(r.text, r.page) >= 7, `${r.text} on ${r.page}`);
  t.ck("native controls are told it is dark", /dark/.test(r.scheme), r.scheme);
  const on = await page.evaluate(() => [...document.querySelectorAll(".set-opt")]
    .find((b) => b.getAttribute("aria-checked") === "true")?.innerText.trim());
  t.ck("Dark is ticked", on === "Dark", on);
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  const menuBg = await page.evaluate(() => { const m = document.querySelector(".user-menu");
    return m ? getComputedStyle(m).backgroundColor : null; });
  t.ck("the profile menu is dark", menuBg && lum(menuBg) < 0.05, menuBg);
  await shot(page, "dark-menu");
  await page.evaluate(() => document.querySelector(".add-scrim")?.click());
  await wait(300);
  await page.evaluate((h) => [...document.querySelectorAll("nav.tabs button")]
    .find((b) => b.innerText.trim().split("\n")[0] === h)?.click(), home);
  await wait(600);
  await shot(page, "dark-dash");
  // A card on the dashboard sits a step above the page.
  const card = await page.evaluate(() => {
    const el = document.querySelector(".sched-hero");
    const day = document.querySelector(".shs-day.is-next");
    return el ? { bg: getComputedStyle(el).backgroundColor, cls: el.className,
      next: day ? getComputedStyle(day).backgroundColor : null,
      nextText: day ? getComputedStyle(day.querySelector(".shs-dom")).color : null } : null;
  });
  t.ck("a card is dark too, a step above the page", card && lum(card.bg) < 0.05 && lum(card.bg) >= lum(r.page),
    JSON.stringify(card));
  // A later rule must still beat an earlier one in the dark: the next booked
  // day is drawn solid brand over the plain "has work" tint it also carries.
  t.ck("the next booked day is still solid brand in the dark, with readable figures",
    card?.next && lum(card.next) > 0.2 && contrast(card.next, card.nextText) >= 4.5, JSON.stringify(card));

  console.log("\n-- remembered --");
  await page.reload({ waitUntil: "domcontentloaded" }); await wait(2200);
  r = await read(page);
  t.ck("Dark survives a reload", r.theme === "dark" && lum(r.page) < 0.03, JSON.stringify(r));

  console.log("\n-- Light wins over a dark device --");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await openMenu(page); await pick(page, "Light"); await wait(300);
  r = await read(page);
  t.ck("Light on a dark device is light", r.theme === "" && lum(r.page) > 0.8, JSON.stringify(r));

  console.log("\n-- System follows the device, live --");
  await pick(page, "System"); await wait(300);
  r = await read(page);
  t.ck("System on a dark device is dark", r.theme === "dark", JSON.stringify(r));
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await wait(300);
  r = await read(page);
  t.ck("and turns light when the device does, without a reload", r.theme === "", JSON.stringify(r));

  console.log("\n-- the drawer, on a phone --");
  await page.evaluate(() => localStorage.setItem("ss_theme", "dark"));
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" }); await wait(2200);
  await page.evaluate(() => document.querySelector(".hamburger, .menu-btn, [aria-label='Menu'], [aria-label='Open menu']")?.click());
  await wait(500);
  const inDrawer = await page.evaluate(() => ({
    acct: !!document.querySelector(".drawer-actions button"),
    theme: document.querySelectorAll(".drawer-actions .theme-opt, .drawer-actions .set-opt").length }));
  t.ck("the drawer is open, and carries no theme rows", inDrawer.acct && inDrawer.theme === 0, JSON.stringify(inDrawer));
  await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")].find((b) => /My account/.test(b.innerText))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^Settings$/.test(b.innerText.trim()))?.click());
  await wait(400);
  const dr = await page.evaluate(() => [...document.querySelectorAll(".set-opt")]
    .map((b) => ({ label: b.innerText.trim(), h: b.getBoundingClientRect().height,
      on: b.getAttribute("aria-checked") === "true" })));
  t.ck("Settings on a phone offers the same three", dr.map((o) => o.label).join(",") === "System,Dark,Light", JSON.stringify(dr));
  t.ck("Dark is ticked there too", dr.find((o) => o.on)?.label === "Dark", JSON.stringify(dr));
  t.ck("each is thumb-sized", dr.length === 3 && dr.every((o) => o.h >= 44), JSON.stringify(dr));
  await shot(page, "dark-drawer");
  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- signed out stays light --");
  const out = await visitApp(browser, { host: "sound", webPort: WEB, viewport: { width: 1100, height: 900 },
    onNewDocument: () => { try { localStorage.setItem("ss_theme", "dark"); } catch { /* */ } } });
  await wait(1800);
  const signedOut = await out.page.evaluate(() => ({ theme: document.documentElement.dataset.theme || "",
    bg: getComputedStyle(document.body).backgroundColor }));
  t.ck("a signed-out page is light whatever was picked", signedOut.theme === "" && lum(signedOut.bg) > 0.5,
    JSON.stringify(signedOut));
  await out.ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
