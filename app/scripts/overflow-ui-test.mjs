// Overflow on the screen, both sides of it.
//
// The thing this has to prove visually is a negative: the posting account is
// never shown a list of contractors. Before you post there are no candidates,
// after you post there are no candidates, and the only names that ever appear
// belong to people who chose to answer. A screen that quietly rendered
// "sent to 14 contractors" would undo the whole design, and it would look
// like a feature.
//
// The other half is the contractor's: their own standing, in their own words,
// with reasons they can act on -- and answering that is plainly not a booking.
//
//   node scripts/overflow-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-ovf-test");
const WEB = 5217, API = 8929;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const GC = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing", "roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

const JOBS = [{
  id: "job1", accountId: "acc_outer", title: "Burst riser at Cedar Park", status: "active",
  date: iso(1), time: null, address: "1 Cedar", area: "Seattle", zip: "98101",
  trades: ["plumbing"], assignments: {}, notes: "", createdAt: iso(-1), photos: [],
  severity: "urgent",
}, {
  // The reported card: the contractor asked never replied, and the window ran
  // out. Beside it a trade somebody accepted, which must NOT offer overflow.
  id: "job2", accountId: "acc_outer", title: "Move-out work unit 32", status: "active",
  date: iso(2), time: null, address: "2028 NW 59th", area: "Seattle", zip: "98107",
  trades: ["electrical", "roofing"], notes: "", createdAt: iso(-1), photos: [], severity: null,
  assignments: {
    electrical: { id: "wo_e", subId: "cmp_mine", company: "My Electric", wo: "WO-336667", value: 150000,
      status: "pending", auto: false, responseWindow: "24h", respondBy: inHours(-5) },
    roofing: { id: "wo_r", subId: "cmp_roof", company: "My Roofing", wo: "WO-1", value: 100000,
      status: "accepted", auto: false },
  },
}, {
  id: "job3", accountId: "acc_outer", title: "Gutter run at Elm", status: "active",
  date: iso(3), time: null, address: "3 Elm", area: "Seattle", zip: "98101",
  trades: ["gutters"], notes: "", createdAt: iso(-1), photos: [], severity: null,
  assignments: { gutters: { id: "wo_g", subId: "cmp_mine", company: "My Gutters", wo: "WO-2", value: 50000,
    status: "declined", auto: false } },
}];

// One open post with one answer, and nobody else ever named.
let POSTS = [{
  id: "ovf1", jobId: "job1", jobTitle: "Burst riser at Cedar Park", jobDate: iso(1),
  trade: "plumbing", severity: "urgent", scope: "Section of riser to replace",
  value: 300000, feeBps: 0, status: "open", expiresAt: inHours(6), createdAt: iso(0),
  filledCompanyId: null,
  responses: [{
    id: "r1", companyId: "cmp_ok", company: "Rainier Plumbing", contact: "Pat Rain",
    phone: "2065550101", email: "pat@rainier.test", where: "Seattle, WA",
    price: 280000, canStart: "tomorrow 8am", note: "Two-man crew, parts on the van", at: iso(0),
  }],
}];

const posted = [], picked = [], responded = [], optedIn = [];
let ELIGIBILITY = { ok: true, reason: null, companies: [], feeBps: 0, available: true, migration: null };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  }
  if (path === "/api/overflow/posts") return [200, POSTS];
  if (path === "/api/overflow/offers") return [200, []];
  if (path === "/api/overflow/standing") return [200, { eligible: false, reasons: [], overflowOptIn: false, overflowTrades: [] }];
  if (/^\/api\/jobs\/[^/]+\/overflow\/eligibility/.test(path)) return [200, ELIGIBILITY];
  if (path === "/api/jobs/job1/overflow" && method === "POST") {
    posted.push(body);
    return [201, { id: "ovf2", trade: body.trade, severity: body.severity, expiresAt: inHours(6), feeBps: 0, sent: true }];
  }
  const pk = /^\/api\/overflow\/([^/]+)\/pick$/.exec(path);
  if (pk && method === "POST") { picked.push({ post: pk[1], body }); return [200, { ok: true, companyId: body.companyId }]; }
  const rs = /^\/api\/overflow\/([^/]+)\/respond$/.exec(path);
  if (rs && method === "POST") { responded.push({ post: rs[1], body }); return [200, { ok: true }]; }
  if (path === "/api/overflow/opt-in" && method === "PUT") { optedIn.push(body); return [200, { ok: true, ...body }]; }
  return undefined;
} });

const browser = await launch();
const openApp = async (acct = GC) => {
  const r = await visitApp(browser, { host: acct.subdomain, webPort: WEB,
    seat: { userId: acct.user.id, accountId: acct.id }, viewport: { width: 1340, height: 1700 } });
  await wait(2600);
  return r;
};
const toJobs = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Jobs/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(900);
  await openCards(page);
};

