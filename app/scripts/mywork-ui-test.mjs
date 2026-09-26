// The portal's job list, when more than one company hires you.
//
// The screen used to answer "does anybody need me" for exactly one account: the
// one the seat was standing in. A subcontractor on several rosters switched
// account to find out, and the amber badge only ever counted the account in
// front of them -- so jobs waiting on a yes sat behind a clean nav.
//
// The assertions that matter:
//
//   THE BADGE COUNTS EVERY CLIENT. If it counted only the local ones this test
//   reads 1 where it should read 3, which is exactly the bug.
//
//   A ROW FROM ANOTHER CLIENT SAYS WHOSE IT IS, and offers no Accept button --
//   answering posts to the account the seat is on, so an Accept here would reach
//   the wrong company. It offers the way there instead.
//
//   node scripts/mywork-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-mywork-test");
const WEB = 5231, API = 8943;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const GC = {
  id: "acc_a", name: "Alder Construction", subdomain: "alder", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_bay", name: "Rae Bay", email: "rae@bayroofing.test", role: "contractor" },
};
const SUB = {
  id: "cmp_bay", company: "Bay Roofing", engagementId: "en_a", accountId: "acc_a",
  contact: "Rae Bay", email: "rae@bayroofing.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "BAYRR001QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, autoSchedule: false,
};

// One job at the account we are in, two at other companies. One of each is
// waiting on a yes.
const LOCAL_JOB = {
  id: "j_a", accountId: "acc_a", title: "Re-roof the mill", address: "12 Mill Lane",
  area: null, zip: null, date: "2026-10-02", time: null, trades: ["roofing"],
  scope: null, status: "active", assignments: {
    roofing: { id: "wo_a", subId: "cmp_bay", wo: "WO-1001", status: "pending", auto: false,
      value: "4500", respondBy: null, tradeScope: null, crewName: null },
  },
  photos: [], measurementDocs: [], propertyId: null, requestedBy: null,
  severity: null, notes: null,
};

const MY_WORK = { work: [
  { woId: "wo_a", wo: "WO-1001", jobId: "j_a", trade: "roofing",
    accountId: "acc_a", accountName: "Alder Construction", accountSubdomain: "alder",
    here: true, status: "pending", auto: false, respondBy: null,
    title: "Re-roof the mill", address: "12 Mill Lane", date: "2026-10-02",
    propertyName: "Alder Mill", jobStatus: "active", value: "4500", payKind: "fixed" },
  { woId: "wo_b", wo: "WO-1002", jobId: "j_b", trade: "roofing",
    accountId: "acc_b", accountName: "Birch Builders", accountSubdomain: "birch",
    here: false, status: "pending", auto: false,
    respondBy: "2099-10-08T17:00:00Z",
    title: "Gutter run", address: "40 Elm Ave", date: "2026-10-09",
    propertyName: null, jobStatus: "active", value: "1200", payKind: "fixed" },
  { woId: "wo_c", wo: "WO-1003", jobId: "j_c", trade: "roofing",
    accountId: "acc_c", accountName: "Cedar Contracting", accountSubdomain: "cedar",
    here: false, status: "pending", auto: false, respondBy: null,
    title: "Flat roof patch", address: "3 Fir Close", date: "2026-10-14",
    propertyName: null, jobStatus: "active", value: "880", payKind: "fixed" },
  { woId: "wo_d", wo: "WO-1004", jobId: "j_d", trade: "roofing",
    accountId: "acc_b", accountName: "Birch Builders", accountSubdomain: "birch",
    here: false, status: "accepted", auto: false, respondBy: null,
    title: "Ridge cap replace", address: "9 Oak Row", date: "2026-10-05",
    propertyName: null, jobStatus: "active", value: "2400", payKind: "fixed" },
] };

let SERVE_WORK = MY_WORK;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/account-users") return [200, [
    { id: "u_bay", name: "Rae Bay", email: "rae@bayroofing.test", phone: null, role: "contractor",
      subId: "cmp_bay", propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs") return [200, [LOCAL_JOB]];
  if (path === "/api/my-work") return [200, SERVE_WORK];
  if (path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/doc-shares" || path === "/api/clients"
    || path === "/api/property-transfers") return [200, []];
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const v = await visitApp(browser, { host: "alder", webPort: WEB,
    seat: { userId: "u_bay", accountId: "acc_a" }, viewport: { width: 1200, height: 1800 } });
  await wait(2900);
  return v;
};

