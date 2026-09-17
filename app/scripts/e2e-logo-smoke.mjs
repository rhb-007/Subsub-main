// Smoke test for account logo upload: sign in as admin, upload a logo
// through the real <input type=file> in Account > Company, reload, and
// confirm the persisted logo (served from /api/logo/:accountId) still
// renders — proving the upload, the DB write, and the public serving
// endpoint all actually work together, not just each in isolation.
import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";

const log = (...a) => console.log("[e2e-logo]", ...a);
const testFile = "/tmp/claude-0/-home-user-Subsub-main/6d131209-b8ee-5b87-9e93-429b66083c27/scratchpad/test-logo.png";
// Minimal valid-enough PNG header + junk bytes — good enough to round-trip through R2.
writeFileSync(testFile, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082", "hex"));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("pageerror", (err) => log("PAGE ERROR:", err.message, "\n", err.stack));

try {
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  // Ross Mather / Harbor Point Builders is on the Scale plan — branding
  // (and so the logo uploader) is a Scale-only feature, hidden on Basic.
  const rows = await page.$$(".ld-row");
  for (const row of rows) {
    const text = await row.evaluate((el) => el.textContent);
    if (text.includes("Ross Mather")) { await row.click(); break; }
  }
  await page.waitForSelector(".ss-header", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));
  log("logged in as Ross Mather (admin, Harbor Point Builders — Scale plan)");

  // Open the user menu, then My account -> Company pane, where the logo
  // uploader lives.
  await page.click(".user-btn");
  await new Promise((r) => setTimeout(r, 300));
  const openedMyAccount = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")];
    const btn = els.find((e) => /my account/i.test(e.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  log("opened My account:", openedMyAccount);
  await new Promise((r) => setTimeout(r, 400));
  const wentToCompany = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")];
    const btn = els.find((e) => e.textContent.trim() === "Company");
    if (btn) { btn.click(); return true; }
    return false;
  });
  log("opened Company pane:", wentToCompany);
  await new Promise((r) => setTimeout(r, 400));

  const fileInput = await page.$('input[type=file][accept*="image"]');
  if (!fileInput) throw new Error("no logo file input found");
  await fileInput.uploadFile(testFile);
  log("uploaded logo via real <input type=file>");
  await new Promise((r) => setTimeout(r, 1500)); // let the async R2 PUT + patchAccount finish

  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));

  // The logo renders as <img src="/api/logo/a1"> somewhere in the header once persisted.
  const logoImgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find((i) => i.src.includes("/api/logo/"));
    return img ? img.src : null;
  });
  log("logo <img> src after reload:", logoImgSrc);

  let servesOk = false;
  if (logoImgSrc) {
    const res = await page.evaluate(async (src) => {
      const r = await fetch(src);
      return { status: r.status, contentType: r.headers.get("content-type") };
    }, logoImgSrc);
    log("GET on logo URL:", JSON.stringify(res));
    servesOk = res.status === 200 && (res.contentType || "").startsWith("image/");
  }

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({ wentToCompany, logoImgSrc, servesOk }, null, 2));
  if (!logoImgSrc || !servesOk) process.exitCode = 1;
} catch (err) {
  console.error("[e2e-logo] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
