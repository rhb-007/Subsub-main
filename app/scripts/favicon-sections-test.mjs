// Two things the app never had: an icon, and a way to fold its sections.
//
// The app's HTML carried no icon links at all -- the files existed only at
// the marketing site's root -- so app.subsub.work, every customer's
// subdomain, and every sign-in and application form showed the browser's
// blank default tab. They are served from the build now, at absolute paths
// so a branded subdomain resolves them the same way.
//
// And the tenant's dashboard had one hand-built toggle on Past reports and
// nothing on the section above it. Two reports fit on a phone; a year of
// them does not. Both fold now, and stay folded.
//
//   node scripts/favicon-sections-test.mjs

import puppeteer from "puppeteer-core";
import { statSync } from "node:fs";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Declared icons, and whether each one is really there. A link tag pointing
// at a 404 is worse than no link tag: it looks done.
const icons = (page) => page.evaluate(async () => {
  const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')];
  const out = [];
  for (const l of links) {
    let status = 0, bytes = 0;
    try {
      const r = await fetch(l.href);
      status = r.status;
      bytes = (await r.arrayBuffer()).byteLength;
    } catch { /* recorded as 0 */ }
    out.push({ rel: l.getAttribute("rel"), href: new URL(l.href).pathname, status, bytes });
  }
  return out;
});

const onDisk = (name) => { try { return statSync(`dist/${name}`).size; } catch { return -1; } };

try {
  for (const [label, url] of [
    ["the generic app", `http://127.0.0.1:${PORT}/`],
    ["a customer's subdomain", `http://cascademanagement.subsub.work:${PORT}/`],
    ["the application form", `http://cascademanagement.subsub.work:${PORT}/?apply=1`],
  ]) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    await wait(1200);
    const got = await icons(page);
    console.log(`\n-- ${label} --`);
    ck("it declares an icon at all", got.some((g) => /icon/.test(g.rel)), `${got.length} link tags`);
    ck("every icon it names really is there",
      got.length > 0 && got.every((g) => g.status === 200 && g.bytes > 0),
      got.filter((g) => g.status !== 200 || !g.bytes).map((g) => `${g.href} → ${g.status}`).join(" ; ") || `${got.length} fetched`);
    const ico = got.find((g) => g.href.endsWith("favicon.ico"));
    ck("and the bytes are the real file, not the app's HTML",
      !!ico && ico.bytes === onDisk("favicon.ico"),
      `${ico?.bytes} served vs ${onDisk("favicon.ico")} on disk`);
    ck("the paths are absolute, so a subdomain resolves them the same",
      got.every((g) => g.href.startsWith("/")), got.map((g) => g.href).join(" "));
    await page.close();
  }

  // ---- the folding sections ---------------------------------------------
  console.log("\n-- a tenant with history --");
  const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
  const pm = await tok("pm@example.test");
  const S = Date.now().toString(36);
  const EMAIL = `fold.${S}@example.test`;
  const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
  await fetch(`${API}/tenants`, { method: "POST", headers: H,
    body: JSON.stringify({ propertyId: "p1", firstName: "Nils", lastName: "Aker", email: EMAIL, unit: "8B", channels: ["email"] }) });
  const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
  const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
  await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "correct horse battery" }) });
  const tn = await tok(EMAIL);
  const mk = async (title) => (await (await fetch(`${API}/jobs`, { method: "POST",
    headers: { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
    body: JSON.stringify({ title, propertyId: "p1", address: "101 Main St", trades: [] }) })).json()).id;
  const live = await mk(`Still open ${S}`);
  const gone = await mk(`Long done ${S}`);
  await fetch(`${API}/jobs/${gone}/withdraw`, { method: "POST",
    headers: { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
    body: JSON.stringify({ note: "sorted itself" }) });
  ck("the fixture has one open and one closed", !!live && !!gone);

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://cascademanagement.subsub.work:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("correct horse battery");
  await page.click(".login-btn");
  await wait(3000);

  const secs = () => page.evaluate(() => [...document.querySelectorAll(".tn-sec")].map((s) => ({
    title: s.querySelector(".tn-sec-title")?.textContent.trim(),
    count: s.querySelector(".sec-count")?.textContent.trim(),
    open: s.querySelector(".tn-sec-head")?.getAttribute("aria-expanded") === "true",
    rows: s.querySelectorAll(".tn-row").length,
  })));
  let state = await secs();
  ck("there are two sections", state.length === 2, JSON.stringify(state));
  ck("the open one is open, and counted", state[0]?.open && state[0].count === "1" && state[0].rows === 1, JSON.stringify(state[0]));
  ck("past reports start folded away", state[1]?.open === false && state[1].rows === 0, JSON.stringify(state[1]));
  ck("but say how many are in there", state[1]?.count === "1", state[1]?.count);

  console.log("\n-- folding --");
  const click = (i) => page.evaluate((n) => document.querySelectorAll(".tn-sec-head")[n]?.click(), i);
  await click(0); await wait(400);
  state = await secs();
  ck("the open section folds", state[0].open === false && state[0].rows === 0, JSON.stringify(state[0]));
  await click(1); await wait(400);
  state = await secs();
  ck("and the past one unfolds", state[1].open === true && state[1].rows === 1, JSON.stringify(state[1]));

  console.log("\n-- and it stays that way --");
  await page.reload({ waitUntil: "networkidle0" });
  await wait(3000);
  state = await secs();
  ck("what was folded is still folded after a reload", state[0]?.open === false, JSON.stringify(state[0]));
  ck("and what was opened is still open", state[1]?.open === true, JSON.stringify(state[1]));

  // The whole header, not just the chevron: on a phone 15 pixels is not a target.
  const head = await page.evaluate(() => {
    const h = document.querySelector(".tn-sec-head");
    const r = h.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), tag: h.tagName,
      controls: !!h.getAttribute("aria-controls") };
  });
  ck("the header is the control, and a reachable one",
    head.tag === "BUTTON" && head.w > 200 && head.h >= 24, JSON.stringify(head));
  ck("and it says what it controls", head.controls);
  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
  await page.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
