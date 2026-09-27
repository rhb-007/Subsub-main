// The inbox page, and the ask that leads to it.
//
// Two screens with no account behind either. The pack page gains one line --
// "been sent paperwork by more than one contractor?" -- and the inbox is what
// that leads to: every subcontractor who has sent this person documents, with
// what has expired since, and a claim that lands them in an account whose
// roster they did not have to type.
//
// The assertion that matters most is a negative one: neither page ever names
// the address. A forwarded certificate must not tell the forwarder's colleague
// which mailbox it went to.
//
// And then the claim, which shipped unpressable. `?inbox=` returns above the
// logged-in gate -- right, because somebody opened a link to read what was sent
// them -- so the page was public to EVERYBODY, a signed-in admin included, and
// the one button on it linked to `?signup=1`, a mode nothing has ever handled.
// The route, the table and the page all shipped and nothing could press the
// button. Three people press it and they need three different things: an admin
// claims in place, another seat is told who can, and a stranger is sent to
// get-started carrying the token.
//
//   node scripts/inbox-ui-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inbox-test");
const WEB = 5245, API = 8961;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const PACK = {
  company: "Ridge Roofing", contact: "Sam Ridge", where: "Seattle, WA",
  license: null, licenseVerified: false, licenseCheckedAt: null,
  sentTo: "Priya", note: null, expiresAt: "2026-10-10 00:00:00",
  docs: [
    { kind: "insurance", onFile: true, issuer: "Cascade Mutual", policyNo: "POL-1",
      coverageCents: 200000000, expiresOn: "2027-04-01", readable: true, gated: false, id: "d1" },
    { kind: "w9", onFile: true, readable: false, gated: true, id: "d2" },
  ],
};
const INBOX = {
  expiresAt: "2026-09-30 00:00:00",
  summary: { companies: 3, expired: 1, soon: 1 },
  rows: [
    { token: "tok_bay", company: "Bay Roofing", contact: "Rae Bay", where: "Tacoma, WA",
      sentAt: "2026-09-21", expiresAt: "2026-10-05",
      docs: [{ kind: "insurance", onFile: true, expiresOn: "2026-09-24", gated: false },
             { kind: "w9", onFile: true, expiresOn: null, gated: true }] },
    { token: "tok_pine", company: "Pine Roofing", contact: "Pip Pine", where: "Everett, WA",
      sentAt: "2026-09-25", expiresAt: "2026-10-09",
      docs: [{ kind: "insurance", onFile: true, expiresOn: "2026-10-09", gated: false }] },
    { token: "tok_ridge", company: "Ridge Roofing", contact: "Sam Ridge", where: "Seattle, WA",
      sentAt: "2026-09-18", expiresAt: "2026-10-02",
      docs: [{ kind: "insurance", onFile: true, expiresOn: "2027-04-01", gated: false }] },
  ],
};

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const SEAT_USER = (role) => [{ id: "usr_richard", name: "Richard Braun",
  email: "rb@outerhome.co", phone: null, role, subId: null, propertyIds: [], unit: null,
  hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const asks = [];
const claims = [];
let ASK_REPLY = [200, { ok: true, sent: true }];
let INBOX_REPLY = [200, INBOX];
let CLAIM_REPLY = [200, { ok: true, added: 3 }];
let ROLE = "admin";

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (/^\/api\/pack\/[^/]+\/inbox$/.test(path) && method === "POST") {
    asks.push(path); return ASK_REPLY;
  }
  if (/^\/api\/pack\//.test(path)) return [200, PACK];
  if (/^\/api\/inbox\/[^/]+\/claim$/.test(path) && method === "POST") {
    claims.push(path); return CLAIM_REPLY;
  }
  if (/^\/api\/inbox\//.test(path)) return INBOX_REPLY;
  if (path.startsWith("/api/account-by-subdomain/")) return [200, { ...ACCOUNT, kind: ACCOUNT.kind }];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/account-users") return [200, SEAT_USER(ROLE)];
  return undefined;
} });

const browser = await launch();
// The same page, opened by somebody who IS signed in. `?inbox=` returns above
// the logged-in gate, so the page looks identical -- which is exactly why the
// claim could never tell these two people apart.
const openSeat = async (qs) => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" },
    viewport: { width: 1200, height: 1400 } });
  await r.page.goto(`http://outerhome.subsub.work:${WEB}/?${qs}`,
    { waitUntil: "domcontentloaded" });
  for (let n = 0; n < 25; n++) {
    await wait(300);
    if (await r.page.$(".inbox-claim")) break;
  }
  return r;
};
const open = async (qs) => {
  const page = await browser.newPage();
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.setViewport({ width: 1200, height: 1400 });
  await page.goto(`http://127.0.0.1:${WEB}/?${qs}`, { waitUntil: "domcontentloaded" });
  await wait(1800);
  return { page, crashes };
};

