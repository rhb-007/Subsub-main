// What a subcontractor's own account looks like once they are inside it.
//
// They signed up to send a compliance pack. What they were given was a hiring
// account's home screen: a set-up checklist reading "Bring your subcontractors
// in -- 0 of 3", "Approve their documents" and "Create your first job", and no
// nav item for their own documents at all.
//
// None of those three is wrong for a general contractor. All three are wrong
// for a roofer, and "0 of 3" reads as a quota they are already failing on a
// screen they have just arrived at.
//
// What this covers:
//
//   THE CHECKLIST IS THEIRS: add the four documents, send them to somebody.
//   Not a shorter version of the hiring list -- a different list.
//
//   AND IT NAMES WHAT IS MISSING. "2 of 4" does not say which two, which is
//   the only thing worth knowing at that moment.
//
//   MY DOCUMENTS IS IN THE NAV. The panel already existed in Account ->
//   Company; ROLES.admin just had no way to it but Account, Company, scroll.
//   One implementation, two ways in -- a second copy would be two components
//   holding the same upload state.
//
//   AND ITS BADGE COUNTS PRESENCE, NOT APPROVAL. missingDocs() asks whether a
//   HIRING account has verified a document, and nobody verifies your own --
//   each client reviews separately -- so that test is false forever and the
//   badge would read 4 after uploading all four.
//
//   node scripts/sub-home-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-subhome-test");
const WEB = 5267, API = 8969;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = (kind) => ({
  id: "acc_orcas", name: "Orcas Roofing", subdomain: "orcasroofing", kind,
  plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_jason", name: "Jason", email: "jason@orcas.test", role: "admin" },
});

let KIND = "subcontractor";
let MY_COMPANY = {
  companyId: "cmp_own_acc_orcas", company: "Orcas Roofing", contact: "Jason",
  email: "jason@orcas.test", license: null, docs: {}, sharesSent: 0,
  findable: true, code: null, url: null,
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT(KIND)];
  if (path === "/api/account") return [200, ACCOUNT(KIND)];
  if (path === "/api/my-company") return [200, MY_COMPANY];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/account-users") return [200, [
    { id: "u_jason", name: "Jason", email: "jason@orcas.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "orcasroofing", webPort: WEB,
    seat: { userId: "u_jason", accountId: "acc_orcas" },
    viewport: { width: 1200, height: 1400 } });
  for (let n = 0; n < 30; n++) {
    await wait(250);
    if (await r.page.$(".gs-card")) break;
  }
  return r;
};
const steps = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".gs-steps li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()));
const navItems = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav.tabs button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));

