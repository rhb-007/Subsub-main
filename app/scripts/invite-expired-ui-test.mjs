// Two reports from one roster.
//
// "Where have the subcontractors I invited but who haven't accepted gone?"
// The strip listed OPEN invites only, so thirty days after being sent an
// invite dropped off the screen with nothing saying so -- and the one button
// that could chase it answered "expired". So the strip now lists an expired
// invite too, marked Expired, and Send again renews it. One superseded by a
// newer open invite to the same address is left off, or one person reads as
// two.
//
// "Clicking Add WA state license number does not work." Add opened the edit
// form at its top, with the license box below the company name and nothing
// pointing at it -- and over a contractor who keeps their own record it opened
// a form that cannot change the license at all. Now Add lands in the box,
// rung and focused, and that second kind of contractor gets a sentence
// instead of the button.
//
//   node --no-warnings scripts/invite-expired-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inviteexpired-test");
const WEB = 5591, API = 9291;
const t = tally();

const ACCOUNT = {
  id: "acc_o", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_r", name: "Richard", email: "r@outerhome.test", role: "admin" },
};
const day = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const inv = (o) => ({ label: null, createdAt: day(-40), usedAt: null, revokedAt: null, companyId: null,
  phone: null, sentAt: day(-40), url: "https://outerhome.subsub.work/?invite=abc", engagedAs: "subcontractor", ...o });
const STALE = inv({ id: "inv_old", email: "ana@ridge.test", contact: "Ana", companyName: "Ridge Roofing",
  expiresAt: day(-10), status: "expired" });
// Expired, but a newer open invite went to the same address: one person.
const REPLACED = inv({ id: "inv_dup", email: "bo@pine.test", contact: "Bo", companyName: "Pine Gutters",
  expiresAt: day(-20), status: "expired" });
const FRESH = inv({ id: "inv_new", email: "bo@pine.test", contact: "Bo", companyName: "Pine Gutters",
  createdAt: day(-2), sentAt: day(-2), expiresAt: day(28), status: "open" });
let INVITES = [STALE, REPLACED, FRESH];

