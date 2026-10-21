// 094. The Google Calendar panel in My account -> Settings, drawn in a
// browser against a stubbed API.
//
// What is asserted is what somebody sees and what gets sent: the panel says
// when Google Calendar is not set up, Connect sends the browser's own time
// zone and goes to the address the server answered, coming back from Google
// opens Settings and says what happened, the two switches send what they
// show, the crew-side switch is not offered to a tenant, and a seat the route
// refuses is shown no panel at all.
//
//   node --no-warnings scripts/gcal-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-gcal-test");
const WEB = 5577, API = 9277;
const t = tally();

const ACCOUNT = {
  id: "acc_s", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_c", name: "Chris Lee", email: "chris@sound.test", role: "admin" },
};

let state = { configured: false, connected: false, syncOn: true, blockOn: true, events: 0 };
let refuse = false;
const sent = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/google-calendar") {
    if (refuse) return [403, { error: "forbidden" }];
    if (method === "GET") return [200, { ...state, calendarName: "SubSub Jobs" }];
    if (method === "PATCH") { sent.push(["patch", body]); state = { ...state, ...body }; return [200, { ok: true }]; }
    if (method === "DELETE") { sent.push(["delete"]); state = { ...state, connected: false, email: null }; return [200, { ok: true }]; }
  }
  if (path === "/api/google-calendar/start") {
    sent.push(["start", body]);
    return [200, { url: `http://sound.subsub.work:${WEB}/consent-stand-in` }];
  }
  if (path === "/api/google-calendar/sync") { sent.push(["sync"]); return [200, { inserted: 0 }]; }
  if (path === "/api/account-users") return [200, [
    { id: "usr_c", name: "Chris Lee", email: "chris@sound.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
    { id: "usr_t", name: "John Smith", email: "john@t.test", phone: null, role: "tenant",
      subId: null, propertyIds: ["p1"], unit: "4", hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector(".user-btn")?.click());
  await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^Settings$/.test(b.innerText.trim()))?.click());
  await wait(500);
};
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector(".gcal-panel");
  if (!p) return null;
  return {
    text: p.innerText,
    buttons: [...p.querySelectorAll("button")].map((b) => b.innerText.trim()),
    boxes: [...p.querySelectorAll("input[type=checkbox]")].map((i) => ({
      name: i.closest("label")?.querySelector(".no-name")?.innerText.trim(), on: i.checked })),
    landed: p.querySelector(".gcal-landed")?.innerText || null,
  };
});
const press = (page, label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll(".gcal-panel button, .modal button")].find((x) => x.innerText.trim().includes(l));
  b?.click(); return !!b;
}, label);

