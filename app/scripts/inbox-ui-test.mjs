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
//   node scripts/inbox-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

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

const asks = [];
let ASK_REPLY = [200, { ok: true, sent: true }];
let INBOX_REPLY = [200, INBOX];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (/^\/api\/pack\/[^/]+\/inbox$/.test(path) && method === "POST") {
    asks.push(path); return ASK_REPLY;
  }
  if (/^\/api\/pack\//.test(path)) return [200, PACK];
  if (/^\/api\/inbox\//.test(path)) return INBOX_REPLY;
  return undefined;
} });

const browser = await launch();
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
    t.ck("and carrying the token through signup",
      /inbox=tok_box/.test(claim.href || ""), String(claim.href));
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

t.done();