const sub = (o) => ({
  engagedAs: "subcontractor", accountId: "acc_o", contact: "X", phone: "555-0100",
  categories: ["roofing"], caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: false, insurance: false, contract: false, w9: false, hasPortal: false,
  license: "", ubi: "", state: "WA", licenseCheck: null, available: true, unavailableDays: [],
  coverage: {}, docReview: {}, ...o,
});
const SUBS = [
  sub({ id: "cmp_t", engagementId: "en_t", company: "Typed In Roofing", email: "t@typed.test", answersForItself: false }),
  sub({ id: "cmp_s", engagementId: "en_s", company: "Self Run Roofing", email: "s@self.test", answersForItself: true, hasPortal: true }),
];
const resends = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/invites") return [200, INVITES];
  const m = path.match(/^\/api\/invites\/(inv_\w+)\/resend$/);
  if (m && method === "POST") {
    resends.push(m[1]);
    const row = INVITES.find((i) => i.id === m[1]);
    return [200, { ...row, expiresAt: day(30), status: "open", sentAt: day(0), renewed: true, emailed: true, texted: false }];
  }
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Richard", email: "r@outerhome.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const goRoster = (page) => page.evaluate(() => [...document.querySelectorAll("nav button, .drawer button, aside button")]
  .find((x) => /^(sub)?contractors/i.test(x.innerText.trim()))?.click());

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_o" }, viewport: { width: 1200, height: 1500 } });
  await wait(2400);
  await goRoster(page);
  await wait(1000);

  console.log("\n-- the invited strip --");
  const strip = await page.evaluate(() => [...document.querySelectorAll(".invited-card")].map((c) => ({
    name: c.querySelector("b")?.innerText.trim(), chip: c.querySelector(".invited-chip")?.innerText.trim(),
    when: c.querySelector(".invited-when")?.innerText.trim(), expired: c.classList.contains("is-expired") })));
  const ridge = strip.find((c) => /Ridge/.test(c.name));
  t.ck("an expired invite is still on the roster", !!ridge, JSON.stringify(strip));
  t.ck("marked Expired, saying it can be sent again",
    !!ridge && /^expired$/i.test(ridge.chip) && ridge.expired && /send again/i.test(ridge.when), JSON.stringify(ridge));
  t.ck("one person invited twice is one card", strip.filter((c) => /Pine/.test(c.name)).length === 1, JSON.stringify(strip));
  t.ck("and it is the open one", /^invited$/i.test(strip.find((c) => /Pine/.test(c.name))?.chip || ""), JSON.stringify(strip));

  console.log("\n-- its panel --");
  await page.evaluate(() => [...document.querySelectorAll(".invited-card")].find((c) => /Ridge/.test(c.innerText))?.click());
  await wait(700);
  let p = await page.evaluate(() => {
    const el = document.querySelector(".invited-panel");
    return { open: !!el, text: el?.innerText.replace(/\s+/g, " ") || "",
      acts: [...(el?.querySelectorAll(".invited-acts button") || [])].map((b) => b.innerText.trim()) };
  });
  t.ck("the panel says the link expired", p.open && /expired .* no longer opens/i.test(p.text), p.text);
  t.ck("it offers Send again", p.acts.some((a) => /^send again$/i.test(a)), JSON.stringify(p.acts));
  t.ck("and not Copy link, for a link that no longer opens", !p.acts.some((a) => /copy link/i.test(a)), JSON.stringify(p.acts));
  await page.evaluate(() => [...document.querySelectorAll(".invited-acts button")].find((b) => /send again/i.test(b.innerText))?.click());
  await wait(900);
  p = await page.evaluate(() => ({ note: document.querySelector(".invited-panel .cov-hint.ok")?.innerText || "",
    chip: document.querySelector(".invited-panel .invited-chip")?.innerText.trim() || "" }));
  t.ck("the press reached the resend route", resends.includes("inv_old"), JSON.stringify(resends));
  t.ck("and says the link works for 30 more days", /30 more days/.test(p.note), p.note);
  t.ck("the panel is an open invite again", /^invited$/i.test(p.chip), p.chip);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
  await wait(500);

  console.log("\n-- Add a license number --");
  const openCard = (name) => page.evaluate((n) => [...document.querySelectorAll(".grid .card")]
    .find((c) => c.innerText.includes(n))?.click(), name);
  const licSec = () => page.evaluate(() => {
    const sec = [...document.querySelectorAll(".detail section")]
      .find((x) => /WA contractor registration/i.test(x.querySelector("h4")?.innerText || ""));
    return { there: !!sec, add: !!sec?.querySelector(".lic-card.none .doc-add"),
      own: sec?.querySelector(".lic-own")?.innerText.trim() || "" };
  });
  await openCard("Typed In Roofing");
  await wait(800);
  let s = await licSec();
  t.ck("a contractor you typed in offers Add", s.there && s.add, JSON.stringify(s));
  await page.evaluate(() => document.querySelector(".lic-card.none .doc-add")?.click());
  await wait(900);
  const f = await page.evaluate(() => {
    const a = document.activeElement;
    const label = a?.closest("label");
    return { tag: a?.tagName, label: label?.innerText.replace(/\s+/g, " ").trim() || "",
      ring: !!label?.classList.contains("fld-ring") };
  });
  t.ck("Add lands in the license box", f.tag === "INPUT" && /L&I license #/.test(f.label), JSON.stringify(f));
  t.ck("and rings it", f.ring, JSON.stringify(f));
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
  await wait(500);

  await openCard("Self Run Roofing");
  await wait(800);
  s = await licSec();
  t.ck("a contractor who keeps their own record has no Add", s.there && !s.add, JSON.stringify(s));
  t.ck("it says they add it themselves", /their own account/i.test(s.own), JSON.stringify(s));

  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
