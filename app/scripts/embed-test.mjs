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

console.log("\n-- it wears the account's own colours --");
{
  const theme = { bg: "#0B0F0D", surface: "#FFFFFF", text: "#12211C",
    accent: "#B5442E", btnText: "#FFF8F2" };
  const html = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome",
    trades: TRADES, theme });
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

  t.ck("the button takes the accent", /button\{[^}]*background:#B5442E/i.test(css),
    (css.match(/button\{[^}]*\}/i) || [""])[0]);
  t.ck("and the button text colour", /button\{[^}]*color:#FFF8F2/i.test(css),
    (css.match(/button\{[^}]*\}/i) || [""])[0]);
  t.ck("the focus ring matches", /outline:2px solid #B5442E/i.test(css));
  t.ck("and so does the confirmation tick", /ss-tick\{[^}]*background:#B5442E/i.test(css));

  // Hover is computed, not stored: the editor asks for one accent, and a
  // second colour to maintain is a second colour to get wrong.
  const hover = (css.match(/hover:not\(:disabled\)\{background:(#[0-9a-f]{6})/i) || [])[1];
  t.ck("hover is a darker shade of it", !!hover && hover.toLowerCase() !== "#b5442e", String(hover));

  // NOT applied, deliberately. This form lands inside somebody's existing
  // layout: a snippet that paints a page background is the restyles-their-
  // whole-website failure every rule in it is scoped to avoid.
  t.ck("the page background is never painted", !css.includes("#0B0F0D"), "#0B0F0D");
  t.ck("and the form sets no background of its own",
    !/\.ss-form\{[^}]*background/i.test(css), (css.match(/\.ss-form\{[^}]*\}/i) || [""])[0]);

  // No theme is SubSub's green, which is a real form rather than a broken one.
  const plain = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome", trades: TRADES });
  t.ck("with no theme it falls back to the default",
    /button\{[^}]*background:#1f6b4a/i.test(plain));

  // A colour out of the database landing in a <style> block on a customer's
  // website is an injection unless it is checked.
  const nasty = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome",
    theme: { accent: "red;}body{display:none;}#x{a:b" } });
  t.ck("a colour that is not a colour cannot escape the rule",
    !nasty.includes("body{display:none"), "escaped");
  t.ck("and the default is used instead",
    /button\{[^}]*background:#1f6b4a/i.test(nasty));
  t.ck("a three-digit hex is refused too",
    /button\{[^}]*background:#1f6b4a/i.test(
      applyFormHtml({ subdomain: "o", accountName: "O", theme: { accent: "#abc" } })));
}

console.log("\n-- the snippet is safe to paste into somebody else's page --");
{
  const html = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome", trades: TRADES });
  // Every rule scoped under the root id. A bare `input{...}` would restyle
  // their whole website, which is the fastest way to have it ripped back out.
  // Comments out first: the selector is whatever precedes a {, and a /* ... */
  // above a rule would otherwise be read as part of its selector and fail a
  // check that is about where the rules APPLY.
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1].replace(/\/\*[\s\S]*?\*\//g, "");
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

    // A refusal comes FIRST, because success is now terminal: it replaces the
    // form, so anything tested after it would be driving a hidden one.
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
    t.ck("and the form is still there to correct",
      await page.evaluate(() => !document.querySelector("#subsub-apply .ss-form").hidden));

    reply = [200, { ok: true }];
    posts.length = 0;
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

    // The confirmation REPLACES the form. A blank form under "we got it" reads
    // as an invitation to send it again, which is how one applicant becomes
    // three rows on somebody's roster.
    const after = await page.evaluate(() => {
      const root = document.querySelector("#subsub-apply");
      const done = root.querySelector(".ss-done");
      return {
        formGone: getComputedStyle(root.querySelector(".ss-form")).display === "none",
        doneShown: !!done && !done.hidden && getComputedStyle(done).display !== "none",
        text: done ? done.innerText.replace(/\s+/g, " ").trim() : "",
        tick: !!done?.querySelector(".ss-tick"),
        centred: done ? getComputedStyle(done).textAlign : "",
      };
    });
    t.ck("the form is gone", after.formGone, String(after.formGone));
    t.ck("and the confirmation is in its place", after.doneShown, String(after.doneShown));
    t.ck("with a tick", after.tick);
    t.ck("centred", after.centred === "center", after.centred);
    t.ck("it names who has it", /that[\u2019']s with Outerhome/i.test(after.text), after.text);
    // What actually happens next, which the old one never said: a human reads
    // it, and nobody joins a roster until they say so.
    t.ck("it says a person will read it",
      /read every application/i.test(after.text), after.text);
    t.ck("and that nothing happens until they do",
      /nobody joins their roster until they say so/i.test(after.text), after.text);
    t.ck("and where to watch", /rae@bayroofing\.test/.test(after.text), after.text);
    // The reply is identical whether or not that address already has a login,
    // because a form that says "we emailed you" for one and not the other is a
    // way to ask which of a list of addresses is on SubSub.
    t.ck("without claiming an email was sent",
      !/we (have )?(e-?mailed|sent you)/i.test(after.text)
        && !/check your (e-?mail|inbox)/i.test(after.text), after.text);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  } finally {
    await browser.close(); host.close(); api.close();
  }
}

t.done();
