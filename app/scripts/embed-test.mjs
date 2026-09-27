// The application form a general contractor pastes on their own website.
//
// The hosted form at <sub>.subsub.work/?apply=1 has existed since the start and
// nobody knows it is there. It is the only subcontractor-acquisition channel
// that runs without the account doing anything, and a subcontractor who lands
// on a roster is one QuickSend away from putting SubSub in front of every other
// general contractor who asks them for a certificate. Supply brings demand in,
// which in a product with no directory is the only flywheel available.
//
// Generated HTML is worth testing by RUNNING it, not by matching strings: the
// snippet is served from somebody else's website, against a real origin, and a
// missing bracket in the script tag is a form that silently does nothing.
//
//   node scripts/embed-test.mjs

import { createServer } from "node:http";
import { applyFormHtml, applyLink, shouldNudgeEmbed, EMBED_NUDGE_AT } from "../shared/embed.js";
import { launch, tally, wait } from "./lib/stub-stack.mjs";

const t = tally();
const HOST = 5243, API = 8955;

const TRADES = [
  { id: "roofing", label: "Roofing" },
  { id: "siding", label: "Siding" },
  { id: "gutters", label: "Gutters" },
];

console.log("\n-- when to tell them it exists --");
{
  t.ck("not on day one", shouldNudgeEmbed(0, false) === false);
  t.ck("nor with one contractor", shouldNudgeEmbed(1, false) === false);
  t.ck("nor two", shouldNudgeEmbed(2, false) === false);
  t.ck(`at ${EMBED_NUDGE_AT}`, shouldNudgeEmbed(EMBED_NUDGE_AT, false) === true);
  t.ck("and past it", shouldNudgeEmbed(40, false) === true);
  // Once, ever. A growth nudge that repeats is a growth nudge people filter.
  t.ck("but never twice", shouldNudgeEmbed(40, true) === false);
  t.ck("the link is their own address",
    applyLink("outerhome") === "https://outerhome.subsub.work/?apply=1",
    applyLink("outerhome"));
}

