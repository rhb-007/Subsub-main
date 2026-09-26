// The owner, on the building.
//
// "On a property manager account, where is the owner added to each property?
// It's not on the property itself." It was not: the grant is a property scope
// on the owner's MEMBERSHIP, edited from the user form, and the properties
// screen read no users at all. So "who owns 12 Cedar St" could only be answered
// by opening every user in turn and reading their tick list backwards, and
// adding an owner to the building you were looking at meant leaving it.
//
// The relationship has not moved -- it is still membership_properties, still
// editable from the user form, stored once. This is the other direction onto
// it, plus one thing the Users screen cannot show: an owner who was granted a
// building and never arrived. A manager who ticked a box believes they have
// given somebody access; an invite never sent, or never opened, looks the same
// from a distance.
//
// And one negative: an owner does not see this panel. Two owners at the same
// building are both guests, and one is not the account's to introduce to the
// other.
//
//   node scripts/property-owner-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-propowner-test");
const WEB = 5219, API = 8931;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ACCOUNT = {
  id: "acc_pm", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", role: "admin" },
};

const PROPERTIES = [
  { id: "p1", accountId: "acc_pm", name: "12 Cedar St", address: "12 Cedar St",
    area: "Seattle", zip: "98101", units: 8, notes: "" },
  { id: "p2", accountId: "acc_pm", name: "40 Elm Ave", address: "40 Elm Ave",
    area: "Tacoma", zip: "98402", units: 4, notes: "" },
  { id: "p3", accountId: "acc_pm", name: "9 Birch Ln", address: "9 Birch Ln",
    area: "Olympia", zip: "98501", units: 2, notes: "" },
];

// Dana owns Cedar and Elm and has signed in. Theo owns Cedar and never has.
// Nobody owns Birch.
const USERS = [
  { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", phone: null,
    role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_dana", name: "Dana Reyes", email: "dana@owner.test", phone: null,
    role: "owner", subId: null, propertyIds: ["p1", "p2"], unit: null,
    hasLogin: true, inviteSentAt: iso(-20), hasAvatar: false },
  { id: "u_theo", name: "Theo Park", email: "theo@owner.test", phone: null,
    role: "owner", subId: null, propertyIds: ["p1"], unit: null,
    hasLogin: false, inviteSentAt: iso(-3), hasAvatar: false },
];

// Which properties the signed-in seat is allowed to see.
let VISIBLE = ["p1", "p2", "p3"];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  // Scoped the way the real server scopes it. propertyScope() decides this
  // against the caller's membership_properties and is covered against the real
  // Worker by owner-scope-test.mjs; a stub that handed back the whole portfolio
  // would make the checks below pass on the stub rather than on the app.
  if (path === "/api/properties") return [200, PROPERTIES.filter((x) => VISIBLE.includes(x.id))];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/subs" || path === "/api/jobs") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  return undefined;
} });

