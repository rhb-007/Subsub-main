// The two emergency paths, as a person actually meets them.
//
// The half that matters most here is the one the API cannot check. A
// maintenance form that accepts "there's a fire" with a cheerful "sent!" is
// worse than one that refuses it: somebody could stand in a smoke-filled
// hallway waiting for a plumber. So the notice has to appear before
// anything else, has to say plainly that sending a report is not calling
// for help, and must still let them report it once they are safe.
//
//   node scripts/emergency-ui-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const HOST = "cascademanagement.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

const S = Date.now().toString(36);
const EMAIL = `alarm.${S}@example.test`;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
await fetch(`${API}/account`, { method: "PATCH", headers: H, body: JSON.stringify({ emergencyCompanyId: null }) });
await fetch(`${API}/tenants`, { method: "POST", headers: H,
  body: JSON.stringify({ propertyId: "p1", firstName: "Tess", lastName: "Oduya", email: EMAIL, unit: "6D", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "correct horse battery" }) });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));
const body = () => page.evaluate(() => document.body.innerText);

// Pick a problem by its exact label, through the search box, as a person would.
const choose = async (label) => {
  await page.evaluate(() => {
    const el = document.querySelector(".tn-search");
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate((l) => {
    const el = document.querySelector(".tn-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, l.slice(0, 18)); el.dispatchEvent(new Event("input", { bubbles: true }));
  }, label);
  await wait(500);
  return page.evaluate((l) => {
    const b = [...document.querySelectorAll(".tn-pick")].find((x) => x.textContent.includes(l.slice(0, 18)));
    if (!b) return null; b.click(); return b.textContent.trim();
  }, label);
};

try {
  console.log("\n-- signing in --");
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("correct horse battery");
  await page.click(".login-btn");
  await wait(3000);
  ck("the tenant is in", /Hello, Tess/.test(await body()));

  console.log("\n-- picking a fire --");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Report a problem/.test(b.textContent))?.click());
  await wait(1200);
  const fire = await choose("There's a fire, or I can smell smoke");
  ck("the fire is in the list at all", !!fire, fire || "not found");
  await wait(700);

  const sos = await page.evaluate(() => {
    const el = document.querySelector(".sos");
    if (!el) return null;
    const call = el.querySelector(".sos-call");
    return { text: el.innerText, role: el.getAttribute("role"),
      callsOut: call?.getAttribute("href"), top: Math.round(el.getBoundingClientRect().top) };
  });
  ck("a notice appears straight away", !!sos, sos ? "" : "no .sos");
  ck("it says to call 911", /call 911/i.test(sos.text), sos.text.split("\n")[0]);
  ck("and offers to dial it", sos.callsOut === "tel:911", sos.callsOut);
  ck("it says to get somewhere safe first", /somewhere safe/i.test(sos.text));
  // The sentence this whole feature exists for.
  ck("and says plainly that sending this is not calling for help",
    /not the same as calling for help/i.test(sos.text) && /nobody is watching it/i.test(sos.text),
    sos.text.split("\n").find((l) => /not/i.test(l)) || "");
  ck("it is announced, not just coloured", sos.role === "alert", sos.role);

  console.log("\n-- and the form gets out of the way --");
  const hidden = await page.evaluate(() => ({
    textarea: !!document.querySelector(".tn-form textarea"),
    photos: !!document.querySelector(".ph-add"),
    sendDisabled: [...document.querySelectorAll(".tn-form .form-actions button")]
      .find((b) => /Send it/.test(b.textContent))?.disabled,
  }));
  ck("the rest of the form is not shown yet", !hidden.textarea && !hidden.photos, JSON.stringify(hidden));
  ck("and it cannot be sent by mistake", hidden.sendDisabled === true, String(hidden.sendDisabled));

  console.log("\n-- but it never refuses the report --");
  await page.evaluate(() => [...document.querySelectorAll(".sos-actions button")].find((b) => /I'm safe/i.test(b.textContent))?.click());
  await wait(700);
  const after = await page.evaluate(() => ({
    still: !!document.querySelector(".sos"),
    textarea: !!document.querySelector(".tn-form textarea"),
    sendDisabled: [...document.querySelectorAll(".tn-form .form-actions button")]
      .find((b) => /Send it/.test(b.textContent))?.disabled,
  }));
  ck("saying they are safe opens the rest of it", after.textarea === true, JSON.stringify(after));
  ck("the notice stays on screen", after.still === true);
  ck("and it can be sent now", after.sendDisabled === false, String(after.sendDisabled));

  console.log("\n-- picking something else clears the acknowledgement --");
  await page.evaluate(() => document.querySelector(".tn-chosen .tn-change")?.click());
  await wait(500);
  await choose("I can smell gas");
  await wait(700);
  const second = await page.evaluate(() => ({
    sos: !!document.querySelector(".sos"),
    textarea: !!document.querySelector(".tn-form textarea"),
  }));
  ck("a second emergency shows its own notice", second.sos === true);
  ck("and is not waved through by the first", second.textarea === false, JSON.stringify(second));

  console.log("\n-- an urgent one is different --");
  await page.evaluate(() => document.querySelector(".tn-chosen .tn-change")?.click());
  await wait(500);
  const burst = await choose("A pipe has burst");
  await wait(700);
  const urg = await page.evaluate(() => {
    const el = document.querySelector(".urg");
    return { text: el?.innerText || "", sos: !!document.querySelector(".sos"),
      textarea: !!document.querySelector(".tn-form textarea") };
  });
  ck("the burst pipe is in the list", !!burst, burst || "not found");
  ck("it gets a quieter notice, not the 911 one", !!urg.text && urg.sos === false, urg.text.slice(0, 70));
  ck("which says it goes ahead of everything else", /ahead of everything else/i.test(urg.text));
  ck("and the form is open straight away", urg.textarea === true);

  console.log("\n-- an ordinary problem gets neither --");
  await page.evaluate(() => document.querySelector(".tn-chosen .tn-change")?.click());
  await wait(500);
  await choose("A faucet is dripping");
  await wait(700);
  ck("no notices at all", await page.evaluate(() => !document.querySelector(".sos") && !document.querySelector(".urg")));

  console.log("\n-- what the manager sees --");
  // Send the fire through the API so the dashboard has one to show.
  const tn = await tok(EMAIL);
  const TITLE = `Smoke in the hallway ${S}`;
  await fetch(`${API}/jobs`, { method: "POST",
    headers: { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
    body: JSON.stringify({ title: TITLE, propertyId: "p1", address: "101 Main St", trades: [],
      reportDetail: { problem: "There's a fire, or I can smell smoke", started: "Today", words: "", unit: "6D" } }) });
  const mgr = await browser.newPage();
  await mgr.setViewport({ width: 1200, height: 1100 });
  await mgr.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
  await mgr.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await mgr.$("input[type=email]")).type("pm@example.test");
  await (await mgr.$("input[type=password]")).type("x");
  await mgr.click(".login-btn");
  await wait(3500);
  const sec = await mgr.evaluate((t) => {
    const s = document.querySelector(".sec-sos");
    if (!s) return null;
    const rows = [...s.querySelectorAll(".dash-row")];
    return { heading: s.querySelector("h3")?.innerText.trim(), hasIt: s.innerText.includes(t),
      first: rows[0]?.innerText.replace(/\n/g, " · ").slice(0, 120),
      chip: rows.find((r) => r.innerText.includes(t))?.querySelector(".tn-chip")?.textContent.trim(),
      aboveTheRest: (() => {
        const all = [...document.querySelectorAll(".dash-sec")];
        return all.indexOf(s) === 0;
      })() };
  }, TITLE);
  ck("there is an emergency section", !!sec, sec ? "" : "no .sec-sos");
  ck("it is the first thing on the page", sec.aboveTheRest === true);
  ck("the fire is in it", sec.hasIt === true, sec.first);
  ck("marked as life safety", sec.chip === "Life safety", sec.chip);
  ck("and it says nothing was dispatched",
    /not something this can call/i.test(await mgr.evaluate(() => document.querySelector(".sec-sos")?.innerText || "")));
  await mgr.close();

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/em-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
