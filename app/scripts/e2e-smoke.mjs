// Smoke test: signs in, creates a job, reloads the page, and confirms the
// session AND the job survive — the actual point of Phase 1 persistence.
// Requires both dev servers running first (see app/README.md):
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   npm run dev
//
// executablePath below is this sandbox's pinned Chromium. On a real machine,
// either point it at your own Chrome/Chromium install, or swap the
// `puppeteer-core` dependency for `puppeteer` (which bundles a browser).
import puppeteer from "puppeteer-core";

const log = (...a) => console.log("[e2e]", ...a);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("console", (msg) => { if (msg.type() === "error") log("BROWSER CONSOLE ERROR:", msg.text()); });
page.on("pageerror", (err) => log("BROWSER PAGE ERROR:", err.message));

try {
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  log("loaded login page");

  // Click the "Richard Braun" demo login row (admin @ Outerhome).
  await page.waitForSelector(".ld-row");
  const rows = await page.$$(".ld-row");
  let clicked = false;
  for (const row of rows) {
    const text = await row.evaluate((el) => el.textContent);
    if (text.includes("Richard Braun")) { await row.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error("Richard Braun demo row not found");
  log("clicked demo login for Richard Braun");

  await page.waitForSelector(".ss-header", { timeout: 10000 });
  log("logged in, header rendered");

  await new Promise((r) => setTimeout(r, 1500)); // let hydrateAccount finish

  const localStorageAuth = await page.evaluate(() => localStorage.getItem("subsub.auth"));
  log("localStorage auth:", localStorageAuth);

  // Go to Jobs tab and open "New job".
  const tabButtons = await page.$$("nav.top a, nav.top button, .ss-tabs button, [class*=tab]");
  // Simpler: click by visible text "Jobs" in the header nav.
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")];
    const jobsBtn = els.find((e) => e.textContent.trim() === "Jobs");
    if (jobsBtn) jobsBtn.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  const jobTitle = `E2E test job ${Date.now()}`;
  const opened = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")];
    const addBtn = els.find((e) => /new job|add job|create job/i.test(e.textContent));
    if (addBtn) { addBtn.click(); return true; }
    return false;
  });
  log("opened new-job form:", opened);
  await new Promise((r) => setTimeout(r, 300));

  // Fill the job form (JobForm component fields).
  const filled = await page.evaluate((title) => {
    const inputs = [...document.querySelectorAll("input")];
    const nameInput = inputs.find((i) => i.placeholder?.includes("full exterior"));
    const addrInput = inputs.find((i) => i.placeholder === "1420 Maple St");
    if (!nameInput || !addrInput) return false;
    const setVal = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(nameInput, title);
    setVal(addrInput, "999 Test Ave");
    const tradeBtn = document.querySelector("button.pick");
    if (tradeBtn) tradeBtn.click();
    return true;
  }, jobTitle);
  log("filled job form:", filled);
  await new Promise((r) => setTimeout(r, 200));

  const submitted = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")];
    const btn = els.find((e) => /create job/i.test(e.textContent));
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
  log("submitted job form:", submitted);
  await new Promise((r) => setTimeout(r, 1000));

  const foundBeforeReload = await page.evaluate((title) =>
    document.body.textContent.includes(title), jobTitle);
  log("job visible before reload:", foundBeforeReload);

  // The real test: reload the page and confirm the session AND the job survive.
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));

  const loggedInAfterReload = await page.evaluate(() => !!document.querySelector(".ss-header"));
  log("still logged in after reload:", loggedInAfterReload);

  await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")];
    const jobsBtn = els.find((e) => e.textContent.trim() === "Jobs");
    if (jobsBtn) jobsBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const foundAfterReload = await page.evaluate((title) =>
    document.body.textContent.includes(title), jobTitle);
  log("job visible AFTER reload:", foundAfterReload);

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({ clicked, foundBeforeReload, loggedInAfterReload, foundAfterReload }, null, 2));

  if (!loggedInAfterReload || !foundAfterReload) {
    process.exitCode = 1;
  }
} catch (err) {
  console.error("[e2e] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
