// The auto-schedule card, in a real browser, on the screen somebody went
// looking for it on.
//
// The report was "when I go to add auto schedule to a sub, I can't find it
// after they are setup" -- and it was not there: the switch lived only in the
// contractor's own portal, and the hiring side got a badge reporting somebody
// else's decision. So the first thing this checks is that opening a
// contractor now shows one.
//
// The rest is about the card telling the truth. Two contractors, side by
// side, differing in one thing:
//
//   a contractor with a SubSub account  -- no toggle, an Ask them button
//   a record the account typed in       -- a toggle they can throw
//
// If both drew a toggle the screen would be promising something the API
// refuses (autoschedule-test.mjs proves it refuses), and the user would find
// out by tapping it. That mismatch is the bug this file exists to catch.
//
//   node scripts/autoschedule-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-autosched-test");
const WEB = 5211, API = 8921;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

const sub = (over) => ({
  id: over.id, engagementId: "en_" + over.id, accountId: "acc_outer",
  company: over.company, contact: over.contact, phone: "(206)555-0100",
  email: over.email, license: null, ubi: null, city: "Seattle", state: "WA", zip: "98101",
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1, docFiles: {},
  notify: { email: true, sms: false }, docReview: {}, categories: ["roofing"], caps: ["Tear-off"],
  rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0, notes: "", status: "active",
  propertyIds: [], ...over,
});

// The two shapes, and a third that has already agreed so the OFF direction
// has something to be checked on.
const SUBS = [
  sub({ id: "cmp_seat", company: "San Juan Exteriors", contact: "Richard Braun",
        email: "rb@sanjuan.test", hasPortal: true, autoSchedule: false }),
  sub({ id: "cmp_typed", company: "Ace Gutters", contact: "Danny Ace",
        email: "danny@ace.test", hasPortal: false, autoSchedule: false }),
  sub({ id: "cmp_on", company: "Puget Electricity", contact: "Mega Slavo",
        email: "mega@puget.test", hasPortal: true, autoSchedule: true }),
];

const patched = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  }
  // The gate, as the server applies it -- so the browser meets the same
  // refusal it would in production if it ever asked for the wrong thing.
  const m = /^\/api\/subs\/([^/]+)$/.exec(path);
  if (m && method === "PATCH") {
    const who = SUBS.find((s) => s.id === m[1]);
    const want = (body || {}).autoSchedule;
    if (want === true && who?.hasPortal) {
      return [409, { error: "contractor_consent_required",
        detail: "Auto-schedule books jobs straight onto their calendar as accepted, so it is theirs to switch on." }];
    }
    patched.push({ id: m[1], body });
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/notify/auto-schedule/preview")) {
    return [200, { to: "rb@sanjuan.test", subject: "Outerhome: would you like jobs booked automatically?",
      text: "Hi Richard Braun,\n\nalready accepted\n\ncannot turn this on for you", configured: true }];
  }
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1280, height: 1600 } });
  await wait(2400);
  return r;
};

// Get to the roster and open one contractor's card by company name.
const openSub = async (page, name) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(900);
  const found = await page.evaluate((n) => {
    const card = [...document.querySelectorAll(".grid .card")]
      .find((c) => c.querySelector("h3")?.innerText.trim() === n);
    if (!card) return false;
    card.click();
    return true;
  }, name);
  await wait(900);
  return found;
};

// A real mouse press on the switch. A synthetic el.click() from inside the
// page did not reach React's handler here, and a test that silently fails to
// press the thing it is testing passes for the wrong reason, so this goes
// through the browser's own input path instead.
const flip = async (page) => {
  const el = await page.$(".detail .auto-toggle input");
  if (!el) return false;
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await el.click();
  return true;
};

const readCard = (page) => page.evaluate(() => {
  const secs = [...document.querySelectorAll(".detail section")];
  const s = secs.find((x) => /auto-schedule/i.test(x.querySelector("h4")?.innerText || ""));
  if (!s) return null;
  return {
    title: s.querySelector(".auto-title")?.innerText.trim(),
    desc: s.querySelector(".auto-desc")?.innerText.replace(/\s+/g, " ").trim(),
    hasToggle: !!s.querySelector(".auto-toggle input"),
    toggleOn: s.querySelector(".auto-toggle input")?.checked ?? null,
    askLabel: [...s.querySelectorAll("button")].map((b) => b.innerText.trim()).join("|"),
    note: s.querySelector(".auto-note")?.innerText.replace(/\s+/g, " ").trim() || "",
  };
});

