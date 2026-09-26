// The roster, and the three things wrong with it.
//
// 1. IT LIED ABOUT EVERYONE. The account owner -- signed in, looking at the
//    page -- was told "Hasn't been sent an invite", beside a button offering
//    to send them one. hasLogin and inviteSentAt come down with the roster
//    and were dropped on the way into browser state, which copied four
//    fields and not those two. SeatState reads hasLogin to decide whether to
//    say anything at all, so undefined read as "no login" for every seat.
//
// 2. THE AUTOMATIC INVITE WAS INVISIBLE. Adding somebody has always invited
//    them in the same call -- there is no way to add without inviting, on
//    this path or the subcontractor one. But the browser fired the request
//    and forgot it, drew an optimistic row under an invented id, and that
//    row said nobody had been invited. An admin who cannot see that it went
//    reasonably concludes it did not, and sends a second one.
//
//    Worse, the invented id was not a real user id, so Send invite on that
//    row answered 404.
//
// 3. EVERY PERSON WAS TWO LETTERS IN A CIRCLE. Which is fine for two people
//    and stops working at ten, and gives Miguel Acosta and Maria Alvarez the
//    same circle.
//
//   node scripts/user-seat-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-boot-test");
const WEB = 5202, API = 8915;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

// The roster the server actually sends. Richard has signed in; Miguel has
// been invited and has not set a password yet; Dana was added before invites
// existed and has neither.
let roster = [
  { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_miguel", name: "Miguel Acosta", email: "macosta@outerhome.co", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: false,
    inviteSentAt: new Date(Date.now() - 4 * 60_000).toISOString(), hasAvatar: true },
  { id: "usr_dana", name: "Dana Reyes", email: "dana@outerhome.co", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: false, inviteSentAt: null, hasAvatar: false },
];
let posted = null;
let addAnswer = () => [201, { id: "usr_new", invited: true, to: "newbie@outerhome.co", emailed: true, texted: false }];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users" && method === "POST") return addAnswer();
  if (path === "/api/account-users") return [200, roster];
  // A one-pixel PNG is enough: the assertion is that a face is fetched and
  // drawn at all, not what is in it.
  if (/\/avatar$/.test(path)) return [200, "png-bytes"];
  return undefined;
} });

const browser = await launch();
const open = async (viewport) => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport });
  await wait(1800);
  return r;
};
// My account -> Users
const toUsers = async (page) => {
  await page.click(".user-btn");
  await wait(250);
  await page.click(".um-account");
  await page.waitForSelector(".seg-tabs", { timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll(".seg-tabs button")].find((b) => /^users$/i.test(b.innerText.trim()))?.click();
  });
  await page.waitForSelector(".user-list", { timeout: 5000 });
};
const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".user-row")].map((r) => ({
  name: r.querySelector("h4")?.innerText.trim(),
  seat: r.querySelector(".seat-state")?.innerText.replace(/\s+/g, " ").trim() || null,
  avatarImg: !!r.querySelector(".user-avatar img"),
  initials: r.querySelector(".user-avatar")?.innerText.trim() || "",
})));

