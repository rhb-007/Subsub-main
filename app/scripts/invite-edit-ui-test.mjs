// The invite panel, where the typo is actually noticed.
//
// Two things, both visible in the same screenshot. The panel offered Copy
// link, Send again and Revoke and no way to correct a mistyped address — so
// the only route from a typo to a working invite was to throw the record
// away. And its **Expires** line read "just now" over a link good for another
// thirty days, because `relTime` is a past-tense helper: every branch in it is
// a `<` against a positive bound, and a future time makes `ago` negative, so
// the first one matched whatever the date was. On the one line that says
// whether the link still works, "just now" reads as already dead.
//
// Driven in a browser because both are what somebody SEES. A static check
// that the panel mentions an edit form passes with the form never rendering,
// and a check that `relTime` has a future branch passes whether or not the
// panel reaches it.
//
//   node --no-warnings scripts/invite-edit-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inviteedit-test");
const WEB = 5311, API = 9011;
const t = tally();

const ahead = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
};
const USERS = [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false }];

const INVITE = {
  // Five days out, which is the case the line is actually read for: an
  // invite about to lapse. A month out crosses into the absolute-date branch,
  // which is checked separately below.
  id: "inv_1", label: null, createdAt: "2026-10-01 23:00:00", expiresAt: ahead(5),
  usedAt: null, revokedAt: null, companyId: null,
  email: "juan@pacificam.com", phone: "+12067778899", contact: "Juan Soto",
  companyName: "Pacific apartment maintenance", sentAt: new Date(Date.now() - 60_000).toISOString(),
  url: "https://soundpm.subsub.work/?invite=8a0575eebb1074c6ba7ca5dd6a64015cb8182322034046ead4fcdf8b07c8d515",
  status: "open",
};
// The other kind: raised from a contractor's card, so their details live on a
// row the roster edits and this panel must not offer a second door to.
const BOUND = { ...INVITE, id: "inv_2", companyId: "cmp_pac" };

let INVITES = [INVITE];
let patched = null;
let patchCount = 0;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, sent) => {
  if (path === "/api/invites" && method === "PATCH") return undefined;
  if (/^\/api\/invites\/inv_\d$/.test(path) && method === "PATCH") {
    patchCount += 1; patched = sent;
    const base = INVITES[0];
    const next = { ...base, ...sent, email: sent.email ?? base.email };
    const reissued = !!(base.email && sent.email && sent.email !== base.email);
    return [200, { ...next, sentAt: reissued ? null : base.sentAt, reissued }];
  }
  if (path === "/api/invites") return [200, INVITES];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const readPanel = (page) => page.evaluate(() => {
  const p = document.querySelector(".invited-panel");
  if (!p) return { open: false };
  const facts = {};
  const dts = [...p.querySelectorAll(".invited-facts dt")];
  dts.forEach((dt, i) => {
    facts[dt.innerText.replace(/\s+/g, " ").trim().toLowerCase()] =
      (p.querySelectorAll(".invited-facts dd")[i]?.innerText || "").replace(/\s+/g, " ").trim();
  });
  return {
    open: true, facts,
    acts: [...p.querySelectorAll(".invited-acts button")]
      .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    editing: !!p.querySelector(".inv-edit"),
    fields: [...p.querySelectorAll(".inv-edit input")].map((i) => i.value),
    labels: [...p.querySelectorAll(".inv-edit .fld")].map((l) =>
      (l.childNodes[0]?.textContent || "").trim()),
    warn: [...p.querySelectorAll(".inv-edit .fld-note")]
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()).join(" "),
    note: (p.querySelector(".cov-hint.ok")?.innerText || "").replace(/\s+/g, " ").trim(),
    pointer: [...p.querySelectorAll(".fld-note")]
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()).join(" "),
  };
});
const pressIn = (page, sel, text) => page.evaluate((s, want) => {
  [...document.querySelectorAll(s)]
    .find((b) => new RegExp(want, "i").test((b.innerText || "").trim()))?.click();
}, sel, text);
const typeInto = (page, n, value) => page.evaluate((idx, v) => {
  const el = document.querySelectorAll(".inv-edit input")[idx];
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, n, value);

const openPanel = async () => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1200 } });
  await wait(2600);
  await pressIn(page, ".dash-sec .dash-row-btn", "Open");

  await wait(800);
  return { ctx, page };
};