console.log("\n-- the snippet is safe to paste into somebody else's page --");
{
  const html = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome", trades: TRADES });
  // Every rule scoped under the root id. A bare `input{...}` would restyle
  // their whole website, which is the fastest way to have it ripped back out.
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const rules = css.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  t.ck("every CSS rule is scoped to the snippet",
    rules.every((r) => r.split(",").every((sel) => sel.trim().startsWith("#subsub-apply"))),
    JSON.stringify(rules.filter((r) => !r.startsWith("#subsub-apply"))));
  t.ck("it sets no global font or colour",
    !/^\s*(body|html|\*)\s*\{/m.test(css));
  t.ck("and there is a no-JavaScript way through",
    html.includes("<noscript>") && html.includes(applyLink("outerhome")));

  // An account name with markup in it must not become markup.
  const nasty = applyFormHtml({ subdomain: "x", accountName: '</script><img src=x onerror=alert(1)>',
    trades: TRADES });
  t.ck("an account name is escaped, not interpolated",
    !nasty.includes("<img src=x"), nasty.slice(nasty.indexOf("Apply to work"), 120));
  t.ck("and cannot close the script tag early",
    !/<\/script>\s*<img/.test(nasty));

  t.ck("no subdomain, no snippet", applyFormHtml({}) === "");
}

console.log("\n-- and it actually works in a browser --");
{
  const posts = [];
  let reply = [200, { ok: true }];
  const api = createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => {
      posts.push({ url: req.url, body: JSON.parse(b || "{}") });
      res.writeHead(reply[0], cors); res.end(JSON.stringify(reply[1]));
    });
  }).listen(API);

  // Served from a different origin, the way it will be in the wild.
  const snippet = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome",
    trades: TRADES, apiOrigin: `http://127.0.0.1:${API}` });
  const host = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Roofer wanted</title>
      <body style="font-family:Georgia,serif;color:#333"><h1>Work with us</h1>${snippet}`);
  }).listen(HOST);

  const browser = await launch();
  try {
    const page = await browser.newPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://127.0.0.1:${HOST}/`, { waitUntil: "domcontentloaded" });
    await wait(500);

    const shape = await page.evaluate(() => ({
      fields: [...document.querySelectorAll("#subsub-apply [name]")].map((e) => e.name),
      required: [...document.querySelectorAll("#subsub-apply [required]")].map((e) => e.name),
      trades: [...document.querySelectorAll("#subsub-apply select option")].map((o) => o.value),
      // The host page's serif must not have been overridden.
      hostFont: getComputedStyle(document.querySelector("h1")).fontFamily,
    }));
    t.ck("the form renders", shape.fields.length === 5, JSON.stringify(shape.fields));
    t.ck("asking only what the server requires",
      shape.required.join(",") === "company,contact,email", JSON.stringify(shape.required));
    t.ck("with the trades passed in", shape.trades.join(",") === "roofing,siding,gutters");
    t.ck("and the host page's own styling is untouched",
      /Georgia/.test(shape.hostFont), shape.hostFont);

    // Refuses to send without the three the server needs -- so somebody does
    // not watch a request fail for something the page could have said.
    await page.evaluate(() => document.querySelector("#subsub-apply button").click());
    await wait(400);
    t.ck("it will not send an empty form", posts.length === 0, JSON.stringify(posts));
    t.ck("and says what is missing",
      /Company, your name and email are needed/.test(
        await page.evaluate(() => document.querySelector(".ss-msg").textContent)));

    await page.evaluate(() => {
      const f = document.querySelector("#subsub-apply .ss-form");
      f.company.value = "Bay Roofing";
      f.contact.value = "Rae Bay";
      f.email.value = "rae@bayroofing.test";
      f.phone.value = "2065550111";
      [...f.categories.options].find((o) => o.value === "roofing").selected = true;
      [...f.categories.options].find((o) => o.value === "gutters").selected = true;
      document.querySelector("#subsub-apply button").click();
    });
    await wait(700);

    t.ck("a filled form reaches the API", posts.length === 1, JSON.stringify(posts));
    t.ck("at the account's own path", posts[0]?.url === "/api/apply/outerhome", posts[0]?.url);
    t.ck("carrying the company", posts[0]?.body.company === "Bay Roofing");
    t.ck("the contact", posts[0]?.body.contact === "Rae Bay");
    t.ck("the email", posts[0]?.body.email === "rae@bayroofing.test");
    t.ck("and every trade they picked",
      (posts[0]?.body.categories || []).join(",") === "roofing,gutters",
      JSON.stringify(posts[0]?.body.categories));
    t.ck("it never sends a password", !("password" in (posts[0]?.body || {})));

    const ok = await page.evaluate(() => document.querySelector(".ss-msg").textContent);
    t.ck("and it says so, naming who it went to", /that's with Outerhome/i.test(ok), ok);
    t.ck("the form clears for the next one",
      await page.evaluate(() => document.querySelector("#subsub-apply .ss-form").company.value === ""));

    // A refusal has to reach the person, not the console.
    reply = [429, { error: "rate_limited" }];
    await page.evaluate(() => {
      const f = document.querySelector("#subsub-apply .ss-form");
      f.company.value = "Pine"; f.contact.value = "Pip"; f.email.value = "pip@pine.test";
      document.querySelector("#subsub-apply button").click();
    });
    await wait(700);
    const bad = await page.evaluate(() => document.querySelector(".ss-msg").textContent);
    t.ck("a refusal is shown in the form", /Too many applications/.test(bad), bad);
    t.ck("and the button comes back",
      await page.evaluate(() => !document.querySelector("#subsub-apply button").disabled));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  } finally {
    await browser.close(); host.close(); api.close();
  }
}

t.done();
