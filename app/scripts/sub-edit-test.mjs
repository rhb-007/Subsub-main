// Editing a contractor on the roster, and saving without the screen going white.
//
// Reported from a real account: open a contractor, press Edit, change
// something, press Save -- and the modal turns white. A white modal is a React
// render that threw, so whatever is on screen is gone and there is no message
// saying why. It is the worst shape of bug this app produces, because the
// record looks lost.
//
// This drives the real path: roster -> detail -> Edit -> Save, and fails on
// any page error, not just a missing element.
//
//   node scripts/sub-edit-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-subedit-test");
const WEB = 5271, API = 8971;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_out", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing", "siding"], logoKey: null, subscriptionStatus: "active",
  hostnameStatus: "active",
  user: { id: "u_rb", name: "Richard", email: "rb@outerhome.test", role: "admin" },
};

const patches = [];
// Shaped like the roster row the API really returns, including the fields a
// contractor who APPLIED through the public form arrives with -- which is the
// case that was reported: no crews, no coverage cities, no licence.
let SUB = {
  id: "cmp_round", engagementId: "eng_round", accountId: "acc_out",
  company: "Roundhouse Kick Consgruction", contact: "Bobby Smurda",
  phone: "2127778281", email: "bsmurdq@gmail.com",
  city: "", state: "", zip: "", license: "", ubi: "",
  categories: ["roofing", "siding"], caps: [],
  // A crew with a named member, so step THREE is satisfied and step two is the
  // only thing holding Save. That is the silent case: the hint was gated on
  // the current step, which is fine, so the button was dead with nothing said.
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [],
    members: [{ name: "Bobby Smurda", role: "Lead" }] }],
  coverage: { mode: "cities", cities: [], radii: [] },
  propertyIds: [], rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
  bond: false, insurance: false, contract: false, available: true,
  notes: "Applied through the public application form.",
  docFiles: { insurance: "roundhouse-coi.pdf", w9: "roundhouse-w9.pdf" },
  docReview: { insurance: { status: "pending" }, w9: { status: "verified", verifiedBy: "Richard" } },
  status: "active", autoSchedule: 0,
  notify: { email: true, sms: false },
  mailStreet: "", mailCity: "", mailState: "", mailZip: "",
  hasPortal: false,
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/properties") return [200, []];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_out",
    company: "Outerhome", contact: "Richard", email: "rb@outerhome.test",
    docs: {}, sharesSent: 0, findable: true, code: null, url: null }];
  if (path === "/api/account-users") return [200, [
    { id: "u_rb", name: "Richard", email: "rb@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  const patch = path.match(/^\/api\/subs\/([^/]+)$/);
  if (patch && method === "PATCH") { patches.push(body); return [200, { ok: true }]; }
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_out" },
    viewport: { width: 1200, height: 1400 } });
  for (let n = 0; n < 30; n++) { await wait(250); if (await r.page.$("nav.tabs")) break; }
  return r;
};

