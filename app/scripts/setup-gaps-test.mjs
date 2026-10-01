// Finishing setup for a contractor who never arrived.
//
// An invited subcontractor who has not opened their link has a half-filled
// record and nobody is coming to finish it -- that is what "not arrived"
// means. Until it is finished they cannot be matched to a job or assigned,
// and they sit on the roster as a row that does nothing.
//
// The account could always do it: `PATCH /api/subs/:companyId` takes the
// company half exactly when nobody answers for that company. What was
// missing is the way in, which is this file's oldest shape.
//
// What the assertions have to be careful about:
//
//   THE GATE IS `answersForItself`, NOT `hasPortal`. A roofer whose only
//   login is on ANOTHER account has no portal here and is still somebody
//   else's record; the server answers `company_not_yours`. The fixture holds
//   exactly that row, because it is the only one the two predicates disagree
//   on -- and checking the easy row passes whichever is in force.
//
//   AND NAMING THE GAPS IS THE FEATURE. "Setup incomplete" is a count;
//   somebody has to open a three-step form and hunt. So the labels are
//   asserted, and so is the step the button lands on.
//
//   node --no-warnings scripts/setup-gaps-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { setupGaps, mayFinishSetup, firstGapStep } from "../shared/setup.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-setupgaps-test");
const WEB = 5299, API = 8999;
const t = tally();

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

// A record with nothing but a name and an address: what an account has after
// typing somebody in and inviting them.
const BARE = {
  id: "cmp_bare", engagementId: "en_bare", accountId: "acc_x",
  company: "San Juan Exteriors", contact: "", email: "sj@example.test",
  phone: "", city: "", state: "", zip: "", license: "", licenseCheck: null,
  categories: [], caps: [], coverage: { mode: "cities", cities: [], radii: [] },
  crews: [], rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
  available: true, unavailableDays: [], warranty: null,
  status: "invited", insurance: 0, bond: 0, contract: 0, w9: 0,
  docFiles: {}, docReview: {}, propertyIds: [], notes: "",
  notify: { email: true, sms: false }, autoSchedule: false,
  docs: {}, docState: "missing", docAssignable: false, docSoonest: null,
  hasPortal: false, answersForItself: false,
};
// Same emptiness, but somebody else answers for them: no portal HERE, a seat
// elsewhere. The one row the two predicates disagree on.
const THEIRS = { ...BARE, id: "cmp_theirs", engagementId: "en_theirs", company: "Harbor Glass",
  hasPortal: false, answersForItself: true };
// And one that is finished, so "no gaps draws nothing" is checked rather than
// assumed.
const DONE = { ...BARE, id: "cmp_done", engagementId: "en_done", status: "active",
  company: "Cascade Roofworks", contact: "Miguel Alvarez",
  phone: "206-555-0142", city: "Seattle", state: "WA", zip: "98108",
  categories: ["roofing"], coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  crews: [{ id: "c1", name: "Crew A", available: true, unavailableDays: [],
    members: [{ name: "Miguel Alvarez", role: "Lead" }] }],
  insurance: 1, bond: 1, w9: 1, answersForItself: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/subs") return [200, [BARE, THEIRS, DONE]];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

// ---- the rule on its own -------------------------------------------------
console.log("\n-- what counts as a gap --");
{
  const g = setupGaps(BARE);
  const keys = g.map((x) => x.key);
  t.ck("a bare record is missing the lot", g.length >= 6, JSON.stringify(keys));
  // One or the other. A contractor reachable by mobile and not by email is
  // completely set up, and asking for the second is a box they can never tick.
  t.ck("an email alone satisfies how to reach them", !keys.includes("reach"), JSON.stringify(keys));
  t.ck("but no email and no phone does not",
    setupGaps({ ...BARE, email: "" }).some((x) => x.key === "reach"));
  // `{}` is truthy and the column defaults to it, so the obvious
  // `!!sub.coverage` answers yes to a contractor who covers nowhere.
  t.ck("an empty coverage object is still a gap", keys.includes("coverage"), JSON.stringify(keys));
  t.ck("and a filled one is not",
    !setupGaps({ ...BARE, coverage: { cities: ["Seattle"], radii: [] } }).some((x) => x.key === "coverage"));
  // The signed agreement is the hiring account's own paperwork and optional
  // by decision; a row demanding one is the permanently-amber failure.
  t.ck("the optional agreement is never a gap", !keys.includes("contract"), JSON.stringify(keys));
  t.ck("the three required documents are", ["insurance", "bond", "w9"].every((k) => keys.includes(k)));
  t.ck("a finished record has none", setupGaps(DONE).length === 0,
    JSON.stringify(setupGaps(DONE).map((x) => x.key)));
  // Pointing rather than landing: the button opens where the work is.
  t.ck("and it lands on the first step with something on it", firstGapStep(g) === 1, String(firstGapStep(g)));
  t.ck("later, when the early steps are done",
    firstGapStep(setupGaps({ ...DONE, insurance: false })) === 3,
    String(firstGapStep(setupGaps({ ...DONE, insurance: false }))));

  t.ck("somebody nobody answers for may be finished", mayFinishSetup(BARE) === true);
  // THE ROW THE TWO PREDICATES DISAGREE ON.
  t.ck("and somebody with a seat elsewhere may not", mayFinishSetup(THEIRS) === false);
  t.ck("even though they have no login here", THEIRS.hasPortal === false);
}

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openCard = async (page, name) => {
  // NAV LABEL IS THE ROSTER NOUN -- "Subcontractors" for a general contractor
  // and "Contractors" for a managing agent -- so it is matched loosely, for
  // the reason test:rosterword records: this suite is about the panel, not
  // about what the roster is called.
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /contractor/i.test(b.innerText || ""))?.click());
  await wait(1600);
  // The name is a heading inside the tile rather than a button of its own,
  // which is what the first version of this missed -- reporting a panel that
  // renders perfectly as absent.
  await page.evaluate((n) => {
    const el = [...document.querySelectorAll("button, [role=button], h3, h4")]
      .find((x) => (x.innerText || "").includes(n));
    el?.click();
  }, name);
  await wait(1200);
};

