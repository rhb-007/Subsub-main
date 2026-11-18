// The "Compliance pack emails" switches in My account -> Settings, drawn in a
// browser against a stubbed API. Five items, each on unless the person turned
// it off; the panel shows what is stored and Save sends only its own key.
//
//   node --no-warnings scripts/doc-notify-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docnotify-test");
const WEB = 5623, API = 9323;
const t = tally();

const ACCOUNT = {
  id: "acc_o", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_d", name: "Dana Ruiz", email: "dana@o.test", role: "admin" },
};
let stored = { email: true, sms: false, statusChanges: true, docUploads: { bond: false } };
const sent = [];
const users = () => [
  { id: "usr_d", name: "Dana Ruiz", email: "dana@o.test", phone: null, role: "admin", notify: stored,
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_c", name: "Cal Sub", email: "cal@s.test", phone: null, role: "contractor", notify: {},
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, { ...ACCOUNT, user: { ...ACCOUNT.user, notify: stored } }];
  if (path === "/api/account-users") return [200, users()];
  if (path === "/api/me" && method === "PATCH") {
    sent.push(body);
    stored = { ...stored, docUploads: { ...stored.docUploads, ...(body.notify?.docUploads || {}) } };
    return [200, { ok: true, notify: stored }];
  }
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector(".user-btn")?.click());
  await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^Settings$/.test(b.innerText.trim()))?.click());
  await wait(500);
};
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector(".doc-notify-panel");
  if (!p) return null;
  return { text: p.innerText,
    boxes: [...p.querySelectorAll("label[data-kind]")].map((l) => ({ kind: l.dataset.kind, on: l.querySelector("input").checked })) };
});

try {
  console.log("\n-- an admin's Settings --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_d", accountId: "acc_o" } });
  await wait(2000);
  await openSettings(page);
  const p = await panel(page);
  t.ck("Settings carries the compliance pack emails panel", !!p && /Compliance pack emails/i.test(p.text), JSON.stringify(p));
  t.ck("with the five items", JSON.stringify(p?.boxes.map((b) => b.kind)) === '["insurance","bond","w9","license","agreement"]', JSON.stringify(p?.boxes));
  t.ck("each on by default, and the one turned off shown off",
    p?.boxes.filter((b) => b.on).length === 4 && p?.boxes.find((b) => b.kind === "bond")?.on === false, JSON.stringify(p?.boxes));
  t.ck("it says a signed agreement asks for a countersignature", /countersign/.test(p?.text || ""), p?.text);

  await page.evaluate(() => document.querySelector('.doc-notify-panel label[data-kind="w9"] input')?.click());
  await wait(200);
  await page.evaluate(() => document.querySelector(".doc-notify-save")?.click());
  await wait(800);
  const body = sent.pop();
  t.ck("Save sends only the switches", JSON.stringify(Object.keys(body?.notify || {})) === '["docUploads"]', JSON.stringify(body));
  t.ck("with W-9 off and the rest as shown",
    body?.notify?.docUploads?.w9 === false && body.notify.docUploads.bond === false && body.notify.docUploads.insurance === true, JSON.stringify(body));
  t.ck("and it says saved", /Saved/.test((await panel(page))?.text || ""));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- a contractor seat --");
  {
    const { ctx: c2, page: p2 } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_c", accountId: "acc_o" } });
    await wait(2000);
    await openSettings(p2);
    const open = await p2.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
      .some((b) => /^Settings$/.test(b.innerText.trim()) && b.className.includes("on")));
    t.ck("Settings really opened", open);
    t.ck("and has no compliance pack emails panel", (await panel(p2)) === null);
    await c2.close();
  }
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
