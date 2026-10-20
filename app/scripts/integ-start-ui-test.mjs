// Account -> Integrations: Zapier and Postman as two cards of their own,
// drawn in a browser against a stubbed API.
//
// What is asserted is what somebody sees: two separate cards above the
// switches, side by side on an iPad and stacked on a phone; the Zapier card
// says who it is for and opens the invite link when the server has one, and
// otherwise says how to do it with a webhook step rather than offering a
// button onto nothing; the Postman card hands over the collection's absolute
// address, from the API rather than this page's origin.
//
//   node --no-warnings scripts/integ-start-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-integstart-test");
const WEB = 5579, API = 9279;
const t = tally();

let INVITE = null;
const INTEG = [
  { id: "api", name: "Your API key", what: "w", uses: "An API key", soon: false, enabled: true },
  { id: "hover", name: "Hover", what: "w", uses: "Your Hover account", soon: true, enabled: false },
];
const ACCOUNT = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rae", name: "Rae", email: "rae@outerhome.test", role: "admin" },
};
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/integrations") return [200, { integrations: INTEG, onScale: true, migration: null, zapierInvite: INVITE }];
  if (path === "/api/crm-rules") return [200, { rules: [], unmapped: [] }];
  if (path === "/api/api-tokens") return [200, []];
  if (path === "/api/account-users") return [200, [
    { id: "u_rae", name: "Rae", email: "rae@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const open = async (width) => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_rae", accountId: "acc_gc" }, viewport: { width, height: 1400 } });
  await wait(1500);
  await r.page.evaluate(() => document.querySelector(".user-btn")?.click());
  await wait(400);
  await r.page.evaluate(() => document.querySelector(".user-menu .um-account")?.click());
  await wait(600);
  await r.page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => b.innerText.trim() === "Integrations")?.click());
  for (let n = 0; n < 30; n++) { await wait(200); if (await r.page.$(".integ-start")) break; }
  return r;
};
const read = (page) => page.evaluate(() => {
  const box = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: b.left, t: b.top, r: b.right, w: b.width } : null; };
  const card = (k) => document.querySelector(`.integ-card[data-start="${k}"]`);
  const z = card("zapier"), p = card("postman");
  return {
    zap: z ? { text: z.innerText, box: box(z), links: [...z.querySelectorAll("a")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href"), target: a.target })) } : null,
    pm: p ? { text: p.innerText, box: box(p), links: [...p.querySelectorAll("a")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href"), dl: a.hasAttribute("download") })) } : null,
    listTop: document.querySelector(".integ-list")?.getBoundingClientRect().top ?? null,
    vw: document.documentElement.clientWidth,
  };
});

try {
  console.log("\n-- an iPad, no invite link set --");
  {
    const { ctx, page, crashes } = await open(1024);
    const s = await read(page);
    t.ck("Zapier is a card of its own", !!s.zap, JSON.stringify(s));
    t.ck("and Postman is a card of its own", !!s.pm);
    t.ck("Zapier says who it is for", /Not a developer\?/i.test(s.zap?.text || ""), s.zap?.text);
    t.ck("Postman says who it is for", /For developers/i.test(s.pm?.text || ""), s.pm?.text);
    t.ck("side by side on an iPad", s.zap && s.pm && Math.abs(s.zap.box.t - s.pm.box.t) < 2 && s.pm.box.l > s.zap.box.r,
      JSON.stringify([s.zap?.box, s.pm?.box]));
    t.ck("above the switches", s.listTop !== null && s.zap.box.t < s.listTop);
    t.ck("with no invite link, the Zapier card says how to use a webhook step",
      /Webhooks by Zapier/.test(s.zap?.text || ""), s.zap?.text);
    t.ck("and its button goes to the docs' Zapier section, in a new tab",
      s.zap?.links.length === 1 && s.zap.links[0].href === "https://subsub.work/developers#zapier" && s.zap.links[0].target === "_blank",
      JSON.stringify(s.zap?.links));
    const dl = s.pm?.links.find((l) => l.dl);
    t.ck("Postman offers the collection as a download, from the API", dl?.href === `http://127.0.0.1:${API}/api/v1/postman.json`,
      JSON.stringify(s.pm?.links));
    t.ck("and the address to paste into Postman's Import is the same one", (s.pm?.text || "").includes(`http://127.0.0.1:${API}/api/v1/postman.json`));
    t.ck("and a link to the API docs", s.pm?.links.some((l) => l.href === "https://subsub.work/developers"));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- with the invite link set --");
  {
    INVITE = "https://zapier.com/developer/public-invite/247047/abc/";
    const { ctx, page } = await open(1024);
    const s = await read(page);
    t.ck("the button adds SubSub to Zapier, through the invite", s.zap?.links.length === 1
      && s.zap.links[0].href === INVITE && /Add SubSub to Zapier/.test(s.zap.links[0].text), JSON.stringify(s.zap?.links));
    t.ck("and the webhook directions are not drawn beside it", !/Webhooks by Zapier/.test(s.zap?.text || ""));
    await ctx.close();
  }

  console.log("\n-- a phone --");
  {
    const { ctx, page } = await open(390);
    const s = await read(page);
    t.ck("stacked", s.zap && s.pm && s.pm.box.t > s.zap.box.t && Math.abs(s.pm.box.l - s.zap.box.l) < 2,
      JSON.stringify([s.zap?.box, s.pm?.box]));
    t.ck("and nothing past the screen's edge", s.zap.box.r <= s.vw + 1 && s.pm.box.r <= s.vw + 1,
      JSON.stringify([s.zap?.box, s.pm?.box, s.vw]));
    await ctx.close();
  }
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
