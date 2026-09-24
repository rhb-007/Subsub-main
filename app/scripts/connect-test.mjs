// Connecting to a contractor who is already on SubSub.
//
// The old way of adding somebody who was already here: type their company,
// their contact, their licence, their trades, their crews, their coverage
// and their insurance into a three-step form -- and then have the server
// quietly notice the licence already existed, reuse that company, and throw
// every field you had just typed away. The contractor was never told that a
// company they had never heard of now had their documents.
//
// Both halves are wrong and both are fixed here. The match is surfaced as
// soon as an address or a licence is typed, before the rest of the form; and
// connecting is ASKED for rather than taken, because it hands over that
// contractor's documents, crews and availability and that is not the hiring
// account's to grant.
//
// The other way in is a QR code in the contractor's own portal: they show
// it, it gets scanned, same request. Which means the code has to actually
// scan -- so this file renders one and reads it back with a real decoder
// rather than trusting that the squares look about right.
//
// Needs the local stack: worker on 8787, mail/SMS stubs, dist on 5191 with
// *.subsub.work mapped to it.
//
//   node scripts/connect-test.mjs

import puppeteer from "puppeteer-core";
import sharp from "sharp";
import jsQR from "jsqr";
import { execFileSync } from "node:child_process";
import { qrPath } from "../src/lib/qr.js";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const SMS = process.env.SMS_STUB || "http://127.0.0.1:8905";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());
const sentSms = async () => (await (await fetch(`${SMS}/__sent`)).json().catch(() => []));
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Writing to the local D1 file from outside makes the dev server bounce,
// and a request that lands in that half-second fails at the socket rather
// than answering anything. This file writes to D1 in the middle of the run
// -- putting the two sides back to unconnected between sections -- so a
// connection failure is retried rather than reported as a broken feature.
// Anything the server actually answers, including an error, is passed
// straight through.
const rawFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawFetch(...args); }
    catch (err) {
      if (attempt >= 4) throw err;
      await wait(700);
    }
  }
};

// Rainier Roofing: a real contractor with a real login, engaged at the
// managing agent account and NOT at the general contractor -- which is
// exactly the situation this feature is for.
const S = Date.now().toString(36);
const THEM = { companyId: "cmp_r", email: "ana@rainier.test", company: "Rainier Roofing" };
const GC = "acc_test";      // Outerhome, the general contractor doing the asking
const THEIRS = "acc_pm";    // where their seat already is

const admin = await tok("admin@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": GC, "content-type": "application/json" };
const theirs = await tok(THEM.email);
const TH = { Authorization: `Bearer ${theirs}`, "X-Account-Id": THEIRS, "content-type": "application/json" };

// This file borrows seed data, so it puts every one of those back.
const cleanup = () => {
  for (const sql of [
    `DELETE FROM connect_requests;`,
    `DELETE FROM engagements WHERE company_id = '${THEM.companyId}' AND account_id = '${GC}';`,
    `DELETE FROM memberships WHERE company_id = '${THEM.companyId}' AND account_id = '${GC}';`,
    `DELETE FROM activity WHERE kind LIKE 'connect%';`,
    `UPDATE companies SET connect_code = NULL WHERE id = '${THEM.companyId}';`,
    `DELETE FROM user_invites WHERE email LIKE '%${S}%';`,
    `DELETE FROM memberships WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '%${S}%');`,
    `DELETE FROM engagements WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '%${S}%');`,
    `DELETE FROM activity WHERE text LIKE '%${S}%';`,
    `DELETE FROM users WHERE email LIKE '%${S}%';`,
    `DELETE FROM companies WHERE company LIKE '%${S}%';`,
    `DELETE FROM memberships WHERE user_id = 'usr_cx_${S}';`,
    `DELETE FROM activity WHERE user_id = 'usr_cx_${S}';`,
    `DELETE FROM users WHERE id = 'usr_cx_${S}';`,
  ]) { try { d1(sql); } catch (e) { console.log("cleanup:", String(e.message).slice(0, 60)); } }
};
cleanup();
// The lookup is rate limited per account, and this file does a lot of them.
d1("DELETE FROM rate_limits WHERE bucket LIKE 'connect-%';");

