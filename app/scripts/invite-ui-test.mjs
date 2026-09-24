// The invite box, at the size somebody actually opens it.
//
// It started as one field and a button on a single row, which was fine.
// Then it grew to three fields and a button on that same row, inside a
// 560px modal -- so each box came out around sixty pixels wide with its
// hint wrapping to four lines above it, and the primary button said "Create
// link" because the email box happened to be empty. It was unusable on a
// tablet and worse on a phone.
//
// So this checks the thing that was wrong rather than the thing that was
// added: how wide the boxes actually are, at three widths, with the panel
// open. A layout assertion is only worth having if it fails when the layout
// is bad, which the old one does.
//
//   node scripts/invite-ui-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const HOST = "outerhome.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

async function openPanel(width, height) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", "admin@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /Invite a subcontractor/i.test(b.textContent))?.click());
  await wait(1200);
  return { ctx, page, crashes };
}

const shape = (page) => page.evaluate(() => {
  const panel = document.querySelector(".inv-panel");
  if (!panel) return null;
  const fields = [...panel.querySelectorAll(".inv-make .fld")].map((l) => {
    const input = l.querySelector("input");
    return {
      label: l.childNodes[0]?.textContent?.trim() || "",
      w: Math.round(input?.getBoundingClientRect().width || 0),
      top: Math.round(input?.getBoundingClientRect().top || 0),
      lines: Math.round(l.getBoundingClientRect().height),
    };
  });
  const btn = panel.querySelector(".inv-send");
  return {
    fields,
    panelW: Math.round(panel.getBoundingClientRect().width),
    button: btn ? { text: btn.innerText.trim(), w: Math.round(btn.getBoundingClientRect().width),
      disabled: btn.disabled } : null,
    text: panel.innerText,
    overflows: panel.scrollWidth > panel.clientWidth + 1,
  };
});

try {
  for (const [w, h, name] of [[1200, 1400, "desktop"], [834, 1180, "tablet"], [390, 844, "phone"]]) {
    console.log(`\n-- ${name} (${w}px) --`);
    const { ctx, page, crashes } = await openPanel(w, h);
    const s = await shape(page);
    ck(`${name}: the panel opens`, !!s, String(s));
    // Four now. Company name was added because the API has taken it since
    // the beginning and the invite email reads "has invited <company> to
    // join theirs" -- the form simply never asked, so every invite went out
    // saying "you". "Their name" became "Full name", which is what it is.
    ck(`${name}: four fields, no more`, s.fields.length === 4,
      s.fields.map((f) => f.label).join(" | "));
    ck(`${name}: company, full name, email, mobile`,
      /^company name/i.test(s.fields[0].label) && /^full name/i.test(s.fields[1].label)
      && /^email/i.test(s.fields[2].label) && /^mobile/i.test(s.fields[3].label),
      s.fields.map((f) => f.label).join(" | "));
    ck(`${name}: nothing still calls it "their name"`,
      !s.fields.some((f) => /their name/i.test(f.label)), s.fields.map((f) => f.label).join(" | "));

    // The actual complaint. Sixty-pixel boxes are what a row of three inside
    // a modal produces; a stacked one gives every box the panel's width.
    const narrowest = Math.min(...s.fields.map((f) => f.w));
    ck(`${name}: no box is squeezed`, narrowest > 200, `narrowest ${narrowest}px of ${s.panelW}px panel`);
    ck(`${name}: they all get the same width`,
      Math.max(...s.fields.map((f) => f.w)) - narrowest < 3,
      s.fields.map((f) => f.w).join(", "));
    // Stacked means each one starts below the last.
    ck(`${name}: one per line`,
      s.fields.every((f, i) => i === 0 || f.top > s.fields[i - 1].top),
      s.fields.map((f) => f.top).join(" → "));
    ck(`${name}: nothing spills sideways`, s.overflows === false);

    ck(`${name}: the button says what it does`, s.button?.text === "Send invite", s.button?.text);
    // It used to read "Create link" whenever the email box was empty, which
    // is the state it opens in -- so the thing it is for was never the
    // thing it offered.
    ck(`${name}: and is held until there is somewhere to send it`, s.button?.disabled === true);
    ck(`${name}: with the link-only way kept, out of the way`,
      /link to send yourself/i.test(s.text), s.text.split("\n").slice(-3).join(" / "));
    ck(`${name}: nothing threw`, crashes.length === 0, crashes.join(" | "));

    // And it unlocks on either route, because either one can carry an
    // invite. The fourth box is Mobile since Company name was added, and
    // the number belongs to nobody: this form looks a typed number up now,
    // and finding somebody deliberately holds Send back.
    await page.type(".inv-make .fld:nth-of-type(4) input", "206-555-0909");
    await wait(400);
    ck(`${name}: a mobile alone is enough`,
      (await page.evaluate(() => !document.querySelector(".inv-send").disabled)) === true);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