try {
  console.log("\n-- the checklist a subcontractor gets --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: {}, sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    const list = await steps(page);
    const all = list.join(" | ");

    t.ck("there is a checklist", list.length > 0, String(list.length));
    // THE THREE THAT WERE WRONG.
    t.ck("nothing about bringing subcontractors in", !/bring your subcontractors/i.test(all), all);
    t.ck("nothing about approving their documents", !/approve their documents/i.test(all), all);
    t.ck("and no create-your-first-job", !/first job/i.test(all), all);

    // THE TWO THAT MATTER.
    // One row per thing, because a counter does not say which two are missing
    // and the two it does not name are the whole task.
    t.ck("the trades line is about being hired, not hiring",
      /trades you want to be hired for/i.test(all), all);
    t.ck("insurance is its own row", /certificate of insurance/i.test(all), all);
    t.ck("so is the bond", /surety bond/i.test(all), all);
    t.ck("so is the W-9", /add your w-9/i.test(all), all);
    t.ck("and sending it is the last one", /send your pack/i.test(all), all);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and it moves as they do the work --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: { insurance: { fileName: "coi.pdf" }, w9: { fileName: "w9.pdf" } },
      sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    // Only the CURRENT step carries its note and buttons; a finished one is
    // its title and a tick. So the thing to assert is which row is which.
    const marked = await page.evaluate(() =>
      [...document.querySelectorAll(".gs-steps li")].map((li) => ({
        title: li.querySelector("b")?.innerText.trim() || "",
        state: li.className.replace("gs-step ", "").trim(),
      })));
    const stateOf = (re) => (marked.find((m) => re.test(m.title)) || {}).state;
    t.ck("insurance is ticked off", stateOf(/certificate of insurance/i) === "done",
      JSON.stringify(marked));
    t.ck("the W-9 too", stateOf(/w-9/i) === "done", JSON.stringify(marked));
    t.ck("and the bond is the one it is asking for now",
      stateOf(/surety bond/i) === "now", JSON.stringify(marked));
    t.ck("with the rest still to come",
      stateOf(/license/i) === "later", JSON.stringify(marked));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the pack is on the dashboard, permanently --");
  {
    // The set-up checklist is temporary by design -- it disappears when
    // finished and can be dismissed before that -- and what it stands in front
    // of is the thing the account is FOR. Somebody asked for their insurance on
    // a job site needs that answer every day, not only in week one.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1234",
      docs: { insurance: { fileName: "coi.pdf", expiresOn: "2027-06-30" },
        bond: { fileName: "bond.pdf", expiresOn: "2024-01-01" } },
      sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows li")].map((li) => ({
        label: li.querySelector(".cpr-lab")?.innerText.trim(),
        note: li.querySelector(".cpr-note")?.innerText.trim(),
        state: li.className.trim(),
      })));
    t.ck("the card is there", rows.length > 0, JSON.stringify(rows.length));
    const row = (re) => rows.find((r) => re.test(r.label || "")) || {};
    t.ck("a current document reads through its expiry",
      /Through/i.test(row(/insurance/i).note || ""), JSON.stringify(row(/insurance/i)));
    t.ck("a lapsed one says so and is marked",
      /Expired/i.test(row(/bond/i).note || "") && row(/bond/i).state === "bad",
      JSON.stringify(row(/bond/i)));
    t.ck("one not added says that", /Not added/i.test(row(/w-9/i).note || ""),
      JSON.stringify(row(/w-9/i)));
    // The dot carries the state, so it must not be the only thing that does.
    t.ck("every row says its state in words too",
      rows.every((r) => (r.note || "").length > 0), JSON.stringify(rows));
    t.ck("the licence row names the state it is from",
      /OR/.test(row(/license/i).label || ""), JSON.stringify(row(/license/i)));

    // THE ONE THAT MUST NOT BE HARDCODED. A UBI is Washington's Unified
    // Business Identifier and does not exist in the other fifty, so a row for
    // it in Oregon is a line nobody there can ever complete.
    t.ck("no UBI row outside Washington",
      !rows.some((r) => /UBI/i.test(r.label || "")), JSON.stringify(rows.map((r) => r.label)));

    // And the send is in the card, not behind a menu.
    t.ck("the send field is right there",
      await page.evaluate(() => !!document.querySelector(".cpack .qsend-row input")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a Washington company is asked for its UBI --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", ubi: null, license: "ORCASR891QZ",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows .cpr-lab")].map((x) => x.innerText.trim()));
    t.ck("the UBI row appears in WA", labels.some((l) => /UBI/i.test(l)), labels.join(" | "));
    const all = (await steps(page)).join(" | ");
    t.ck("and it is a checklist step there too", /Add your UBI/i.test(all), all);
    t.ck("with the licence naming Washington", /Washington contractor license/i.test(all), all);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- with nothing on file there is nothing to send --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", docs: {}, sharesSent: 0, ubi: null };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    // The server refuses an empty pack with nothing_on_file, so a send field
    // here would be a button the server will refuse.
    t.ck("no send field with an empty pack",
      await page.evaluate(() => !document.querySelector(".cpack .qsend-row input")));
    t.ck("and it says what unlocks it",
      await page.evaluate(() => !!document.querySelector(".cpack-empty")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- My documents is reachable from the nav --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    const nav = await navItems(page);
    t.ck("it is in the nav at all", nav.some((x) => /^My documents/i.test(x)), nav.join(" | "));
    // Presence, not approval: nobody verifies your own documents, so a badge
    // built on missingDocs() would read 4 after all four were uploaded.
    const item = nav.find((x) => /^My documents/i.test(x)) || "";
    t.ck("and badges the three not on file", /\b3\b/.test(item), item);

    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^My documents/i.test(b.innerText))?.click());
    for (let n = 0; n < 25; n++) {
      await wait(200);
      if (await page.$(".mydocs")) break;
    }
    t.ck("pressing it lands on the documents themselves",
      await page.evaluate(() => !!document.querySelector(".mydocs")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a general contractor's home is untouched --");
  {
    KIND = "general_contractor";
    MY_COMPANY = { ...MY_COMPANY, docs: {}, sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    const all = (await steps(page)).join(" | ");
    t.ck("they are still asked to bring subcontractors in",
      /bring your subcontractors/i.test(all), all);
    t.ck("and to create a first job", /first job/i.test(all), all);
    t.ck("and are not asked for a compliance pack of their own",
      !/compliance pack/i.test(all), all);
    // They can be hired too, so the documents item is theirs as well.
    t.ck("but My documents is there, because they can be hired",
      (await navItems(page)).some((x) => /^My documents/i.test(x)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and an account that cannot be hired has no documents item --");
  {
    KIND = "property_manager";
    MY_COMPANY = { ...MY_COMPANY, docs: {} };
    const { ctx, page, crashes } = await open();
    // A landlord is nobody's subcontractor; an item answering 403 is worse
    // than no item.
    t.ck("no My documents for a property manager",
      !(await navItems(page)).some((x) => /^My documents/i.test(x)),
      (await navItems(page)).join(" | "));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
