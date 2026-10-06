// THE DELETE CONFIRMATION IN THE STAFF CONSOLE, driven, because the
// reported symptom is only visible as drawn.
//
// "Can't delete subcontractors in admin console - stops here", with a
// screenshot of the name typed correctly and the button still dead. Two
// things had to be true at once for that: the comparison was exact against
// a stored name that had picked up a trailing space -- which the label
// renders identically, because HTML collapses it -- and there was no hint
// beside the button, so a dead control said nothing about why.
//
// A static check cannot see either half. `typed.trim() === item.name` reads
// exactly as intended, and a check that the modal *mentions* a hint passes
// with the hint never rendering. So this types into the box and reads the
// button and the sentence back.
//
//   node --no-warnings scripts/console-delete-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-del-test");
const WEB = 5317, API = 8963;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

const STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };

const BOOT = () => ({
  accounts: [
    { id: "acc1", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
      plan: "scale", billing: "monthly", comped: false, compNote: null, trades: [],
      hostnameStatus: "active", subscriptionStatus: "active", createdAt: "2026-01-04", status: "active" },
  ],
  users: [{ id: "u_admin", name: "Account Admin", email: "admin@cascade.test", phone: null }],
  memberships: [{ userId: "u_admin", accountId: "acc1", role: "admin", companyId: null }],
  companies: [
    // THE REPORTED ROW, and the trailing space is the whole fixture. It is
    // what the edit route used to leave behind, it renders away in the
    // label, and a clean name would pass whichever comparison is in force --
    // so this is the only row either direction can be checked against.
    { id: "cmp_rk", company: "Roundhouse Kick Consgruction ", contact: "Chuck N",
      phone: "2065550400", email: "chuck@rk.test", license: null, ubi: null,
      city: "Seattle", state: "WA", zip: "98101", warranty: null },
  ],
  engagements: [
    { id: "en_rk", accountId: "acc1", companyId: "cmp_rk", status: "active",
      categories: ["framing"], rating: 0, ratedJobs: 0, docReview: {} },
  ],
  jobs: [], subEvents: [], activity: [], smsDaily: [],
});

const deletes = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  // The console's sign-in gate. Without this it sits on "Continue with
  // Google" and every selector below finds nothing -- which reads as the
  // feature being broken rather than the harness never having signed in.
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT()];
  if (path === "/api/platform/companies" && method === "GET") return [200, []];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path === "/api/notify/log") return [200, []];
  if (/^\/api\/platform\/companies\/cmp_rk$/.test(path) && method === "DELETE") {
    deletes.push({ path, body });
    return [200, { ok: true }];
  }
  return undefined;
} });

const browser = await launch();
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1400, height: 1500 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