try {
  console.log("\n-- open a contractor, edit, save --");
  {
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Contractors/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(250); if (await page.$(".grid .card")) break; }

    // Into the detail modal, the way somebody does: tap the card.
    await page.evaluate(() => {
      const card = [...document.querySelectorAll(".grid .card")]
        .find((c) => /Roundhouse/i.test(c.innerText));
      card?.click();
    });
    for (let n = 0; n < 30; n++) { await wait(250); if (await page.$(".modal")) break; }
    t.ck("the contractor opens", await page.evaluate(() =>
      /Roundhouse/i.test(document.querySelector(".modal")?.innerText || "")),
      (await page.evaluate(() => (document.querySelector(".modal")?.innerText || "").slice(0, 80))));

    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^Edit$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 30; n++) { await wait(250); if (await page.$(".modal input")) break; }
    t.ck("Edit opens the form",
      await page.evaluate(() => !!document.querySelector(".modal input")));

    // Change something, then save.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".modal input")]
        .find((i) => /Roundhouse/i.test(i.value));
      if (!el) return;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "Roundhouse Kick Construction");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    // THE DEAD BUTTON. Jump to the last step -- which editing allows, and is
    // the point of the numbered chips -- and Save is disabled with nothing on
    // screen saying why, because the hint under it is gated on the CURRENT
    // step being incomplete and this one is fine. A contractor who applied
    // through the public form has no capability and no coverage area, so step
    // two can never be satisfied by accident.
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /Crews & paperwork/i.test(b.innerText))?.click());
    await wait(600);
    const dead = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".modal button")]
        .find((x) => /^save changes$/i.test(x.innerText.trim()));
      return { disabled: !!b?.disabled,
        hint: document.querySelector(".modal .cov-hint")?.innerText.trim() || "" };
    });
    t.ck("Save is refused while an earlier step is unfinished", dead.disabled === true,
      JSON.stringify(dead));
    // The bug. This step is complete, so the old hint rendered nothing at all
    // and the button was dead and silent -- indistinguishable from broken.
    t.ck("and the screen says so rather than going quiet",
      dead.hint.length > 0, JSON.stringify(dead));
    t.ck("naming the step that is holding it",
      /trades & coverage/i.test(dead.hint), JSON.stringify(dead));
    t.ck("and what it wants", /capabilit|coverage area|trade/i.test(dead.hint),
      JSON.stringify(dead));
    t.ck("with a way to get there", /go there/i.test(dead.hint), JSON.stringify(dead));
    await page.evaluate(() => [...document.querySelectorAll(".modal .cov-hint button")]
      .find((b) => /go there/i.test(b.innerText))?.click());
    await wait(500);
    t.ck("which lands on that step",
      await page.evaluate(() => /Step 2 of 3/i.test(document.querySelector(".modal")?.innerText || "")));

    // Now finish step two the way somebody would, and save for real.
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /Trades & coverage/i.test(b.innerText))?.click());
    await wait(500);
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll(".modal button")]
        .find((b) => /^Asphalt shingle$/i.test(b.innerText.trim()));
      chip?.click();
      const city = [...document.querySelectorAll(".modal button")]
        .find((b) => /^Seattle$/i.test(b.innerText.trim()));
      city?.click();
    });
    await wait(500);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /Crews & paperwork/i.test(b.innerText))?.click());
    await wait(500);

    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll(".modal button")].map((b) => b.innerText.trim()));
    t.ck("the last step offers a save", buttons.some((x) => /^save changes$/i.test(x)),
      buttons.join(" | "));

    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^save changes$/i.test(b.innerText.trim()))?.click());
    await wait(1400);

    // THE BUG. A white modal is a render that threw.
    t.ck("saving does not blank the screen", crashes.length === 0, crashes.join(" | "));
    const after = await page.evaluate(() => {
      const m = document.querySelector(".modal");
      return { open: !!m, text: (m?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120),
        bodyText: document.body.innerText.replace(/\s+/g, " ").trim().length };
    });
    t.ck("and the page still has content", after.bodyText > 200, String(after.bodyText));
    t.ck("no empty modal left behind", !after.open || after.text.length > 0,
      JSON.stringify(after));
    t.ck("the change was sent", patches.length >= 1, JSON.stringify(patches));
    t.ck("carrying the edit", patches[0]?.company === "Roundhouse Kick Construction",
      String(patches[0]?.company));

    // And it must not quietly delete a document this form has no control for.
    // It knows about three kinds; DOC_KINDS has four. Listing them flat
    // replaced the whole object and wiped the W-9 of anybody who had one --
    // their client's roster then read "not on file" for a document that was.
    t.ck("the W-9 on file survives the edit",
      patches[0]?.docFiles?.w9 === "roundhouse-w9.pdf",
      JSON.stringify(patches[0]?.docFiles));
    t.ck("and the certificate is still named",
      patches[0]?.docFiles?.insurance === "roundhouse-coi.pdf",
      JSON.stringify(patches[0]?.docFiles));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
