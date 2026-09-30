// The code a hiring account holds up on a job site to recruit somebody.
//
// The exact mirror of the subcontractor's own QR code: theirs hands over a
// compliance pack, this one hands over a place to apply. What is easy to get
// wrong and impossible to see on a screen:
//
//   THE ADDRESS HAS TO RESOLVE. A custom hostname is Scale, so on Basic
//   <sub>.subsub.work is dead -- and a QR code that fails while somebody is
//   standing there holding a phone is worse than no code at all. That is the
//   whole reason `applyUrl` exists rather than the panel building the URL.
//
//   IT IS SCALE, BY DECISION, AND THE SNIPPET BESIDE IT IS NOT. That pair is
//   gated differently on purpose and a later pass will want to harmonise
//   them: the snippet is the cheapest growth lever and `POST
//   /api/apply/:subdomain` checks no plan, while the code is the in-person
//   gesture that goes with a branded address, which is itself Scale. Both
//   branches are asserted, because a component left on one answer is right
//   for one plan and never checked for the other.
//
//   THE FORM HAS TO OPEN AT THE OTHER END. `openingApplication` required a
//   real subdomain, so the fallback address would have drawn a sign-in page:
//   a code that scans, loads, and shows the wrong screen.
//
//   ONE COMPONENT, TWO WAYS IN. Branding holds the panel and the
//   add-a-contractor gate opens the same one. Two copies would be two
//   components to keep in step, which is the rule the embed panel records.
//
//   node --no-warnings scripts/recruit-qr-test.mjs

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-recruitqr-test");
const WEB = 5283, API = 8983;
const t = tally();

const E = await import("../shared/embed.js");

