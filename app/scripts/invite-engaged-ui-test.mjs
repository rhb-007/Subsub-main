// THE PICKER THAT WAS NOT THERE, PROVED REACHABLE.
//
// Reported as *"when I go to signup a new user I don't see any settings for a
// handyman"*. The route and the column shipped with 058; what was missing was
// the control on the door people actually use, which is Invite.
//
// Driven in a browser because the static half of this has already passed over
// exactly this bug twice in this repository. `roleLocked` made the buildings
// and jobs pickers unreachable for every seat on every account kind while
// `{scopeByJob && !roleLocked && (` read exactly as intended; and
// `className={on ? "on" : ""}` was written in three places with no `.chip.on`
// rule anywhere, so a ticked chip and an untouched one were the same pixels.
// Neither a mutation nor a grep can see either. What this reads back is what
// the browser computed:
//
//   THE PICKER OPENS, on the kind that may use it, from the Invite button on
//   the Contractors screen. A count of mounts in the source cannot say whether
//   anybody can reach one.
//
//   THE SELECTED HALF IS VISIBLY SELECTED. Computed background, not a class
//   name.
//
//   AND PRESSING SEND SENDS THE WORD. The request body, off the stub -- a
//   control that draws itself correctly and posts the opposite value is the
//   whole reason a UI test exists.
//
//   BOTH BRANCHES IN THE SAME PLACE. A general contractor must NOT get the
//   picker, and asserting only the property manager leaves the diagonal
//   coverage that left `hiresLabel` half-wired. The positive assertion rides
//   with it, because "it is absent" passes loudest on a screen that never
//   opened.
//
//   node --no-warnings scripts/invite-engaged-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inviteas-test");
const WEB = 5327, API = 9025;
const t = tally();

// The one thing that changes between the two runs. `mayEngageHandyman` reads
// the account kind and nothing else, so this is the whole fixture difference.
let KIND = "property_manager";
let posted = null;

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: KIND,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Chris Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Chris Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false }];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/invites" && method === "POST") {
    posted = body;
    return [201, { id: "inv_1", label: null, createdAt: "2026-10-03 01:00:00",
      expiresAt: "2026-11-02T01:00:00.000Z", usedAt: null, revokedAt: null, companyId: null,
      email: "juan@pacificam.test", phone: null, contact: "Juan Soto",
      companyName: "Pacific apartment maintenance", sentAt: "2026-10-03 01:00:00",
      engagedAs: body?.engagedAs === "handyman" ? "handyman" : "subcontractor",
      url: "https://app.subsub.work/?invite=" + "a".repeat(64), status: "open",
      emailed: true, texted: false, emailError: null, textError: null,
      engagedAsRecorded: true }];
  }
  if (path === "/api/subs" || path === "/api/jobs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits"
    || path === "/api/inspections") return [200, []];
  if (path === "/api/payouts/status") {
    return [200, { status: "none", ready: false, requirements: [], configured: false }];
  }
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// A controlled input needs the node's own descriptor setter: assigning .value
// does not reach React's onChange, which this project has reported as a broken
// product twice.
// MATCHED ON THE LABEL'S OWN TEXT, never its whole innerText. The Company
// name field carries an inline note reading "SubSub is matched on the email,
// mobile or licence below" -- so a substring match for "Email" found the
// COMPANY box, typed the address into it, and left the email empty, which
// disabled Send. Reported by this suite as the product not posting the
// relationship; it was the harness. The same trap `.chip` and
// `.embed-code-btn` already record: a selector that matches more than one
// thing answers for whichever it happened to reach.
//
// The note is a <span>, so it is on the same rendered LINE as the label --
// which is why splitting innerText was not enough either. The label's own text
// is its direct text children and nothing below them.
const typeIn = (page, label, text) => page.evaluate(([lab, v]) => {
  const head = (el) => [...(el?.childNodes || [])]
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
  const box = [...document.querySelectorAll(".inv-panel .fld input")]
    .find((i) => new RegExp(`^${lab}$`, "i").test(head(i.closest("label"))));
  if (!box) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(box, v);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [label, text]);

// THE ROSTER NOUN FOLLOWS THE ACCOUNT KIND, so a general contractor's nav
// reads "Subcontractors" and a managing agent's reads "Contractors". Matching
// only one of them is how a negative assertion comes to pass over a screen
// that never opened -- which is a trap this repository has already recorded
// against this exact navigation.
const openInvite = async () => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1400 } });
  await wait(2600);
  const nav = await page.evaluate(() => {
    const b = [...document.querySelectorAll("nav button")]
      .find((x) => /^(Sub)?contractors/i.test((x.innerText || "").trim()));
    b?.click();
    return (b?.innerText || "").trim();
  });
  await wait(900);
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /^Invite$/i.test((x.innerText || "").trim()));
    b?.click();
    return !!b;
  });
  await wait(700);
  return { ctx, page, nav, opened };
};

// The segmented control, as the browser drew it.
const seg = (page) => page.evaluate(() => {
  const panel = document.querySelector(".inv-panel");
  if (!panel) return { panel: false };
  const box = panel.querySelector(".insp-kind");
  if (!box) return { panel: true, seg: false,
    heads: [...panel.querySelectorAll("div.fld")].map((d) => (d.innerText || "").split("\n")[0]) };
  const btns = [...box.querySelectorAll("button")].map((b) => {
    const cs = getComputedStyle(b);
    return { label: (b.innerText || "").trim(), on: b.getAttribute("aria-pressed") === "true",
      bg: cs.backgroundColor, color: cs.color };
  });
  return { panel: true, seg: true, btns,
    note: (box.parentElement.querySelector(".fld-note")?.innerText || "").replace(/\s+/g, " ").trim(),
    notes: [...box.parentElement.querySelectorAll(".fld-note")]
      .map((p) => (p.innerText || "").replace(/\s+/g, " ").trim()) };
});

