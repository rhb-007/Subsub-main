// The cookie banner for EU, UK and Swiss visitors on the marketing site
// (content/gtag.mjs). Driven in a browser against the real root pages, with
// Google's own script blocked, because what matters is what the page tells
// Consent Mode and what it draws:
//   - the region default denies analytics in the EU, UK and Switzerland, and
//     comes before the tag's config, which is when Consent Mode reads it;
//   - a European clock draws the banner, an American one does not;
//   - Accept and Decline write the choice, update consent and remove the box;
//   - a stored choice is applied on the next page and the banner stays away;
//   - the two buttons are equal (a quieter Decline is the dark pattern);
//   - the privacy policy can reopen it, from anywhere.
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { CONSENT_REGIONS, GTAG_ID } from "../../content/gtag.mjs";

const t = tally();
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = 5583;
const site = createServer((req, res) => {
  let f = join(root, decodeURIComponent(req.url.split("?")[0]));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": extname(f) === ".html" ? "text/html" : "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(WEB);

const browser = await launch();
const open = async (path, tz, ctx) => {
  ctx = ctx || await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateTimezone(tz);
  await page.setRequestInterception(true);
  const gtm = [];
  page.on("request", (r) => {
    if (/googletagmanager|google-analytics/.test(r.url())) { gtm.push(r.url()); return r.abort(); }
    r.continue();
  });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e.message || e)));
  await page.goto(`http://127.0.0.1:${WEB}${path}`, { waitUntil: "domcontentloaded" });
  await wait(300);
  return { ctx, page, crashes, gtm };
};
const layer = (page) => page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)));
const banner = (page) => page.evaluate(() => {
  const b = document.getElementById("ss-consent");
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const btns = [...b.querySelectorAll("button")].map((x) => {
    const s = getComputedStyle(x), q = x.getBoundingClientRect();
    return { text: x.textContent, bg: s.backgroundColor, color: s.color, w: Math.round(q.width), h: Math.round(q.height), weight: s.fontWeight };
  });
  return { text: b.innerText, link: b.querySelector("a")?.getAttribute("href"), btns,
    onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
});

// Europe: denied by default, banner up.
{
  const { ctx, page, crashes, gtm } = await open("/index.html", "Europe/Berlin");
  const dl = await layer(page);
  const defaults = dl.filter((a) => a[0] === "consent" && a[1] === "default");
  const regional = defaults.find((a) => a[2].region);
  t.ck("analytics is denied by default in the EU, UK and Switzerland",
    regional?.[2].analytics_storage === "denied" && ["DE", "FR", "GB", "CH", "NO", "IE"].every((c) => regional[2].region.includes(c))
      && regional[2].region.length === CONSENT_REGIONS.length, JSON.stringify(regional));
  t.ck("and ads storage is denied everywhere", defaults.some((a) => !a[2].region && a[2].ad_storage === "denied"));
  const cfg = dl.findIndex((a) => a[0] === "config" && a[1] === GTAG_ID);
  const lastDefault = dl.findLastIndex((a) => a[0] === "consent" && a[1] === "default");
  t.ck("the defaults come before the tag's config", cfg > lastDefault && lastDefault >= 0, `${lastDefault} < ${cfg}`);
  t.ck("the Google tag is still requested", gtm.some((u) => u.includes(GTAG_ID)));
  const b = await banner(page);
  t.ck("a European clock draws the banner", !!b, "");
  t.ck("it says what it is and links the policy", /Google Analytics/.test(b?.text || "") && b?.link === "/privacy-policy.html#cookies", b?.text);
  t.ck("it is on screen on a phone", !!b?.onScreen);
  const [acc, dec] = b?.btns || [];
  t.ck("Accept and Decline are both there", acc?.text === "Accept analytics" && dec?.text === "Decline", JSON.stringify(b?.btns));
  t.ck("and they look the same", !!acc && !!dec && acc.bg === dec.bg && acc.color === dec.color && acc.weight === dec.weight && acc.h === dec.h && acc.h >= 44,
    JSON.stringify(b?.btns));
  await page.evaluate(() => { document.cookie = "_ga=GA1.1.123; path=/"; document.cookie = "_ga_X=GS1; path=/"; });
  await page.click('#ss-consent [data-consent="denied"]');
  const after = await layer(page);
  t.ck("Decline updates consent to denied", after.some((a) => a[0] === "consent" && a[1] === "update" && a[2].analytics_storage === "denied"));
  t.ck("and removes the box", !(await banner(page)));
  t.ck("and clears any analytics cookie", !/_ga/.test(await page.evaluate(() => document.cookie)), await page.evaluate(() => document.cookie));
  t.ck("and is remembered", (await page.evaluate(() => localStorage.getItem("ss_consent"))) === "denied");
  // The next page in the same browser.
  const next = await open("/pricing.html", "Europe/Berlin", ctx);
  t.ck("the next page asks nothing", !(await banner(next.page)));
  t.ck("and applies the stored no before the config",
    (await layer(next.page)).findIndex((a) => a[0] === "consent" && a[1] === "update" && a[2].analytics_storage === "denied")
      < (await layer(next.page)).findIndex((a) => a[0] === "config"));
  t.ck("nothing crashed", !crashes.length && !next.crashes.length, crashes.concat(next.crashes).join(" | "));
  await ctx.close();
}

// Accept, from London.
{
  const { ctx, page } = await open("/for-subcontractors.html", "Europe/London");
  t.ck("a UK clock draws it too", !!(await banner(page)));
  await page.click('#ss-consent [data-consent="granted"]');
  t.ck("Accept updates consent to granted",
    (await layer(page)).some((a) => a[0] === "consent" && a[1] === "update" && a[2].analytics_storage === "granted"));
  t.ck("and is remembered", (await page.evaluate(() => localStorage.getItem("ss_consent"))) === "granted" && !(await banner(page)));
  await ctx.close();
}

// America: no banner, analytics on by default, and the policy can still turn it off.
{
  const { ctx, page } = await open("/privacy-policy.html", "America/Los_Angeles");
  t.ck("an American clock draws no banner", !(await banner(page)));
  t.ck("the policy names the cookies and Google",
    await page.evaluate(() => { const s = document.getElementById("cookies")?.parentElement?.innerText || ""; return /_ga/.test(s) && /Google Analytics/.test(s); }));
  await page.click("button.cookie-choice");
  t.ck("Change your cookie choice opens it anywhere", !!(await banner(page)));
  await page.click('#ss-consent [data-consent="denied"]');
  t.ck("so anybody can decline", (await page.evaluate(() => localStorage.getItem("ss_consent"))) === "denied");
  await ctx.close();
}

// A generated page carries it too.
{
  const { ctx, page } = await open("/licensing/index.html", "Europe/Paris");
  t.ck("a generated page draws it", !!(await banner(page)));
  await ctx.close();
}

await browser.close();
site.close();
t.done();