const browser = await launch();
const openAs = async (userId) => {
  const r = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId, accountId: "acc_pm" }, viewport: { width: 1340, height: 1800 } });
  await wait(2600);
  return r;
};
const toProperties = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^(Properties|Buildings)/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(1000);
};
const cards = (page) => page.evaluate(() => [...document.querySelectorAll(".prop-card")].map((c) => ({
  name: c.querySelector("h3")?.innerText.trim(),
  owners: c.querySelector(".prop-owners")?.innerText.replace(/\s+/g, " ").trim() || null,
  rows: [...c.querySelectorAll(".po-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
  // Specifically the one in the Owners panel. Other panels on this card have
  // their own start buttons and must not be mistaken for this.
  addBtn: !!c.querySelector(".prop-owners .po-add"),
})));

try {
  console.log("\n-- the owner is on the building now --");
  const { ctx, page, crashes } = await openAs("u_pm");
  await toProperties(page);
  const list = await cards(page);
  t.ck("all three buildings are drawn", list.length === 3, JSON.stringify(list.map((c) => c.name)));

  const cedar = list.find((c) => /Cedar/.test(c.name || ""));
  const elm = list.find((c) => /Elm/.test(c.name || ""));
  const birch = list.find((c) => /Birch/.test(c.name || ""));

  t.ck("the building has an Owners section", !!cedar?.owners, String(cedar?.owners));
  t.ck("both of Cedar's owners are named",
    /Dana Reyes/.test(cedar.owners) && /Theo Park/.test(cedar.owners), cedar.owners);
  t.ck("with their addresses", /dana@owner\.test/.test(cedar.owners), cedar.owners);
  t.ck("Elm shows only its own owner",
    /Dana Reyes/.test(elm.owners) && !/Theo Park/.test(elm.owners), elm.owners);
  t.ck("a building with no owner says so plainly",
    /nobody owns this building/i.test(birch.owners), birch.owners);
  t.ck("and explains what an owner would see",
    /work at their own buildings/i.test(birch.owners), birch.owners);

  console.log("\n-- and it says who has actually arrived --");
  {
    const dana = cedar.rows.find((r) => /Dana/.test(r));
    const theo = cedar.rows.find((r) => /Theo/.test(r));
    t.ck("somebody who has signed in reads as signed in", /signed in/i.test(dana), dana);
    t.ck("somebody who has not is flagged instead",
      !/signed in/i.test(theo) && /hasn't set a password/i.test(theo), theo);
    t.ck("and can be chased from here", /send again/i.test(theo), theo);
    // The consequence spelled out, because a ticked box looks like access.
    t.ck("the building warns that one of them cannot see it",
      /1 of 2 cannot see anything here yet/i.test(cedar.owners), cedar.owners);
    // An owner of several buildings is distinguishable from an owner of one.
    t.ck("an owner of more than one building says how many",
      /2 buildings/.test(dana), dana);
    t.ck("an owner of exactly one does not", !/1 building/.test(theo), theo);
  }

  console.log("\n-- adding an owner starts from the building --");
  {
    t.ck("every building offers it", list.every((c) => c.addBtn), JSON.stringify(list.map((c) => c.addBtn)));
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".prop-card")].find((x) => /Birch/.test(x.innerText));
      c.querySelector(".po-add").click();
    });
    await wait(1100);
    const form = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /new user/i.test(x.innerText));
      if (!f) return null;
      // The role is a button group (.role-pick), not a select.
      const chosen = f.querySelector(".role-pick button.on");
      const ticked = [...f.querySelectorAll(".pick-grid .pick")]
        .filter((b) => b.className.split(/\s+/).includes("on")).map((b) => b.innerText.trim());
      return { roleText: chosen?.querySelector(".rp-label")?.innerText.trim() || null,
        buildingsLabel: [...f.querySelectorAll(".fld")]
          .map((x) => x.innerText.split("\n")[0].trim()).find((x) => /building/i.test(x)) || null,
        ticked, text: f.innerText.replace(/\s+/g, " ").trim().slice(0, 240) };
    });
    t.ck("the user form opens", !!form, String(form));
    // Pressing "Add an owner" on a building has already answered two of the
    // form's questions. Asking them again is the friction this removes.
    t.ck("the role is already Building owner", form.roleText === "Building owner", String(form.roleText));
    t.ck("and the form asks what they can SEE, not what they manage",
      /buildings they can see/i.test(form.buildingsLabel || ""), String(form.buildingsLabel));
    t.ck("and that building is already ticked",
      form.ticked.some((x) => /Birch/.test(x)), JSON.stringify(form.ticked));
    t.ck("and only that one", form.ticked.filter((x) => /Cedar|Elm/.test(x)).length === 0,
      JSON.stringify(form.ticked));
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- an owner is not shown the other owners --");
  {
    VISIBLE = ["p1", "p2"];   // Dana's two, as the server would send them
    const { ctx: c2, page: p2, crashes: cr2 } = await openAs("u_dana");
    await toProperties(p2);
    const mine = await cards(p2);
    t.ck("they see their own buildings", mine.length === 2, JSON.stringify(mine.map((c) => c.name)));
    t.ck("and not the one they were not granted",
      !mine.some((c) => /Birch/.test(c.name || "")), JSON.stringify(mine.map((c) => c.name)));
    t.ck("no Owners panel is drawn for them",
      mine.every((c) => c.owners === null), JSON.stringify(mine.map((c) => c.owners)));
    // The specific thing that must not leak: the co-owner of their building.
    const blob = await p2.evaluate(() => document.body.innerText);
    t.ck("their co-owner is not named anywhere on the screen",
      !/Theo Park/.test(blob), "Theo Park appears on an owner's screen");
    t.ck("nor is there an add-an-owner button", mine.every((c) => !c.addBtn));
    t.ck("nothing threw", cr2.length === 0, cr2.join(" | "));
    await c2.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