// ---- the address, which is the whole decision ------------------------------
console.log("\n-- which address the code encodes --");
{
  t.ck("with a live hostname it is their own name",
    E.applyUrl("outerhome", { liveHost: true }) === "https://outerhome.subsub.work/?apply=1",
    E.applyUrl("outerhome", { liveHost: true }));
  // The one that matters. Withholding the code here is what the recorded
  // decision refuses; encoding a dead address is what the panel refuses.
  t.ck("without one it still produces a URL, naming the account in the query",
    E.applyUrl("outerhome", { liveHost: false }) === "https://app.subsub.work/?apply=outerhome",
    E.applyUrl("outerhome", { liveHost: false }));
  t.ck("and it is never the dead subdomain address",
    !E.applyUrl("outerhome", { liveHost: false }).startsWith("https://outerhome."));
  t.ck("a reserved subdomain encodes nothing at all",
    E.applyUrl("app") === null && E.applyUrl("www") === null);
  t.ck("and so does junk", E.applyUrl("") === null && E.applyUrl("has space") === null);
  t.ck("the account name is escaped into the query rather than concatenated",
    E.applyUrl("a-b") === "https://app.subsub.work/?apply=a-b");

  // Two functions building one URL is two records of one fact. `applyLink` is
  // the snippet's -- it goes on the customer's own website, where a link to
  // app.subsub.work would read as sending their visitors elsewhere -- so it is
  // defined in terms of this one rather than beside it.
  t.ck("applyLink is the same implementation, not a second copy",
    E.applyLink("outerhome") === E.applyUrl("outerhome", { liveHost: true }));

  // Comments stripped first: a comment explaining the address reads, to a
  // substring count, exactly like a second place building it. Same lesson
  // test:rosterword records about a hardcoded company name.
  const src = readFileSync(join(app, "shared/embed.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // WHOLE comment lines only. A `//` stripper that does not care where the
    // slashes are eats `https://` and leaves nothing to count, which is how
    // the first version of this reported ZERO places building the URL -- a
    // pass turned into a failure by its own tooling.
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const builds = (src.match(/subsub\.work\/\?apply=/g) || []).length;
  t.ck("and there is only one place that builds it", builds === 1, String(builds));
}

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
// The same account without the plan. `hostnameStatus` stays null in both, so
// the fallback address is what is drawn either way -- which is the point: a
// Scale account whose custom hostname is still being provisioned gets a code
// that works rather than one that resolves to nothing.
const BASIC = { ...ACCOUNT, plan: "basic" };
let PLAN = "scale";

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  const acct = PLAN === "scale" ? ACCOUNT : BASIC;
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/subs" || path === "/api/jobs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/properties" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/agreements") return [200, []];
  if (path === "/api/agreement-terms") return [200, { terms: {}, hiringParty: {}, requireByDefault: false, fields: [], template: { reviewed: null } }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();

// ---- the code scans to the FORM, not to a sign-in page --------------------
//
// `openingApplication` required a real subdomain, so the fallback address the
// code now encodes would have loaded the login screen. A code that scans,
// loads and shows the wrong screen is the worst of the three failures here,
// because it looks like it worked.
console.log("\n-- what the encoded address actually opens --");
{
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${WEB}/?apply=outerhome`, { waitUntil: "networkidle0" });
  await wait(600);
  const txt = await page.evaluate(() => document.body.innerText);
  t.ck("the application form opens on a hostname that is nobody's",
    /Work with Outerhome|Tell us about your company/i.test(txt),
    txt.slice(0, 120).replace(/\n/g, " | "));
  t.ck("and it is not the sign-in page", !/Enter your email and password/i.test(txt));
  // The account is named in the URL, so the form has to wear their branding:
  // one company's name over another company's colours tells an applicant they
  // are in the wrong place.
  t.ck("branded as the account the link names", /Outerhome/.test(txt));

  // And the query string must not brand anything else. A hostname belonging
  // to nobody wearing a company's colours because of a query parameter is the
  // white-label failure this codebase refuses, from a new direction.
  const p2 = await browser.newPage();
  await p2.goto(`http://127.0.0.1:${WEB}/?brand=outerhome`, { waitUntil: "networkidle0" });
  await wait(500);
  const t2 = await p2.evaluate(() => document.body.innerText);
  // ASSERTED ON THE BRANDING, not on the apply form's heading. The first
  // version looked for "Work with Outerhome", which is absent either way --
  // `openingApplication` still requires `?apply`, so the FORM never renders
  // for `?brand=`. What a widened lookup would actually do is put the
  // account's name and colours on a sign-in page for a hostname that belongs
  // to nobody, which is the white-label failure, and the check has to look at
  // the thing that changes. Mutation caught it passing.
  t.ck("but a bare query parameter does not brand the sign-in page",
    !/Outerhome/i.test(t2), t2.slice(0, 90).replace(/\n/g, " | "));
  t.ck("which still wears SubSub's own identity", /SubSub/i.test(t2),
    t2.slice(0, 60).replace(/\n/g, " | "));
  await page.close(); await p2.close();
}

// ---- the two ways in ------------------------------------------------------
console.log("\n-- both ways in reach the same code --");
{
  const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
  await wait(2200);

  // Branding, where the artifact lives beside the form it is a code for.
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Branding")?.click());
  await wait(900);

  const onBranding = await page.evaluate(() => {
    const panel = [...document.querySelectorAll(".rq-panel")][0];
    return panel ? {
      heading: (panel.querySelector("h4")?.innerText || "").trim(),
      url: (panel.querySelector(".rq-url")?.innerText || "").trim(),
      qr: !!panel.querySelector("svg.qr"),
      note: (panel.querySelector(".rq-note")?.innerText || "").trim(),
    } : null;
  });
  t.ck("the panel is on Branding", !!onBranding, JSON.stringify(onBranding));
  t.ck("and it draws an actual code", onBranding?.qr === true);
  // A QR code is the one control whose destination cannot be read, so
  // somebody about to point a stranger's camera at it is shown the address.
  t.ck("the address is shown, because a code cannot be read",
    /app\.subsub\.work\/\?apply=outerhome/.test(onBranding?.url || ""), onBranding?.url);
  t.ck("and says the address will switch to their own once it is live",
    /subsub\.work is live|switches to your own/i.test(onBranding?.note || ""),
    onBranding?.note?.slice(0, 80));

  // And the add-a-contractor gate, which is where the question comes up.
  // The roster, then the Add MENU -- which is a menu, so reaching the form
  // takes the entry inside it and not just the button that opens it.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")))?.click());
  await wait(900);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^\+?\s*Add$/.test(x.innerText.trim()))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
    .find((x) => /^(Sub)?contractor$/i.test(x.innerText.trim()))?.click());
  await wait(900);
  const gate = await page.evaluate(() => {
    const b = document.querySelector(".cx-gate-qr");
    return b ? (b.innerText || "").trim() : null;
  });
  t.ck("the add-a-contractor gate offers it too", !!gate, String(gate).slice(0, 70));
  t.ck("and says why, rather than only naming the artifact",
    /here with you|scan/i.test(gate || ""), String(gate).slice(0, 70));

  await page.evaluate(() => document.querySelector(".cx-gate-qr")?.click());
  await wait(700);
  const modal = await page.evaluate(() => {
    const m = document.querySelector(".rq-modal");
    return m ? {
      qr: !!m.querySelector("svg.qr"),
      url: (m.querySelector(".rq-url")?.innerText || "").trim(),
    } : null;
  });
  t.ck("pressing it opens the same code", !!modal && modal.qr === true, JSON.stringify(modal));
  t.ck("encoding the same address as the panel",
    !!modal?.url && modal.url === onBranding?.url,
    `${modal?.url} vs ${onBranding?.url}`);

  // No unrendered escape anywhere, which is this codebase's standing guard.
  const body = await page.evaluate(() => document.body.innerText);
  t.ck("no \\uXXXX survives into the page", !/\\u[0-9a-fA-F]{4}/.test(body));
  await page.close(); await ctx.close();
}