// A SECOND person at the contractor: an estimator who does not answer the
// request. Rainier ships with one seat, and with one seat "everybody at the
// company" and "whoever tapped yes" are the same set -- so the assertion
// about seats would pass whether or not the code did anything. The seed
// data has no two-person contractor, so this file makes one.
const MATE = { id: `usr_cx_${S}`, email: `mate.${S}@rainier.test`, name: `Sam Ruiz ${S}` };
d1(`INSERT INTO users (id, name, email) VALUES ('${MATE.id}', '${MATE.name}', '${MATE.email}');`);
d1(`INSERT INTO memberships (id, user_id, account_id, role, company_id)
    VALUES ('mem_cx_${S}', '${MATE.id}', '${THEIRS}', 'contractor', '${THEM.companyId}');`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

async function signIn(host, email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${host}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6000);
  return { ctx, page, crashes };
}
// The first line only: a nav button's innerText carries its badge count on
// a second line ("Connect\n1"), so matching the whole thing misses the very
// case this file is about -- the one where somebody is waiting.
const click = (page, re) => page.evaluate((r) => [...document.querySelectorAll("button")]
  .find((b) => new RegExp(r).test(b.innerText.trim().split("\n")[0].trim()))?.click(), re);

try {
  console.log("\n-- the QR has to actually scan --");
  {
    // Rendered and read back by a decoder that has never heard of the
    // encoder. Eyeballing a grid of squares proves nothing: the failure
    // mode of a hand-checked QR is one that reads as the wrong string, in
    // a car park, on somebody else's phone.
    const url = "https://app.subsub.work/?connect=ABCDEFGHJK";
    const { size, path } = qrPath(url);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="410" height="410">`
      + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const read = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    ck("a rendered code decodes at all", !!read, String(read));
    ck("and decodes to exactly the URL that went in", read?.data === url, read?.data);
    // The quiet zone is the commonest reason a hand-rolled QR fails, and it
    // is invisible when you look at one.
    ck("with the four-module quiet zone the spec requires",
      size >= 33 + 8 && !path.includes("M0 0"), `${size} modules wide`);
  }

  console.log("\n-- is this contractor already on SubSub? --");
  {
    const byEmail = await (await fetch(`${API}/connect/lookup?email=${THEM.email}`, { headers: H })).json();
    ck("found by the email somebody typed", byEmail.found === true && byEmail.match.companyId === THEM.companyId,
      JSON.stringify(byEmail).slice(0, 120));
    ck("and named", byEmail.match?.company === THEM.company, byEmail.match?.company);
    // What a hiring account may learn about a company it does not work
    // with: enough to recognise them, and nothing worth scraping.
    const keys = Object.keys(byEmail.match || {}).sort().join(",");
    ck("the answer carries no address, no number and no documents",
      !/email|phone|insurance|bond|doc/i.test(keys), keys);

    const byPhone = await (await fetch(`${API}/connect/lookup?phone=206-555-0142`, { headers: H })).json();
    ck("found by their number too", byPhone.match?.companyId === THEM.companyId, JSON.stringify(byPhone).slice(0, 80));

    const miss = await (await fetch(`${API}/connect/lookup?email=nobody.${Date.now()}@nowhere.test`, { headers: H })).json();
    ck("and somebody who is not here is not found", miss.found === false, JSON.stringify(miss));

    // A company row is not a contractor on SubSub. Most of them were typed
    // in by a hiring account and have no login at all -- asking one of
    // those to connect would be a request nobody could ever accept.
    // Sound Siding is a company row somebody typed into a form. It has an
    // email and no login behind it, which is true of most company rows
    // here. Asking one of those to connect would be a request that nobody
    // could ever accept, so it is not offered -- and because the address
    // DOES match a real row, this is the assertion that proves the check
    // runs rather than one that passes because nothing was found.
    const typed = await (await fetch(`${API}/connect/lookup?email=ken@sound.test`, { headers: H })).json();
    ck("a company nobody can sign in as is not offered",
      typed.found === false && typed.reason === "no_account", JSON.stringify(typed));
    const cannot = await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: "cmp_s" }) });
    ck("and cannot be asked even by id", cannot.status === 409, String(cannot.status));

    const nothing = await fetch(`${API}/connect/lookup`, { headers: H });
    ck("and asking nothing is refused rather than answered", nothing.status === 400, String(nothing.status));
  }

  console.log("\n-- a contractor already on our own list --");
  {
    // The report this answers: a general contractor typed the email of a
    // subcontractor ALREADY ON THEIR OWN ROSTER and was told "Nobody on
    // SubSub matches that."
    //
    // Most company rows on SubSub were typed in by a hiring account and
    // have no login behind them -- Sound Siding above is one, and the
    // lookup rightly refuses to offer those for connecting, since nobody
    // could accept. But that check ran first, so it also swallowed the
    // account's own contractors. Nothing is disclosed by naming a company
    // that this account typed in itself.
    const email = `mine.${S}@ownroster.test`;
    const mine = await (await fetch(`${API}/subs`, { method: "POST", headers: H,
      body: JSON.stringify({ company: `Own Roster ${S}`, contact: "Chris Roster", email,
        categories: ["siding"], caps: [] }) })).json();
    ck("a contractor is on our roster", !!mine.companyId, JSON.stringify(mine).slice(0, 70));
    // Take the login away, which is the state every contractor added before
    // invites were sent is in.
    d1(`DELETE FROM user_invites WHERE email = '${email}';`);
    d1(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = '${email}');`);
    d1(`DELETE FROM users WHERE email = '${email}';`);

    const look = await (await fetch(`${API}/connect/lookup?email=${email}`, { headers: H })).json();
    ck("looking them up finds them, rather than denying they exist",
      look.found === true, JSON.stringify(look).slice(0, 110));
    ck("and says they are already ours", look.match?.engaged === true, String(look.match?.engaged));
    ck("naming the company, so it is plainly the right one",
      look.match?.company === `Own Roster ${S}`, look.match?.company);

    const ask = await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: mine.companyId }) });
    const askBody = await ask.json();
    ck("and asking to connect says they are already engaged, not that they have no account",
      ask.status === 409 && askBody.error === "already_engaged", `${ask.status} ${askBody.error}`);
  }

  console.log("\n-- who may ask --");
  {
    const r = await fetch(`${API}/connect/lookup?email=${THEM.email}`,
      { headers: { Authorization: `Bearer ${theirs}`, "X-Account-Id": THEIRS } });
    ck("a contractor seat cannot run the lookup", r.status === 403, String(r.status));
  }

  console.log("\n-- asking --");
  let reqId = null;
  {
    const beforeMail = (await sentMail()).length, beforeSms = (await sentSms()).length;
    const made = await (await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: THEM.companyId, message: "Met you at the Ballard job." }) })).json();
    reqId = made.id;
    ck("the request is created and pending", made.status === "pending", made.status);
    ck("recorded as typed rather than scanned", made.via === "lookup", made.via);
    ck("it names who is asking", made.account === "Outerhome", made.account);

    const mail = (await sentMail()).slice(beforeMail);
    ck("an email goes to them", mail.length === 1, `${mail.length} sent`);
    ck("saying somebody wants to work with them, not that they must sign up",
      /wants to work with you/i.test(mail[0]?.subject || ""), mail[0]?.subject);
    // The thing a contractor most needs to know before tapping yes.
    const body = mail[0]?.text || "";
    ck("and the email says what accepting hands over",
      /compliance documents/i.test(body) && /trades/i.test(body) && /crews/i.test(body),
      (body.match(/.*compliance documents.*/i) || ["nothing about documents"])[0].trim().slice(0, 90));
    ck("and a text as well, since that is what gets read",
      (await sentSms()).length === beforeSms + 1, `${(await sentSms()).length - beforeSms} sent`);

    const twice = await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: THEM.companyId }) });
    ck("asking twice is refused rather than sending it again", twice.status === 409, String(twice.status));

    const ours = await (await fetch(`${API}/connect-requests`, { headers: H })).json();
    ck("it is on our own list of what we have asked for",
      ours.some((r) => r.id === reqId && r.status === "pending"), `${ours.length} rows`);
  }

  console.log("\n-- their side --");
  {
    const mine = await (await fetch(`${API}/my-connect-requests`, { headers: TH })).json();
    ck("they can see it", mine.some((r) => r.id === reqId), `${mine.length} rows`);
    ck("with what was said", mine.find((r) => r.id === reqId)?.message === "Met you at the Ballard job.",
      mine.find((r) => r.id === reqId)?.message);

    // Somebody else's contractor seat must not see it, and must not be
    // able to answer it.
    const other = await tok("sub@example.test");
    const OH = { Authorization: `Bearer ${other}`, "X-Account-Id": GC, "content-type": "application/json" };
    const notMine = await (await fetch(`${API}/my-connect-requests`, { headers: OH })).json();
    ck("another contractor cannot see it", !notMine.some?.((r) => r.id === reqId),
      Array.isArray(notMine) ? `${notMine.length} rows` : JSON.stringify(notMine));
    const steal = await fetch(`${API}/my-connect-requests/${reqId}/respond`, { method: "POST", headers: OH,
      body: JSON.stringify({ accept: true }) });
    ck("nor answer it", steal.status === 404, String(steal.status));

    const adminTry = await fetch(`${API}/my-connect-requests/${reqId}/respond`, { method: "POST", headers: H,
      body: JSON.stringify({ accept: true }) });
    ck("and the account that asked cannot accept on their behalf", adminTry.status === 403, String(adminTry.status));
  }

  console.log("\n-- accepting is what creates the engagement --");
  {
    const before = await (await fetch(`${API}/subs`, { headers: H })).json();
    ck("they are not on the roster while it is pending",
      !before.some((s) => s.id === THEM.companyId), `${before.length} on the roster`);

    const res = await (await fetch(`${API}/my-connect-requests/${reqId}/respond`, { method: "POST", headers: TH,
      body: JSON.stringify({ accept: true }) })).json();
    ck("accepting works", res.ok === true && res.status === "accepted", JSON.stringify(res).slice(0, 80));

    const after = await (await fetch(`${API}/subs`, { headers: H })).json();
    const them = after.find((s) => s.id === THEM.companyId);
    ck("and now they are on it", !!them, `${after.length} on the roster`);
    // Their profile came with them. This is the entire point: nobody
    // retyped any of it.
    ck("with the profile they already had, not a blank one",
      them?.company === THEM.company && !!them?.contact, JSON.stringify({ c: them?.company, k: them?.contact }));
    // Active, not invited: "invited" is for somebody who has not answered.
    const st = d1(`SELECT status FROM engagements WHERE account_id='${GC}' AND company_id='${THEM.companyId}';`);
    ck("the engagement is active, because they just said yes", /active/.test(st), st.match(/"status":\s*"(\w+)"/)?.[1]);

    // Trades live on the engagement, not the company. A connection made
    // with empty ones is a contractor who matches no job and cannot be
    // assigned to anything -- which would make "connect and they are
    // ready" untrue in the only way that matters.
    ck("and they arrive with the trades they already work under",
      (them?.categories || []).includes("roofing"), JSON.stringify(them?.categories));

    // Everyone at the company, not only whoever tapped yes: a colleague who
    // cannot see the work is a connection that half exists.
    // Ana answered. Sam, the second person at Rainier, did not -- and must
    // still be able to see the work, or the connection half exists and the
    // missing half is invisible from both ends.
    const seats = d1(`SELECT user_id FROM memberships
      WHERE account_id='${GC}' AND company_id='${THEM.companyId}'`);
    ck("the one who answered gets a seat", /usr_ana|"user_id"/.test(seats) && seats.includes("user_id"),
      seats.match(/"user_id":\s*"([^"]+)"/g)?.join(", ") || "none");
    ck("and so does their colleague who never saw the request",
      seats.includes(MATE.id), seats.match(/"user_id":\s*"([^"]+)"/g)?.join(", ") || "none");

    // And they can actually get to the account they just joined.
    const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${theirs}` } })).json();
    ck("they have a seat at that account now",
      (me.memberships || []).some((m) => m.accountId === GC && m.role === "contractor"),
      JSON.stringify((me.memberships || []).map((m) => m.accountId)));

    const again = await fetch(`${API}/my-connect-requests/${reqId}/respond`, { method: "POST", headers: TH,
      body: JSON.stringify({ accept: true }) });
    ck("answering twice is refused", again.status === 409, String(again.status));

    const lookup = await (await fetch(`${API}/connect/lookup?email=${THEM.email}`, { headers: H })).json();
    ck("and the lookup now says they are already ours", lookup.match?.engaged === true, String(lookup.match?.engaged));
    const askAgain = await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: THEM.companyId }) });
    ck("so there is nothing left to ask for", askAgain.status === 409, String(askAgain.status));
  }

  // Back to unconnected, for the declining and scanning parts.
  d1(`DELETE FROM engagements WHERE company_id='${THEM.companyId}' AND account_id='${GC}';`);
  d1(`DELETE FROM memberships WHERE company_id='${THEM.companyId}' AND account_id='${GC}';`);
  d1(`DELETE FROM connect_requests;`);
  await wait(2500);   // let the dev server finish bouncing

  console.log("\n-- declining --");
  {
    const made = await (await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: THEM.companyId }) })).json();
    const res = await (await fetch(`${API}/my-connect-requests/${made.id}/respond`, { method: "POST", headers: TH,
      body: JSON.stringify({ accept: false }) })).json();
    ck("declining works", res.status === "declined", JSON.stringify(res));
    const after = await (await fetch(`${API}/subs`, { headers: H })).json();
    ck("and nothing was shared", !after.some((s) => s.id === THEM.companyId), `${after.length} on the roster`);
    // A no in March must not be a no forever.
    const later = await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ companyId: THEM.companyId }) });
    ck("but they can be asked again later", later.status === 201, String(later.status));
    const pending = await (await fetch(`${API}/connect-requests`, { headers: H })).json();
    const live = pending.find((r) => r.status === "pending");
    const gone = await fetch(`${API}/connect-requests/${live.id}`, { method: "DELETE", headers: H });
    ck("and a request can be withdrawn", gone.status === 200, String(gone.status));
    const mine = await (await fetch(`${API}/my-connect-requests`, { headers: TH })).json();
    ck("which takes it off their list too", !mine.some((r) => r.status === "pending"),
      mine.map((r) => r.status).join(","));

    // A refusal that simply vanishes from the asking side's list is
    // indistinguishable from one still being thought about, and the
    // difference is the whole reason somebody keeps checking.
    const ours = await (await fetch(`${API}/connect-requests`, { headers: H })).json();
    ck("a declined request is kept, not swallowed",
      ours.some((r) => r.status === "declined" && r.companyId === THEM.companyId),
      ours.map((r) => r.status).join(","));
  }

  console.log("\n-- the code, and scanning it --");
  let code = null;
  {
    const got = await (await fetch(`${API}/connect/code`, { headers: TH })).json();
    code = got.code;
    ck("a contractor gets a code", /^[0-9A-Z]{10}$/.test(code || ""), code);
    // No I, L, O or U: this gets read aloud down a phone and typed off a
    // screen, and those four are where that goes wrong.
    ck("with no letters that get mistyped off a screen", !/[ILOU]/.test(code), code);
    ck("and a URL that carries it", got.url?.endsWith(`?connect=${code}`), got.url);
    const same = await (await fetch(`${API}/connect/code`, { headers: TH })).json();
    ck("asking again gives the same one", same.code === code, same.code);

    const seen = await (await fetch(`${API}/connect/code/${code}`, { headers: H })).json();
    ck("scanning it finds them", seen.match?.companyId === THEM.companyId, JSON.stringify(seen).slice(0, 100));

    const made = await (await fetch(`${API}/connect-requests`, { method: "POST", headers: H,
      body: JSON.stringify({ code }) })).json();
    ck("and asking by code works", made.status === "pending", JSON.stringify(made).slice(0, 80));
    ck("recorded as scanned, so they know they showed it to somebody", made.via === "code", made.via);
    await fetch(`${API}/connect-requests/${made.id}`, { method: "DELETE", headers: H });

    const rotated = await (await fetch(`${API}/connect/code/rotate`, { method: "POST", headers: TH })).json();
    ck("it can be changed", rotated.code !== code && /^[0-9A-Z]{10}$/.test(rotated.code), rotated.code);
    const dead = await (await fetch(`${API}/connect/code/${code}`, { headers: H })).json();
    ck("and the old one stops working, which is the point of changing it",
      dead.found === false, JSON.stringify(dead));
    code = rotated.code;

    const nonsense = await (await fetch(`${API}/connect/code/NOTACODE12`, { headers: H })).json();
    ck("a made-up code finds nobody", nonsense.found === false, JSON.stringify(nonsense));
  }

  console.log("\n-- typing their email into the add form --");
  const gc = await signIn("outerhome.subsub.work", "admin@example.test");
  {
    const openAdd = async () => {
      await click(gc.page, "^Add$");
      await wait(800);
      await gc.page.evaluate(() => [...document.querySelectorAll(".add-menu button")]
        .find((b) => /contractor/i.test(b.innerText))?.click());
      await wait(1400);
    };
    // The gate's three boxes, not the form's -- the form is on the far side
    // of it now.
    const typeGate = (label, v) => gc.page.evaluate((l, val) => {
      const el = [...document.querySelectorAll(".cx-gate-flds .fld")]
        .find((f) => new RegExp("^" + l, "i").test(f.innerText.trim()))?.querySelector("input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
    }, label, v);
    const gateText = () => gc.page.evaluate(() => document.querySelector(".cx-gate")?.innerText || "");

    await openAdd();
    // The complaint this answers: the whole profile -- company, contact,
    // licence, UBI, address, trades, capabilities, coverage, crews,
    // documents, notifications -- was on screen from the first keystroke,
    // and the only way to learn it was all already on file was to happen to
    // type an email into the middle of it.
    const gate = await gateText();
    ck("adding opens on a question, not on the form", /already on SubSub\?/i.test(gate),
      gate.split("\n").slice(0, 2).join(" / ") || "no gate");
    ck("with three boxes and nothing else to fill in",
      await gc.page.evaluate(() => document.querySelectorAll(".cx-gate-flds .fld").length) === 3);
    ck("and none of the profile form is on screen yet",
      await gc.page.evaluate(() => !document.querySelector(".steps-bar") && !document.querySelector(".sf-steps")));
    ck("they are the three that can identify somebody",
      /email/i.test(gate) && /mobile/i.test(gate) && /license/i.test(gate),
      gate.replace(/\n/g, " ").slice(0, 120));
    // "Skip" only means something when there is something to skip. With
    // nothing typed there is nothing to skip past, and calling it that
    // reads as though a step is being missed out.
    const firstBtn = await gc.page.evaluate(() =>
      [...document.querySelectorAll(".cx-gate .form-actions button")]
        .map((b) => b.innerText.trim()).join(" | "));
    ck("the way on says continue, not skip, while there is nothing to skip",
      /continue/i.test(firstBtn) && !/skip/i.test(firstBtn), firstBtn);

    await typeGate("Email", "someone.new@nowhere.test");
    await wait(2600);
    // Looked and found nobody is not the same as not having looked, and a
    // blank space says the second when it means the first.
    ck("an address nobody has says so in words", /nobody on subsub matches/i.test(await gateText()),
      (await gateText()).split("\n").find((l) => /matches/i.test(l)) || "said nothing");
    ck("and still says continue, because nothing was found to skip", await gc.page.evaluate(() =>
      [...document.querySelectorAll(".cx-gate .form-actions button")]
        .some((b) => /continue/i.test(b.innerText))));
    ck("and does not pretend to have found somebody",
      await gc.page.evaluate(() => !document.querySelector(".cx-found")));

    await typeGate("Email", THEM.email);
    await wait(2800);
    const card = await gc.page.evaluate(() => document.querySelector(".cx-found")?.innerText || "");
    ck("theirs brings up the card", /already on subsub/i.test(card), card.split("\n")[0] || "no card");
    ck("naming the company", card.includes(THEM.company), card.split("\n")[1]);
    ck("and saying there is nothing to fill in", /nothing to fill in/i.test(card),
      (card.match(/.*nothing to fill in.*/i) || ["not said"])[0].slice(0, 70));
    // NOW there is something to skip, and only now.
    const withMatch = await gc.page.evaluate(() =>
      [...document.querySelectorAll(".cx-gate .form-actions button")]
        .map((b) => b.innerText.trim()).join(" | "));
    ck("and only with somebody found does the way on say skip",
      /skip/i.test(withMatch), withMatch);

    // Never a dead end. Two companies can share a number, and plenty of
    // contractors have no email on file at all.
    await gc.page.evaluate(() => [...document.querySelectorAll(".cx-gate .form-actions button")]
      .find((b) => /add them myself|^continue$/i.test(b.innerText))?.click());
    await wait(900);
    ck("it can be waved past into the form the old way",
      await gc.page.evaluate(() => !document.querySelector(".cx-gate") && !!document.querySelector(".sf-steps")));
    // What they typed at the gate is in the form, not asked for twice.
    ck("carrying what was typed at the gate into it", await gc.page.evaluate((em) => {
      const el = [...document.querySelectorAll(".fld")]
        .find((f) => /^Email/.test(f.innerText.trim()))?.querySelector("input");
      return el?.value === em;
    }, THEM.email));

    // Most of step 1 is behind "More details" now. A licence typed at the
    // gate lives in there, so the panel has to open itself -- otherwise it
    // reads as having been thrown away, which is the exact complaint the
    // gate was built to answer.
    await gc.page.evaluate(() => [...document.querySelectorAll(".form button")]
      .find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
    await wait(900);
    await openAdd();
    await typeGate("License", "GATECARRY99");
    await wait(2500);
    await gc.page.evaluate(() => [...document.querySelectorAll(".cx-gate .form-actions button")]
      .find((b) => /add them myself|^continue$/i.test(b.innerText))?.click());
    await wait(1000);
    const carried = await gc.page.evaluate(() => {
      const more = document.querySelector(".sf-more");
      const lic = [...document.querySelectorAll(".fld")]
        .find((f) => /license/i.test(f.innerText))?.querySelector("input");
      return { open: more?.getAttribute("aria-expanded") === "true", value: lic?.value || "" };
    });
    ck("a licence typed at the gate opens the details panel on its own", carried.open === true);
    ck("and is still in it", carried.value === "GATECARRY99", carried.value || "gone");
    await gc.page.evaluate(() => [...document.querySelectorAll(".form button")]
      .find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
    await wait(900);

    // Start again and take the other road.
    await gc.page.evaluate(() => [...document.querySelectorAll(".form button")]
      .find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
    await wait(1000);
    await openAdd();
    await typeGate("Email", THEM.email);
    await wait(2800);
    ck("and it comes back next time the form is opened",
      await gc.page.evaluate(() => !!document.querySelector(".cx-found")));

    await gc.page.evaluate(() => [...document.querySelectorAll(".cx-found-acts button")]
      .find((b) => /ask to connect/i.test(b.innerText))?.click());
    await wait(3000);
    ck("asking closes it rather than leaving three steps in front of them",
      await gc.page.evaluate(() => !document.querySelector(".form")));
    await click(gc.page, "^Contractors");
    await wait(1800);
    const strip = await gc.page.evaluate(() =>
      [...document.querySelectorAll(".invited-card")].map((c) => c.innerText.replace(/\n/g, " ")).join(" ~ "));
    ck("and they show up as asked, not as a contractor",
      new RegExp(`Asked[^~]*${THEM.company}`, "i").test(strip), strip.slice(0, 200));
    const cards = strip.split(" ~ ").filter((t) => t.includes(THEM.company));
    ck("and only once, not as a declined card and an asked card together",
      cards.length === 1, cards.join(" || ").slice(0, 160));

    // Asked already, and the form says so rather than offering to ask twice.
    await openAdd();
    await typeGate("Email", THEM.email);
    await wait(2800);
    const second = await gc.page.evaluate(() => document.querySelector(".cx-found")?.innerText || "");
    ck("opening it again says it is already with them",
      /already asked/i.test(second), second.replace(/\n/g, " ").slice(0, 120) || "no card");
    await gc.page.evaluate(() => [...document.querySelectorAll(".cx-gate .form-actions button")]
      .find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
    await wait(800);

    ck("nothing threw", gc.crashes.length === 0, gc.crashes.slice(0, 2).join(" ; "));
  }

  console.log("\n-- and on their phone --");
  {
    const them = await signIn("cascademanagement.subsub.work", THEM.email);
    await click(them.page, "^Connect$");
    await wait(2500);
    const pane = await them.page.evaluate(() => document.querySelector(".pane")?.innerText || "");
    ck("the request is waiting for them", pane.includes("Outerhome"), pane.split("\n").slice(0, 6).join(" / "));
    ck("and it says what accepting hands over", /compliance documents/i.test(pane), pane.slice(0, 200));
    ck("their code is drawn as an actual QR", await them.page.evaluate(() => {
      const el = document.querySelector("svg.qr path");
      return !!el && (el.getAttribute("d") || "").length > 500;
    }));
    ck("and printed underneath, for when the camera will not focus",
      await them.page.evaluate((c) => (document.querySelector(".cx-code-txt")?.innerText || "").trim() === c, code));

    await them.page.evaluate(() => [...document.querySelectorAll(".cx-req button")]
      .find((b) => /accept/i.test(b.innerText))?.click());
    await wait(3500);
    // Read off the DOM, not the prose: the answered list says "You
    // accepted", and a text search for "Accept" finds that happily.
    const after = await them.page.evaluate(() => ({
      stillAsking: [...document.querySelectorAll(".cx-req:not(.spent) button")]
        .some((b) => /^Accept$/i.test(b.innerText.trim())),
      answered: [...document.querySelectorAll(".cx-req.spent")].map((e) => e.innerText.replace(/\n/g, " ")),
    }));
    ck("accepting clears it off the waiting list", after.stillAsking === false);
    ck("and files it as answered rather than dropping it",
      after.answered.some((t) => /Outerhome/.test(t) && /accepted/i.test(t)), after.answered.join(" | "));
    const roster = await (await fetch(`${API}/subs`, { headers: H })).json();
    ck("and the general contractor has them now",
      roster.some((s) => s.id === THEM.companyId), `${roster.length} on the roster`);
    ck("nothing threw", them.crashes.length === 0, them.crashes.slice(0, 2).join(" ; "));
    await them.ctx.close();
  }
  await gc.ctx.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  await browser.close();
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
