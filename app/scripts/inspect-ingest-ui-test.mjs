// The screen that wires an inspection app up, and answers what its words mean.
//
// The receiver shipped in the same change as this, which is deliberate: the
// routes on their own are the shape this product keeps producing and refusing
// -- correct pieces with no way in. A condition dictionary that can only be
// written by API is one that, for the person who runs a lettings agency, cannot
// be written at all.
//
// What this covers, none of which a static check can see:
//
//   THE WORK QUEUE COMES FIRST. A walk whose condition words map to nothing
//   still arrives, so the account has rooms it cannot sign off and one
//   unanswered word explaining all of them. That is the only part of this
//   screen with anything to DO in it.
//
//   AND IT SAYS THE INSPECTIONS ARE SAFE. "These meant nothing to SubSub"
//   reads as "they were rejected", and somebody who believes that goes hunting
//   in their inspection app instead of on their Inspections screen.
//
//   ANSWERING ONE IS ONE TAP AND CLEARS IT, so the queue keeps meaning "still
//   to do".
//
//   THE ADDRESS IS ON THE SCREEN. Without it the panel hands somebody a
//   dictionary and leaves them to assemble a URL out of the developer docs.
//
//   AND THE TOKEN BOX PRINTS BOTH ADDRESSES, because a token is hashed the
//   moment that box closes -- an address not printed then can never be printed
//   whole again.
//
//   A GENERAL CONTRACTOR GETS NEITHER, because it keeps no buildings, which is
//   exactly what `/api/inspection-rules` refuses. BOTH BRANCHES ARE DRIVEN IN
//   THE SAME PLACE: a fix checked on one account kind is the diagonal coverage
//   that left `hiresLabel` half-wired.
//
//   node scripts/inspect-ingest-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inspingest-test");
const WEB = 5347, API = 8903;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

let KIND = "property_manager";
let PLAN = "scale";
let RULES = { rules: [], unmapped: [] };
const saved = [];
const removed = [];
const minted = [];

const ACCOUNT = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "sound", kind: KIND,
  plan: PLAN, billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rae", name: "Rae", email: "rae@sound.test", role: "admin" },
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/inspection-rules" && method === "POST") {
    saved.push(body);
    // The server clears an answered word from the queue; the stub does the
    // same, or the test would prove nothing about the screen reloading.
    RULES = {
      rules: [...RULES.rules, { id: `r${saved.length}`, source: body.source || "*",
        value: body.value, status: body.status }],
      unmapped: RULES.unmapped.filter((u) =>
        u.value.toLowerCase() !== String(body.value).toLowerCase()),
    };
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/inspection-rules/") && method === "DELETE") {
    removed.push(path.split("/").pop());
    RULES = { ...RULES, rules: RULES.rules.filter((r) => r.id !== removed[removed.length - 1]) };
    return [200, { ok: true }];
  }
  if (path === "/api/inspection-rules") return [200, RULES];
  if (path === "/api/api-tokens" && method === "POST") {
    minted.push(body);
    return [200, { id: "t1", name: body?.name || "x", prefix: "ssk_abc12",
      token: "ssk_abc12_the_rest_of_it" }];
  }
  if (path === "/api/api-tokens") return [200, minted.length
    ? [{ id: "t1", name: minted[0]?.name || "x", prefix: "ssk_abc12", lastUsedAt: null, revokedAt: null }]
    : []];
  if (path === "/api/crm-rules") return [200, { rules: [], unmapped: [] }];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_pm",
    company: "Sound Property Management", contact: "Rae", email: "rae@sound.test",
    docs: {}, sharesSent: 0, openToHire: true }];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/properties") return [200, []];
  if (path === "/api/inspections") return [200, []];
  if (path === "/api/weather") return [200, {}];
  if (path === "/api/account-users") return [200, [
    { id: "u_rae", name: "Rae", email: "rae@sound.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

const browser = await launch();

// Opens Account -> Profile, where the panel lives beside the API token.
const openPanel = async () => {
  const r = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "u_rae", accountId: "acc_pm" }, viewport: { width: 1200, height: 2000 } });
  await r.page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
  await wait(400);
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
  for (let n = 0; n < 40; n++) {
    await wait(200);
    if (await r.page.$(".seg-tabs, nav.tabs")) break;
  }
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Profile")?.click());
  for (let n = 0; n < 40; n++) { await wait(200); if (await r.page.$(".portal-panel")) break; }
  await wait(700);
  return r;
};

// A throw inside a child blanks that subtree without a `pageerror`, so the
// harness's own crash list stays empty exactly when the subject has
// disappeared. The page's own console is the only thing that sees it.
const watchConsole = (page) => {
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  return errs;
};

