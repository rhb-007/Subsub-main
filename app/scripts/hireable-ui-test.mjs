// The two screens that came out of "an account is a company too", and the
// three logs at the bottom of the console's account drawer.
//
// An account settings page that says "you hire contractors here" and stops
// there is the whole reason a general contractor could not work out where
// their QR code was: there was nothing of theirs to put one on. Now there
// is, and this is where they fill it in and show it.
//
// And the console drawer ends in three logs that all grow forever. Open by
// default they pushed the plan and the seats -- the things staff open the
// drawer to change -- off the bottom of a screen already scrolling.
//
// Needs the local stack, app dist on 5191 and the console on 5192, and
// migration 031 run against the local database.
//
//   node scripts/hireable-ui-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const APP = process.env.APP_PORT || "5191";
const CONSOLE = process.env.CONSOLE_PORT || "5192";
const HOST = "cascademanagement.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const S = Date.now().toString(36);
const staffEmail = `hs.${S}@subsub.test`, staffId = `usr_hs_${S}`;
d1(`INSERT INTO users (id, name, email) VALUES ('${staffId}', 'Console Staff', '${staffEmail}');`);
d1(`INSERT INTO superadmins (user_id, role, finance, impersonate) VALUES ('${staffId}', 'superadmin', 1, 0);`);

