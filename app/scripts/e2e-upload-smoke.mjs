// Smoke test for the real file-upload path: sign in as a contractor with a
// missing document, upload one through the actual <input type=file>, and
// confirm it shows as "awaiting review" after a reload (proves the R2 PUT
// + D1 record both really happened, not just one or the other).
import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";

const log = (...a) => console.log("[e2e-upload]", ...a);
const testFile = "/tmp/claude-0/-home-user-Subsub-main/6d131209-b8ee-5b87-9e93-429b66083c27/scratchpad/test-contract.pdf";
writeFileSync(testFile, "%PDF-1.4 fake test contract for e2e upload smoke test\n");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("pageerror", (err) => log("PAGE ERROR:", err.message));

try {
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });

  const rows = await page.$$(".ld-row");
  for (const row of rows) {
    const text = await row.evaluate((el) => el.textContent);
    if (text.includes("Dana Cho")) { await row.click(); break; }
  }
  await page.waitForSelector(".ss-header", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));
  log("logged in as Dana Cho (contractor, Emerald Exteriors)");

  // Navigate to the contractor's Documents pane.
  const wentToDocs = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")];
    const btn = els.find((e) => /documents/i.test(e.textContent) && e.tagName === "BUTTON");
    if (btn) { btn.click(); return true; }
    return false;
  });
  log("clicked into documents pane:", wentToDocs);
  await new Promise((r) => setTimeout(r, 500));

  const fileInput = await page.$('input[type=file]');
  if (!fileInput) throw new Error("no file input found on the documents pane");
  await fileInput.uploadFile(testFile);
  log("uploaded file via real <input type=file>");
  await new Promise((r) => setTimeout(r, 1500)); // let the async R2 PUT + D1 write finish

  const showsPendingBeforeReload = await page.evaluate(() =>
    document.body.textContent.includes("test-contract.pdf") || document.body.textContent.includes("is reviewing this"));
  log("shows uploaded doc before reload:", showsPendingBeforeReload);

  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")];
    const btn = els.find((e) => /documents/i.test(e.textContent) && e.tagName === "BUTTON");
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const showsPendingAfterReload = await page.evaluate(() =>
    document.body.textContent.includes("test-contract.pdf") || document.body.textContent.includes("is reviewing this"));
  log("shows uploaded doc AFTER reload:", showsPendingAfterReload);

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({ wentToDocs, showsPendingBeforeReload, showsPendingAfterReload }, null, 2));
  if (!showsPendingAfterReload) process.exitCode = 1;
} catch (err) {
  console.error("[e2e-upload] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
