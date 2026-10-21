// The profile menu on an iPad held sideways.
//
// Reported with the menu boxed: every icon sat on a line above its label,
// "Recruiting QR" wrapped, and the current account's tick dropped under the
// role. One rule did it -- .user-menu button was a column, written for the
// demo's two-line "Switch user" rows and applied to every button in the menu.
//
// So this measures, rather than reads the CSS: each icon is on its label's
// line, no label wraps, the tick sits on the account's name line at the right,
// and the menu is wide enough that none of it has to.
//
//   node scripts/user-menu-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-usermenu-test");
const WEB = 5471, API = 8471;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const HOME = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_r", name: "Richard Braun", email: "r@outerhome.test", role: "admin" },
};
const seat = (id, name, sub, role, kind = "general_contractor") => ({
  accountId: id, accountName: name, subdomain: sub, role, kind, plan: "scale",
  billing: "monthly", theme: null, trades: [], logoKey: null, useDefaultMark: true,
  companyId: null,
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/auth/me") return [200, { user: HOME.user, memberships: [
    seat("acc_outer", "Outerhome", "outerhome", "admin"),
    seat("acc_sound", "Sound Property Management", "sound", "admin", "property_manager"),
  ] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, HOME];
  if (path === "/api/account") return [200, HOME];
  if (path === "/api/account-users") return [200, [
    { id: "u_r", name: "Richard Braun", email: "r@outerhome.test", role: "admin",
      subId: null, propertyIds: [], hasLogin: true },
  ]];
  return undefined;
} });

const browser = await launch();

const measure = (page) => page.evaluate(() => {
  const menu = document.querySelector(".user-menu");
  if (!menu) return null;
  const line = (el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
  const rows = [...menu.querySelectorAll(":scope > button.um-qr, :scope > button.um-account, :scope > button.um-signout")]
    .map((b) => {
      const svg = b.querySelector("svg");
      const label = [...b.childNodes].map((n) => n.nodeType === 3 ? n.textContent.trim() : "").join("").trim()
        || b.querySelector(".um-qr-label")?.innerText.trim() || "";
      const lab = b.querySelector(".um-qr-label");
      const r = b.getBoundingClientRect();
      // the label's own line: a text node has no rect, so measure via a range
      let textTop = null, textLines = 0;
      const node = lab || [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        textLines = new Set(rects.map((x) => Math.round(x.top))).size;
        textTop = rects.length ? Math.round(rects[0].top + rects[0].height / 2) : null;
      }
      return { text: b.innerText.replace(/\s+/g, " ").trim(), label,
        // a two-line label (Recruiting QR over "for subcontractors") centers
        // its icon on the pair, so the icon is checked against the block
        iconMid: svg ? line(svg) : null,
        textMid: b.querySelector(".um-qr-text") ? line(b.querySelector(".um-qr-text")) : textTop, textLines,
        iconLeft: svg ? Math.round(svg.getBoundingClientRect().left) : null,
        height: Math.round(r.height) };
    });
  const accts = [...menu.querySelectorAll("button.um-acct")].map((b) => {
    const name = b.querySelector(".ua-name"), tick = b.querySelector(".ua-tick"), role = b.querySelector(".ua-role");
    return { name: name?.innerText.trim(), nameMid: name ? line(name) : null,
      roleTop: role ? Math.round(role.getBoundingClientRect().top) : null,
      nameBottom: name ? Math.round(name.getBoundingClientRect().bottom) : null,
      tickMid: tick ? line(tick) : null,
      tickRight: tick ? Math.round(tick.getBoundingClientRect().right) : null,
      btnRight: Math.round(b.getBoundingClientRect().right) };
  });
  return { width: Math.round(menu.getBoundingClientRect().width), rows, accts };
});

try {
  for (const vp of [{ width: 1180, height: 820 }, { width: 1366, height: 1024 }]) {
    console.log(`\n-- ${vp.width}x${vp.height} --`);
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_r", accountId: "acc_outer" }, viewport: vp });
    await wait(2500);
    const btn = await page.$(".user-btn");
    t.ck("the profile button is in the header", !!btn);
    if (btn) await btn.click();
    await wait(500);
    const m = await measure(page);
    t.ck("the menu opens", !!m);
    if (m) {
      const names = m.rows.map((r) => r.text);
      for (const want of ["My Passport QR", "Recruiting QR", "My account", "Sign out"]) {
        t.ck(`"${want}" is in the menu`, names.some((n) => n.startsWith(want)), JSON.stringify(names));
      }
      for (const r of m.rows) {
        t.ck(`"${r.label}": icon on the label's line`, r.iconMid != null && r.textMid != null
          && Math.abs(r.iconMid - r.textMid) <= 6, `icon ${r.iconMid}, text ${r.textMid}`);
        t.ck(`"${r.label}": label on one line`, r.textLines === 1, String(r.textLines));
      }
      const lefts = new Set(m.rows.map((r) => r.iconLeft));
      t.ck("every icon starts at one left edge", lefts.size === 1, JSON.stringify([...lefts]));
      t.ck("the menu is wide enough not to wrap", m.width >= 260, String(m.width));
      t.ck("both accounts are listed", m.accts.length === 2, JSON.stringify(m.accts));
      const cur = m.accts.find((a) => a.tickMid != null);
      t.ck("the current account carries a tick", !!cur, JSON.stringify(m.accts));
      if (cur) {
        t.ck("the tick is on the account's row, not under the role",
          cur.tickMid < cur.roleTop + 4, `tick ${cur.tickMid}, role top ${cur.roleTop}`);
        t.ck("and at the right edge", cur.btnRight - cur.tickRight <= 20, `${cur.btnRight - cur.tickRight}px in`);
      }
      for (const a of m.accts) t.ck(`"${a.name}": role under the name`, a.roleTop >= a.nameBottom - 2,
        `name bottom ${a.nameBottom}, role top ${a.roleTop}`);
    }
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