try {
  console.log("\n-- the account sees answers, and never a candidate list --");
  const { ctx, page, crashes } = await openApp();
  await toJobs(page);

  const sec = await page.evaluate(() => {
    const h = [...document.querySelectorAll(".dash-sec h3")]
      .find((x) => /out to overflow/i.test(x.innerText));
    if (!h) return null;
    const s = h.closest(".dash-sec");
    return {
      count: h.querySelector(".sec-count")?.textContent,
      text: s.innerText.replace(/\s+/g, " ").trim(),
      answers: [...s.querySelectorAll(".ovf-answer")].map((a) => a.innerText.replace(/\s+/g, " ").trim()),
      buttons: [...s.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    };
  });
  t.ck("the section is there", !!sec, String(sec));
  if (!sec) { t.ck("...so nothing below could be checked", false); await ctx.close(); await browser.close(); web.close(); api.close(); t.done(); }

  t.ck("it counts answers, not people asked", sec.count === "1", String(sec.count));
  t.ck("the one who answered is named", /Rainier Plumbing/.test(sec.text), sec.text);
  t.ck("with when they can be there", /tomorrow 8am/i.test(sec.text), sec.text);
  t.ck("and their price", /2,800/.test(sec.text), sec.text);
  t.ck("and their note", /Two-man crew/.test(sec.text), sec.text);
  t.ck("they can be called", sec.text.includes("Call") || /Call/.test(sec.buttons.join("|")), JSON.stringify(sec.buttons));
  t.ck("and picked", sec.buttons.some((b) => /pick them/i.test(b)), JSON.stringify(sec.buttons));
  // The negative that matters.
  t.ck("nothing says how many were asked",
    !/sent to \d+|\d+ contractors|\d+ invited|\d+ reached/i.test(sec.text), sec.text);
  t.ck("and exactly one company appears", sec.answers.length === 1, JSON.stringify(sec.answers));

  await page.evaluate(() => {
    const s = [...document.querySelectorAll(".dash-sec")]
      .find((x) => /out to overflow/i.test(x.innerText));
    [...s.querySelectorAll("button")].find((b) => /pick them/i.test(b.innerText))?.click();
  });
  await wait(1100);
  t.ck("picking sends the company that answered",
    picked.length === 1 && picked[0].body.companyId === "cmp_ok", JSON.stringify(picked));

console.log("\n-- before the migration is run, it says so before asking anything --");
  {
    // The live state until somebody pastes 038. The form must not open, take a
    // description of an emergency, and only then fail.
    ELIGIBILITY = { ok: true, reason: null, companies: [], feeBps: 0,
      available: false, migration: "038_overflow" };
    POSTS = [];
    const { ctx: c0, page: p0 } = await openApp();
    await toJobs(p0);
    await p0.evaluate(() => [...document.querySelectorAll(".trade-actions button")]
      .find((x) => /overflow/i.test(x.innerText))?.click());
    await wait(1200);
    const panel = await p0.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /overflow/i.test(x.innerText));
      return f ? { text: f.innerText.replace(/\s+/g, " ").trim(),
        hasScope: !!f.querySelector("textarea"),
        buttons: [...f.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    });
    t.ck("it says overflow is not switched on", /isn't switched on yet/i.test(panel?.text || ""), panel?.text);
    t.ck("and names the migration", /038_overflow/.test(panel?.text || ""), panel?.text);
    t.ck("it does not ask for a scope it cannot send", panel?.hasScope === false, String(panel?.hasScope));
    t.ck("and offers no send button", !panel.buttons.some((b) => /send it out/i.test(b)), JSON.stringify(panel.buttons));
    t.ck("while saying the rest of the job is unaffected",
      /own roster as usual/i.test(panel?.text || ""), panel?.text);
    await c0.close();
    ELIGIBILITY = { ok: true, reason: null, companies: [], feeBps: 0, available: true, migration: null };
  }

  console.log("\n-- posting is refused when the account has somebody of its own --");
  {
    ELIGIBILITY = { ok: false, reason: "own_roster_available", companies: ["My Own Plumbing"], feeBps: 0, available: true, migration: null };
    POSTS = [];
    const { ctx: c2, page: p2 } = await openApp();
    await toJobs(p2);
    const pressed = await p2.evaluate(() => {
      const b = [...document.querySelectorAll(".trade-actions button")]
        .find((x) => /overflow/i.test(x.innerText));
      if (!b) return false; b.click(); return true;
    });
    t.ck("the open slot offers overflow", pressed, String(pressed));
    await wait(1200);
    const gate = await p2.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /overflow|somebody/i.test(x.innerText));
      return f ? { text: f.innerText.replace(/\s+/g, " ").trim(),
        buttons: [...f.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    });
    t.ck("it says they have somebody already", /you have somebody for this/i.test(gate?.text || ""), gate?.text);
    t.ck("and names their own contractor", /My Own Plumbing/.test(gate?.text || ""), gate?.text);
    t.ck("so there is nothing to send", !gate.buttons.some((b) => /send it out/i.test(b)), JSON.stringify(gate.buttons));
    await c2.close();
  }

  console.log("\n-- and when they have nobody, it sends without naming anyone --");
  {
    ELIGIBILITY = { ok: true, reason: null, companies: [], feeBps: 0, available: true, migration: null };
    POSTS = [];
    const { ctx: c3, page: p3 } = await openApp();
    await toJobs(p3);
    await p3.evaluate(() => [...document.querySelectorAll(".trade-actions button")]
      .find((x) => /overflow/i.test(x.innerText))?.click());

    await wait(1200);
    const form = await p3.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /put this out to overflow/i.test(x.innerText));
      return f ? { text: f.innerText.replace(/\s+/g, " ").trim(),
        hasScope: !!f.querySelector("textarea"),
        buttons: [...f.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    });
    t.ck("the posting form opens", !!form, String(form));
    t.ck("it is explicit that nobody gets a list",
      /nobody gets a list/i.test(form.text), form.text);
    t.ck("it says eligibility is earned",
      /good ratings|current documents|verified licence/i.test(form.text), form.text);
    t.ck("it shows no contractor at all", !/Rainier|Olympic|cmp_/.test(form.text), form.text);
    t.ck("and asks what the work is", form.hasScope);

    // Fill and send.
    await p3.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /put this out to overflow/i.test(x.innerText));
      const set = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
        d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(f.querySelector("textarea"), "Burst riser, water off at the main");
      set(f.querySelector('input[inputmode="decimal"]'), "3000");
    });
    await wait(400);
    await p3.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /put this out to overflow/i.test(x.innerText));
      [...f.querySelectorAll("button")].find((b) => /send it out/i.test(b.innerText))?.click();
    });
    await wait(1300);
    t.ck("it was sent", posted.length === 1, JSON.stringify(posted));
    t.ck("with the scope and the ceiling",
      posted[0]?.scope?.includes("Burst riser") && posted[0]?.value === "3000", JSON.stringify(posted[0]));
    const after = await p3.evaluate(() => {
      const f = document.querySelector(".form.sent-state");
      return f ? f.innerText.replace(/\s+/g, " ").trim() : null;
    });
    t.ck("and the confirmation still names nobody and counts nothing",
      !!after && !/\d+ contractors|sent to \d+/i.test(after), String(after));
    t.ck("it says answers will appear", /ones who answer/i.test(after || ""), String(after));
    await c3.close();
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- a contractor who never replied, or declined: overflow is on offer --");
  {
    const { ctx: c4, page: p4, crashes: cr4 } = await openApp();
    await toJobs(p4);
    const rows = await p4.evaluate(() => {
      const out = {};
      for (const card of document.querySelectorAll(".job-card")) {
        const title = card.querySelector(".job-card-head")?.innerText || "";
        for (const r of card.querySelectorAll(".trade-row")) {
          const name = r.querySelector(".trade-name")?.innerText.trim();
          out[`${/unit 32/.test(title) ? "job2" : /Gutter/.test(title) ? "job3" : "job1"}:${name}`] =
            [...r.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean);
        }
      }
      return out;
    });
    const has = (k, re) => (rows[k] || []).some((b) => re.test(b));
    t.ck("the expired row drew", (rows["job2:Electrical"] || []).length > 0, JSON.stringify(rows));
    t.ck("no reply -- expired: Find alternatives AND Overflow",
      has("job2:Electrical", /Find alternatives/) && has("job2:Electrical", /^Overflow$/), JSON.stringify(rows["job2:Electrical"]));
    t.ck("declined: Overflow too", has("job3:Gutters", /^Overflow$/), JSON.stringify(rows["job3:Gutters"]));
    t.ck("an accepted trade does not offer it", !has("job2:Roofing", /^Overflow$/), JSON.stringify(rows["job2:Roofing"]));

    // Pressing it opens the same form, for THAT job and trade.
    await p4.evaluate(() => {
      const card = [...document.querySelectorAll(".job-card")].find((c) => /unit 32/.test(c.innerText));
      const row = [...card.querySelectorAll(".trade-row")].find((r) => /Electrical/.test(r.innerText));
      [...row.querySelectorAll("button")].find((b) => b.innerText.trim() === "Overflow")?.click();
    });
    await wait(1100);
    const form = await p4.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /put this out to overflow/i.test(x.innerText));
      return f ? f.querySelector(".form-sub")?.innerText || "" : null;
    });
    t.ck("pressing it opens the overflow form for that job and trade",
      form !== null && /unit 32/.test(form) && /Electrical/.test(form), String(form));
    t.ck("nothing threw", cr4.length === 0, cr4.join(" | "));
    await c4.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