try {
  console.log("\n-- the badge counts every client, not the one in front of you --");
  {
    SERVE_WORK = MY_WORK;
    const { ctx, page, crashes } = await open();

    const badge = await page.evaluate(() => {
      const b = [...document.querySelectorAll("nav button")]
        .find((x) => /^My Jobs/.test(x.innerText.trim()));
      return b ? b.innerText.replace(/\s+/g, " ").trim() : null;
    });
    // Three pending across three companies. One of them is local: a badge
    // reading 1 is the bug this exists to catch.
    t.ck("the nav badge is on My Jobs", !!badge, String(badge));
    t.ck("and counts all three, not just the local one",
      /\b3\b/.test(badge || ""), String(badge));

    const strip = await page.evaluate(() =>
      document.querySelector(".who-for")?.innerText.trim() || null);
    t.ck("the strip says how many companies this is for",
      /3 companies/.test(strip || ""), String(strip));

    const cards = await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .map((c) => ({ away: c.classList.contains("jr-away"),
        text: c.innerText.replace(/\s+/g, " ").trim() })));
    t.ck("every slot is on one list", cards.length === 4, String(cards.length));
    t.ck("one of them is local", cards.filter((c) => !c.away).length === 1,
      String(cards.filter((c) => !c.away).length));
    t.ck("and three are somewhere else", cards.filter((c) => c.away).length === 3);
    t.ck("no switching needed to see Birch's work",
      cards.some((c) => /gutter run/i.test(c.text)));
    t.ck("or Cedar's", cards.some((c) => /flat roof patch/i.test(c.text)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a row from another client says whose, and does not pretend to answer --");
  {
    SERVE_WORK = MY_WORK;
    const { ctx, page, crashes } = await open();

    const away = await page.evaluate(() => {
      const c = [...document.querySelectorAll(".jr-card")]
        .find((x) => /gutter run/i.test(x.innerText));
      if (!c) return null;
      return {
        client: c.querySelector(".jr-client")?.innerText.replace(/\s+/g, " ").trim() || null,
        buttons: [...c.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
        text: c.innerText.replace(/\s+/g, " ").trim(),
      };
    });
    t.ck("it names the client on the row", /Birch Builders/.test(away?.client || ""),
      String(away?.client));
    t.ck("and says the work is FOR them", /^For /.test(away?.client || ""), String(away?.client));

    // The load-bearing one. Accepting posts to the account the seat is on.
    t.ck("no Accept button", !away.buttons.some((b) => /^Accept$/i.test(b)),
      JSON.stringify(away.buttons));
    t.ck("no Decline button", !away.buttons.some((b) => /^Decline$/i.test(b)),
      JSON.stringify(away.buttons));
    t.ck("nor a way to change a work order at another account",
      !away.buttons.some((b) => /Request a change/i.test(b)), JSON.stringify(away.buttons));
    t.ck("nor to open one", !away.buttons.some((b) => /View work order/i.test(b)),
      JSON.stringify(away.buttons));
    t.ck("it says where to answer instead",
      /Answer this at Birch Builders/.test(away.text), away.text);
    // The countdown is the whole reason to surface it from another account.
    t.ck("and still shows the clock", /left to respond/.test(away.text), away.text);

    // A slot with no response window is not waiting on a yes, so it says where
    // it is rather than telling them to go and answer something.
    const noDeadline = await page.evaluate(() => {
      const c = [...document.querySelectorAll(".jr-card")]
        .find((x) => /flat roof patch/i.test(x.innerText));
      return c ? c.innerText.replace(/\s+/g, " ").trim() : null;
    });
    t.ck("one with no deadline just says whose it is",
      /This job is at Cedar Contracting/.test(noDeadline || ""), String(noDeadline));
    t.ck("and offers the way there",
      away.buttons.some((b) => /Go to Birch Builders/.test(b)), JSON.stringify(away.buttons));

    // The local row keeps everything it had.
    const local = await page.evaluate(() => {
      const c = [...document.querySelectorAll(".jr-card")]
        .find((x) => /re-roof the mill/i.test(x.innerText));
      return c ? { away: c.classList.contains("jr-away"),
        buttons: [...c.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()) } : null;
    });
    t.ck("the local row is not marked away", local?.away === false);
    t.ck("and can still be accepted", local.buttons.some((b) => /^Accept$/i.test(b)),
      JSON.stringify(local.buttons));
    t.ck("and declined", local.buttons.some((b) => /^Decline$/i.test(b)));
    t.ck("and its work order opened", local.buttons.some((b) => /View work order/i.test(b)));
    t.ck("and it carries no client strip -- you are already there",
      await page.evaluate(() => {
        const c = [...document.querySelectorAll(".jr-card")]
          .find((x) => /re-roof the mill/i.test(x.innerText));
        return !c.querySelector(".jr-client");
      }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- one client, and the screen is what it always was --");
  {
    // The fix must not tax the common case. A subcontractor working for one
    // company should see no strip, no tint and the same sentence as before.
    SERVE_WORK = { work: [MY_WORK.work[0]] };
    const { ctx, page, crashes } = await open();
    const strip = await page.evaluate(() =>
      document.querySelector(".who-for")?.innerText.trim() || null);
    t.ck("it names the one company rather than counting",
      /Subcontracting for Alder Construction/.test(strip || ""), String(strip));
    t.ck("no row is marked away",
      await page.evaluate(() => document.querySelectorAll(".jr-away").length === 0));
    t.ck("and no client strip anywhere",
      await page.evaluate(() => document.querySelectorAll(".jr-client").length === 0));
    const badge = await page.evaluate(() => {
      const b = [...document.querySelectorAll("nav button")]
        .find((x) => /^My Jobs/.test(x.innerText.trim()));
      return b ? b.innerText.replace(/\s+/g, " ").trim() : null;
    });
    t.ck("the badge reads 1", /\b1\b/.test(badge || ""), String(badge));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and the route failing is not a white screen --");
  {
    // A database without the columns answers with an empty list, and a 503 is
    // possible. Either way the portal must still draw its own account's work.
    SERVE_WORK = { work: [] };
    const { ctx, page, crashes } = await open();
    t.ck("the local job still renders",
      await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
        .some((c) => /re-roof the mill/i.test(c.innerText))));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