const press = (page, label) => page.evaluate((lab) => {
  const b = [...document.querySelectorAll(".inv-panel .insp-kind button")]
    .find((x) => new RegExp(`^${lab}$`, "i").test((x.innerText || "").trim()));
  b?.click();
  return !!b;
}, label);

try {
  console.log("\n-- a managing agent gets the picker, and it works --");
  {
    KIND = "property_manager";
    const { ctx, page, nav, opened } = await openInvite();
    t.ck("the roster screen opens", /contractors/i.test(nav), nav);
    t.ck("and the Invite form with it", opened);
    let s = await seg(page);
    t.ck("the panel is really on screen", s.panel === true, JSON.stringify(s));
    // THE WHOLE REPORT. A count of mounts in App.tsx cannot say this.
    t.ck("the working relationship is asked", s.seg === true, JSON.stringify(s.heads || s));
    t.ck("and it offers both answers",
      (s.btns || []).map((b) => b.label).join("/") === "Subcontractor/Handyman",
      JSON.stringify((s.btns || []).map((b) => b.label)));
    t.ck("opening on subcontractor, which is what NULL means",
      s.btns?.[0]?.on === true && s.btns?.[1]?.on === false,
      JSON.stringify((s.btns || []).map((b) => b.on)));

    // VISIBLY selected, computed. Two states reading the same pixels is the
    // chip bug this project already paid for: correct markup, nothing on
    // screen, and no mutation can see it.
    //
    // READ THROUGH, because this block runs on the case it exists to catch.
    // `s.btns[1].bg` threw when the picker was missing, which killed the run
    // and took the eleven assertions below with it -- one real failure
    // reported as a crash, the read-through-`link?.` lesson for the fifth
    // time in this repository.
    const offBg = s.btns?.[1]?.bg ?? null;
    t.ck("pressed Handyman", await press(page, "Handyman"));
    await wait(350);
    s = await seg(page);
    t.ck("the choice moves", s.btns?.[1]?.on === true && s.btns?.[0]?.on === false,
      JSON.stringify((s.btns || []).map((b) => b.on)));
    t.ck("and the selected half is drawn differently from the unselected one",
      !!s.btns && s.btns[1].bg !== offBg && s.btns[1].bg !== s.btns[0].bg,
      `${s.btns?.[1]?.bg} vs ${s.btns?.[0]?.bg} (was ${offBg})`);
    // What it means, where the decision is taken -- not in help text read
    // afterwards.
    t.ck("it says what a handyman is",
      /no contractor licence/i.test((s.notes || []).join(" ")), JSON.stringify(s.notes));
    t.ck("and what it changes about the form they will open",
      /lighter trades/i.test((s.notes || []).join(" ")), JSON.stringify(s.notes));

    posted = null;
    t.ck("the company name takes a value", await typeIn(page, "Company name", "Pacific apartment maintenance"));
    t.ck("and the email", await typeIn(page, "Email", "juan@pacificam.test"));
    await wait(250);
    await page.evaluate(() => [...document.querySelectorAll(".inv-panel button")]
      .find((b) => /Send invite/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    // THE BODY, not the markup. A control that draws itself correctly and
    // posts the opposite value is exactly what this is for.
    t.ck("Send posts the relationship", posted?.engagedAs === "handyman",
      JSON.stringify(posted));
    // SCOPED TO THE SENT NOTE. The panel's own copy explains what a handyman
    // is, so reading the whole panel for the word passes whether or not the
    // confirmation ever mentions it -- the could-not-fail shape, and the first
    // version of this assertion was exactly that.
    t.ck("and the confirmation says what they will join as",
      /handyman/i.test(await page.evaluate(() =>
        document.querySelector(".inv-panel .cov-hint.ok")?.innerText || "")),
      await page.evaluate(() =>
        document.querySelector(".inv-panel .cov-hint.ok")?.innerText || "(no note)"));
    await ctx.close();
  }

  console.log("\n-- and a general contractor does not --");
  {
    // THE OTHER BRANCH, IN THE SAME PLACE. A GC works job to job under a prime
    // contract and has no buildings to maintain, so the server refuses the
    // word -- and a picker here would be a control whose save is thrown away.
    KIND = "general_contractor";
    const { ctx, page, nav, opened } = await openInvite();
    // The positive assertion first. "No picker" on a screen that never
    // rendered is an assertion that cannot fail, and the roster noun changing
    // with the kind is what makes that easy to write by accident.
    t.ck("the roster screen opens here too", /subcontractors/i.test(nav), nav);
    t.ck("and so does the Invite form", opened);
    const s = await seg(page);
    t.ck("the panel is really on screen", s.panel === true, JSON.stringify(s));
    t.ck("and there is no working-relationship picker", s.seg === false,
      JSON.stringify((s.btns || []).map((b) => b.label)));
    // Still a usable form: the fix must not take the invite away to remove a
    // control from it.
    posted = null;
    t.ck("the form still works", await typeIn(page, "Email", "ops@cascade.test"));
    await wait(250);
    await page.evaluate(() => [...document.querySelectorAll(".inv-panel button")]
      .find((b) => /Send invite/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    t.ck("and sends", !!posted, JSON.stringify(posted));
    // Not sent at all, rather than sent as "subcontractor": the route reads
    // NULL as that, and a field the account was never asked about has no
    // business on the request.
    t.ck("without claiming a relationship it never asked about",
      posted && posted.engagedAs === undefined, JSON.stringify(posted));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
