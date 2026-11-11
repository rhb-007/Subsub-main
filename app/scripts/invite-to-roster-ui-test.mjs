// "Add to your roster" on an invite nobody has accepted.
//
// The panel gains one button; it opens the same add form "Add one myself"
// opens, with the company, contact, email and mobile from the invite already
// in it, and saving posts `fromInviteId` so the server ties the invite to the
// new record. An invite already on a contractor card offers no button: that
// one is on the roster. And once added, the invite is not listed a second
// time in the strip beside the card.
//
//   node --no-warnings scripts/invite-to-roster-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-invitetoroster-test");
const WEB = 5293, API = 8993;
const t = tally();

const ACCOUNT = {
  id: "acc_o", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_r", name: "Richard", email: "r@outerhome.test", role: "admin" },
};
const day = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const inv = (o) => ({ label: null, createdAt: day(-15), usedAt: null, revokedAt: null, companyId: null,
  sentAt: day(-15), expiresAt: day(15), status: "open", url: "https://outerhome.subsub.work/?invite=abc",
  engagedAs: "subcontractor", ...o });
const INVITES = [
  inv({ id: "inv_ent", email: "enterprise.roofing@live.test", phone: "+14254668486", contact: "Eli Park",
    companyName: "Enterprise Roofing" }),
  inv({ id: "inv_card", email: "c@carded.test", phone: null, contact: "Cy", companyName: "Carded Co",
    companyId: "cmp_card" }),
];
const posts = [];

serveApp({ dir: OUT, port: WEB });
serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs" && method === "POST") {
    posts.push(typeof body === "string" ? JSON.parse(body || "{}") : body);
    return [201, { companyId: "cmp_new", engagementId: "en_new", reused: false,
      invite: { invited: false, reason: "invite_already_out" }, fromInvite: { id: "inv_ent", bound: true } }];
  }
  if (path === "/api/subs") return [200, []];
  if (path === "/api/invites") return [200, INVITES];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Richard", email: "r@outerhome.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const goRoster = (page) => page.evaluate(() => [...document.querySelectorAll("nav button, .drawer button, aside button")]
  .find((x) => /^(sub)?contractors/i.test(x.innerText.trim()))?.click());
const openInvite = (page, re) => page.evaluate((src) => [...document.querySelectorAll(".invited-card")]
  .find((c) => new RegExp(src).test(c.innerText))?.click(), re);
const panel = (page) => page.evaluate(() => {
  const el = document.querySelector(".invited-panel");
  return { open: !!el, add: !!el?.querySelector(".inv-add-roster"), text: el?.innerText.replace(/\s+/g, " ") || "" };
});

try {
  const { page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_o" }, viewport: { width: 820, height: 1180 } });
  await wait(2400);
  await goRoster(page);
  await wait(1000);

  console.log("\n-- an invite on a card offers no button --");
  await openInvite(page, "Carded");
  await wait(600);
  let p = await panel(page);
  t.ck("its panel opened", p.open, p.text);
  t.ck("and there is no Add to your roster", p.open && !p.add, p.text);
  await page.keyboard.press("Escape"); await wait(300);
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click()); await wait(400);

  console.log("\n-- an open invite --");
  await openInvite(page, "Enterprise");
  await wait(600);
  p = await panel(page);
  t.ck("its panel offers Add to your roster", p.add, p.text);
  t.ck("and says they can be added now", /add them to your roster yourself now/i.test(p.text), p.text);
  await page.evaluate(() => document.querySelector(".inv-add-roster")?.click());
  await wait(800);
  const form = await page.evaluate(() => {
    const vals = [...document.querySelectorAll(".modal input")].map((i) => i.value);
    const labels = [...document.querySelectorAll(".modal input")].map((i) => (i.closest("label")?.innerText || i.placeholder || "").trim().slice(0, 20));
    return { invitedGone: !document.querySelector(".invited-panel"), vals, labels };
  });
  t.ck("the invite panel gives way to the add form", form.invitedGone && form.vals.length > 0, JSON.stringify(form));
  for (const v of ["Enterprise Roofing", "enterprise.roofing@live.test", "(425)466-8486"]) {
    t.ck(`the first step already holds ${v}`, form.vals.includes(v), JSON.stringify(form.vals));
  }
  // Past "are they already on SubSub?", the contact is there too.
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => /^Continue$/.test(b.innerText.trim()))?.click());
  await wait(500);
  const next = await page.evaluate(() => [...document.querySelectorAll(".modal input")].map((i) => i.value));
  t.ck("and the next holds the contact, Eli Park", next.includes("Eli Park"), JSON.stringify(next));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
} finally {
  await browser.close();
}
t.done();