try {
  console.log("\n-- the ask, on the pack page --");
  {
    asks.length = 0; ASK_REPLY = [200, { ok: true, sent: true }];
    const { page, crashes } = await open("pack=tok_ridge");
    const ask = await page.evaluate(() => {
      const el = document.querySelector(".inbox-ask");
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim() } : null;
    });
    t.ck("the pack page offers it", !!ask, String(ask));
    t.ck("phrased as their problem, not ours",
      /sent paperwork by more than one contractor/i.test(ask.text), ask.text);
    t.ck("and says it will be emailed",
      /email you the link/i.test(ask.text), ask.text);

    await page.evaluate(() => [...document.querySelectorAll(".inbox-ask button")]
      .find((b) => /Email me the link/i.test(b.innerText))?.click());
    await wait(700);
    t.ck("asking reaches the server", asks.length === 1, JSON.stringify(asks));
    t.ck("keyed by the share token", asks[0] === "/api/pack/tok_ridge/inbox", asks[0]);

    const done = await page.evaluate(() =>
      document.querySelector(".inbox-ask.done")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("it confirms", /Sent\./.test(done || ""), String(done));
    t.ck("the pack page has none either",
      !/\\u[0-9a-f]{4}/i.test(await page.evaluate(() => document.body.innerText)),
      "");
    // The load-bearing negative. A forwarded certificate must not tell the
    // forwarder's colleague which mailbox it went to.
    t.ck("without naming the address",
      !/@/.test(done || ""), String(done));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- the inbox itself --");
  {
    INBOX_REPLY = [200, INBOX];
    const { page, crashes } = await open("inbox=tok_box");
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
    t.ck("it opens with no account", /Sent to you/.test(body), body.slice(0, 90));
    t.ck("naming how many sent to them", /3 subcontractors have/.test(body), body.slice(0, 160));

    // The reason to have opened it, first.
    const alert = await page.evaluate(() =>
      document.querySelector(".inbox-alert")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("what has lapsed is said at the top",
      /1 document has expired/.test(alert || ""), String(alert));
    t.ck("and what is about to", /1 more expires within 30 days/.test(alert || ""), String(alert));
    t.ck("marked as a problem, not a note",
      await page.evaluate(() => document.querySelector(".inbox-alert")?.classList.contains("bad")));

    const rows = await page.evaluate(() => [...document.querySelectorAll(".inbox-row")]
      .map((r) => ({ co: r.querySelector(".inbox-co")?.innerText.trim(),
        chips: [...r.querySelectorAll(".inbox-doc")].map((c) => c.className.replace("inbox-doc ", "")) })));
    t.ck("every subcontractor is listed", rows.length === 3, String(rows.length));
    t.ck("worst first, as the server ordered them", rows[0].co === "Bay Roofing",
      JSON.stringify(rows.map((r) => r.co)));
    t.ck("a lapsed certificate reads red", rows[0].chips.includes("bad"),
      JSON.stringify(rows[0].chips));
    t.ck("one inside thirty days reads amber", rows[1].chips.includes("warn"),
      JSON.stringify(rows[1].chips));
    t.ck("and one with months left reads fine", rows[2].chips.includes("ok"),
      JSON.stringify(rows[2].chips));

    const claim = await page.evaluate(() => {
      const a = document.querySelector(".inbox-claim a");
      return a ? { text: a.innerText.trim(), href: a.getAttribute("href") } : null;
    });
    t.ck("claiming is offered", !!claim, String(claim));
    t.ck("counting what they get", /Claim these 3/.test(claim.text), claim.text);
    // It used to point at `/?signup=1&inbox=...`, a mode this bundle has never
    // handled, so the button did nothing at all. Creating an account lives on
    // the marketing site, and the token has to survive the trip because it is
    // what knows WHICH contractors are being claimed.
    t.ck("it goes to the form that can actually make an account",
      /^https:\/\/subsub\.work\/get-started\.html\?/.test(claim.href || ""), String(claim.href));
    t.ck("and carries the token through signup",
      /inbox=tok_box/.test(claim.href || ""), String(claim.href));
    t.ck("not to a mode nothing handles",
      !/signup=1/.test(claim.href || ""), String(claim.href));
    t.ck("the pitch is that they did not type it",
      /They already did|they already did/.test(body), body.slice(-260));

    // Nothing about the mailbox, and nothing about who else these
    // subcontractors work for.
    t.ck("the address is never on the page", !/@/.test(body), body.slice(0, 200));
    t.ck("and no escape sequence reached the screen",
      !/\\u[0-9a-f]{4}/i.test(body), (body.match(/.{0,40}\\u[0-9a-f]{4}.{0,20}/i) || [""])[0]);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- an admin who is already signed in claims in place --");
  {
    INBOX_REPLY = [200, INBOX]; CLAIM_REPLY = [200, { ok: true, added: 3 }];
    claims.length = 0; ROLE = "admin";
    const { ctx, page, crashes } = await openSeat("inbox=tok_box");

    // THE POINT. They have an account. Sending them to a signup form asks them
    // to make a second one.
    const btn = await page.evaluate(() =>
      document.querySelector(".inbox-claim button")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("it is a button, not a link off the site", !!btn, String(btn));
    t.ck("naming the account it would land on", /Outerhome/.test(btn || ""), String(btn));
    t.ck("and nothing points at a signup form",
      await page.evaluate(() => !document.querySelector(".inbox-claim a")));

    await page.evaluate(() => document.querySelector(".inbox-claim button")?.click());
    for (let n = 0; n < 20 && !claims.length; n++) await wait(200);
    t.ck("pressing it reaches the claim route", claims.length === 1, JSON.stringify(claims));
    t.ck("keyed by the inbox token", claims[0] === "/api/inbox/tok_box/claim", claims[0]);

    for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".inbox-claim.done")) break; }
    const done = await page.evaluate(() =>
      document.querySelector(".inbox-claim.done")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("it says what happened", /On your roster now/i.test(done || ""), String(done));
    t.ck("with the count the server returned", /\b3 contractors are\b/.test(done || ""), String(done));
    // A document share is agreement to be hireable, not agreement to have been
    // hired, and the screen has to say so or somebody expects three crews.
    t.ck("and that nothing is assigned to anybody",
      /Nothing is assigned/i.test(done || ""), String(done));
    // Claiming spends the link, so coming back here answers "already claimed".
    // The way on has to be offered now or this is a dead end.
    t.ck("the way on is offered, because this link is now spent",
      await page.evaluate(() => document.querySelector(".inbox-claim.done a")?.getAttribute("href") === "/"));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a failure says nothing was added --");
  {
    INBOX_REPLY = [200, INBOX]; CLAIM_REPLY = [500, { error: "boom" }];
    claims.length = 0; ROLE = "admin";
    const { ctx, page, crashes } = await openSeat("inbox=tok_box");
    await page.evaluate(() => document.querySelector(".inbox-claim button")?.click());
    for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".inbox-claim-fine.err")) break; }
    const err = await page.evaluate(() =>
      document.querySelector(".inbox-claim-fine.err")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("it says so", /didn.t save/i.test(err || ""), String(err));
    t.ck("and says nothing was added, which is what they need to know",
      /nothing was added/i.test(err || ""), String(err));
    t.ck("it did not claim success", await page.evaluate(() => !document.querySelector(".inbox-claim.done")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    CLAIM_REPLY = [200, { ok: true, added: 3 }];
  }

  console.log("\n-- a seat that cannot write engagements is told who can --");
  {
    INBOX_REPLY = [200, INBOX]; claims.length = 0; ROLE = "pm";
    const { ctx, page, crashes } = await openSeat("inbox=tok_box");
    const body = await page.evaluate(() =>
      document.querySelector(".inbox-claim")?.innerText.replace(/\s+/g, " ").trim() || null);
    // Offering a button the server will refuse is the lie QuickSend's W-9 line
    // exists to avoid.
    t.ck("no button is offered",
      await page.evaluate(() => !document.querySelector(".inbox-claim button")), String(body));
    t.ck("it says an admin has to do it", /admin/i.test(body || ""), String(body));
    t.ck("and names the account, so they know who to ask",
      /Outerhome/.test(body || ""), String(body));
    t.ck("nothing was claimed", claims.length === 0, JSON.stringify(claims));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    ROLE = "admin";
  }

  console.log("\n-- and the old claim link still lands somewhere useful --");
  {
    // `/?signup=1&inbox=X` is what the button used to be. An admin holding one
    // claims in place rather than being bounced off to make a second account.
    INBOX_REPLY = [200, INBOX]; claims.length = 0; ROLE = "admin";
    const { ctx, page, crashes } = await openSeat("signup=1&inbox=tok_box");
    t.ck("the inbox page still renders",
      /Sent to you/.test(await page.evaluate(() => document.body.innerText)),
      (await page.evaluate(() => document.body.innerText)).slice(0, 80));
    t.ck("with the claim on it",
      await page.evaluate(() => !!document.querySelector(".inbox-claim button")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a link that is no longer good says which kind of no --");
  {
    for (const [err, phrase] of [["expired", /has expired/], ["claimed", /already been claimed/],
      ["revoked", /was replaced/]]) {
      INBOX_REPLY = [404, { error: err }];
      const { page, crashes } = await open("inbox=tok_box");
      const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
      t.ck(`${err} says so`, phrase.test(body), body.slice(0, 110));
      t.ck(`${err} does not white-screen`, body.length > 20 && crashes.length === 0,
        crashes.join(" | "));
      await page.close();
    }
    INBOX_REPLY = [404, { error: "not_found" }];
    const { page } = await open("inbox=nope");
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
    t.ck("and an unknown one offers the way back",
      /Open any document link you were sent/.test(body), body.slice(0, 140));
    await page.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}

// ---- and the other half of the trip ------------------------------------
// Signing up is two pages on another origin, so the token cannot be kept in
// this tab -- it travels in the query string the whole way. get-started reads
// it, and points its last button back at the inbox page rather than at a
// dashboard, because the claim happens there and a dashboard has no idea this
// person was in the middle of claiming anything.
console.log("\n-- get-started carries the token back --");
{
  const html = readFileSync(join(app, "..", "get-started.html"), "utf8");
  t.ck("it reads the token off the query string",
    /qs\.get\('inbox'\)/.test(html), "");
  t.ck("and checks the shape before trusting it",
    /inboxTok\s*=\s*''/.test(html) && /test\(inboxTok\)/.test(html), "");
  t.ck("the sign-in link comes back to the inbox page",
    /\?inbox=' \+ encodeURIComponent\(inboxTok\)/.test(html), "");
  t.ck("and the last screen says the claim is still waiting",
    /waiting to be\s*'\s*\+\s*'added/.test(html)
      || /waiting to be/.test(html), "");

  // The validator has to accept a real one. shareToken() is base64url of 32
  // bytes, so a hand-written character class is exactly the kind of guard that
  // silently rejects every live token.
  const m = html.match(/if\(!(\/\^\[[^\n]*?\$\/)\.test\(inboxTok\)\)/);
  t.ck("the guard was found in the page", !!m, String(m && m[1]));
  if (m) {
    // eslint-disable-next-line no-new-func
    const re = new Function(`return ${m[1]};`)();
    const real = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255))
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    t.ck("it accepts a token the server would actually mint", re.test(real), real);
    t.ck("and refuses something with a quote in it", !re.test(`x'"><b`), "");
    t.ck("and refuses an empty one", !re.test(""), "");
  }
}

t.done();
