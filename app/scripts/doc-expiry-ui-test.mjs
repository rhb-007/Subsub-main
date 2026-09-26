// What the screens do with an expiry now there is one.
//
// Two places it has to show, and they are different questions:
//
//   reviewing a document  -- write down what it SAYS. The reviewer was
//   already reading the carrier, the number and the date in order to approve
//   it; none of it was being kept.
//
//   picking a job for somebody -- is the cover good for THAT DATE. A
//   certificate that is green on the roster and runs out before the work is
//   invisible everywhere else, and assignment is the only moment anybody can
//   do something about it.
//
//   node scripts/doc-expiry-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docexp-test");
const WEB = 5215, API = 8927;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

const verified = { status: "verified", checks: {}, limits: {} };
const SUB = {
  id: "cmp_sj", engagementId: "en_sj", accountId: "acc_outer",
  company: "San Juan Exteriors", contact: "Richard Braun", phone: "(206)555-0100",
  email: "rb@sanjuan.test", city: "Seattle", state: "WA", zip: "98101",
  license: "SANJU123456",
  licenseCheck: { found: true, status: "ACTIVE", suspendDate: null, expirationDate: iso(500) },
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "msa.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: true, autoSchedule: false,
  // Insurance runs out in 20 days. Current today; not good for a job in 60.
  docs: {
    insurance: { fileName: "coi.pdf", expiresOn: iso(20), issuer: "Acme Mutual", policyNo: "CGL-99812" },
    bond: { fileName: "bond.pdf", expiresOn: iso(400) },
    contract: { fileName: "msa.pdf", expiresOn: null },
    w9: { fileName: "w9.pdf", expiresOn: null },
  },
  docState: "expiring", docAssignable: true, docSoonest: iso(20),
};

const JOBS = [
  { id: "job_soon", accountId: "acc_outer", title: "Cedar Park re-roof", status: "active",
    date: iso(5), time: null, address: "1 Cedar", area: "Seattle", zip: "98101",
    trades: ["roofing"], assignments: {}, notes: "", createdAt: iso(-2), photos: [] },
  { id: "job_late", accountId: "acc_outer", title: "Elm St re-roof", status: "active",
    date: iso(60), time: null, address: "2 Elm", area: "Seattle", zip: "98101",
    trades: ["roofing"], assignments: {}, notes: "", createdAt: iso(-2), photos: [] },
];

const reviewed = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  }
  const rv = /^\/api\/subs\/([^/]+)\/documents\/([^/]+)\/review$/.exec(path);
  if (rv && method === "POST") { reviewed.push({ kind: rv[2], body }); return [200, { ok: true }]; }
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1340, height: 1600 } });
  await wait(2500);
  return r;
};

const toContractors = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(800);
};
const openCard = async (page) => {
  const ok = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".grid .card")]
      .find((x) => x.querySelector("h3")?.innerText.trim() === "San Juan Exteriors");
    if (!c) return false; c.click(); return true;
  });
  await wait(800);
  return ok;
};

try {
  const { ctx, page, crashes } = await open();

  console.log("\n-- reviewing a document asks what it says --");
  {
    await toContractors(page);
    await openCard(page);
    // Into the insurance review.
    // The compliance rows are .doc-row; a verified one's button reads "View"
    // rather than "Review", and "Re-check" elsewhere in the card is the
    // LICENCE check, which is a different thing entirely.
    const opened = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".doc-row")]
        .find((r) => /certificate of insurance/i.test(r.innerText));
      if (!row) return "no insurance row";
      const b = [...row.querySelectorAll("button")][0];
      if (!b) return "no button on the row";
      b.click();
      return b.innerText.trim();
    });
    await wait(900);
    const form = await page.evaluate(() => {
      // The review opens in a modal of its own; .form inside it is the one
      // with the carrier and policy fields, not whatever .form the detail
      // card left on the page.
      const f = [...document.querySelectorAll(".form")]
        .find((x) => /carrier|policy number/i.test(x.innerText));
      if (!f) return null;
      const labels = [...f.querySelectorAll("label.fld")].map((l) => l.innerText.split("\n")[0].trim());
      return { labels, hasDate: !!f.querySelector('input[type="date"]'), text: f.innerText.slice(0, 200) };
    });
    t.ck("a review form opened", !!form, `${opened} :: ${JSON.stringify(form)}`);
    if (form) {
      t.ck("it asks who wrote it", form.labels.some((l) => /carrier/i.test(l)), JSON.stringify(form.labels));
      t.ck("it asks for the policy number", form.labels.some((l) => /policy number/i.test(l)), JSON.stringify(form.labels));
      t.ck("and it asks when it expires",
        form.hasDate && form.labels.some((l) => /expires/i.test(l)), JSON.stringify(form.labels));

      // Fill it and verify, then check what was actually sent.
      await page.evaluate(() => {
        const f = [...document.querySelectorAll(".form")]
          .find((x) => /carrier|policy number/i.test(x.innerText));
        const set = (el, v) => {
          const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
          d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const byLabel = (re) => [...f.querySelectorAll("label.fld")]
          .find((l) => re.test(l.innerText.split("\n")[0]))?.querySelector("input");
        set(byLabel(/carrier/i), "Acme Mutual");
        set(byLabel(/policy number/i), "CGL-99812");
        // Every money input on the form, wherever it lives, so Verify becomes
        // available. The limits are not label.fld rows.
        [...f.querySelectorAll("input")].forEach((i) => {
          if (i.type === "date" || i.type === "checkbox") return;
          const lab = i.closest("label")?.innerText || "";
          if (/carrier|policy number/i.test(lab)) return;
          set(i, "2000000");
        });
        f.querySelectorAll('input[type="checkbox"]').forEach((cb) => { if (!cb.checked) cb.click(); });
      });
      await wait(400);
      await page.evaluate(() => {
        const f = [...document.querySelectorAll(".form")]
          .find((x) => /carrier|policy number/i.test(x.innerText));
        const d = f.querySelector('input[type="date"]');
        const set = (el, v) => {
          const p = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
          p.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set(d, new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10));
      });
      await wait(400);
      const pressed = await page.evaluate(() => {
        const b = [...document.querySelectorAll(".form button")]
          .find((x) => /verify document/i.test(x.innerText));
        if (!b || b.disabled) return b ? "disabled" : "missing";
        b.click(); return "clicked";
      });
      await wait(1000);
      t.ck("the document can be verified", pressed === "clicked", pressed);
      const sent = reviewed.find((r) => r.kind === "insurance");
      t.ck("the carrier is sent", sent?.body?.issuer === "Acme Mutual", JSON.stringify(sent?.body));
      t.ck("the policy number is sent", sent?.body?.policyNo === "CGL-99812", String(sent?.body?.policyNo));
      t.ck("and an expiry is sent", !!sent?.body?.expires, String(sent?.body?.expires));
    }
  }