try {
  console.log("\n-- what the roster says about each person --");
  {
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await toUsers(page);
    await wait(400);
    const r = await rows(page);
    t.ck("all three seats are drawn", r.length === 3, JSON.stringify(r.map((x) => x.name)));

    const richard = r.find((x) => /Richard/.test(x.name));
    const miguel = r.find((x) => /Miguel/.test(x.name));
    const dana = r.find((x) => /Dana/.test(x.name));

    // The reported bug, exactly.
    t.ck("somebody who is signed in is told nothing at all",
      richard.seat === null, String(richard.seat));
    t.ck("and is not offered an invite they do not need",
      !/send invite/i.test(richard.seat || ""), String(richard.seat));

    t.ck("somebody invited is told when", /invite sent/i.test(miguel.seat || ""), String(miguel.seat));
    t.ck("and is NOT told they have not been invited",
      !/hasn't been sent an invite/i.test(miguel.seat || ""), String(miguel.seat));
    t.ck("their button offers to send it again, not to send a first one",
      /send again/i.test(miguel.seat || ""), String(miguel.seat));

    t.ck("somebody who really has not been invited is told so",
      /hasn't been sent an invite/i.test(dana.seat || ""), String(dana.seat));
    t.ck("and is offered one", /send invite/i.test(dana.seat || ""), String(dana.seat));

    // The preview button is not a login. It re-renders this account from data
    // the browser already holds; the API still authenticates as whoever is
    // really signed in. Calling it "Log in as" promised a session it does not
    // open, which is worst exactly when somebody uses it to check what a
    // person can reach -- the answer they get is this account's access
    // wearing that person's screen. Real impersonation lives in the staff
    // console and is audited.
    const preview = await page.evaluate(() => {
      const b = document.querySelector(".user-row-actions .login-as-btn");
      return b ? { label: b.innerText.trim(), title: b.title } : null;
    });
    t.ck("the preview button exists", !!preview, JSON.stringify(preview));
    t.ck("and does not call itself a login",
      !/log ?in/i.test(preview?.label || ""), String(preview?.label));
    t.ck("it says what it is instead", /view as/i.test(preview?.label || ""), String(preview?.label));
    t.ck("and spells out that you stay yourself",
      /stay signed in as yourself/i.test(preview?.title || ""), String(preview?.title));

    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- a face, where there is one --");
  {
    // Per visit, not since the process started: the block above opened its
    // own page and fetched the same face, and counting both made a cache
    // that works look like one that does not.
    api.calls.length = 0;
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await toUsers(page);
    await wait(700);
    const r = await rows(page);
    const miguel = r.find((x) => /Miguel/.test(x.name));
    const dana = r.find((x) => /Dana/.test(x.name));
    t.ck("a picture is drawn for whoever has one", miguel.avatarImg, JSON.stringify(miguel));
    t.ck("and initials for whoever does not", !dana.avatarImg && dana.initials === "DR", JSON.stringify(dana));
    t.ck("it was fetched once, not once per circle",
      api.calls.filter((p) => /usr_miguel\/avatar$/.test(p)).length === 1,
      api.calls.filter((p) => /avatar/.test(p)).join(" "));
    t.ck("and nothing was fetched for somebody without one",
      !api.calls.some((p) => /usr_dana\/avatar/.test(p)), api.calls.filter((p) => /avatar/.test(p)).join(" "));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- adding somebody says what was sent --");
  {
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await toUsers(page);
    posted = null;
    api.calls.length = 0;
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /new user/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".form", { timeout: 4000 });
    await page.type(".form input", "Newbie Person");
    await page.evaluate(() => {
      const ins = document.querySelectorAll(".form input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(ins[1], "newbie@outerhome.co");
      ins[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The roster the reload will return, now with the new person on it.
    roster = [...roster, { id: "usr_new", name: "Newbie Person", email: "newbie@outerhome.co",
      phone: null, role: "pm", subId: null, propertyIds: [], unit: null,
      hasLogin: false, inviteSentAt: new Date().toISOString(), hasAvatar: false }];
    await page.evaluate(() => {
      [...document.querySelectorAll(".form button")].find((b) => /create user/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".seat-added", { timeout: 6000 });
    const said = await page.$eval(".seat-added", (n) => n.innerText.replace(/\s+/g, " ").trim());
    t.ck("it says they were invited", /invited/i.test(said), said);
    t.ck("it names the address it went to", /newbie@outerhome\.co/.test(said), said);
    t.ck("and says there is nothing else to send", /nothing else to send/i.test(said), said);

    // The roster is re-read, so the new row carries a real id and a real
    // invite time rather than an invented id and a false warning.
    await wait(600);
    const r = await rows(page);
    const fresh = r.find((x) => /Newbie/.test(x.name));
    t.ck("the new row appears", !!fresh, JSON.stringify(r.map((x) => x.name)));
    t.ck("and does not claim they were never invited",
      !/hasn't been sent an invite/i.test(fresh?.seat || ""), String(fresh?.seat));
    t.ck("the roster was re-read rather than guessed at",
      api.calls.filter((p) => p === "/api/account-users").length >= 1, api.calls.join(" "));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- and when the invite could not go out --");
  {
    addAnswer = () => [201, { id: "usr_x", invited: false, reason: "no_email" }];
    const { ctx, page } = await open({ width: 1200, height: 1000 });
    await toUsers(page);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /new user/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".form", { timeout: 4000 });
    await page.type(".form input", "No Mail");
    await page.evaluate(() => {
      const ins = document.querySelectorAll(".form input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(ins[1], "nomail@outerhome.co");
      ins[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => {
      [...document.querySelectorAll(".form button")].find((b) => /create user/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".seat-added", { timeout: 6000 });
    const said = await page.$eval(".seat-added", (n) => n.innerText.replace(/\s+/g, " ").trim());
    t.ck("it does not claim an invite went out", !/was added and invited/i.test(said), said);
    t.ck("it says what stopped it", /no email address/i.test(said), said);
    t.ck("and it is marked as a problem",
      await page.$eval(".seat-added", (n) => n.classList.contains("warn")));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
