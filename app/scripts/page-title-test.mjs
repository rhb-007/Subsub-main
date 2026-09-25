// The browser tab on the two pages a subcontractor sees before they are
// inside the app.
//
// Both said "SubSub" and nothing else. The application form is linked from
// a customer's own website, so it is opened cold, in a tab beside six
// others, by somebody who has never heard of us -- and the one line the
// browser shows them before the page paints said nothing about whose form
// it is.
//
// So: a title derived from the company name with nothing to set up, both
// editable, and SubSub on the end of both whatever anybody types. That last
// part is the bit worth testing from several angles, because a customer
// removing our name from a page hosted on our domain, under a "Powered by
// SubSub" line, is the failure mode -- not a typo.
//
// Needs the local stack (worker 8787, supa stub 8902, app dist 5191).
//
//   node scripts/page-title-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const HOST = "outerhome.subsub.work";
const ACCOUNT = "acc_test";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

const admin = await tok("admin@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const before = await (await fetch(`${API}/account`, { headers: H })).json();
const theme = before.theme || { bg: "#F4F6F4", surface: "#FFFFFF", text: "#12211C", accent: "#1F6B4A", btnText: "#FFFFFF" };
const setTheme = (extra) => fetch(`${API}/account`, { method: "PATCH", headers: H,
  body: JSON.stringify({ theme: { ...theme, ...extra } }) });
// What came back, which is what the browser will be handed.
const savedTheme = async () => (await (await fetch(`${API}/account`, { headers: H })).json()).theme || {};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const titleAt = async (path) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".wl-page, .login-wrap", { timeout: 15000 });
  await wait(1400);
  const out = { title: await page.title(), crashes };
  await ctx.close();
  return out;
};

