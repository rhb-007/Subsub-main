// THE AUTO-SCHEDULE SWITCH, ON SCREEN.
//
// Reported as *"is the auto schedule move-in / move-out inspection jobs in?
// Can't see it — where is it?"*. It was: route, migration, picker, rules
// module and a server suite of 57 assertions. **Nothing had ever drawn it.**
// That is exactly the state `roleLocked` was in — every piece correct and the
// control unreachable, with nothing reporting it — and it is why "can't see
// it" is a report worth a browser test rather than a reply.
//
// What only a browser can answer:
//
//   WHERE IT IS, which is what was asked. Account -> Company, under the
//   emergency contractor.
//
//   WHO GETS IT. Only an account with buildings: a general contractor has no
//   tenancies ending, so a turnaround is not a thing it has. Both branches in
//   the same place, because a gate checked on one of two kinds is the
//   diagonal coverage this project keeps paying for.
//
//   AND WHAT IT SAYS WHEN THE COLUMN IS NOT THERE. `app.onError` answers
//   `migration_needed` with the file to run; the screen read every failure as
//   "That didn't save. Try again", which is false on a database behind the
//   code and tells the one person who can fix it nothing.
//
//   node --no-warnings scripts/auto-turn-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-auto-turn-test");
const WEB = 5345, API = 9043;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

let KIND = "property_manager";
let ON = false;
// Whether the database has 065. Held apart so the refusal can be driven as
// the server really answers it rather than as a hand-made error.
let MIGRATED = true;
const saved = [];

const ACCOUNT = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm", kind: KIND,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing"], logoKey: null, subscriptionStatus: "active",
  hostnameStatus: "active", autoTurnaround: ON,
  user: { id: "u_mgr", name: "Chris Lane", email: "chris@soundpm.test", role: "admin" },
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account" && method === "PATCH") {
    saved.push(body);
    // EXACTLY WHAT THE SERVER ANSWERS on a database without the column:
    // `app.onError` turns the throw into a 503 naming the migration. Faking
    // a bare 500 here would be testing a shape the product never produces.
    if (!MIGRATED && body?.autoTurnaround !== undefined) {
      return [503, { error: "migration_needed", migration: "065_auto_turnaround",
        detail: "no such column: auto_turnaround" }];
    }
    if (body?.autoTurnaround !== undefined) ON = !!body.autoTurnaround;
    return [200, { ok: true }];
  }
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/account-users") return [200, [
    { id: "u_mgr", name: "Chris Lane", email: "chris@soundpm.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_pm",
    company: "Sound Property Management", contact: "Chris Lane", docs: {},
    sharesSent: 0, openToHire: true }];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/properties") return [200, []];
  if (path === "/api/weather") return [200, {}];
  return undefined;
} });

const browser = await launch();

// Account -> Company, which is the answer to "where is it".
const openCompany = async () => {
  const r = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1200, height: 1800 } });
  await wait(2200);
  await r.page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
  await wait(400);
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
  await wait(900);
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Company")?.click());
  await wait(900);
  return r;
};

// The panel, found by its heading rather than by a class, because the heading
// is what somebody looking for it reads.
const panelOf = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll(".portal-panel")]
    .find((p) => /Auto-schedule turnarounds/i.test(p.querySelector("h4")?.innerText || ""));
  if (!el) return null;
  const picks = [...el.querySelectorAll(".picks button")];
  return {
    head: (el.querySelector("h4")?.innerText || "").trim(),
    note: (el.querySelector(".panel-note")?.innerText || "").replace(/\s+/g, " ").trim(),
    picks: picks.map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") })),
    hints: [...el.querySelectorAll(".cov-hint")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
    err: (el.querySelector(".fld-err")?.innerText || "").replace(/\s+/g, " ").trim(),
    // Where it sits on the tab, so "under the emergency contractor" is a
    // measurement rather than a claim about source order.
    top: Math.round(el.getBoundingClientRect().top),
  };
});

