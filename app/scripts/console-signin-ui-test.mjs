// The console's sign-in card: the two buttons are drawn as buttons, the same
// height, full width, stacked with a gap -- not the browser's own chrome side
// by side. Reported with them touching at two heights, because the markup's
// classes (sa-btn, sa-google, sa-alt) had no rules: the CSS was written under
// other names. Only the computed pixels can see that.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-signin-test");
const WEB = 5781, API = 8781;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });
const web = serveApp({ dir: OUT, port: WEB });
// Nobody signed in: /me refuses, so the card is what draws.
const api = serveApi({ port: API, routes: (path) => (path === "/api/platform/me" ? [401, { error: "unauthorized" }] : undefined) });
const browser = await launch();

for (const vp of [{ width: 1024, height: 1366 }, { width: 390, height: 844 }]) {
  console.log(`\n-- ${vp.width}px --`);
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport(vp);
  await page.goto(`http://localhost:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(1800);
  const read = () => page.evaluate(() => {
    const card = document.querySelector(".sa-card");
    const g = card?.querySelector(".sa-google"), a = card?.querySelector(".sa-alt");
    if (!card || !g || !a) return { missing: true, html: (card?.innerText || document.body.innerText).slice(0, 200) };
    const c = card.getBoundingClientRect(), gr = g.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const cs = (el) => getComputedStyle(el);
    const inner = card.clientWidth - parseFloat(cs(card).paddingLeft) - parseFloat(cs(card).paddingRight);
    return { gH: gr.height, aH: ar.height, gW: gr.width, aW: ar.width, inner,
      gap: ar.top - gr.bottom, sameRow: Math.abs(ar.top - gr.top) < 4,
      gBg: cs(g).backgroundColor, gRadius: parseFloat(cs(g).borderTopLeftRadius),
      aBg: cs(a).backgroundColor, aBorder: cs(a).borderTopColor };
  });
  const r = await read();
  t.ck("the card and both buttons are drawn", !r.missing, JSON.stringify(r));
  if (!r.missing) {
    t.ck("Google is a full-width white button at least 44px tall", r.gH >= 44 && Math.abs(r.gW - r.inner) < 2 && /255, 255, 255/.test(r.gBg) && r.gRadius >= 8, JSON.stringify(r));
    t.ck("the password option is full width and the same height", r.aH === r.gH && Math.abs(r.aW - r.inner) < 2, JSON.stringify(r));
    t.ck("stacked, not side by side, with a gap between them", !r.sameRow && r.gap >= 8, JSON.stringify(r));
    t.ck("the password option is the quieter of the two", /rgba\(0, 0, 0, 0\)|transparent/.test(r.aBg), JSON.stringify(r));
  }
  await page.evaluate(() => document.querySelector(".sa-alt")?.click());
  await wait(300);
  const f = await page.evaluate(() => {
    const b = document.querySelector(".sa-card form .sa-btn");
    return b ? { h: b.getBoundingClientRect().height, bg: getComputedStyle(b).backgroundColor } : null;
  });
  t.ck("its Sign in is a solid button too", !!f && f.h >= 44 && !/rgba\(0, 0, 0, 0\)/.test(f.bg) && !/239, 239, 239/.test(f.bg), JSON.stringify(f));
}

await browser.close(); web.close(); api.close();
t.done();
