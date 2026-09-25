// Three things that were wrong on screen, and are the kind of wrong that no
// build step notices.
//
// 1. A contractor card put the trade chips ABOVE the company name, so a grid
//    of them read as a wall of "Roofing / Siding / Gutters" and whose card
//    each one was arrived second. The detail modal was fixed for exactly
//    this reason; the card it opens from was not.
//
// 2. The availability grid's top-left corner read "Contractorfree crews".
//    The label and its note are two elements, the note is display:block and
//    sized to sit on its own line -- but the corner was a row flex, which
//    laid them out as neighbours and ate the space between them.
//
// 3. The properties screen offered "New property" in the header AND a second
//    button saying the same thing inside the empty state, a couple of inches
//    below it. Two buttons doing one thing, one of them only sometimes.
//
// The empty state is reached by answering /api/properties with an empty list
// rather than by deleting anybody's buildings -- the screen is the thing
// under test, not the data.
//
// Needs the local stack (worker 8787, supa stub 8902, app dist 5191).
//
//   node scripts/ui-tidy-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const HOST = "cascademanagement.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const crashes = [];
const signIn = async (page) => {
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1000);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);
};
const goTab = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button, .ss-tabs button")]
    .find((b) => new RegExp(`^${l}`, "i").test(b.innerText.trim()))?.click(), label);
  await wait(2500);
};

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.setViewport({ width: 1280, height: 1400 });
  await signIn(page);

  // ---- 1. whose card is this -------------------------------------------
  console.log("\n-- a contractor card says whose it is first --");
  await goTab(page, "Contractors");
  const cards = await page.evaluate(() => [...document.querySelectorAll(".grid .card")].slice(0, 8).map((c) => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    return {
      name: c.querySelector(".name-row h3")?.textContent.trim() || "",
      nameBox: box(c.querySelector(".name-row h3")),
      contactBox: box(c.querySelector(".contact")),
      catBox: box(c.querySelector(":scope > .cat-row")),
      dot: box(c.querySelector(".avail-dot")),
      hasId: !!c.querySelector(".card-id"),
      chips: c.querySelectorAll(":scope > .cat-row .cat-badge").length,
      firstLine: c.innerText.split("\n")[0].trim(),
    };
  }));
  // Guarded, because every one of the assertions below is an .every() over
  // this array and an empty one passes them all without looking at anything.
  ck("there are cards to look at", cards.length >= 2, `${cards.length}`);
  const withChips = cards.filter((c) => c.chips > 0);
  ck("and some of them carry trades", withChips.length > 0, `${withChips.length} of ${cards.length}`);
  if (!withChips.length) throw new Error("no contractor cards with trades on them -- nothing below would be testing anything");
  ck("every card has an identity block", cards.every((c) => c.hasId));
  // The whole point. Before this, catBox.top was ABOVE nameBox.top on every
  // card in the grid.
  ck("the company name is above the trade chips on every card",
    withChips.every((c) => c.nameBox && c.catBox && c.nameBox.top < c.catBox.top),
    withChips.map((c) => `${c.name}: name ${c.nameBox?.top} vs chips ${c.catBox?.top}`).slice(0, 3).join(" | "));
  ck("and the contact line sits between them",
    withChips.every((c) => c.contactBox.top > c.nameBox.top && c.contactBox.top < c.catBox.top),
    withChips.map((c) => `${c.nameBox.top} / ${c.contactBox.top} / ${c.catBox.top}`).slice(0, 3).join(" | "));
  // Whatever a card reads out loud, the first thing it says is the name.
  ck("the first line of the card is the company",
    cards.every((c) => c.firstLine === c.name),
    cards.slice(0, 3).map((c) => `"${c.firstLine}" vs "${c.name}"`).join(" | "));
  // The availability dot was the other thing in the old top row; it belongs
  // beside the name now, not stranded over a chip.
  ck("the availability dot rides with the name",
    cards.every((c) => c.dot && Math.abs(c.dot.top - c.nameBox.top) < 20),
    cards.slice(0, 3).map((c) => `dot ${c.dot?.top} name ${c.nameBox.top}`).join(" | "));
  ck("and stays at the right-hand edge",
    cards.every((c) => c.dot.right > c.nameBox.right), `${cards[0]?.dot.right} vs ${cards[0]?.nameBox.right}`);

  // ---- 2. Contractorfree crews -----------------------------------------
  console.log("\n-- the availability grid's corner --");
  await goTab(page, "Availability");
  const corner = await page.evaluate(() => {
    const c = document.querySelector(".cal-corner");
    if (!c) return null;
    const note = c.querySelector(".cc-note");
    const nb = note?.getBoundingClientRect();
    // The label is whatever text is NOT in the note, so its box has to be
    // measured with a range rather than a selector.
    const label = c.firstChild;
    const r = document.createRange(); r.selectNodeContents(label);
    const lb = r.getBoundingClientRect();
    return {
      text: c.innerText,
      label: { top: Math.round(lb.top), bottom: Math.round(lb.bottom), right: Math.round(lb.right) },
      note: { top: Math.round(nb.top), left: Math.round(nb.left) },
    };
  });
  ck("the corner is there", !!corner, String(corner));
  // The two boxes are separate elements, so innerText keeps a newline between
  // them whichever way they are laid out -- putting the corner back to a row
  // flex leaves this reading "Contractor\nfree crews" while the screen says
  // "Contractorfree crews". The text check is worth keeping, but it is the
  // two geometry ones below that actually catch the bug.
  ck("the two words are not welded together", /Contractor\s+free crews/.test(corner.text),
    JSON.stringify(corner.text));
  ck("it still says both", /Contractor/.test(corner.text) && /free crews/.test(corner.text), JSON.stringify(corner.text));
  ck("the note is on its own line below the label",
    corner.note.top >= corner.label.bottom - 2, `label bottom ${corner.label.bottom}, note top ${corner.note.top}`);
  ck("and starts back at the left, not alongside it",
    corner.note.left < corner.label.right, `note left ${corner.note.left}, label right ${corner.label.right}`);

  // ---- 3. one button, not two ------------------------------------------
  console.log("\n-- the properties screen with nothing on it --");
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/\/api\/properties(\?|$)/.test(req.url()) && req.method() === "GET") {
      req.respond({ status: 200, contentType: "application/json", body: "[]" });
    } else req.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(6500);
  await goTab(page, "Properties");
  const props = await page.evaluate(() => {
    const empty = document.querySelector(".ss-main .dash-empty");
    const head = document.querySelector(".ss-main .dash-hello");
    const all = [...document.querySelectorAll(".ss-main button")]
      .map((b) => b.innerText.trim()).filter((t) => /propert/i.test(t));
    return {
      emptyText: empty?.innerText || "",
      emptyButtons: empty ? [...empty.querySelectorAll("button")].map((b) => b.innerText.trim()) : null,
      headButtons: head ? [...head.querySelectorAll("button")].map((b) => b.innerText.trim()) : [],
      addButtonsOnScreen: all,
    };
  });
  ck("the empty state is showing", /No properties yet/i.test(props.emptyText), props.emptyText.slice(0, 80));
  // The report: "Remove add property cta button here".
  ck("it offers no button of its own", Array.isArray(props.emptyButtons) && props.emptyButtons.length === 0,
    JSON.stringify(props.emptyButtons));
  ck("the header still offers one", props.headButtons.some((t) => /new property/i.test(t)),
    props.headButtons.join(" | "));
  ck("so there is exactly one way to add one on the screen",
    props.addButtonsOnScreen.length === 1, props.addButtonsOnScreen.join(" | "));

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
  await ctx.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