const readPanel = (page) => page.evaluate(() => {
  const p = document.querySelector(".setup-gaps");
  return p ? {
    text: (p.innerText || "").replace(/\s+/g, " ").trim(),
    gaps: [...p.querySelectorAll(".sg-list li")].map((x) => x.textContent.trim()),
    btn: p.querySelector("button")?.innerText.trim() || null,
  } : null;
});

try {
  console.log("\n-- the card offers it, and names what is missing --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
    await wait(2400);
    await openCard(page, "San Juan Exteriors");
    const g = await readPanel(page);
    t.ck("the panel is on the card", !!g, String(g));
    t.ck("saying nobody has filled it in", /Nobody has signed in/i.test(g?.text || ""),
      String(g?.text || "").slice(0, 90));
    // Named, not counted: a list somebody can work through.
    t.ck("and naming the gaps", (g?.gaps || []).length >= 6, JSON.stringify(g?.gaps));
    t.ck("in words rather than field names",
      (g?.gaps || []).some((x) => /insurance/i.test(x)) && (g?.gaps || []).some((x) => /What they do/i.test(x)),
      JSON.stringify(g?.gaps));
    t.ck("with a way in", /Continue setup/i.test(g?.btn || ""), String(g?.btn));

    // And pressing it opens the form, on the step the first gap is on.
    await page.evaluate(() => [...document.querySelectorAll(".setup-gaps button")]
      .find((b) => /Continue setup/i.test(b.innerText || ""))?.click());
    await wait(1200);
    const form = await page.evaluate(() => {
      const on = document.querySelector(".step-dot.on, .steps .on, .form-steps .on");
      return { open: !!document.querySelector(".modal"),
        step: on?.textContent?.trim() || null,
        text: (document.querySelector(".modal")?.innerText || "").replace(/\s+/g, " ").slice(0, 160) };
    });
    t.ck("the form opens", form.open === true, JSON.stringify(form));
    t.ck("on the company step, which is where the first gap is",
      /Company/i.test(form.text), form.text.slice(0, 120));
    await ctx.close().catch(() => {});
  }

  // ---- the field the gate is made of -------------------------------------
  //
  // THIS IS THE ONE THAT FOUND A LIVE BUG. `/api/subs` has carried
  // `answersForItself` since `SubForm`'s lock was corrected to read it, and
  // nothing in the browser read it into state -- it is neither a companies
  // column nor an engagements one, so both whitelists dropped it exactly as
  // they drop `hasPortal`. So `locked = !!existing?.answersForItself` was
  // `!!undefined` on every row and permanently false: the three-step form
  // opened fully editable over a contractor somebody else answers for, and
  // the server answered `company_not_yours` to a save the screen had already
  // invited. The fix shipped over a field that never arrived.
  //
  // No static check can see it -- the source reads exactly as intended --
  // and only a row the two predicates DISAGREE on can tell.
  console.log("\n-- and the form behind it is locked for them too --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
    await wait(2400);
    await openCard(page, "Harbor Glass");
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Edit/i.test((b.innerText || "").trim()))?.click());
    await wait(1200);
    const form = await page.evaluate(() => {
      const m = document.querySelector(".modal");
      return { open: !!m, text: (m?.innerText || "").replace(/\s+/g, " ") };
    });
    t.ck("the edit form opens, so this can fail", form.open === true, JSON.stringify(form).slice(0, 80));
    // Locked is one pane -- "How you work with X" -- rather than three steps.
    t.ck("and it is the engagement-only pane, not the three-step form",
      !/Step 1 of 3/i.test(form.text), form.text.slice(0, 120));
    t.ck("saying their details are their own",
      /their own|theirs/i.test(form.text), form.text.slice(0, 200));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- but not over a record somebody else answers for --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
    await wait(2400);
    await openCard(page, "Harbor Glass");
    // The card has to have opened, or "no panel" is an assertion that cannot
    // fail -- the trap this repo records about the QR code test.
    const opened = await page.evaluate(() =>
      (document.querySelector(".modal")?.innerText || "").includes("Harbor Glass"));
    t.ck("their card opened, so the next line can fail", opened === true);
    t.ck("and there is no Continue setup on it", (await readPanel(page)) === null);
    await ctx.close().catch(() => {});
  }

  console.log("\n-- and nothing at all on a finished record --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
    await wait(2400);
    await openCard(page, "Cascade Roofworks");
    const opened = await page.evaluate(() =>
      (document.querySelector(".modal")?.innerText || "").includes("Cascade Roofworks"));
    t.ck("their card opened", opened === true);
    t.ck("and the panel is absent", (await readPanel(page)) === null);
    await ctx.close().catch(() => {});
  }
} catch (err) {
  t.fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