try {
  console.log("\n-- it is on Account -> Company, where somebody was told to look --");
  {
    const { ctx, page, crashes } = await openCompany();
    const p = await panelOf(page);
    t.ck("the panel is on the Company tab", !!p, JSON.stringify(p));
    t.ck("headed what the answer calls it",
      /Auto-schedule turnarounds/i.test(p?.head || ""), p?.head);
    // MOVE-IN AND MOVE-OUT ONLY, said where the switch is rather than
    // discovered: a repair is somebody's home with somebody in it.
    t.ck("and says it is move-in and move-out only",
      /move-in and\s+move-out only/i.test(p?.note || ""), p?.note);
    t.ck("with Off and On to press",
      (p?.picks || []).map((x) => x.label).join("/") === "Off/On", JSON.stringify(p?.picks));
    t.ck("starting Off, which is what the account row says",
      p?.picks?.[0]?.on === true && p?.picks?.[1]?.on === false, JSON.stringify(p?.picks));
    // UNDER THE EMERGENCY CONTRACTOR. Measured, because source order is not
    // screen order and somebody looking for it is scrolling.
    const emTop = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((x) => /emergency/i.test(x.querySelector("h4")?.innerText || ""));
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    });
    t.ck("sitting below the emergency contractor panel",
      emTop !== null && p.top > emTop, `${p?.top} vs ${emTop}`);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- pressing On saves it, and the panel then says what it will do --");
  {
    ON = false; MIGRATED = true; saved.length = 0;
    const { ctx, page } = await openCompany();
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Auto-schedule turnarounds/i.test(p.querySelector("h4")?.innerText || ""));
      [...el.querySelectorAll(".picks button")].find((b) => b.innerText.trim() === "On")?.click();
    });
    await wait(900);
    t.ck("it posts exactly once", saved.length === 1, JSON.stringify(saved));
    t.ck("asking for it to be on", saved[0]?.autoTurnaround === true, JSON.stringify(saved[0]));
    const p = await panelOf(page);
    t.ck("the switch reads On afterwards", p?.picks?.[1]?.on === true, JSON.stringify(p?.picks));
    // THE ONE THING IT WILL NOT DO, said rather than discovered: the side
    // paying for the work cannot book the side doing it onto a calendar.
    t.ck("and it says it asks rather than booking their calendar",
      (p?.hints || []).some((h) => /asks .* does not book their calendar/i.test(h)),
      JSON.stringify(p?.hints));
    t.ck("and that it stops rather than proposing for ever",
      (p?.hints || []).some((h) => /stops and tells you/i.test(h)), JSON.stringify(p?.hints));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- and a database without 065 is told which file to run --");
  {
    ON = false; MIGRATED = false; saved.length = 0;
    const { ctx, page } = await openCompany();
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Auto-schedule turnarounds/i.test(p.querySelector("h4")?.innerText || ""));
      [...el.querySelectorAll(".picks button")].find((b) => b.innerText.trim() === "On")?.click();
    });
    await wait(900);
    const p = await panelOf(page);
    // "TRY AGAIN" IS FALSE THERE. The column is not coming back on the next
    // press, and a control that refuses for ever with no reason beside it is
    // indistinguishable from a broken one.
    t.ck("the failure does not say to try again",
      !!p?.err && !/^That didn't save\. Try again\.$/.test(p.err), p?.err);
    t.ck("it names the migration to run", /065_auto_turnaround/.test(p?.err || ""), p?.err);
    t.ck("and the switch did not pretend to turn on",
      p?.picks?.[1]?.on === false, JSON.stringify(p?.picks));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- and a general contractor does not get it at all --");
  {
    // THE OTHER BRANCH, IN THE SAME PLACE. A gate checked on one of two kinds
    // is the diagonal coverage that left `hiresLabel` half-wired -- and "it
    // is absent" passes loudest on a screen that never opened, so the Company
    // tab is proved present first.
    KIND = "general_contractor"; ON = false; MIGRATED = true;
    const { ctx, page } = await openCompany();
    const opened = await page.evaluate(() => [...document.querySelectorAll(".portal-panel h4")]
      .map((h) => h.innerText.trim()));
    t.ck("the Company tab really opened", opened.length > 0, JSON.stringify(opened));
    t.ck("and carries no turnaround switch",
      !opened.some((h) => /Auto-schedule turnarounds/i.test(h)), JSON.stringify(opened));
    await ctx.close().catch(() => {});
    KIND = "property_manager";
  }
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
