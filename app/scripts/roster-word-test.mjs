// What this account calls the companies on its roster.
//
// A general contractor holds the prime contract, so the people they engage
// work under it: those are SUBcontractors, and it is the word a GC uses all
// day. A property manager engages a plumber directly for their own building
// -- nobody is sub to anything, and "subcontractor" describes a chain that
// does not exist.
//
// Reported against the Add menu, which said "Contractor" to a general
// contractor. Fixing only that would have left the nav, the page title and
// the dashboard tile still saying Contractors -- two names for one list,
// which is how somebody concludes there are two lists.
//
// So this drives BOTH kinds and requires every one of those places to agree
// with itself and to differ between them. A static check that `rosterWords`
// exists cannot fail; only rendering it twice can.
//
//   node scripts/roster-word-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-rosterword-test");
const WEB = 5281, API = 8981;
const t = tally();
// ---- no customer's name is baked into the product -------------------------
//
// "Materials paid by" offered two options and one of them was the literal
// string "Outerhome" -- the first customer's name, shipped as the default
// answer and as a picker option for every account in SubSub. The other option
// said "Subcontractor (reimbursed)", which is the wrong noun for three of the
// five kinds, in the same control.
//
// Static, because what is checked is that two literals are gone and that the
// values come from the account instead. Driving the form would need a job, a
// property and a roster to reach one select.
{
  const src = readFileSync(join(app, "src/App.tsx"), "utf8");
  const i = src.indexOf("function JobForm(");
  const whole = src.slice(i, src.indexOf("\nfunction ", i + 10));
  // COMMENTS ARE STRIPPED FIRST, the same lesson `embed-test` already records
  // about reading CSS selectors: a comment explaining what the literal USED to
  // be reads, to a plain substring check, exactly like the literal still being
  // there. The first version of this failed on its own explanation.
  const body = whole.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  // The demo seed legitimately names the demo account; JobForm may not.
  for (const name of ["Outerhome", "Harbor Point", "Alder Construction"]) {
    t.ck(`the job form does not hardcode ${name}`, !body.includes(name), name);
  }
  t.ck("materials paid by defaults to the account's own name",
    /materialsPaidBy:\s*accountName/.test(body));
  t.ck("and the other option is whatever this account calls who it hires",
    /\$\{rosterWord\}\s*\(reimbursed\)/.test(body));
  t.ck("which JobForm is actually given",
    /<JobForm[\s\S]{0,400}?accountName=\{account\.name\}/.test(src)
      && /<JobForm[\s\S]{0,400}?rosterWord=\{rosterWords\(account\)\.One\}/.test(src));
}

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const acct = (kind) => ({
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
});

let KIND = "general_contractor";
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct(KIND)];
  if (path === "/api/account") return [200, acct(KIND)];
  if (path === "/api/subs" || path === "/api/jobs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/properties" || path === "/api/tenants") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();

// The nav entry, the Add menu item and the title of the screen the nav opens.
const wordsOnScreen = async (page) => {
  const nav = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")));
    return b ? b.innerText.trim().split(/[\s\n]/)[0] : null;
  });
  // The Add menu, which is where this was reported.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^\+?\s*Add$/.test(x.innerText.trim()))?.click());
  await wait(500);
  const menu = await page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
    .map((x) => x.innerText.trim()).filter((x) => /^(Sub)?contractor$/i.test(x))[0] || null);
  await page.keyboard.press("Escape");
  await wait(300);
  // And the screen it opens.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")));
    b?.click();
  });
  await wait(900);
  const title = await page.evaluate(() => {
    const h = document.querySelector(".ss-main h1, .ss-main h2, .page-head h1, .ph-title");
    return h ? h.innerText.trim() : null;
  });
  return { nav, menu, title };
};

try {
  console.log("\n-- a general contractor hires SUBcontractors --");
  KIND = "general_contractor";
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const w = await wordsOnScreen(page);
    t.ck("the nav says Subcontractors", w.nav === "Subcontractors", String(w.nav));
    t.ck("the Add menu offers a Subcontractor", w.menu === "Subcontractor", String(w.menu));
    t.ck("and the screen it opens is called the same thing",
      w.title === "Subcontractors", String(w.title));
    // The point of doing all three: one of them left behind is two names for
    // one list.
    t.ck("all three agree", w.nav === w.title && w.menu === "Subcontractor",
      `${w.nav} / ${w.menu} / ${w.title}`);

    // The dashboard too, and this is the half the first version of this test
    // missed: it checked the GC's nav and the PM's dashboard, so a component
    // left on the default word was right for one of them and the assertions
    // for the other were never written. The checklist duly went back to
    // "Bring your contractors in" for a general contractor with nothing
    // failing.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((x) => /^Dashboard/.test(x.innerText.trim()))?.click());
    await wait(900);
    const dash = await page.evaluate(() => document.body.innerText);
    t.ck("the set-up checklist asks for subcontractors",
      /bring your subcontractors in/i.test(dash),
      (dash.match(/Bring your [a-z]+ in/i) || ["not found"])[0]);
    t.ck("and the dashboard tile counts subcontractors",
      /subcontractors missing docs/i.test(dash),
      (dash.match(/[a-z]+ missing docs/i) || ["not found"])[0]);
    await ctx.close();
  }

  console.log("\n-- a property manager hires contractors, full stop --");
  KIND = "property_manager";
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const w = await wordsOnScreen(page);
    t.ck("the nav says Contractors", w.nav === "Contractors", String(w.nav));
    t.ck("the Add menu offers a Contractor", w.menu === "Contractor", String(w.menu));
    t.ck("and the screen agrees", w.title === "Contractors", String(w.title));
    t.ck("nobody is called a subcontractor to somebody with no prime contract",
      !/subcontractor/i.test(`${w.nav} ${w.menu} ${w.title}`),
      `${w.nav} / ${w.menu} / ${w.title}`);

    // The same bug mirrored, and the one that was still on screen after the
    // nav was fixed: the set-up checklist said "Bring your subcontractors in"
    // to a property manager, three inches under a nav reading Contractors.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((x) => /^Dashboard/.test(x.innerText.trim()))?.click());
    await wait(900);
    const dash = await page.evaluate(() => document.body.innerText);
    t.ck("and the set-up checklist does not call them subcontractors either",
      dash.length > 0 && !/subcontractor/i.test(dash),
      (dash.match(/.{0,40}subcontractor.{0,25}/i) || ["clean"])[0]);
    await ctx.close();
  }

  console.log("\n-- and a subcontractor account passes work down the same chain --");
  KIND = "subcontractor";
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const w = await wordsOnScreen(page);
    t.ck("so it says Subcontractors too", w.nav === "Subcontractors", String(w.nav));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
