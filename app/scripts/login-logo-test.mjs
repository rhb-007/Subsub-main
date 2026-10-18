// SubSub's own sign-in page wears the stacked logo, mark over word: the mark gold, the word black.
// A company's page keeps its own mark and name.
//
//   node scripts/login-logo-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-loginlogo-test");
const WEB = 5373, API = 8873;
const t = tally();

buildApp({ outDir: OUT, apiPort: API });
const ACCOUNT = { id: "acc_pm", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [], logoKey: null,
  subscriptionStatus: "active", hostnameStatus: "active" };
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) =>
  path.startsWith("/api/account-by-subdomain/") ? [200, ACCOUNT] : undefined });
const browser = await launch();

const read = (page) => page.evaluate(() => {
  const st = document.querySelector(".login-brand .ss-stacked");
  const svgs = st ? [...st.querySelectorAll("svg")] : [];
  const r = svgs.map((s) => s.getBoundingClientRect());
  const fillsOf = (s) => [...new Set([...(s?.querySelectorAll("path, g") || [])].map((p) => p.getAttribute("fill")).filter(Boolean))];
  const markFills = fillsOf(svgs[0]), wordFills = fillsOf(svgs[1]);
  const card = document.querySelector(".login-card")?.getBoundingClientRect();
  const h1 = document.querySelector(".login-brand h1");
  return {
    stacked: !!st, n: svgs.length,
    markAbove: r.length === 2 ? r[0].bottom <= r[1].top : null,
    centered: r.length === 2 && card ? r.every((b) => Math.abs((b.left + b.right) / 2 - (card.left + card.right) / 2) < 3) : null,
    wordWider: r.length === 2 ? r[1].width > r[0].width * 2 : null,
    markFills, wordFills,
    h1Visible: h1 ? h1.getBoundingClientRect().height > 2 : null,
    h1: h1?.textContent || "",
  };
});

try {
  for (const vp of [{ width: 1100, height: 1000 }, { width: 390, height: 800 }]) {
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, viewport: vp });
    await page.waitForSelector(".login-card", { timeout: 15000 });
    await wait(300);
    const s = await read(page);
    t.ck(`${vp.width}px: SubSub's sign-in page draws the stacked logo`, s.stacked && s.n === 2, JSON.stringify(s));
    t.ck(`${vp.width}px: the mark sits above the word`, s.markAbove === true, JSON.stringify(s));
    t.ck(`${vp.width}px: both are centered in the card`, s.centered === true, JSON.stringify(s));
    t.ck(`${vp.width}px: the word is the wide part, as in the logo`, s.wordWider === true, JSON.stringify(s));
    t.ck(`${vp.width}px: the mark is gold`, s.markFills.length === 1 && s.markFills[0] === "#E39B32", JSON.stringify(s.markFills));
    t.ck(`${vp.width}px: the word is black`, s.wordFills.length === 1 && s.wordFills[0] === "#111111", JSON.stringify(s.wordFills));
    t.ck(`${vp.width}px: the name is not printed a second time`, s.h1Visible === false && s.h1 === "SubSub", JSON.stringify(s));
    t.ck(`${vp.width}px: nothing crashed`, crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  const { ctx, page } = await visitApp(browser, { host: "cascade", webPort: WEB });
  await page.waitForSelector(".login-card", { timeout: 15000 });
  await page.waitForFunction(() => /Cascade/.test(document.querySelector(".login-brand h1")?.textContent || ""), { timeout: 8000 }).catch(() => {});
  const c = await read(page);
  t.ck("a company's page shows its own name", /Cascade Management/.test(c.h1) && c.h1Visible === true, JSON.stringify(c));
  t.ck("and not SubSub's stacked logo", c.stacked === false, JSON.stringify(c));
  await ctx.close();
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