try {
  // ---- the account's own company profile ---------------------------------
  console.log("\n-- a general contractor's own settings --");
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1500 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(900);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6500);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^My account/i.test(b.innerText.trim()))?.click());
  await wait(1800);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^Company$/i.test(b.innerText.trim()))?.click());
  await wait(2600);

  const panel = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".settings-panel")]
      .find((x) => /Working as a subcontractor/i.test(x.textContent));
    if (!p) return null;
    const qr = p.querySelector(".cx-code svg");
    return {
      fields: [...p.querySelectorAll(".fld")].map((l) => l.childNodes[0]?.textContent?.trim()),
      state: p.querySelector(".hire-state")?.innerText.trim() || "",
      stateKind: p.querySelector(".hire-state")?.className || "",
      qr: !!qr, qrPaths: qr ? qr.querySelectorAll("path").length : 0,
      code: p.querySelector(".cx-code-txt")?.textContent.trim() || "",
      saveDisabled: [...p.querySelectorAll("button")].find((b) => /Save profile/.test(b.textContent))?.disabled,
      text: p.innerText,
    };
  });
  ck("the panel is there", !!panel, String(panel));
  // The reported symptom: "I don't see any QR or connect feature in my account".
  ck("with a QR code on it", panel.qr && panel.qrPaths > 0, `${panel.qrPaths} paths`);
  ck("and the code in words too", /^[0-9A-Z]{10}$/.test(panel.code), panel.code);
  ck("it asks for the three things a search matches on",
    ["Email", "Mobile", "Licence number"].every((l) => panel.fields.includes(l)),
    panel.fields.join(" | "));
  // A profile with none of them is findable by nobody, and nothing else on
  // the page would ever say so.
  ck("and says plainly whether anybody can find them",
    /Nobody can find you yet|can find you by the details/i.test(panel.state), panel.state.slice(0, 70));
  ck("marked as a state, not just prose",
    /hire-state (on|off)/.test(panel.stateKind), panel.stateKind);
  ck("Save is held until something changes", panel.saveDisabled === true);
  ck("it says what this is for", /can also be hired/i.test(panel.text),
    panel.text.split("\n").slice(0, 3).join(" / "));
  ck("and where a request would land", /Asking to work with you/i.test(panel.text));

  // Typing an address unlocks Save, which is the only way to become findable.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll(".settings-panel")]
      .find((x) => /Working as a subcontractor/i.test(x.textContent));
    const email = [...p.querySelectorAll(".fld")].find((l) => /^Email/.test(l.childNodes[0]?.textContent || ""))
      ?.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(email, "work@sanjuan.test");
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(600);
  const unlocked = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".settings-panel")]
      .find((x) => /Working as a subcontractor/i.test(x.textContent));
    return [...p.querySelectorAll("button")].find((b) => /Save profile/.test(b.textContent))?.disabled;
  });
  ck("and unlocks once there is something to save", unlocked === false);
  ck("nothing threw on that page", crashes.length === 0, crashes.join(" ; "));
  await ctx.close();

  // ---- the console drawer's logs -----------------------------------------
  console.log("\n-- the console's account drawer --");
  const cctx = await browser.createBrowserContext();
  const cp = await cctx.newPage();
  await cp.setViewport({ width: 1280, height: 1500 });
  const cCrashes = [];
  cp.on("pageerror", (e) => cCrashes.push(e.message));
  await cp.goto(`http://127.0.0.1:${CONSOLE}/`, { waitUntil: "domcontentloaded" });
  await wait(2500);
  await cp.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /use a password/i.test(b.innerText))?.click());
  await cp.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(800);
  await cp.type("input[type=email]", staffEmail);
  await cp.type("input[type=password]", "correct horse battery");
  await cp.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Sign in$/.test(b.innerText.trim()))?.click());
  await wait(7000);
  await cp.evaluate(() => [...document.querySelectorAll(".pf-nav button, nav button")]
    .find((b) => /^Accounts/i.test(b.innerText.trim()))?.click());
  await wait(2000);
  await cp.evaluate(() => document.querySelector(".pf-company-card .pfc-top, .pfc-top")?.click());
  await wait(2500);

  const folds = await cp.evaluate(() => {
    const f = [...document.querySelectorAll(".pf-fold")];
    return f.map((x) => ({
      title: x.querySelector(".pf-fold-btn h3")?.textContent.trim(),
      open: x.classList.contains("open"),
      expanded: x.querySelector(".pf-fold-btn")?.getAttribute("aria-expanded"),
      bodyRows: x.querySelectorAll(".pf-act-row, .pf-line, .pf-mail-row").length,
      height: Math.round(x.getBoundingClientRect().height),
    }));
  });
  // Guarded: every assertion below is an .every() over this list, and an
  // empty one passes the lot without looking at anything.
  ck("the drawer's logs are folds", folds.length >= 3, folds.map((f) => f.title).join(" | "));
  if (folds.length < 3) throw new Error("the account drawer never opened -- nothing below would be testing anything");
  ck("mail, activity and subscriptions among them",
    ["Email sent to this account", "User activity", "Subscription history"]
      .every((t) => folds.some((f) => f.title === t)), folds.map((f) => f.title).join(" | "));
  // The complaint: "the length will get out of hand".
  ck("every one of them starts shut", folds.every((f) => !f.open),
    folds.map((f) => `${f.title}:${f.open}`).join(" | "));
  ck("saying so to a screen reader too", folds.every((f) => f.expanded === "false"),
    folds.map((f) => f.expanded).join(", "));
  // Shut means not rendered, not merely hidden -- a closed log should not be
  // drawing four hundred rows nobody is looking at.
  ck("and none of them is drawing rows", folds.every((f) => f.bodyRows === 0),
    folds.map((f) => f.bodyRows).join(", "));
  ck("so each is a row rather than a page", folds.every((f) => f.height < 90),
    folds.map((f) => f.height).join(", "));

  const opened = await cp.evaluate(async () => {
    const f = [...document.querySelectorAll(".pf-fold")]
      .find((x) => /User activity/.test(x.textContent));
    f.querySelector(".pf-fold-btn").click();
    await new Promise((r) => setTimeout(r, 700));
    return {
      open: f.classList.contains("open"),
      rows: f.querySelectorAll(".pf-act-row").length,
      height: Math.round(f.getBoundingClientRect().height),
      filter: !!f.querySelector("select"),
    };
  });
  ck("one opens when asked", opened.open === true);
  ck("and fills up", opened.rows > 0 && opened.height > 120, `${opened.rows} rows, ${opened.height}px`);
  ck("with its filter, which only appears when it is open", opened.filter === true);

  // Left open, it stays open -- staff who live in the activity log should
  // not have to reopen it daily.
  await cp.reload({ waitUntil: "domcontentloaded" });
  await wait(8000);
  await cp.evaluate(() => [...document.querySelectorAll(".pf-nav button, nav button")]
    .find((b) => /^Accounts/i.test(b.innerText.trim()))?.click());
  await wait(1800);
  await cp.evaluate(() => document.querySelector(".pf-company-card .pfc-top, .pfc-top")?.click());
  await wait(2500);
  const remembered = await cp.evaluate(() => {
    const f = [...document.querySelectorAll(".pf-fold")];
    return f.map((x) => ({ title: x.querySelector(".pf-fold-btn h3")?.textContent.trim(),
      open: x.classList.contains("open") }));
  });
  const act = remembered.find((f) => /User activity/.test(f.title || ""));
  ck("it is still open on the way back", act?.open === true, JSON.stringify(remembered));
  ck("and the ones nobody opened are still shut",
    remembered.filter((f) => !/User activity/.test(f.title || "")).every((f) => !f.open),
    JSON.stringify(remembered));
  ck("nothing threw in the console", cCrashes.length === 0, cCrashes.slice(0, 2).join(" ; "));
  await cctx.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  try {
    d1(`DELETE FROM activity WHERE user_id = '${staffId}'`);
    d1(`DELETE FROM superadmins WHERE user_id = '${staffId}'`);
    d1(`DELETE FROM users WHERE id = '${staffId}'`);
  } catch (e) { console.log("cleanup:", String(e.message).slice(0, 70)); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