console.log("\n-- and an expired certificate stops reading as a verified one --");
  {
    const { ctx: c3, page: p3 } = await open();
    await toContractors(p3);
    await openCard(p3);
    const rows = await p3.evaluate(() => [...document.querySelectorAll(".doc-row")].map((r) => ({
      text: r.innerText.replace(/\s+/g, " ").trim(),
      lapsed: r.className.includes("doc-lapsed"),
      soon: r.className.includes("doc-soon"),
    })));
    const ins = rows.find((r) => /certificate of insurance/i.test(r.text));
    const bond = rows.find((r) => /surety bond/i.test(r.text));
    const w9 = rows.find((r) => /W-9/i.test(r.text));
    // Insurance is 20 days out in the fixture: verified, but flagged as close.
    t.ck("a certificate running out soon is marked as such", ins?.soon === true, ins?.text);
    t.ck("and says how long is left", /in 20 days/.test(ins?.text || ""), ins?.text);
    t.ck("the carrier is shown once it is known", /Acme Mutual/.test(ins?.text || ""), ins?.text);
    // The bond is 400 days out: ordinary verified.
    t.ck("one with plenty of room is left alone",
      bond?.soon === false && bond?.lapsed === false, JSON.stringify(bond));
    // A W-9 has no date and must not be coloured for it.
    t.ck("a document that never expires is not flagged",
      w9?.soon === false && w9?.lapsed === false, JSON.stringify(w9));
    await c3.close();
  }

  console.log("\n-- picking a job asks about the job's date --");
  {
    const { ctx: c2, page: p2 } = await open();
    await toContractors(p2);
    await openCard(p2);
    // Assign, then the existing-job path.
    await p2.evaluate(() => [...document.querySelectorAll(".detail button")]
      .find((b) => /assign/i.test(b.innerText))?.click());
    await wait(900);
    await p2.evaluate(() => [...document.querySelectorAll(".ac-card")]
      .find((b) => /existing job/i.test(b.innerText))?.click());
    await wait(900);

    const rows = await p2.evaluate(() => [...document.querySelectorAll(".pick-row")].map((r) => ({
      title: r.querySelector("h4")?.innerText.trim(),
      text: r.innerText.replace(/\s+/g, " ").trim(),
      buttons: [...r.querySelectorAll("button")].map((b) => b.innerText.trim()),
    })));
    t.ck("both open slots are offered", rows.length === 2, JSON.stringify(rows.map((r) => r.title)));

    const soon = rows.find((r) => /Cedar Park/.test(r.title || ""));
    const late = rows.find((r) => /Elm St/.test(r.title || ""));

    // Inside the cover: ordinary Assign.
    t.ck("a job inside the cover is offered normally",
      soon.buttons.some((b) => /^Assign$/i.test(b)) && !/not covered/i.test(soon.text),
      `${soon.text} :: ${JSON.stringify(soon.buttons)}`);

    // Past the expiry: flagged, and Assign is not the offer.
    t.ck("a job past the expiry is flagged", /not covered on this date/i.test(late.text), late.text);
    t.ck("it says which document and when it runs out",
      /certificate of insurance expires/i.test(late.text), late.text);
    t.ck("and names the job's own date", late.text.includes(new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)), late.text);
    t.ck("Assign is not offered for it",
      !late.buttons.some((b) => /^Assign/i.test(b)), JSON.stringify(late.buttons));
    t.ck("the renewal is offered instead",
      late.buttons.some((b) => /request renewal/i.test(b)), JSON.stringify(late.buttons));
    await c2.close();
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
