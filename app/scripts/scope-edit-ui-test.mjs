// An admin can actually reach the scope pickers on somebody else's seat.
//
// WHY THIS IS A BROWSER TEST AND NOT A REGEX. The static assertions for both
// pickers -- `{scopeByJob && !roleLocked && (` and `{showBuildings &&
// !roleLocked && (` -- passed the entire time neither could be opened, because
// the bug was in what fed `roleLocked`. The form asked `can("users")`, which is
// not a capability any role has: `ROLES[role].can.includes(view)` answered
// false for an admin, so every Edit user modal opened with the role badge
// locked, and `roleLocked` hides the role picker, the buildings picker, the
// jobs picker and the contractor link.
//
// So the reported symptom was "when I edit them it only allows to edit name and
// email", and the source read exactly as intended. Only driving the modal shows
// the difference. Same lesson the draft-review suite records: checking that a
// component MENTIONS a thing passes while the thing is ignored.
//
// Three properties, and the first two are the ones a customer asked for:
//
//   A GENERAL CONTRACTOR CAN ATTACH A PROJECT MANAGER TO NAMED JOBS. They have
//   no buildings, so this is the only scope that seat has.
//
//   A MANAGING AGENT CAN STILL ATTACH ONE TO NAMED BUILDINGS. That picker has
//   existed since membership_properties shipped and was equally unreachable, so
//   the fix has to be checked on both branches in the same place -- diagonal
//   coverage is what let `hiresLabel` ship half-wired.
//
//   AND WHAT IS ALREADY SET COMES BACK TICKED. The list travels API -> memberships
//   -> accountUsers -> form, and a field dropped at any step opens the picker
//   empty. Empty does not read as an error: it reads as "runs everything", and
//   the next save writes exactly that. So the assertion is on the ticked state,
//   and on the body of the PATCH that follows.
//
//   node --no-warnings scripts/scope-edit-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-scopeedit-test");
const WEB = 5289, API = 8989;
const t = tally();

// Two accounts, because the two pickers are offered on opposite kinds and a
// suite that only drives one of them is the diagonal-coverage hole.
const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_a", name: "Dana Ray", email: "dana@outerhome.co", role: "admin" },
};
const PM_ACC = { ...GC, kind: "property_manager" };

let ACCOUNT = GC;

const USERS = () => [
  { id: "usr_a", name: "Dana Ray", email: "dana@outerhome.co", phone: null, role: "admin",
    subId: null, propertyIds: [], jobIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  // Narrowed already, on both axes, so whichever picker the account kind
  // offers has something to bring back.
  { id: "usr_p", name: "Pat Lee", email: "pat@outerhome.co", phone: null, role: "pm",
    subId: null, propertyIds: ["p1"], jobIds: ["j1"], unit: null, hasLogin: true,
    inviteSentAt: null, hasAvatar: false },
];

const JOBS = [
  { id: "j1", accountId: "acc_gc", title: "Harbor reroof", address: "9 Dock Rd", city: "Tacoma",
    state: "WA", zip: "98402", date: "2026-11-02", trades: ["roofing"], assignments: {},
    status: "active", notes: "", propertyId: null },
  { id: "j2", accountId: "acc_gc", title: "Cedar gutters", address: "4 Cedar Ln", city: "Tacoma",
    state: "WA", zip: "98403", date: "2026-11-09", trades: ["gutters"], assignments: {},
    status: "active", notes: "", propertyId: null },
];
const PROPS = [
  { id: "p1", accountId: "acc_gc", ownerAccountId: "acc_gc", name: "Harbor Flats", address: "9 Dock Rd",
    city: "Tacoma", state: "WA", zip: "98402", units: 12, vendorIds: [], ownerIds: [], notes: "" },
  { id: "p2", accountId: "acc_gc", ownerAccountId: "acc_gc", name: "Cedar Court", address: "4 Cedar Ln",
    city: "Tacoma", state: "WA", zip: "98403", units: 6, vendorIds: [], ownerIds: [], notes: "" },
];

// Every PATCH body is kept. "A picker appeared" is not the property under
// test -- "the list it shows is the list that gets saved" is.
let patches = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "PATCH" && path.startsWith("/api/account-users/")) {
    patches.push({ path, body }); return [200, { ok: true }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/properties") return [200, ACCOUNT.kind === "general_contractor" ? [] : PROPS];
  if (path === "/api/tenants") return [200, []];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openUsers = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Users")?.click());
  await wait(900);
};

// Opens Edit on a named row and returns what the form is actually offering.
const editForm = async (page, who) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll(".user-row")]
      .find((r) => new RegExp(name).test(r.innerText || ""));
    [...(row?.querySelectorAll("button") || [])]
      .find((b) => /^Edit$/i.test(b.innerText.trim()))?.click();
  }, who);
  await wait(700);
  return page.evaluate(() => {
    // EITHER HEADING. The form is titled "My account" when it is your own
    // seat and "Edit user" otherwise, so matching only the second returned
    // null for the self case -- and "no scope pickers" then passed against
    // nothing at all, which is the assertion-that-cannot-fail shape this
    // suite exists to avoid.
    const f = [...document.querySelectorAll(".modal .form, .form")]
      .find((x) => /Edit user|My account/i.test(x.innerText || ""));
    if (!f) return null;
    // Field groups are `.fld`, and the label is the group's own first text
    // node -- reading innerText of the group and matching the heading would
    // match the note underneath it too.
    const group = (label) => [...f.querySelectorAll(".fld")]
      .find((d) => (d.childNodes[0]?.textContent || "").trim() === label);
    const picks = (label) => [...(group(label)?.querySelectorAll(".pick") || [])]
      .map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") }));
    return {
      text: (f.innerText || "").replace(/\s+/g, " ").trim(),
      roleLocked: !!f.querySelector(".role-locked"),
      rolePicker: !!f.querySelector(".role-pick"),
      jobs: picks("Jobs"),
      buildings: picks("Buildings"),
    };
  });
};

