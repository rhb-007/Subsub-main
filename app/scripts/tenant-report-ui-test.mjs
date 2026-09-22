// The tenant's own reports, driven through the browser.
//
// Four asks, all really one: a tenant could see a line and a chip and
// nothing else. What they had picked, when they said it started, what they
// wrote, and whether they had sent a picture were all either thrown away at
// submit or never shown. Editing had the same hole from the other side --
// it offered a title and a textarea, two of the five things they answered.
//
// So this walks it the way a person does: report a problem with a photo on
// it, open it, read back everything that was typed, then correct every
// field and check it took.
//
// Needs the local stack -- see addsub-from-assign-test.mjs.
//
//   node scripts/tenant-report-ui-test.mjs

import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const APP_HOST = process.env.APP_HOST || "cascademanagement.subsub.work";
const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A real PNG on disk for the file input to pick up.
const SHOT = "/tmp/claude-0/tenant-shot.png";
writeFileSync(SHOT, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

// ---- a tenant who can sign in -------------------------------------------
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const S = Date.now().toString(36);
const EMAIL = `uitest.${S}@example.test`;
const pm = await tok("pm@example.test");
await fetch(`${API}/tenants`, { method: "POST",
  headers: { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
  body: JSON.stringify({ propertyId: "p1", firstName: "Uma", lastName: "Reed", email: EMAIL, unit: "3F", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const invite = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
if (!invite) { console.error("no invite link came through the mail stand-in"); process.exit(1); }
await fetch(`${API}/tenant-invite/${invite}`, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", `--host-resolver-rules=MAP *.subsub.work 127.0.0.1`],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1300 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const body = () => page.evaluate(() => document.body.innerText);
const modal = () => page.evaluate(() => document.querySelector(".tn-detail")?.innerText || "");
const hit = (re, sel = "button,a") => page.evaluate((rs, s) => {
  const el = [...document.querySelectorAll(s)].find((e) => new RegExp(rs, "i").test(e.textContent || ""));
  if (!el) return null; el.click(); return (el.textContent || "").trim();
}, re.source, sel);

try {
  console.log("\n-- signing in --");
  await page.goto(`http://${APP_HOST}:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("correct horse battery");
  await page.click(".login-btn");
  await wait(3000);
  ck("the tenant is in", /Hello, Uma/.test(await body()));

  console.log("\n-- the nav says the same thing as the button --");
  const navWords = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => b.textContent.trim())
      .filter((t) => /report a problem|file a report/i.test(t)));
  ck("nothing still says File a report", !navWords.some((t) => /file a report/i.test(t)), navWords.join(" | "));
  ck("and the nav offers Report a problem", navWords.some((t) => /^report a problem$/i.test(t)), navWords.join(" | "));

  console.log("\n-- reporting one, with a photo --");
  await hit(/Report a problem/);
  await wait(1200);
  await page.evaluate(() => [...document.querySelectorAll(".tn-group")].find((g) => /plumb|water|kitchen|bath/i.test(g.textContent))?.click()
    || document.querySelector(".tn-group")?.click());
  await wait(600);
  const picked = await page.evaluate(() => { const b = document.querySelector(".tn-pick"); b?.click(); return b?.textContent.trim(); });
  await wait(700);
  ck("a problem can be picked from the list", !!picked, picked);
  await page.evaluate(() => [...document.querySelectorAll(".tn-when .pick")].find((b) => /few days/i.test(b.textContent))?.click());
  const words = `The tap drips all night ${S}`;
  await page.evaluate((w) => {
    const ta = document.querySelector(".tn-form textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, w); ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, words);
  await wait(300);

  ck("the form offers photos", await page.evaluate(() => !!document.querySelector(".ph-add")), "");
  const input = await page.$(".tn-form input[type=file]");
  ck("with a real file input behind it", !!input);
  await input.uploadFile(SHOT);
  await wait(800);
  ck("the chosen photo previews before anything is sent",
    await page.evaluate(() => document.querySelectorAll(".tn-form .ph-thumb img").length === 1));

  await hit(/Send it/);
  await wait(3000);
  const after = await body();
  ck("it lands on the list", after.includes(picked), picked);
  ck("and the list says a photo came with it", /1 photo\b/.test(after), after.split("\n").find((l) => /photo/.test(l)) || "");

  console.log("\n-- reading it back --");
  await page.evaluate(() => document.querySelector(".tn-row-open")?.click());
  await wait(1800);
  const m = await modal();
  ck("the modal opens on that report", m.includes(picked), m.split("\n")[0]);
  ck("it says which unit", /UNIT\s*\n?3F/.test(m), m.match(/UNIT[\s\S]{0,12}/)?.[0]);
  ck("what they picked", new RegExp(picked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(m));
  ck("when it started", /A few days ago/i.test(m), m.match(/STARTED[\s\S]{0,24}/)?.[0]);
  ck("and what they actually wrote", m.includes(words), words);
  ck("the photo is there and loaded",
    await page.evaluate(() => [...document.querySelectorAll(".tn-detail .ph-thumb img")].some((i) => i.naturalWidth > 0)));

  console.log("\n-- correcting it --");
  ck("a fresh report offers Edit", /Edit/.test(m), m.split("\n").slice(-3).join(" / "));
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail button")].find((b) => /^Edit\b/.test(b.textContent.trim()))?.click());
  await wait(900);
  ck("editing is a modal, not the row", await page.evaluate(() => !!document.querySelector(".tn-detail")) && /Correct your report/i.test(await modal()));
  const fields = await page.evaluate(() => ({
    title: !!document.querySelector(".tn-detail input"),
    problem: !!document.querySelector(".tn-detail .tn-chosen"),
    when: document.querySelectorAll(".tn-detail .tn-when .pick").length,
    words: !!document.querySelector(".tn-detail textarea"),
    photos: document.querySelectorAll(".tn-detail .ph-thumb").length,
  }));
  ck("and carries every field, not two", fields.title && fields.problem && fields.when > 0 && fields.words && fields.photos > 0,
    JSON.stringify(fields));

  const newTitle = `Dripping tap ${S}`;
  await page.evaluate((t) => {
    const el = document.querySelector(".tn-detail input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, t); el.dispatchEvent(new Event("input", { bubbles: true }));
  }, newTitle);
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail .tn-when .pick")].find((b) => /today/i.test(b.textContent))?.click());
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail button")].find((b) => /Save changes/i.test(b.textContent))?.click());
  await wait(2500);
  const saved = await modal();
  ck("the new title took", saved.includes(newTitle), saved.split("\n")[0]);
  ck("and so did the new start", /Today/.test(saved), saved.match(/STARTED[\s\S]{0,18}/)?.[0]);

  // It has to survive a reload, not just a re-render.
  await page.reload({ waitUntil: "networkidle0" });
  await wait(2800);
  ck("it is still there after a reload", (await body()).includes(newTitle));

  console.log("\n-- once a contractor is booked --");
  const jobs = await (await fetch(`${API}/jobs`, { headers: { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT } })).json();
  const job = jobs.find((j) => j.title === newTitle);
  ck("the manager can see the report", !!job, newTitle);
  const hdr = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
  await fetch(`${API}/jobs/${job.id}/approve`, { method: "POST", headers: hdr });
  const asg = await fetch(`${API}/jobs/${job.id}/assign`, { method: "POST", headers: hdr,
    body: JSON.stringify({ trade: job.trades[0] || "plumbing", companyId: "cmp_r", responseWindow: "24h" }) });
  ck("and put a contractor on it", asg.status === 201, String(asg.status));
  await page.reload({ waitUntil: "networkidle0" });

  await wait(2800);
  await page.evaluate(() => document.querySelector(".tn-row-open")?.click());
  await wait(1500);
  const booked = await modal();
  ck("withdraw is no longer offered", !/Withdraw/i.test(booked), booked.split("\n").slice(-4).join(" / "));
  ck("and it says who to ask instead", /no longer yours to take back/i.test(booked),
    booked.split("\n").find((l) => /take back/i.test(l)) || "nothing said");

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/tn-ui-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