// ---- and the Basic branch, which is the half a single-plan test never sees --
//
// Asserted because the snippet beside it is deliberately NOT gated this way.
// A pass that only ever drives Scale would be satisfied by no gate at all.
console.log("\n-- on Basic the code is withheld, and the snippet is not --");
{
  PLAN = "basic";
  const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
  await wait(2200);
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Branding")?.click());
  await wait(900);

  const seen = await page.evaluate(() => ({
    // Read through `?.` so a missing panel reports as a missing panel rather
    // than throwing and hiding every assertion after it.
    qr: !!document.querySelector(".rq-panel"),
    snippet: !!document.querySelector(".embed-strip"),
    branding: /Branding comes with Scale/i.test(document.body.innerText),
  }));
  t.ck("the Branding tab really did open, so the next two can fail",
    seen.branding, JSON.stringify(seen));
  t.ck("the code is withheld on Basic", seen.qr === false, JSON.stringify(seen));
  // THE PAIR. Same tab, same form behind them, different gate -- and this is
  // the assertion that stops the two being harmonised in either direction.
  t.ck("but the snippet beside it is still there, which is the whole pair",
    seen.snippet === true, JSON.stringify(seen));

  // And the add-a-contractor gate agrees with the tab, or the screen offers a
  // code the Branding tab does not have.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")))?.click());
  await wait(900);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^\+?\s*Add$/.test(x.innerText.trim()))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
    .find((x) => /^(Sub)?contractor$/i.test(x.innerText.trim()))?.click());
  await wait(900);
  const gateOnBasic = await page.evaluate(() => ({
    gate: !!document.querySelector(".cx-gate"),
    qr: !!document.querySelector(".cx-gate-qr"),
  }));
  t.ck("the add form opened, so this assertion can fail", gateOnBasic.gate,
    JSON.stringify(gateOnBasic));
  t.ck("and it does not offer a code the Branding tab withholds",
    gateOnBasic.qr === false, JSON.stringify(gateOnBasic));
  await page.close(); await ctx.close();
  PLAN = "scale";
}

await browser.close();
web.close(); api.close();
t.done();
