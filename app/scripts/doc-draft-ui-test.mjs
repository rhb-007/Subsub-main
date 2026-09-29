// The promise of a paused review, proved by driving it.
//
// The server suite pins that a draft is stored and is not a verdict. What it
// cannot show is the thing the feature exists for: that a reviewer who comes
// back finds the figures they typed, in the boxes they typed them in. A
// static check that the component MENTIONS the draft passes even when the
// form ignores it -- which is exactly what happened on the first attempt, so
// this exists.
//
//   node scripts/doc-draft-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docdraft-test");
const WEB = 5277, API = 8977;
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

// Four coverage lines in, a carrier, a policy number, and a note about why
// they stopped. The umbrella line and the expiry are deliberately absent:
// this is a review that CANNOT be verified yet, which is the whole case.
const DRAFT = {
  limits: { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000", auto: "1000000" },
  checks: { named: true, primary: true },
  issuer: "Cascade Mutual", policyNo: "CGL-99812",
  note: "waiting on the umbrella page",
  overrides: {},
};

const SUB = {
  id: "cmp_sj", engagementId: "en_sj", accountId: "acc_outer",
  company: "San Juan Exteriors", contact: "Richard Braun", phone: "(206)555-0100",
  email: "rb@sanjuan.test", city: "Seattle", state: "WA", zip: "98101",
  license: "SANJU123456",
  licenseCheck: { found: true, status: "ACTIVE", suspendDate: null, expirationDate: iso(500) },
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "msa.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  // Pending, with somebody's half-read pass parked on it.
  docReview: { insurance: {
    status: "pending", draft: DRAFT,
    draftAt: new Date(Date.now() - 3600000).toISOString(), draftBy: "Dana Ellis",
  } },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: true, autoSchedule: false,
  docs: {
    insurance: { fileName: "coi.pdf", expiresOn: null },
    bond: { fileName: "bond.pdf", expiresOn: null },
    contract: { fileName: "msa.pdf", expiresOn: null },
    w9: { fileName: "w9.pdf", expiresOn: null },
  },
  docState: "pending", docAssignable: false, docSoonest: null,
};

const saved = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (/\/documents\/[^/]+\/file$/.test(path) && method === "GET") {
    return [200, null, { raw: "%PDF-1.4\nACORD\n%%EOF", type: "application/pdf" }];
  }
  const d = /^\/api\/subs\/([^/]+)\/documents\/([^/]+)\/draft$/.exec(path);
  if (d && method === "PUT") { saved.push({ kind: d[2], body }); return [200, { ok: true }]; }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();

// Which row on the card each document is. The labels are what a reviewer
// reads, so the test finds them the same way.
const ROW_LABEL = {
  insurance: "certificate of insurance",
  bond: "surety bond",
  contract: "subcontractor agreement",
  w9: "w-9",
};

const toCard = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(800);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".grid .card")]
      .find((x) => x.querySelector("h3")?.innerText.trim() === "San Juan Exteriors");
    c?.click();
  });
  await wait(800);
};