// Through React's own setter: assigning `.value` does not reach a controlled
// component's onChange, which reads as the feature being broken rather than
// the harness being wrong.
const type = (page, text) => page.evaluate((v) => {
  const box = [...document.querySelectorAll(".modal input")].pop();
  if (!box) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  box.focus();
  set.call(box, v);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, text);

// The confirmation is the LAST window on the page: a company now opens in a
// window of its own, and the typed-name box is drawn over it.
const modal = (page) => page.evaluate(() => {
  const m = [...document.querySelectorAll(".modal")].pop();
  if (!m) return null;
  const btn = [...m.querySelectorAll("button")].find((b) => /Delete (company|account)/i.test(b.innerText || ""));
  return {
    // What the reader is told to type, as it is DRAWN -- which is the whole
    // point: a trailing space is invisible here and was not in the compare.
    asks: (m.querySelector("label b")?.innerText || "").trim(),
    btn: (btn?.innerText || "").replace(/\s+/g, " ").trim(),
    off: btn ? btn.disabled : null,
    hint: (m.querySelector("[role=alert]")?.innerText || "").replace(/\s+/g, " ").trim(),
  };
});

try {
  // The console reads its session out of localStorage, so it has to be
  // seeded before the app boots. Going straight to the page lands on
  // "Continue with Google", where every selector below finds nothing and
  // the suite reports the feature as broken rather than itself.
  await page.goto(`http://127.0.0.1:${WEB}/seed.txt`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate(() => {
    localStorage.setItem("subsub.auth", JSON.stringify({ userId: "u_staff", accountId: null }));
    localStorage.setItem("sb-stub-auth-token", JSON.stringify({
      access_token: "stub", refresh_token: "stub", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "u_staff", email: "staff@subsub.test" },
    }));
  });
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2800);

  // PROVEN, not assumed. "No delete button" on a screen that never opened
  // is an assertion that cannot fail, which this project has paid for
  // before -- so signing in is its own check and it prints what is on
  // screen instead when it goes wrong.
  const inside = await page.evaluate(() => !/Continue with Google/i.test(document.body.innerText));
  t.ck("the console is signed in", inside,
    await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\s+/g, " ")));

  console.log("\n-- opening the delete confirmation --");
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("button, a")]
      .find((b) => /^\s*companies\s*$/i.test(b.innerText || ""));
    if (nav) nav.click();
  });
  await wait(800);
  // A company is a row now, and its window carries the edit form and the
  // Delete company button -- the control in the report, one press further in.
  const openDelete = async () => {
    await page.evaluate(() => document.querySelector(".pf-rows .pf-row[data-company]")?.click());
    await wait(500);
    return page.evaluate(() => {
      const btn = [...document.querySelectorAll(".modal button")]
        .find((b) => /Delete company/i.test(b.innerText || "") || (b.title || "") === "Delete company");
      if (btn) { btn.click(); return true; }
      return false;
    });
  };
  const opened = await openDelete();
  t.ck("the delete confirmation opens", opened, String(opened));
  await wait(500);

  let m = await modal(page);
  t.ck("it asks for the company by name", /Roundhouse Kick Consgruction/.test(m?.asks || ""), m?.asks);
  // The label renders the trailing space away. That is the bug in one line:
  // what the reader is told to type is not what the code was comparing.
  t.ck("and the name it asks for renders with no trailing space",
    m?.asks === "Roundhouse Kick Consgruction", JSON.stringify(m?.asks));
  t.ck("the button starts dead, because nothing is typed", m?.off === true, JSON.stringify(m));
  // AN EMPTY BOX IS NOT TOLD OFF. A confirmation that scolds you before you
  // have started is one people stop reading.
  t.ck("and says nothing yet", !!m && !m.hint, JSON.stringify(m));

  console.log("\n-- a wrong name says why, which it never used to --");
  await type(page, "Roundhouse");
  await wait(250);
  m = await modal(page);
  t.ck("the button is still dead", m?.off === true, JSON.stringify(m));
  // THE REPORTED SYMPTOM. A disabled control with no reason beside it is
  // indistinguishable from a broken one.
  t.ck("but now there is a reason beside it", /does not match/i.test(m?.hint || ""), m?.hint);
  t.ck("naming what is actually wanted", /Roundhouse Kick Consgruction/.test(m?.hint || ""), m?.hint);
  t.ck("and saying what does not count, so the next try is informed",
    /spaces and capitals do not matter/i.test(m?.hint || ""), m?.hint);

  console.log("\n-- and the name as it is DRAWN is the name that works --");
  deletes.length = 0;
  await type(page, "Roundhouse Kick Consgruction");
  await wait(250);
  m = await modal(page);
  // THE WHOLE REPORT. Typed exactly as the label renders it, against a
  // stored value that is not that string.
  t.ck("typing it as the label shows it enables the button", m?.off === false, JSON.stringify(m));
  t.ck("and the reason goes away", !!m && !m.hint, JSON.stringify(m));

  await page.evaluate(() => [...[...document.querySelectorAll(".modal")].pop().querySelectorAll("button")]
    .find((b) => /Delete company/i.test(b.innerText || ""))?.click());
  await wait(900);
  t.ck("pressing it actually deletes", deletes.length === 1, JSON.stringify(deletes));
  // The typed name travels, because the server checks it against the row it
  // is about to delete -- a browser-side check alone stops a slip of the
  // finger but not a stale id.
  t.ck("and the typed name travels with it",
    /Roundhouse Kick Consgruction/.test(deletes[0]?.body?.confirmName || ""),
    JSON.stringify(deletes[0]?.body));

  console.log("\n-- and case is not a trap either --");
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("button, a")]
      .find((b) => /^\s*companies\s*$/i.test(b.innerText || ""));
    if (nav) nav.click();
  });
  await wait(700);
  await openDelete();
  await wait(500);
  await type(page, "roundhouse kick consgruction");
  await wait(250);
  m = await modal(page);
  t.ck("a lowercase name is accepted", m?.off === false, JSON.stringify(m));

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