// Scoped to THIS panel by its heading. A bare `.crm-row` would find the CRM
// panel's rows directly above it and pass whichever existed -- the
// whichever-one-exists trap this project has paid for four times.
const panelOf = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll(".portal-panel")]
    .find((p) => /Inspections from your inspection app/i.test(p.textContent || ""));
  return el ? {
    text: el.innerText.replace(/\s+/g, " ").trim(),
    gaps: [...el.querySelectorAll(".crm-row.gap")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    rows: [...el.querySelectorAll(".crm-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    code: [...el.querySelectorAll("code.tok-val")].map((c) => c.innerText.trim()),
    // Where the queue sits relative to the rules and to the address, MEASURED
    // rather than assumed: source order is not screen order, and a static check
    // that the JSX moved passes whether or not it lands anywhere.
    gapY: el.querySelector(".crm-row.gap")?.getBoundingClientRect().top ?? null,
    ruleY: [...el.querySelectorAll(".crm-row:not(.gap)")][0]?.getBoundingClientRect().top ?? null,
    addrY: el.querySelector("code.tok-val")?.getBoundingClientRect().top ?? null,
  } : null;
});

try {
  console.log("\n-- with nothing set up, it says what it is for --");
  {
    RULES = { rules: [], unmapped: [] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("the panel is there", !!p, String(p));
    t.ck("and there is one of it",
      await page.evaluate(() => [...document.querySelectorAll(".portal-panel")]
        .filter((x) => /Inspections from your inspection app/i.test(x.textContent || "")).length) === 1);
    t.ck("it says what arrives", /draft inspection/i.test(p.text), p.text.slice(0, 200));
    // Said rather than left to be discovered: a JSON webhook cannot carry
    // bytes, so photographs are added on the inspection itself.
    t.ck("and that photographs are added here", /Photographs are added here/i.test(p.text),
      p.text.slice(0, 300));
    t.ck("it does not pretend there is work to do", !/Waiting on you/i.test(p.text));
    // Most apps need nothing here, so an empty dictionary must not read as an
    // unfinished setup step.
    t.ck("and says the ordinary words are already understood",
      /already reads the ordinary ones/i.test(p.text), p.text.slice(0, 400));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    const log = watchConsole(page);
    await page.evaluate(() => window.scrollBy(0, 400));
    await wait(300);
    t.ck("and the page's own console is clean", log.length === 0, JSON.stringify(log).slice(0, 200));
    await ctx.close();
  }

  console.log("\n-- an unanswered word is the first thing on the screen --");
  {
    RULES = { rules: [{ id: "r0", source: "*", value: "Grade A", status: "ok" }],
      unmapped: [{ id: "g1", source: "generic", value: "Grade C", hits: 9, lastSeen: "2026-09-28" }] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("the queue is shown", p.gaps.length === 1, JSON.stringify(p.gaps));
    t.ck("naming the word", /Grade C/.test(p.gaps[0]), p.gaps[0]);
    // ROOMS, not walks. "On 9 rooms" is the measure of how much of the walk is
    // unreadable, which is what makes it worth answering.
    t.ck("and how many rooms it has cost", /9 rooms/.test(p.gaps[0]), p.gaps[0]);
    t.ck("it is headed as waiting on them", /waiting on you \(1\)/i.test(p.text), p.text.slice(0, 200));

    // ABOVE the rules AND above the address, because it is the only part with
    // anything to do in it.
    t.ck("it sits ABOVE the rules list",
      p.gapY !== null && p.ruleY !== null && p.gapY < p.ruleY, `${p.gapY} vs ${p.ruleY}`);
    t.ck("and above the address", p.addrY !== null && p.gapY < p.addrY, `${p.gapY} vs ${p.addrY}`);

    // "meant nothing to SubSub" reads as "rejected" unless the screen says
    // otherwise, and somebody who believes that goes hunting in their app.
    t.ck("it says the inspections are safe", /inspections are safe/i.test(p.text), p.text);
    t.ck("and where they are", /Inspections screen/i.test(p.text), p.text);
    // The consequence named, so somebody knows what answering buys: those
    // rooms arrived NOT CHECKED, which is what stops the walk being signed off.
    t.ck("and what those rooms came in as", /not checked/i.test(p.text), p.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("-- and answering it takes one tap --");
  {
    RULES = { rules: [], unmapped: [{ id: "g1", source: "generic", value: "Grade C", hits: 9 }] };
    saved.length = 0;
    const { ctx, page, crashes } = await openPanel();
    await page.evaluate(() => [...document.querySelectorAll(".crm-row.gap button")]
      .find((b) => /What does it mean/i.test(b.innerText))?.click());
    await wait(400);

    const answers = await page.evaluate(() =>
      [...document.querySelectorAll(".insp-answer-row .chip")].map((b) => b.innerText.trim()));
    t.ck("the four answers are offered", answers.length === 4, JSON.stringify(answers));
    // `Not checked` is on it DELIBERATELY: it is what an unanswered word
    // already becomes, so choosing it is deciding that this word means nobody
    // looked -- the right answer for an app sending "N/A" on rooms a flat does
    // not have.
    t.ck("including not-checked, which is a real answer",
      answers.some((a) => /not checked/i.test(a)), JSON.stringify(answers));
    t.ck("and the word is quoted back", await page.evaluate(() =>
      /Grade C/.test(document.querySelector(".insp-answer")?.innerText || "")));

    await page.evaluate(() => [...document.querySelectorAll(".insp-answer-row .chip")]
      .find((b) => /^Fail$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 30 && !saved.length; n++) await wait(150);

    t.ck("it saves", saved.length === 1, JSON.stringify(saved));
    t.ck("with their exact word", saved[0]?.value === "Grade C", JSON.stringify(saved[0]));
    t.ck("and the answer picked", saved[0]?.status === "fail", JSON.stringify(saved[0]));
    // No source sent, so the server files it for EVERY system -- which is the
    // common case and the 049 lesson taken at the start.
    t.ck("and it names no system, so it applies to all of them",
      saved[0]?.source === undefined, JSON.stringify(saved[0]));

    await wait(700);
    const after = await panelOf(page);
    // Leaving an answered word in the queue is how a queue stops meaning
    // "still to do", and a row that survives being answered is a button
    // somebody presses again, and again.
    t.ck("and it leaves the queue", after.gaps.length === 0, JSON.stringify(after.gaps));
    t.ck("appearing as a word instead", after.rows.some((r) => /Grade C/.test(r)),
      JSON.stringify(after.rows));
    t.ck("which reads as what it now means", after.rows.some((r) => /reads as Fail/i.test(r)),
      JSON.stringify(after.rows));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a word can be added without waiting for a walk --");
  {
    RULES = { rules: [], unmapped: [] };
    saved.length = 0;
    const { ctx, page, crashes } = await openPanel();
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Inspections from your inspection app/i.test(p.textContent || ""));
      [...el.querySelectorAll("button")].find((b) => /Add a word/i.test(b.innerText))?.click();
    });
    await wait(400);
    // Nothing to answer until there is a word, and it says so rather than
    // offering four dead buttons.
    const before = await page.evaluate(() => ({
      chips: document.querySelectorAll(".crm-add .insp-answer-row .chip").length,
      hint: [...document.querySelectorAll(".crm-add .cov-hint")].map((x) => x.innerText).join(" "),
    }));
    t.ck("no answer is offered before a word is typed", before.chips === 0, String(before.chips));
    t.ck("and it says to type one first", /type their word for it first/i.test(before.hint),
      before.hint);
    // Whole values, said where somebody is typing rather than in help text:
    // a person entering "Poor" reasonably expects it to catch "Very poor".
    t.ck("matching is said to be whole-value", /will not match/i.test(before.hint), before.hint);

    await page.evaluate(() => {
      const i = document.querySelector(".crm-add input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Needs a deep clean");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".crm-add .insp-answer-row .chip")]
      .find((b) => /^Follow-up$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 30 && !saved.length; n++) await wait(150);
    t.ck("it saves the typed word", saved[0]?.value === "Needs a deep clean", JSON.stringify(saved[0]));
    t.ck("with the answer picked", saved[0]?.status === "follow_up", JSON.stringify(saved[0]));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the address is on the screen --");
  {
    RULES = { rules: [], unmapped: [] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("an address is printed", p.code.length === 1, JSON.stringify(p.code));
    // The OBJECT is the last segment, so the two addresses cannot be mistaken
    // for each other by somebody pasting one of them into a field.
    t.ck("ending in the object it posts", /\/inspections$/.test(p.code[0]), p.code[0]);
    t.ck("through the generic receiver", /\/v1\/hooks\/generic\//.test(p.code[0]), p.code[0]);
    t.ck("and absolute, because it goes into somebody else's system",
      /^https?:\/\//.test(p.code[0]), p.code[0]);
    // A token is hashed the moment it is minted, so no screen can print a
    // whole one again -- which this says, rather than printing a dead address.
    t.ck("with the token left as a placeholder", /YOUR_TOKEN/.test(p.code[0]), p.code[0]);
    t.ck("and it says where to get one", /Connect your CRM/i.test(p.text), p.text.slice(-400));
    t.ck("there is something to copy", await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((x) => /Inspections from your inspection app/i.test(x.textContent || ""));
      return [...el.querySelectorAll("button")].some((b) => /Copy the address/i.test(b.innerText));
    }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- on Basic the address is withheld and the reason given --");
  {
    PLAN = "basic"; RULES = { rules: [], unmapped: [] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    // NAMED rather than hidden: somebody whose inspection app could feed this
    // needs to know it exists before they can decide to pay for it.
    t.ck("the panel still renders", !!p, String(p));
    t.ck("no address is printed", p.code.length === 0, JSON.stringify(p.code));
    t.ck("and it says why", /part of Scale/i.test(p.text), p.text.slice(-200));
    // The dictionary is NOT plan-gated: answering what a word means costs
    // nothing and is worth having before the integration is paid for.
    t.ck("but the dictionary is still there", /Your words/i.test(p.text), p.text.slice(0, 400));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    PLAN = "scale";
  }

  console.log("\n-- the token box prints BOTH addresses --");
  {
    RULES = { rules: [], unmapped: [] }; minted.length = 0;
    const { ctx, page, crashes } = await openPanel();
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Connect your CRM/i.test(p.textContent || ""));
      const i = el.querySelector("input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Our inspection app");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Connect your CRM/i.test(p.textContent || ""));
      [...el.querySelectorAll("button")].find((b) => /Create token/i.test(b.innerText))?.click();
    });
    for (let n = 0; n < 40 && !minted.length; n++) await wait(150);
    await wait(600);

    const box = await page.evaluate(() => {
      const el = document.querySelector(".tok-new");
      return el ? {
        text: el.innerText.replace(/\s+/g, " ").trim(),
        code: [...el.querySelectorAll("code.tok-val")].map((c) => c.innerText.trim()),
      } : null;
    });
    t.ck("the minted box is up", !!box, String(box));
    // AN ADDRESS NOT PRINTED NOW CAN NEVER BE PRINTED WHOLE AGAIN, because the
    // token is hashed the moment this closes. So both are here, and listed
    // rather than hidden behind a picker nobody would know to use.
    t.ck("it holds the token and both addresses", box.code.length === 3, JSON.stringify(box.code));
    t.ck("the token itself", box.code[0] === "ssk_abc12_the_rest_of_it", box.code[0]);
    t.ck("the jobs address", /\/v1\/hooks\/generic\/ssk_abc12_the_rest_of_it$/.test(box.code[1]),
      box.code[1]);
    t.ck("and the inspections one, whole", box.code[2]
      === `${box.code[1]}/inspections`, `${box.code[2]} vs ${box.code[1]}/inspections`);
    t.ck("named as what it is for", /unit inspections/i.test(box.text), box.text.slice(0, 400));
    // It points at the panel below rather than explaining the dictionary twice.
    t.ck("and points at where the words are set",
      /Inspections from your inspection app/i.test(box.text), box.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a general contractor gets neither, because it keeps no buildings --");
  {
    KIND = "general_contractor"; RULES = { rules: [], unmapped: [] }; minted.length = 0;
    const { ctx, page, crashes } = await openPanel();

    // THE POSITIVE FIRST. "There is no panel" passes loudest on a screen that
    // never opened, which is the read-through-nothing trap this project has
    // paid for repeatedly -- so prove the tab is really here before asserting
    // an absence.
    t.ck("the account screen really opened", await page.evaluate(() =>
      [...document.querySelectorAll(".portal-panel")]
        .some((x) => /Connect your CRM/i.test(x.textContent || ""))));
    t.ck("and there is no inspections panel on it", (await panelOf(page)) === null);

    // Nor the second address in the token box: a general contractor has no
    // units to walk, the route refuses it, and a screen offering an address
    // the server will not answer is the screen-that-lies rule pointed at a
    // clipboard.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Connect your CRM/i.test(p.textContent || ""));
      const i = el.querySelector("input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Our CRM");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".portal-panel")]
        .find((p) => /Connect your CRM/i.test(p.textContent || ""));
      [...el.querySelectorAll("button")].find((b) => /Create token/i.test(b.innerText))?.click();
    });
    for (let n = 0; n < 40 && !minted.length; n++) await wait(150);
    await wait(600);
    const box = await page.evaluate(() => {
      const el = document.querySelector(".tok-new");
      return el ? { code: [...el.querySelectorAll("code.tok-val")].map((c) => c.innerText.trim()),
        text: el.innerText.replace(/\s+/g, " ").trim() } : null;
    });
    t.ck("the minted box opened for them too", !!box, String(box));
    t.ck("with the token and the jobs address and nothing else",
      box.code.length === 2, JSON.stringify(box.code));
    t.ck("and no inspections address", !box.code.some((x) => /\/inspections$/.test(x)),
      JSON.stringify(box.code));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    KIND = "property_manager";
  }
} finally {
  await browser.close();
  web.close();
  api.close();
}

t.done();