try {
  console.log("\n-- not set up --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_c", accountId: "acc_s" } });
    await wait(2000);
    await openSettings(page);
    const p = await panel(page);
    t.ck("Settings carries a Google Calendar panel", !!p && /Google Calendar/.test(p.text), JSON.stringify(p));
    t.ck("which says it is not set up, and offers nothing to press", /isn't set up/.test(p?.text || "") && p.buttons.length === 0,
      JSON.stringify(p));
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- connecting --");
  {
    state = { configured: true, connected: false, syncOn: true, blockOn: true, events: 0 };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_c", accountId: "acc_s" } });
    await page.emulateTimezone("America/Chicago");
    await wait(2000);
    await openSettings(page);
    const p = await panel(page);
    t.ck("it says what connecting does, by the calendar's name", /SubSub Jobs/.test(p?.text || ""), p?.text);
    t.ck("and what SubSub does not see", /not what you're doing/.test(p?.text || ""));
    t.ck("Connect is offered", p?.buttons.some((b) => /Connect Google Calendar/.test(b)), JSON.stringify(p?.buttons));
    await press(page, "Connect Google Calendar");
    await wait(1200);
    const start = sent.find((x) => x[0] === "start");
    t.ck("Connect sends the browser's own time zone", start?.[1]?.timeZone === "America/Chicago", JSON.stringify(start));
    t.ck("and where to come back to", /^http:\/\/sound\.subsub\.work:\d+\/$/.test(start?.[1]?.returnTo || ""), JSON.stringify(start));
    t.ck("and goes to the address the server answered", page.url().endsWith("/consent-stand-in"), page.url());
    await ctx.close();
  }

  console.log("\n-- back from Google --");
  {
    state = { configured: true, connected: true, email: "chris@gmail.test", syncOn: true, blockOn: true, events: 3,
      lastSyncedAt: new Date().toISOString() };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB, path: "/?gcal=connected",
      seat: { userId: "usr_c", accountId: "acc_s" } });
    await wait(2500);
    const p = await panel(page);
    t.ck("coming back opens Settings, on its own", !!p, await page.evaluate(() => document.body.innerText.slice(0, 200)));
    t.ck("and says it is connected", /is connected/.test(p?.landed || ""), p?.landed);
    t.ck("the address bar is tidied", !/gcal=/.test(page.url()), page.url());
    t.ck("which Google account, and how many jobs", /chris@gmail\.test/.test(p?.text || "") && /3 jobs/.test(p?.text || ""), p?.text);
    t.ck("both switches, on", p?.boxes.length === 2 && p.boxes.every((b) => b.on), JSON.stringify(p?.boxes));

    await page.evaluate(() => [...document.querySelectorAll(".gcal-panel label")]
      .find((l) => /busy/.test(l.innerText))?.querySelector("input")?.click());
    await wait(800);
    const patch = sent.filter((x) => x[0] === "patch").pop();
    t.ck("turning the busy check off sends exactly that", JSON.stringify(patch?.[1]) === JSON.stringify({ blockOn: false }),
      JSON.stringify(patch));
    const p2 = await panel(page);
    t.ck("and the switch shows the server's answer", p2?.boxes.find((b) => /busy/.test(b.name))?.on === false, JSON.stringify(p2?.boxes));

    await press(page, "Update now");
    await wait(600);
    t.ck("Update now asks for a sync", sent.some((x) => x[0] === "sync"));

    await press(page, "Disconnect");
    await wait(500);
    t.ck("Disconnect asks first, and has sent nothing yet", !sent.some((x) => x[0] === "delete")
      && await page.evaluate(() => /SubSub Jobs calendar comes off/.test(document.querySelector(".modal")?.innerText || "")));
    await page.evaluate(() => document.querySelector(".modal .btn-danger")?.click());
    await wait(800);
    t.ck("agreeing disconnects", sent.some((x) => x[0] === "delete"));
    const p3 = await panel(page);
    t.ck("and the panel offers Connect again", p3?.buttons.some((b) => /Connect Google Calendar/.test(b)), JSON.stringify(p3?.buttons));
    await ctx.close();
  }

  console.log("\n-- a refused connection names why --");
  {
    state = { configured: true, connected: false };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      path: "/?gcal=failed&gcal_why=invalid_client", seat: { userId: "usr_c", accountId: "acc_s" } });
    await wait(2500);
    const p = await panel(page);
    t.ck("Settings opened", !!p, await page.evaluate(() => document.body.innerText.slice(0, 200)));
    t.ck("a wrong client is not 'try again in a minute'", !/Try again in a minute/.test(p?.landed || ""), p?.landed);
    t.ck("it says pressing again won't help, and names Google's code",
      /won't help/.test(p?.landed || "") && /invalid_client/.test(p?.landed || ""), p?.landed);
    t.ck("the address bar is tidied of both", !/gcal/.test(page.url()), page.url());
    await ctx.close();
  }

  console.log("\n-- a tenant --");
  {
    state = { configured: true, connected: true, email: "john@gmail.test", syncOn: true, blockOn: true, events: 1 };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB, path: "/?gcal=connected",
      seat: { userId: "usr_t", accountId: "acc_s" } });
    await wait(2500);
    const p = await panel(page);
    t.ck("a tenant gets the panel", !!p, await page.evaluate(() => document.body.innerText.slice(0, 200)));
    t.ck("with the push switch and not the busy one, since nobody books a tenant",
      p?.boxes.length === 1 && /Put my SubSub jobs/.test(p.boxes[0].name || ""), JSON.stringify(p?.boxes));
    await ctx.close();
  }

  console.log("\n-- a seat the route refuses --");
  {
    refuse = true;
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB, path: "/?gcal=connected",
      seat: { userId: "usr_c", accountId: "acc_s" } });
    await wait(2500);
    const settingsOpen = await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
      .some((b) => /^Settings$/.test(b.innerText.trim()) && b.className.includes("on")));
    t.ck("Settings really opened", settingsOpen);
    t.ck("and there is no panel over a refusal", (await panel(page)) === null);
    await ctx.close();
    refuse = false;
  }
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