const openReview = async (page, kind = "insurance") => {
  await toCard(page);
  await page.evaluate((label) => {
    const row = [...document.querySelectorAll(".doc-row")]
      .find((r) => new RegExp(label, "i").test(r.innerText));
    row?.querySelectorAll("button")[0]?.click();
  }, ROW_LABEL[kind]);
  await wait(1400);
};

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1340, height: 1800 } });
  await wait(2500);

  console.log("\n-- the roster says a review was left unfinished --");
  {
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
    await wait(800);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".grid .card")]
        .find((x) => x.querySelector("h3")?.innerText.trim() === "San Juan Exteriors");
      c?.click();
    });
    await wait(800);
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".doc-row")]
        .find((x) => /certificate of insurance/i.test(x.innerText));
      return r ? { text: r.innerText, chip: !!r.querySelector(".doc-draft"),
        btn: r.querySelector(".doc-review")?.innerText.trim() } : null;
    });
    t.ck("the row is there", !!row, JSON.stringify(row));
    t.ck("it carries the started-review marker", row?.chip, JSON.stringify(row));
    // A draft nobody can see from the roster is unfinished work nobody finds.
    t.ck("and the button says finish rather than start",
      /finish/i.test(row?.btn || ""), String(row?.btn));
    // It must NOT claim the document is any further along than it is.
    t.ck("the document is still awaiting review",
      /awaiting review/i.test(row?.text || ""), (row?.text || "").slice(0, 90));
  }

  console.log("\n-- reopening it hands back what was typed --");
  {
    await openReview(page);
    const form = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /carrier|policy number/i.test(x.innerText));
      if (!f) return null;
      const byLabel = (re) => [...f.querySelectorAll("label.fld")]
        .find((l) => re.test(l.innerText.split("\n")[0]))?.querySelector("input")?.value;
      const money = [...f.querySelectorAll(".cov-line")].map((l) => ({
        name: l.querySelector(".cl-name")?.innerText.trim(),
        value: l.querySelector("input")?.value,
      }));
      return {
        issuer: byLabel(/carrier/i), policy: byLabel(/policy number/i),
        money,
        ticked: [...f.querySelectorAll(".rv-check input")].filter((i) => i.checked).length,
        note: f.querySelector("textarea")?.value || "",
        banner: document.querySelector(".rv-draft")?.innerText || "",
      };
    });
    t.ck("the review form opened", !!form, JSON.stringify(form));
    if (form) {
      t.ck("the carrier came back", form.issuer === "Cascade Mutual", String(form.issuer));
      t.ck("the policy number came back", form.policy === "CGL-99812", String(form.policy));
      const filled = form.money.filter((m) => m.value && /\d/.test(m.value));
      t.ck("the four coverage lines came back", filled.length === 4,
        JSON.stringify(form.money.map((m) => m.value)));
      t.ck("and the one they were waiting on is still empty",
        form.money.some((m) => /umbrella/i.test(m.name || "") && !/\d/.test(m.value || "")),
        JSON.stringify(form.money));
      t.ck("the confirmations they had ticked are ticked", form.ticked === 2, String(form.ticked));
      t.ck("and the note saying why they stopped",
        /umbrella page/i.test(form.note), form.note);

      // Said out loud. A form that quietly arrives pre-filled reads as a
      // record of what the document says, and somebody would carry on from
      // figures they had not checked themselves.
      t.ck("the screen says it is an unfinished review",
        /unfinished review/i.test(form.banner), form.banner.slice(0, 80));
      t.ck("names who left it", /Dana Ellis/.test(form.banner), form.banner.slice(0, 120));
      t.ck("and says nothing has been approved",
        /not been approved|has been\s+approved|Nothing here has been approved/i.test(form.banner),
        form.banner.slice(0, 160));
    }
  }

  console.log("\n-- and it can be paused again from an incomplete form --");
  {
    const state = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /carrier|policy number/i.test(x.innerText));
      const btns = [...f.querySelectorAll(".form-actions button")].map((b) => ({
        text: b.innerText.trim(), disabled: b.disabled,
      }));
      return btns;
    });
    const save = state.find((b) => /finish later/i.test(b.text));
    const verify = state.find((b) => /verify/i.test(b.text));
    t.ck("Save and finish later is offered", !!save, JSON.stringify(state));
    // The whole reason to pause is that the form is not finished. Verify is
    // correctly dead here; Save must not be.
    t.ck("Verify is refused on an incomplete review", verify?.disabled === true, JSON.stringify(verify));
    t.ck("but pausing is not", save?.disabled === false, JSON.stringify(save));

    await page.evaluate(() => {
      const f = [...document.querySelectorAll(".form")].find((x) => /carrier|policy number/i.test(x.innerText));
      [...f.querySelectorAll(".form-actions button")].find((b) => /finish later/i.test(b.innerText))?.click();
    });
    await wait(900);
    t.ck("it saved", saved.length === 1, JSON.stringify(saved.map((s) => s.kind)));
    const sent = saved[0]?.body?.draft || {};
    t.ck("carrying the carrier", sent.issuer === "Cascade Mutual", JSON.stringify(sent.issuer));
    t.ck("the limits", sent.limits?.cgl_agg === "2000000", JSON.stringify(sent.limits));
    t.ck("the ticks", !!sent.checks?.named, JSON.stringify(sent.checks));
    t.ck("and the note", /umbrella page/i.test(sent.note || ""), String(sent.note));
    // A draft that could carry a status would be a verdict wearing its name.
    t.ck("and no status of its own", sent.status === undefined, String(sent.status));
    t.ck("the modal closed", await page.evaluate(() => !document.querySelector(".rv-draft")));
  }

  console.log("\n-- and every document type can be paused, not just insurance --");
  {
    // The bond, the agreement and the W-9 have different forms -- no coverage
    // grid, different confirmations, and two of them do not expire at all. The
    // Save button lives in the one action row they all share, and the only
    // way to know that is to press it on each.
    for (const kind of ["bond", "contract", "w9"]) {
      await page.keyboard.press("Escape");
      await wait(400);
      await openReview(page, kind);

      const shape = await page.evaluate(() => {
        const f = [...document.querySelectorAll(".form")].find((x) => /^Review /i.test(x.innerText));
        if (!f) return null;
        return {
          heading: f.querySelector("h2")?.innerText.trim(),
          save: [...f.querySelectorAll(".form-actions button")]
            .map((b) => ({ text: b.innerText.trim(), disabled: b.disabled }))
            .find((b) => /finish later/i.test(b.text)) || null,
        };
      });
      t.ck(`${kind}: the review opened`, !!shape?.heading, JSON.stringify(shape));
      t.ck(`${kind}: Save and finish later is there`, !!shape?.save, JSON.stringify(shape?.save));
      t.ck(`${kind}: and is pressable on an untouched form`, shape?.save?.disabled === false,
        JSON.stringify(shape?.save));

      // Type something only this document's form has, then park it.
      const before = saved.length;
      await page.evaluate((who) => {
        const f = [...document.querySelectorAll(".form")].find((x) => /^Review /i.test(x.innerText));
        const el = f.querySelector(".rv-issuer input");
        const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
        d.set.call(el, who); el.dispatchEvent(new Event("input", { bubbles: true }));
        f.querySelector(".rv-check input")?.click();
      }, `Who wrote the ${kind}`);
      await wait(300);
      await page.evaluate(() => {
        const f = [...document.querySelectorAll(".form")].find((x) => /^Review /i.test(x.innerText));
        [...f.querySelectorAll(".form-actions button")].find((b) => /finish later/i.test(b.innerText))?.click();
      });
      await wait(900);

      const hit = saved[saved.length - 1];
      t.ck(`${kind}: it saved`, saved.length === before + 1, `${before} -> ${saved.length}`);
      t.ck(`${kind}: against the right document`, hit?.kind === kind, String(hit?.kind));
      t.ck(`${kind}: carrying what was typed`,
        hit?.body?.draft?.issuer === `Who wrote the ${kind}`, JSON.stringify(hit?.body?.draft?.issuer));
      t.ck(`${kind}: and the confirmation that was ticked`,
        Object.values(hit?.body?.draft?.checks || {}).some(Boolean),
        JSON.stringify(hit?.body?.draft?.checks));
      // A draft is never a verdict, whichever document it is.
      t.ck(`${kind}: with no status of its own`, hit?.body?.draft?.status === undefined
        && hit?.body?.status === undefined, JSON.stringify(hit?.body));
    }
  }

  console.log("\n-- nothing threw --");
  t.ck("no page errors", crashes.length === 0, crashes.join(" | "));
  await ctx?.close?.();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
