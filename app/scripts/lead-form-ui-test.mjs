// THE CRM WEBSITE FORM WEARS THE SIGN-UP FORM'S DESIGN.
//
// Asked for as "make the design of the website form the same design (the
// current design is bad) the same as the workbench branding webform design".
// Both are pasted onto the same account's website, so they share the steps,
// the labels, the inputs, the chips, the confirmation panel and the Powered
// by SubSub mark. This reads the drawn form against the sign-up form's own.
//
//   node --no-warnings scripts/lead-form-ui-test.mjs

import { createServer } from "node:http";
import { leadFormHtml, applyFormHtml } from "../shared/embed.js";
import { launch, tally, wait } from "./lib/stub-stack.mjs";

const t = tally();
const API = 9338, HOST = 5638;
const posts = [];
const api = createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let b = ""; req.on("data", (d) => { b += d; });
  req.on("end", () => { posts.push({ url: req.url, body: JSON.parse(b || "{}") }); res.writeHead(200, cors); res.end("{\"ok\":true}"); });
}).listen(API);
const lead = leadFormHtml({ subdomain: "outerhome", accountName: "Outerhome", apiOrigin: `http://127.0.0.1:${API}` });
const apply = applyFormHtml({ subdomain: "outerhome", accountName: "Outerhome", trades: [{ id: "roofing", label: "Roofing" }],
  apiOrigin: `http://127.0.0.1:${API}` });
const host = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:Georgia,serif">${req.url === "/apply" ? apply : lead}`);
}).listen(HOST);

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1200 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  const look = (root) => page.evaluate((r) => {
    const q = (s) => document.querySelector(`${r} ${s}`);
    const cs = (el, k) => el ? getComputedStyle(el)[k] : null;
    const input = q("input[type=text], input[type=email]");
    const btn = q(".ss-next");
    return { dots: document.querySelectorAll(`${r} .ss-dot`).length, steps: document.querySelectorAll(`${r} .ss-step`).length,
      inputBorder: cs(input, "borderTopColor"), inputRadius: cs(input, "borderTopLeftRadius"), inputPad: cs(input, "paddingTop"),
      btnRadius: cs(btn, "borderTopLeftRadius"), btnBg: cs(btn, "backgroundColor"), btnPad: cs(btn, "paddingLeft"),
      by: document.querySelectorAll(`${r} .ss-by svg path`).length, tick: !!q(".ss-done .ss-tick") };
  }, root);
  await page.goto(`http://127.0.0.1:${HOST}/apply`, { waitUntil: "domcontentloaded" }); await wait(300);
  const A = await look("#subsub-apply");
  await page.goto(`http://127.0.0.1:${HOST}/`, { waitUntil: "domcontentloaded" }); await wait(300);
  const L = await look("#subsub-lead");
  t.ck("two steps with dots, like the sign-up form", L.steps === 2 && L.dots === 2, JSON.stringify(L));
  for (const k of ["inputBorder", "inputRadius", "inputPad", "btnRadius", "btnBg", "btnPad"]) {
    t.ck(`its ${k} matches the sign-up form`, L[k] && L[k] === A[k], `${L[k]} vs ${A[k]}`);
  }
  t.ck("it carries the whole SubSub mark", L.by === 9, String(L.by));
  t.ck("and the same confirmation tick", L.tick, "");

  // Step 1: a service chip turns on.
  await page.click("#subsub-lead .ss-chip");
  const on = await page.evaluate(() => document.querySelector("#subsub-lead .ss-chip").className);
  t.ck("a picked service is drawn on", /\bon\b/.test(on), on);
  t.ck("step 2 is hidden on step 1", await page.evaluate(() => document.querySelector('#subsub-lead [data-step="2"]').hidden), "");
  await page.click("#subsub-lead .ss-next"); await wait(150);
  t.ck("Continue opens the contact step", await page.evaluate(() => !document.querySelector('#subsub-lead [data-step="2"]').hidden), "");
  await page.click("#subsub-lead .ss-go"); await wait(150);
  t.ck("no name says so on the step", /name/i.test(await page.evaluate(() => document.querySelector("#subsub-lead .ss-msg").innerText)), "");
  await page.type('#subsub-lead [name=firstName]', "Ana");
  await page.type('#subsub-lead [name=phone]', "2535550142");
  await page.click("#subsub-lead [name=consent]");
  await page.click("#subsub-lead .ss-go"); await wait(800);
  const p = posts[posts.length - 1];
  t.ck("it posts to the lead route", /\/api\/public\/lead\/outerhome$/.test(p?.url || ""), p?.url);
  t.ck("with the service, the name and the consent", p?.body.services?.length === 1 && p.body.firstName === "Ana" && p.body.consent === true,
    JSON.stringify(p?.body));
  const done = await page.evaluate(() => ({ form: document.querySelector("#subsub-lead .ss-form").hidden,
    done: !document.querySelector("#subsub-lead .ss-done").hidden, text: document.querySelector("#subsub-lead .ss-done").innerText }));
  t.ck("the form is replaced by the confirmation", done.form && done.done, JSON.stringify(done));
  t.ck("signed by the account's team", /The Outerhome team/.test(done.text), done.text);
  t.ck("no crash", crashes.length === 0, JSON.stringify(crashes));
} finally {
  await browser.close(); api.close(); host.close();
}
t.done();