try {
  console.log("\n-- it is on the screen at all, which it was not --");
  const { ctx, page, crashes } = await open();
  {
    const ok = await openSub(page, "San Juan Exteriors");
    t.ck("a contractor's card opens", ok, String(ok));
    const card = await readCard(page);
    t.ck("and it has an auto-schedule section", !!card, JSON.stringify(card));
    if (!card) { t.ck("...so nothing below could be checked", false); await ctx.close(); t.done(); }

    console.log("\n-- for a contractor with an account, it does not offer a switch --");
    t.ck("no toggle is drawn", card.hasToggle === false, JSON.stringify(card));
    t.ck("an Ask them button is offered instead", /ask them/i.test(card.askLabel), card.askLabel);
    t.ck("and it says why it is not theirs to throw",
      /theirs to switch on/i.test(card.note), card.note);
    t.ck("the state reads off", card.title === "Off", String(card.title));
    t.ck("and describes what off means for them",
      /accept or decline/i.test(card.desc), card.desc);
  }

  console.log("\n-- asking opens the mail, and says what it is --");
  {
    await page.evaluate(() => {
      const s = [...document.querySelectorAll(".detail section")]
        .find((x) => /auto-schedule/i.test(x.querySelector("h4")?.innerText || ""));
      [...s.querySelectorAll("button")].find((b) => /ask them/i.test(b.innerText))?.click();
    });
    await wait(1200);
    const ask = await page.evaluate(() => {
      const f = document.querySelector(".form");
      if (!f || !/ask about auto-schedule/i.test(f.innerText)) return null;
      return {
        note: f.querySelector(".notify-note")?.innerText.replace(/\s+/g, " ").trim(),
        hasNoteBox: !!f.querySelector("textarea"),
        preview: f.querySelector(".prev-body")?.innerText || "",
        sendable: !f.querySelector(".btn-solid")?.disabled,
      };
    });
    t.ck("the ask modal opens", !!ask, JSON.stringify(ask));
    if (ask) {
      t.ck("it says the account cannot do it for them",
        /can't turn this on for them/i.test(ask.note), ask.note);
      t.ck("it offers a reason to attach", ask.hasNoteBox);
      t.ck("it shows the message that will go out", /already accepted/.test(ask.preview), ask.preview.slice(0, 80));
      t.ck("and it can be sent", ask.sendable === true, String(ask.sendable));
    }
    // Close it.
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /^cancel$/i.test(b.innerText.trim()))?.click();
    });
    await wait(500);
  }

  console.log("\n-- for a record nobody is behind, it does offer one --");
  {
    const ok = await openSub(page, "Ace Gutters");
    t.ck("their card opens", ok, String(ok));
    const card = await readCard(page);
    t.ck("a toggle is drawn", card?.hasToggle === true, JSON.stringify(card));
    t.ck("it is off", card?.toggleOn === false, String(card?.toggleOn));
    t.ck("and the card warns that nobody will answer",
      /no one is going to press accept/i.test(card?.note || ""), card?.note);

    // Throw it, and confirm it actually went to the server and stuck.
    t.ck("the switch can be pressed", await flip(page));
    await wait(1200);
    t.ck("the switch reached the server",
      patched.some((p) => p.id === "cmp_typed" && p.body.autoSchedule === true),
      JSON.stringify(patched));
    const after = await readCard(page);
    t.ck("and the card now reads on", after?.title === "On", String(after?.title));
    t.ck("and says the account is telling them itself",
      /tell them yourself/i.test(after?.desc || ""), after?.desc);
  }

  console.log("\n-- a contractor who agreed can still be switched off --");
  {
    const ok = await openSub(page, "Puget Electricity");
    t.ck("their card opens", ok, String(ok));
    const card = await readCard(page);
    t.ck("it reads on", card?.title === "On", String(card?.title));
    // The one case where a contractor WITH a portal still gets a toggle:
    // taking it away costs them nothing but a round trip.
    t.ck("and a toggle is offered, because off is always allowed",
      card?.hasToggle === true, JSON.stringify(card));
    t.ck("the switch can be pressed", await flip(page));
    await wait(1200);
    t.ck("switching off reached the server",
      patched.some((p) => p.id === "cmp_on" && p.body.autoSchedule === false),
      JSON.stringify(patched));
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