const editFormText = (page) => page.evaluate(() => {
  const f = [...document.querySelectorAll(".modal .form, .form")]
    .find((x) => /Edit user|My account/i.test(x.innerText || ""));
  return f ? (f.innerText || "").replace(/\s+/g, " ").trim() : null;
});

const save = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll(".modal button, .form button")]
    .find((b) => /Save changes/i.test(b.innerText || ""))?.click());
  for (let n = 0; n < 40 && !patches.length; n++) await wait(150);
  await wait(200);
};

try {
  // ---- a general contractor: jobs are the only scope there is -------------
  console.log("\n-- a general contractor attaches a project manager to jobs --");
  {
    ACCOUNT = GC; patches = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1600 } });
    await wait(2200);
    await openUsers(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".user-row")].map((r) => (r.innerText || "").replace(/\n/g, " ")));
    // WITHOUT THIS EVERY ASSERTION BELOW IS AN ASSERTION THAT CANNOT FAIL.
    // "no picker" on a screen that never rendered reads identically to a
    // picker that is missing.
    t.ck("the users screen opened, so the rest of this can fail",
      rows.some((r) => /Pat Lee/.test(r)), JSON.stringify(rows));

    const f = await editForm(page, "Pat Lee");
    t.ck("the Edit user form opens", !!f, String(f));
    // THE BUG. `can("users")` answered false for an admin, so this was true
    // and everything below the email box was hidden.
    t.ck("an admin editing somebody else is not locked out of the role",
      f?.roleLocked === false && f?.rolePicker === true,
      `locked=${f?.roleLocked} picker=${f?.rolePicker}`);
    t.ck("there is a Jobs picker at all", (f?.jobs || []).length === 2,
      JSON.stringify(f?.jobs));
    t.ck("listing the account's jobs by name",
      (f?.jobs || []).map((j) => j.label).sort().join("|") === "Cedar gutters|Harbor reroof",
      JSON.stringify((f?.jobs || []).map((j) => j.label)));
    // The list survived API -> memberships -> accountUsers -> form. Dropped
    // anywhere on that trip this comes back all-off, which reads as "runs
    // every job" rather than as a lost field.
    t.ck("and the one they are already on comes back ticked",
      (f?.jobs || []).filter((j) => j.on).map((j) => j.label).join("|") === "Harbor reroof",
      JSON.stringify(f?.jobs));
    // No buildings on a general contractor, so no second picker narrowing the
    // same person by an axis nothing downstream reads.
    t.ck("no buildings picker on an account with no buildings",
      (f?.buildings || []).length === 0, JSON.stringify(f?.buildings));
    // THE NOTE HAS TWO SENTENCES AND ONLY ONE IS EVER ON SCREEN, so both are
    // read rather than whichever the fixture happened to produce. The count is
    // the point of the first -- "2 of 4" does not say which two, but a live
    // count is the difference between a note and a label.
    t.ck("the note counts what they are on",
      /Assigned to 1 of your 2 jobs/i.test(f?.text || ""), (f?.text || "").slice(-260));
    const untick = async () => {
      await page.evaluate(() => [...document.querySelectorAll(".form .fld .pick")]
        .find((b) => b.innerText.trim() === "Harbor reroof" && b.classList.contains("on"))?.click());
      await wait(250);
      return (await editFormText(page)) || "";
    };
    // Blank must read as "everything", because that is what it means on the
    // server: no rows means nobody narrowed them.
    t.ck("and with none ticked it says that means every job",
      /unticked and they run every job/i.test(await untick()));

    // Put it back, tick the second, and save: the picker's state has to be
    // what is sent.
    await page.evaluate(() => [...document.querySelectorAll(".form .fld .pick")]
      .filter((b) => /^(Harbor reroof|Cedar gutters)$/.test(b.innerText.trim()))
      .forEach((b) => { if (!b.classList.contains("on")) b.click(); }));
    await wait(300);
    t.ck("both ticked counts both",
      /Assigned to 2 of your 2 jobs/i.test(await editFormText(page)));
    await save(page);
    t.ck("saving PATCHes that seat", patches.length === 1
      && patches[0].path === "/api/account-users/usr_p", JSON.stringify(patches.map((p) => p.path)));
    t.ck("carrying both jobs",
      JSON.stringify((patches[0]?.body?.jobIds || []).slice().sort()) === JSON.stringify(["j1", "j2"]),
      JSON.stringify(patches[0]?.body));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  // ---- the same form, the other branch ------------------------------------
  console.log("\n-- and a managing agent attaches one to buildings --");
  {
    ACCOUNT = PM_ACC; patches = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1600 } });
    await wait(2200);
    await openUsers(page);
    t.ck("the users screen opened, so the rest of this can fail",
      await page.evaluate(() => [...document.querySelectorAll(".user-row")]
        .some((r) => /Pat Lee/.test(r.innerText || ""))));

    const f = await editForm(page, "Pat Lee");
    t.ck("the Edit user form opens", !!f, String(f));
    t.ck("an admin editing somebody else is not locked out of the role",
      f?.roleLocked === false && f?.rolePicker === true,
      `locked=${f?.roleLocked} picker=${f?.rolePicker}`);
    t.ck("there is a Buildings picker", (f?.buildings || []).length === 2,
      JSON.stringify(f?.buildings));
    t.ck("and the building they are already on comes back ticked",
      (f?.buildings || []).filter((b) => b.on).map((b) => b.label).join("|") === "Harbor Flats",
      JSON.stringify(f?.buildings));
    // TWO PICKERS ON ONE FORM would be two lists narrowing the same person by
    // different axes, with nothing downstream saying which had hidden a job.
    t.ck("and no jobs picker beside it", (f?.jobs || []).length === 0, JSON.stringify(f?.jobs));

    await save(page);
    t.ck("saving keeps the building list rather than blanking it",
      JSON.stringify(patches[0]?.body?.propertyIds || []) === JSON.stringify(["p1"]),
      JSON.stringify(patches[0]?.body));

    // AND IT IS STILL THERE WHEN YOU LOOK AGAIN, which is a different claim
    // from the one above. `updateUser` patches state optimistically -- nothing
    // re-fetches -- and that patch decided which roles keep a list by asking
    // `u.role === "owner"`. The server keeps one for a pm as well, so a scoped
    // property manager's buildings vanished off the screen the moment their
    // seat was saved and came back on the next reload. A scope that looks lost
    // is a scope somebody re-enters.
    await wait(500);
    const again = await editForm(page, "Pat Lee");
    t.ck("and re-opening shows it still ticked, not blanked by the save",
      (again?.buildings || []).filter((b) => b.on).map((b) => b.label).join("|") === "Harbor Flats",
      JSON.stringify(again?.buildings));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  // ---- and the lock still locks where it should --------------------------
  console.log("\n-- your own seat stays locked, whatever your role --");
  {
    ACCOUNT = GC; patches = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1600 } });
    await wait(2200);
    await openUsers(page);
    const f = await editForm(page, "Dana Ray");
    // Not `canManageUsers` alone: an admin may not change their own role, or
    // an account can talk itself down to zero admins.
    t.ck("an admin editing themselves gets the locked badge",
      f?.roleLocked === true && f?.rolePicker === false,
      `locked=${f?.roleLocked} picker=${f?.rolePicker}`);
    t.ck("and no scope pickers with it",
      (f?.jobs || []).length === 0 && (f?.buildings || []).length === 0,
      JSON.stringify({ jobs: f?.jobs, buildings: f?.buildings }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