try {
  console.log("\n-- what the panel says about itself --");
  {
    const { ctx, page } = await openPanel();
    let v = await readPanel(page);
    t.ck("the panel opens", v.open === true, JSON.stringify(v));

    // THE REPORTED LINE. An invite good for another month read "just now",
    // which is the one wrong answer that reads as already expired.
    t.ck("Expires counts forward", /^in 5 days$/.test(v.facts.expires || ""),
      JSON.stringify(v.facts));
    t.ck("and it is NOT the past-tense answer", !/just now|ago/.test(v.facts.expires || ""),
      String(v.facts.expires));
    // The line beside it is a real past time, so the same helper must still
    // read backwards. One helper, both directions.
    t.ck("and Sent is still read as a past one", /ago|just now/.test(v.facts.status || ""),
      String(v.facts.status));

    t.ck("it offers a way to correct it", v.acts.some((a) => /edit details/i.test(a)),
      JSON.stringify(v.acts));
    t.ck("alongside what it always offered",
      ["copy link", "send again", "revoke"].every((w) => v.acts.some((a) => new RegExp(w, "i").test(a))),
      JSON.stringify(v.acts));

    console.log("\n-- correcting the address --");
    await pressIn(page, ".invited-acts button", "Edit details");
    await wait(400);
    v = await readPanel(page);
    t.ck("the form opens in place", v.editing === true, JSON.stringify(v));
    // SEEDED FROM THE RECORD. An edit form that opens empty is a retype.
    t.ck("with what is on file already in it",
      JSON.stringify(v.fields) === JSON.stringify(["Pacific apartment maintenance",
        "Juan Soto", "juan@pacificam.com", "+12067778899"]), JSON.stringify(v.fields));
    t.ck("and nothing warned before anything changed", v.warn === "", v.warn);

    await typeInto(page, 2, "juan@pacificam.co");
    await wait(300);
    v = await readPanel(page);
    // WARNED BEFORE THE PRESS. Finding out afterwards that the link changed
    // is finding out too late to decide.
    t.ck("changing the address warns that the old link dies",
      /issues a new link/.test(v.warn), v.warn);

    t.ck("and nothing has been sent yet", patchCount === 0, String(patchCount));
    await pressIn(page, ".inv-edit .invited-acts button", "Save details");
    await wait(900);
    t.ck("saving sends exactly one patch", patchCount === 1, String(patchCount));
    t.ck("carrying all four fields",
      patched && patched.email === "juan@pacificam.co"
        && patched.companyName === "Pacific apartment maintenance"
        && patched.contact === "Juan Soto" && patched.phone === "+12067778899",
      JSON.stringify(patched));

    v = await readPanel(page);
    t.ck("the form closes", v.editing === false, JSON.stringify(v));
    t.ck("the panel shows the new address", /juan@pacificam\.co\b/.test(v.facts.invited || ""),
      String(v.facts.invited));
    // BOTH HALVES SAID: the old link is dead, and this is not finished.
    t.ck("and says the old link has stopped working", /old link has stopped working/.test(v.note), v.note);
    t.ck("and that nothing has gone to the new address yet",
      /nothing has gone to the new address/i.test(v.note), v.note);
    t.ck("so the status line stops claiming it was sent",
      /not sent/i.test(v.facts.status || ""), String(v.facts.status));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- and a month out is a date, not a countdown --");
  {
    // Past 30 days the helper hands back the date itself, both directions.
    // What matters is that it is never the past-tense answer: "just now" over
    // a link good for another month is the reading that started this.
    INVITES = [{ ...INVITE, expiresAt: ahead(30) }];
    const { ctx, page } = await openPanel();
    const v = await readPanel(page);
    t.ck("it reads as a real date", /\d{4}/.test(v.facts.expires || ""), String(v.facts.expires));
    t.ck("and not as something that has already happened",
      !/just now|ago/.test(v.facts.expires || ""), String(v.facts.expires));
    await ctx.close().catch(() => {});
    INVITES = [INVITE];
  }

  console.log("\n-- Cancel leaves the record alone --");
  {
    patchCount = 0;
    const { ctx, page } = await openPanel();
    await pressIn(page, ".invited-acts button", "Edit details");
    await wait(400);
    await typeInto(page, 2, "wrong@nowhere.test");
    await wait(250);
    await pressIn(page, ".inv-edit .invited-acts button", "Cancel");
    await wait(400);
    const v = await readPanel(page);
    // A form whose Cancel saves anyway is worse than no form, having been
    // asked and answered.
    t.ck("nothing was sent", patchCount === 0, String(patchCount));
    t.ck("the form is shut", v.editing === false, JSON.stringify(v));
    t.ck("and the old address is still on screen",
      /juan@pacificam\.com/.test(v.facts.invited || ""), String(v.facts.invited));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- one raised from a contractor's card is not edited here --");
  {
    // The route refuses it with on_their_card, so offering the form would be
    // offering a save the server throws away. And a missing button with no
    // explanation is a dead end, so the panel says where to go instead.
    INVITES = [BOUND]; patchCount = 0;
    const { ctx, page } = await openPanel();
    const v = await readPanel(page);
    t.ck("the panel still opens", v.open === true, JSON.stringify(v));
    t.ck("no edit button", !v.acts.some((a) => /edit details/i.test(a)), JSON.stringify(v.acts));
    t.ck("but it says where their details live",
      /contractor card/i.test(v.pointer), v.pointer);
    t.ck("and the rest of the panel still works",
      v.acts.some((a) => /send again/i.test(a)), JSON.stringify(v.acts));
    await ctx.close().catch(() => {});
    INVITES = [INVITE];
  }

} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
