// The branded pages a subcontractor and a tenant actually land on.
//
// Two complaints, both about words doing a job a mark does better. The
// application form explained which fields were required in a sentence under
// the buttons, a long way from the boxes it was talking about. And the
// branded sign-in carried a "For tenants" note explaining that tenants sign
// in with the form directly above it, which reads as a warning that
// something is unusual about a perfectly ordinary sign-in box.
//
// Needs the local stack, and a branded host -- see poweredby-contrast-test.
//
//   node scripts/apply-form-test.mjs

import puppeteer from "puppeteer-core";

const HOST = process.env.APP_HOST || "cascademanagement.subsub.work";
const PORT = process.env.APP_PORT || "5191";
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const text = () => page.evaluate(() => document.body.innerText);
// Which fields carry the mark, read off the page rather than off the source.
const marked = () => page.evaluate(() =>
  [...document.querySelectorAll(".wl-card .req")]
    .filter((r) => !r.closest(".wl-req-key"))
    .map((r) => (r.parentElement.childNodes[0]?.textContent || r.parentElement.textContent || "").trim()));

try {
  console.log("\n-- the branded sign-in --");
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "networkidle0" });
  await wait(2000);
  const signin = await text();
  ck("it is the customer's page", /Cascade Management/i.test(signin), signin.split("\n")[0]);
  ck("the For tenants block is gone", !/for tenants/i.test(signin));
  ck("and so is the paragraph it carried", !/invited you at/i.test(signin));
  ck("the sign-in form itself is untouched",
    await page.evaluate(() => !!document.querySelector("input[type=password]") && !!document.querySelector(".login-btn")));
  // This used to assert that "Already invited? Create your password" was
  // offered here. It was, and it had to be, because none of the three
  // invites sent anything -- that line was the only way in for anybody an
  // account had added. All three send now and every one ends on a screen
  // that takes a password, so the line is gone on purpose and its absence
  // is the thing worth holding. What remains is the way back for somebody
  // who has a login and cannot get at it.
  ck("the line explaining invites to people looking at a sign-in box is gone",
    !/Create your password/i.test(signin),
    signin.split("\n").filter((l) => /password/i.test(l)).join(" / "));
  ck("and forgotten passwords are still catered for", /Forgot password/i.test(signin));

  console.log("\n-- the application form --");
  await page.goto(`http://${HOST}:${PORT}/?apply=1`, { waitUntil: "networkidle0" });
  await wait(2000);
  const apply = await text();
  ck("it is the apply form", /Work with Cascade Management/i.test(apply), apply.split("\n").find((l) => /Work with/.test(l)));
  ck("the sentence naming the required fields is gone",
    !/your name and an email are needed/i.test(apply), apply.split("\n").slice(-3).join(" / "));
  const key = apply.split("\n").find((l) => /Required/i.test(l)) || "";
  ck("a key sits at the foot of it instead", /\*\s*Required/i.test(key), key || "no key");
  ck("and it is the mark and the word, with nothing between them", !key.includes("="), key);

  console.log("\n-- what is marked, and what is not --");
  const step1 = await marked();
  ck("company name is marked", step1.some((t) => /^Company name/i.test(t)), step1.join(" | "));
  ck("their name is marked", step1.some((t) => /^Your name/i.test(t)), step1.join(" | "));
  ck("email is marked", step1.some((t) => /^Email/i.test(t)), step1.join(" | "));
  ck("mobile is not, because it is not required", !step1.some((t) => /^Mobile/i.test(t)), step1.join(" | "));
  ck("nor is the licence", !step1.some((t) => /license/i.test(t)), step1.join(" | "));
  ck("exactly three marks on this step", step1.length === 3, String(step1.length));

  // And the mark says what it means to something that cannot see it.
  ck("each mark is announced as required, not as a star", await page.evaluate(() =>
    [...document.querySelectorAll(".wl-card .req")].every((r) =>
      r.getAttribute("aria-label") === "required" || r.getAttribute("title") === "Required")));

  console.log("\n-- it still refuses an unfinished step --");
  ck("Continue starts disabled", await page.evaluate(() =>
    [...document.querySelectorAll(".wl-actions button")].find((b) => /Continue/i.test(b.textContent))?.disabled === true));
  const type = async (label, v) => page.evaluate((l, val) => {
    const fld = [...document.querySelectorAll(".wl-fld")].find((f) => new RegExp("^" + l, "i").test(f.innerText.trim()));
    const el = fld?.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
  }, label, v);
  await type("Company name", "Harbour Roofing");
  await type("Your name", "Pat Rowe");
  await type("Email", "pat@example.test");
  await wait(400);
  ck("and lets them on once the marked ones are filled", await page.evaluate(() =>
    [...document.querySelectorAll(".wl-actions button")].find((b) => /Continue/i.test(b.textContent))?.disabled === false));

  console.log("\n-- a filled-in field that still will not do --");
  await type("Email", "pat-at-example");
  await wait(400);
  ck("a malformed address is still said in words, since a mark cannot",
    /does not look right/i.test(await text()), (await text()).split("\n").find((l) => /look right/i.test(l)) || "nothing said");
  await type("Email", "pat@example.test");
  await type("Mobile", "20655");
  await wait(400);
  ck("so is a short mobile, which was never required in the first place",
    /10 digits/i.test(await text()), (await text()).split("\n").find((l) => /digits/i.test(l)) || "nothing said");

  console.log("\n-- the later steps --");
  await type("Mobile", "2065550100");
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll(".wl-actions button")].find((b) => /Continue/i.test(b.textContent))?.click());
  await wait(700);
  const step2 = await marked();
  ck("the trades question is marked too", step2.some((t) => /trades do you cover/i.test(t)), step2.join(" | "));
  ck("but the optional city and ZIP are not", !step2.some((t) => /^City|^ZIP/i.test(t)), step2.join(" | "));
  ck("the key is on this step as well", /\*\s*Required/i.test(await text()));

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/apply-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
