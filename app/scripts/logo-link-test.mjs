// The logo on the hosted sign-up form is a link, and Branding says where.
//
// Asked for as "on the form the logo should go back or be redirected to the
// main site index, and this should be editable from the admin". So:
//   - theme.homeUrl (Account -> Branding -> Logo link) when set;
//   - otherwise the branded address's own home page ("/", its sign-in page);
//   - on app.subsub.work/?apply=<sub>, which is nobody's home, no link at all
//     unless a website was set.
// The address lands in an href on a public page, so only a real http(s)
// address is ever drawn: cleanHomeUrl answers null for anything else, and the
// server refuses the save rather than storing it.
//
//   node scripts/logo-link-test.mjs

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { cleanHomeUrl } from "../shared/embed.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-logolink-test");
const WEB = 5983, API = 9100;
const t = tally();

console.log("\n-- the address check --");
t.ck("a bare domain gains https", cleanHomeUrl("outerhome.com") === "https://outerhome.com/");
t.ck("a full address is kept", cleanHomeUrl("https://www.outerhome.com/about") === "https://www.outerhome.com/about");
t.ck("http is allowed", cleanHomeUrl("http://outerhome.com") === "http://outerhome.com/");
t.ck("a script URL is refused", cleanHomeUrl("javascript:alert(1)") === null);
t.ck("a data URL is refused", cleanHomeUrl("data:text/html,hi") === null);
t.ck("a word with no dot is refused", cleanHomeUrl("outerhome") === null);
t.ck("credentials in the address are refused", cleanHomeUrl("https://a:b@outerhome.com") === null);
t.ck("blank is not set", cleanHomeUrl("  ") === null);
t.ck("too long is refused", cleanHomeUrl("a.com/" + "x".repeat(300)) === null);

const worker = readFileSync(join(app, "worker/index.js"), "utf8");
const vt = worker.slice(worker.indexOf("function validTheme("), worker.indexOf("function validTheme(") + 2200);
t.ck("the server checks it with the same function", /cleanHomeUrl\(theme\.homeUrl\)/.test(vt));
t.ck("and refuses a bad one rather than storing it", /if \(!url\) return null;/.test(vt));

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const mk = (homeUrl) => ({
  id: "acc_o", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, logoKey: null, trades: ["roofing"],
  theme: homeUrl ? { homeUrl } : null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_ada", name: "Ada Wynn", email: "ada@outerhome.test", role: "admin" },
});
let ACCOUNT = mk(null);
let saved = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account" && method === "PATCH") { saved = body; return [200, { ...ACCOUNT, ...body }]; }
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, [{ id: "u_ada", name: "Ada Wynn",
    email: "ada@outerhome.test", role: "admin", propertyIds: [], hasLogin: true }]];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (["/api/subs", "/api/jobs", "/api/properties", "/api/invites", "/api/clients",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers",
    "/api/doc-shares", "/api/tenants", "/api/my-quotes"].includes(path)) return [200, []];
  return undefined;
} });

const browser = await launch();
const logo = (page) => page.evaluate(() => {
  const el = document.querySelector(".wl-card .wl-brand");
  if (!el) return null;
  return { tag: el.tagName, href: el.getAttribute("href"), text: el.innerText.trim() };
});

try {
  console.log("\n-- the sign-up form --");
  {
    ACCOUNT = mk("outerhome.com");
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, path: "/?apply=1" });
    await wait(1500);
    const l = await logo(page);
    t.ck("with a website set, the logo is a link to it",
      l?.tag === "A" && l.href === "https://outerhome.com/", JSON.stringify(l));
    t.ck("and still names the company", /Outerhome/.test(l?.text || ""), JSON.stringify(l));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  {
    ACCOUNT = mk(null);
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB, path: "/?apply=1" });
    await wait(1500);
    const l = await logo(page);
    t.ck("with none, on the branded address it goes to that address's home page",
      l?.tag === "A" && l.href === "/", JSON.stringify(l));
    await ctx.close();
  }
  {
    ACCOUNT = mk(null);
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, path: "/?apply=outerhome" });
    await wait(1500);
    const l = await logo(page);
    t.ck("the form drew on app.subsub.work", !!l, JSON.stringify(l));
    t.ck("and there, with no website set, the logo is not a link", l?.tag === "DIV", JSON.stringify(l));
    await ctx.close();
  }
  {
    ACCOUNT = { ...mk(null), theme: { homeUrl: "javascript:alert(1)" } };
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB, path: "/?apply=1" });
    await wait(1500);
    const l = await logo(page);
    t.ck("a stored script URL is never drawn as the link", l?.href !== "javascript:alert(1)", JSON.stringify(l));
    await ctx.close();
  }

  console.log("\n-- Account -> Branding --");
  {
    ACCOUNT = mk(null); saved = null;
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_ada", accountId: "acc_o" }, viewport: { width: 1280, height: 1100 } });
    await wait(2900);
    await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
      .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
    await wait(500);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Branding")?.click());
    await wait(700);
    const type = (v) => page.evaluate((val) => {
      const i = document.querySelector(".home-url-input");
      if (!i) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(i, val); i.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, v);
    const state = () => page.evaluate(() => {
      const f = document.querySelector(".home-url-input")?.closest("label");
      const save = [...document.querySelectorAll(".panel-actions button")].find((b) => /^Save/.test(b.innerText.trim()));
      return { text: f?.innerText.replace(/\s+/g, " ").trim() || null, err: !!f?.querySelector(".fld-err"),
        saveDisabled: save ? save.disabled : null };
    });
    t.ck("the field is on Branding", await type(""));
    await wait(200);
    let s = await state();
    t.ck("blank says it opens the sign-in page", /outerhome\.subsub\.work/.test(s.text || ""), JSON.stringify(s));
    await type("not a website");
    await wait(200);
    s = await state();
    t.ck("a bad address is said", s.err, JSON.stringify(s));
    t.ck("and cannot be saved", s.saveDisabled === true, JSON.stringify(s));
    await type("outerhome.com");
    await wait(200);
    s = await state();
    t.ck("a good one says where pressing the logo goes", /https:\/\/outerhome\.com\//.test(s.text || "") && !s.err, JSON.stringify(s));
    await page.evaluate(() => [...document.querySelectorAll(".panel-actions button")]
      .find((b) => /^Save/.test(b.innerText.trim()))?.click());
    await wait(900);
    t.ck("saving sends the cleaned address", saved?.theme?.homeUrl === "https://outerhome.com/", JSON.stringify(saved?.theme));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