try {
  console.log("\n-- with nothing set, it names the company --");
  {
    await setTheme({ signInTitle: null, applyTitle: null });
    const signIn = await titleAt("/");
    ck("the sign-in tab says whose it is", /^Outerhome/.test(signIn.title), signIn.title);
    ck("and what it is for", /sign in/i.test(signIn.title), signIn.title);
    ck("it is not the bare product name", signIn.title !== "SubSub", signIn.title);
    const apply = await titleAt("/?apply=1");
    ck("the application form does too", /^Outerhome/.test(apply.title), apply.title);
    ck("saying what it is", /apply/i.test(apply.title), apply.title);
    // Two different pages; one title for both would be no better than none.
    ck("and the two differ", signIn.title !== apply.title, `${signIn.title} / ${apply.title}`);
    ck("both carry SubSub", /SubSub$/.test(signIn.title) && /SubSub$/.test(apply.title),
      `${signIn.title} | ${apply.title}`);
    ck("nothing threw", signIn.crashes.length === 0 && apply.crashes.length === 0,
      [...signIn.crashes, ...apply.crashes].join(" ; "));
  }

  console.log("\n-- and it can be changed --");
  {
    await setTheme({ signInTitle: "Crew portal", applyTitle: "Work with Outerhome" });
    const signIn = await titleAt("/");
    ck("the sign-in tab takes the words given", /^Crew portal/.test(signIn.title), signIn.title);
    const apply = await titleAt("/?apply=1");
    ck("so does the form", /^Work with Outerhome/.test(apply.title), apply.title);
    ck("and each still ends in SubSub",
      signIn.title === "Crew portal · SubSub" && apply.title === "Work with Outerhome · SubSub",
      `${signIn.title} | ${apply.title}`);
  }

  console.log("\n-- SubSub cannot be removed --");
  {
    // Four ways somebody would try, from the honest to the deliberate.
    for (const [what, sent] of [
      ["typing it themselves", "Crew portal · SubSub"],
      ["with a pipe instead", "Crew portal | SubSub"],
      ["with a dash", "Crew portal - SubSub"],
      ["with an em dash", "Crew portal — SubSub"],
      ["as a bare word on the end", "Crew portal SubSub"],
      ["in the wrong case", "Crew portal · subsub"],
    ]) {
      await setTheme({ signInTitle: sent });
      const saved = await savedTheme();
      const r = await titleAt("/");
      ck(`${what}: stored without it`, saved.signInTitle === "Crew portal", JSON.stringify(saved.signInTitle));
      ck(`${what}: and shown with exactly one`,
        r.title === "Crew portal · SubSub", r.title);
    }
  }
  {
    // The one that matters: deleting it outright.
    await setTheme({ signInTitle: "Outerhome only" });
    const r = await titleAt("/");
    ck("a title with no mention of us gets one anyway", r.title === "Outerhome only · SubSub", r.title);
  }
  {
    // And the empty case, which must fall back rather than read " · SubSub".
    await setTheme({ signInTitle: "   " });
    const saved = await savedTheme();
    ck("blank is not stored as a title", !saved.signInTitle, JSON.stringify(saved.signInTitle));
    const r = await titleAt("/");
    ck("and the default comes back", /^Outerhome/.test(r.title) && /SubSub$/.test(r.title), r.title);
  }
  {
    // Nothing but our own name: stripping it leaves nothing, so the default
    // has to carry the page rather than leaving a title of one separator.
    await setTheme({ signInTitle: "SubSub" });
    const r = await titleAt("/");
    ck("a title that is only our name falls back", /^Outerhome/.test(r.title), r.title);
    ck("and is not a lone separator", !/^[\s·|-]/.test(r.title), r.title);
  }
  {
    const long = "x".repeat(200);
    await setTheme({ signInTitle: long });
    const saved = await savedTheme();
    ck("a very long one is cut to something a tab can show",
      (saved.signInTitle || "").length === 60, String((saved.signInTitle || "").length));
    const r = await titleAt("/");
    ck("and still ends in SubSub", /SubSub$/.test(r.title), r.title.slice(-20));
  }
  {
    // Newlines in a document.title are a real way to hide the rest of it.
    await setTheme({ signInTitle: "Crew portal\n\n\nignore the rest" });
    const saved = await savedTheme();
    ck("line breaks are flattened", !/[\r\n]/.test(saved.signInTitle || ""), JSON.stringify(saved.signInTitle));
  }

  console.log("\n-- the editor --");
  {
    await setTheme({ signInTitle: "Crew portal", applyTitle: null });
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 1600 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[type=password]", { timeout: 15000 });
    await wait(900);
    await page.type("input[type=email]", "admin@example.test");
    await page.type("input[type=password]", "correct horse battery");
    await page.click(".login-btn");
    await wait(6500);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^My account/i.test(b.innerText.trim()))?.click());
    await wait(1600);
    await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
      .find((b) => /^Company$/i.test(b.innerText.trim()))?.click());
    await wait(2400);

    const ed = await page.evaluate(() => {
      const labels = [...document.querySelectorAll(".settings-panel .fld")]
        .filter((l) => /Sign-in page|Application form/.test(l.childNodes[0]?.textContent || ""));
      return labels.map((l) => ({
        label: l.childNodes[0]?.textContent?.trim(),
        value: l.querySelector("input")?.value,
        placeholder: l.querySelector("input")?.getAttribute("placeholder"),
        maxLength: l.querySelector("input")?.getAttribute("maxlength"),
        suffix: l.querySelector(".sd-suffix")?.textContent.trim(),
        suffixIsInput: !!l.querySelector(".sd-suffix input"),
        preview: l.querySelector(".cov-hint")?.textContent.trim(),
      }));
    });
    ck("both pages have a box", ed.length === 2, ed.map((x) => x.label).join(" | "));
    ck("the one that is set shows what was set, without our name",
      ed[0]?.value === "Crew portal", JSON.stringify(ed[0]?.value));
    // An untouched one shows the default as a placeholder rather than as
    // text, so it reads as a default and not as something somebody chose.
    ck("the untouched one is empty, with the default behind it",
      ed[1]?.value === "" && /Outerhome/.test(ed[1]?.placeholder || ""),
      `"${ed[1]?.value}" / "${ed[1]?.placeholder}"`);
    ck("SubSub sits beside the box as fixed text",
      ed.every((x) => /SubSub/.test(x.suffix || "")), ed.map((x) => x.suffix).join(" | "));
    ck("and is not something that can be typed in",
      ed.every((x) => x.suffixIsInput === false));
    ck("each shows the tab it will produce",
      /Crew portal · SubSub/.test(ed[0]?.preview || ""), ed[0]?.preview);
    ck("including the untouched one", /Outerhome.*SubSub/.test(ed[1]?.preview || ""), ed[1]?.preview);
    ck("with a length a tab can actually show",
      ed.every((x) => x.maxLength === "60"), ed.map((x) => x.maxLength).join(", "));
    ck("nothing threw in the editor", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  // Put the account back exactly as it was.
  await fetch(`${API}/account`, { method: "PATCH", headers: H,
    body: JSON.stringify({ theme: before.theme || null }) }).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
