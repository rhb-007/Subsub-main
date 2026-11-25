// The agreement's terms are editable for one contractor, and the preview agrees.
//
// WHY THIS HAS TO BE A BROWSER TEST. `mergeTerms(stored.terms, body.terms)` has
// taken a per-subcontractor override since the issue route was written, and the
// panel has been posting `terms` on issue since then -- so every static check
// of both halves passed. The only thing that ever WROTE `terms` was the load,
// so every send carried the account's standing terms straight back. Correct
// pieces with no way in, which is only visible by driving the screen.
//
// Four properties, and the last is the one that is easy to lose:
//
//   IT IS EDITABLE AT ALL, on the contractor, which is what was asked for.
//
//   A NUMBER CARRIES ITS UNIT. "Warranty on the work: 36" does not say months,
//   and this grid already held five fields measured in days, months and years
//   with nothing on any of them saying which.
//
//   WHAT IS CHANGED IS COUNTED ON THE TOGGLE. The section is folded, because
//   most accounts use one set for everybody and that case must stay one press
//   -- so a modified set has to say so while it is shut.
//
//   AND THE PREVIEW SHOWS WHAT SEND WOULD PRODUCE. `data.preview` is the
//   server's render of the STANDING terms, so a warranty changed here would
//   have previewed at three years and sent at two: the screen-that-lies rule
//   pointed at the one screen whose whole job is showing somebody what they
//   are about to sign.
//
//   node --no-warnings scripts/agreement-terms-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-agrterms-test");
const WEB = 5291, API = 8991;
const t = tally();

const { TERM_FIELDS, defaultTerms } = await import("../shared/agreement.js");

const ACCOUNT = {
  id: "acc_out", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};

const SUB = {
  id: "cmp_bay", engagementId: "eng_bay", accountId: "acc_out",
  company: "Bay Roofing", contact: "Rae Ortiz", phone: "2065550002", email: "rae@bay.test",
  city: "Tacoma", state: "WA", zip: "98402", license: "BAY*112", ubi: "",
  categories: ["roofing"], caps: [], crews: [], coverage: { mode: "cities", cities: ["Tacoma"], radii: [] },
  propertyIds: [], rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
  bond: true, insurance: true, contract: false, available: true, notes: "",
  docFiles: {}, docReview: {}, status: "active", autoSchedule: 0,
  notify: { email: true, sms: false }, hasPortal: false, answersForItself: false,
};

const PARTIES = {
  kind: "general_contractor",
  hiring: { name: "Outerhome LLC", street: "1 Pike St", city: "Seattle", state: "WA", zip: "98101" },
  sub: { name: "Bay Roofing", street: "", city: "Tacoma", state: "WA", zip: "98402", license: "BAY*112" },
};

// The account's STANDING terms, which is what the override is measured against.
const STANDING = { ...defaultTerms(), governingState: "WA" };

let issued = [];
let calls = [];
let LIVE = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === `/api/subs/${SUB.id}/agreement` && method === "POST") {
    issued.push(body); calls.push(["issue", body]);
    return [200, { ok: true, emailed: !body.signedCopy, to: body.signedCopy ? null : "rae@bay.test",
      agreement: { id: "ag_1", status: "sent", source: body.source || "subsub_standard" } }];
  }
  if (path.startsWith("/api/uploads/") && method === "PUT") { calls.push(["upload", path]); return [200, { key: "acc_out/contract/x-signed.pdf" }]; }
  if (path === `/api/subs/${SUB.id}/documents/contract` && method === "POST") { calls.push(["doc", body]); return [200, { ok: true }]; }
  if (path === "/api/agreements/ag_1/countersign" && method === "POST") { calls.push(["countersign", body]); return [200, { ok: true }]; }
  if (path === "/api/notify/documents" && method === "POST") { calls.push(["docreq", body]); return [200, { ok: true, to: "rae@bay.test" }]; }
  if (path === "/api/agreements/ag_old/resend" && method === "POST") { calls.push(["resend", body]); return [200, { ok: true, to: "rae@bay.test" }]; }
  if (path === `/api/subs/${SUB.id}/agreement`) {
    return [200, {
      agreement: LIVE,
      // Deliberately the SERVER's render of the standing terms, exactly as the
      // route sends it. If the modal drew this rather than re-rendering, the
      // preview would not move when a term does -- which is the bug.
      preview: {
        templateId: "subsub-standard-subcontract", templateVersion: "1.1.0",
        title: "SubSub Standard Subcontractor Agreement",
        partyTerms: { hiring: "Contractor", hired: "Subcontractor" }, reviewed: null,
        sections: [{ id: "warranty", heading: "9. Warranty",
          paragraphs: ["This warranty runs for 3 years from the date the work under a work order is completed."] }],
      },
      previewTerms: STANDING, parties: PARTIES, requireByDefault: false, fields: TERM_FIELDS,
    }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/clients") return [200, []];
  if (path === "/api/account-users") return [200, [
    { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], jobIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openCard = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
    .find((b) => /^(Sub)?contractors/i.test(b.innerText))?.click());
  for (let n = 0; n < 30; n++) { await wait(250); if (await page.$(".grid .card")) break; }
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".grid .card")].find((c) => /Bay Roofing/i.test(c.innerText));
    card?.click();
  });
  for (let n = 0; n < 40; n++) { await wait(250); if (await page.$(".agr-panel")) break; }
  // The agreement is its own tab on the card now, and a hidden pane draws
  // its inputs at zero height.
  await page.evaluate(() => document.querySelector('.modal .sd-tabs [data-tab="agreement"]')?.click());
  await wait(400);
};
// Which agreement is asked first; the SubSub one opens its terms to edit.
const chooseStandard = async (page) => {
  await page.evaluate(() => document.querySelector('.agr-panel [data-act="use-standard"]')?.click());
  await wait(400);
};

const overrideBox = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-agr-edit]");
  if (!el) return null;
  const tog = el.querySelector(".agr-edit-head");
  return {
    toggle: (tog?.innerText || "").replace(/\s+/g, " ").trim(),
    open: !!el.querySelector(".agr-fields"),
    fields: [...el.querySelectorAll(".agr-field")].map((f) => ({
      label: (f.querySelector("span")?.innerText || "").trim(),
      unit: (f.querySelector(".agr-unit")?.innerText || "").trim(),
      value: f.querySelector("input")?.value ?? null,
    })),
    reset: [...el.querySelectorAll("button")].some((b) => /my defaults/i.test(b.innerText)),
    party: [...el.querySelectorAll("[data-agr-party] input, [data-agr-party] select")].map((i) => i.value),
  };
});

const setField = (page, label, value) => page.evaluate(([lab, v]) => {
  const f = [...document.querySelectorAll("[data-agr-edit] .agr-field")]
    .find((x) => (x.querySelector("span")?.innerText || "").trim() === lab);
  const i = f?.querySelector("input");
  if (!i) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(i, String(v));
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [label, value]);

try {
  console.log("\n-- the terms are editable on the contractor --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);

    // WITHOUT THIS EVERY ASSERTION BELOW IS ONE THAT CANNOT FAIL: "no editor"
    // on a card that never opened reads identically to an editor that is
    // missing.
    t.ck("the agreement panel is on the card, so the rest of this can fail",
      await page.evaluate(() => /Subcontractor agreement/i.test(
        document.querySelector(".agr-panel")?.innerText || "")),
      (await page.evaluate(() => (document.querySelector(".agr-panel")?.innerText || "").slice(0, 90))));

    // ASKED FIRST: which agreement. Nothing to edit until that is answered.
    const choice = await page.evaluate(() => [...document.querySelectorAll(".agr-choice .agr-opt")].map((o) => o.dataset.opt));
    t.ck("it asks first: SubSub's agreement or our own", JSON.stringify(choice) === '["standard","custom"]', JSON.stringify(choice));
    t.ck("and no terms are drawn before choosing", !(await overrideBox(page)));
    t.ck("the SubSub option can be read before choosing",
      await page.evaluate(() => !!document.querySelector('.agr-opt[data-opt="standard"] [data-act="view"]')));
    await chooseStandard(page);
    let box = await overrideBox(page);
    t.ck("the override section is there", !!box, String(box));
    // Choosing the SubSub agreement is choosing to edit its terms, so they
    // are open rather than folded behind a toggle.
    t.ck("and is open", box?.open === true, JSON.stringify(box?.toggle));
    t.ck("naming the contractor it is for", /Bay Roofing/.test(box?.toggle || ""), box?.toggle);
    t.ck("with nothing changed, it says nothing", !/changed/i.test(box?.toggle || ""), box?.toggle);

    box = await overrideBox(page);
    // THE FIELDS ARE FULL SIZE. TermFields is the same grid Account -> Company
    // draws, and its inputs were bare browser boxes there: short, small type.
    // Measured, because only the computed box knows whether the rule fired.
    const sizes = await page.evaluate(() => [...document.querySelectorAll("[data-agr-edit] .agr-in input")]
      .map((i) => ({ h: Math.round(i.getBoundingClientRect().height), f: parseFloat(getComputedStyle(i).fontSize) })));
    t.ck("the term inputs are at least 44px tall at 15px type",
      sizes.length > 0 && sizes.every((s) => s.h >= 44 && s.f >= 15), JSON.stringify(sizes.slice(0, 4)));
    t.ck("the warranty is one of the fields, at three years",
      box?.fields.some((f) => /Warranty on the work/i.test(f.label) && f.value === "36"),
      JSON.stringify(box?.fields.filter((f) => /warranty/i.test(f.label))));
    // A NUMBER WITH NO UNIT IS NOT AN EDITABLE VALUE.
    t.ck("and says months, rather than leaving 36 to be guessed at",
      box?.fields.find((f) => /Warranty on the work/i.test(f.label))?.unit === "months",
      JSON.stringify(box?.fields.find((f) => /Warranty on the work/i.test(f.label))));
    t.ck("the response clock is there too, in business hours",
      box?.fields.some((f) => /Respond to a warranty call/i.test(f.label)
        && f.value === "48" && f.unit === "business hours"),
      JSON.stringify(box?.fields.filter((f) => /respond/i.test(f.label))));
    // Offered only when there is something to reset: a control that does
    // nothing is a control somebody presses to find out.
    t.ck("and no reset while nothing is changed", box?.reset === false);
    // THE COMPANY DETAILS ARE HERE TOO, seeded from the account, because they
    // print on this agreement and Account -> Company no longer carries them.
    t.ck("your company details are on the card, filled in from the account",
      JSON.stringify(box?.party) === JSON.stringify(["Outerhome LLC", "1 Pike St", "Seattle", "WA"]), JSON.stringify(box?.party));
    t.ck("an admin is offered to make them the defaults, unticked",
      await page.evaluate(() => document.querySelector("[data-save-default] input")?.checked === false));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- changing one is counted, previewed, and sent --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await chooseStandard(page);

    t.ck("the warranty field can be typed into", await setField(page, "Warranty on the work", 24));
    await page.evaluate(() => {
      const i = document.querySelector("[data-agr-party] input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Outerhome Roofing LLC"); i.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-save-default] input")?.click();
    });
    await wait(350);
    let box = await overrideBox(page);
    // THE COUNT IS WHAT MAKES FOLDING SAFE: a modified set must never be
    // silently modified.
    t.ck("the heading counts what is different from the defaults",
      /2 changed/.test(box?.toggle || ""), box?.toggle);
    t.ck("and a reset appears now there is something to reset", box?.reset === true);

    // The preview has to move with it. This is the assertion the whole
    // livePreview memo exists for -- the stub's own preview says three years,
    // so a modal drawing `data.preview` would still say three.
    await page.evaluate(() => [...document.querySelectorAll(".agr-panel button")]
      .find((b) => /^Preview$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".agr-doc")) break; }
    const doc = await page.evaluate(() => (document.querySelector(".agr-doc")?.innerText || "").replace(/\s+/g, " "));
    t.ck("the preview shows the document", /Warranty/i.test(doc), doc.slice(0, 80));
    // It is SubSub's standard agreement, so no "starting point, not legal
    // advice" box over it: that read as an example rather than the form.
    const modalText = await page.evaluate(() => (document.querySelector(".agr-doc")?.closest(".modal")?.innerText || "").replace(/\s+/g, " "));
    t.ck("the preview carries no not-legal-advice box",
      !!modalText && !/legal advice/i.test(modalText), modalText.slice(0, 120));
    t.ck("and it runs for two years, not the account's three",
      /runs for 2 years/.test(doc) && !/runs for 3 years/.test(doc),
      (doc.match(/runs for [^.]*/) || [])[0]);
    // Rendered from the shared template, so the rest of the document is there
    // too -- proof it is a real render and not the stub's one-section preview.
    t.ck("rendered in full from the shared template, not the stub's stub",
      /Indemnity/i.test(doc) && /Governing law/i.test(doc), doc.slice(0, 60));

    await page.evaluate(() => [...document.querySelectorAll(".modal button, .modal .btn-ghost")]
      .find((b) => /Close|Cancel/i.test(b.innerText))?.click());
    await page.keyboard.press("Escape").catch(() => {});
    await wait(500);

    calls = [];
    t.ck("it offers to ask for the missing documents in the same press",
      await page.evaluate(() => /IRS Form W-9/.test(document.querySelector(".agr-askdocs:not(.agr-savedef)")?.innerText || "")
        && document.querySelector(".agr-askdocs:not(.agr-savedef) input")?.checked === true));
    await page.evaluate(() => document.querySelector('.agr-panel [data-act="send-standard"]')?.click());
    for (let n = 0; n < 40 && !calls.some((c) => c[0] === "docreq"); n++) await wait(150);
    t.ck("sending also sends the document request, after the agreement",
      calls.map((c) => c[0]).join(",") === "issue,docreq", JSON.stringify(calls.map((c) => c[0])));
    t.ck("and says both went", await page.evaluate(() =>
      /emailed to rae@bay\.test/i.test(document.querySelector(".agr-note")?.innerText || "")
      && /request for their documents went/i.test(document.querySelector(".agr-note")?.innerText || "")));
    // THE HALF THAT WAS BROKEN. The body posted the standing terms back
    // unchanged, because nothing could write them.
    t.ck("issuing sends the changed term", issued[0]?.terms?.warrantyMonths === 24,
      JSON.stringify(issued[0]?.terms?.warrantyMonths));
    t.ck("and the company name typed for this agreement", issued[0]?.hiringParty?.name === "Outerhome Roofing LLC",
      JSON.stringify(issued[0]?.hiringParty));
    t.ck("and that the admin asked to make them the defaults", issued[0]?.saveAsDefault === true);
    t.ck("and leaves the rest of the account's terms alone",
      issued[0]?.terms?.paymentDays === STANDING.paymentDays
        && issued[0]?.terms?.warrantyResponseHours === STANDING.warrantyResponseHours,
      JSON.stringify(issued[0]?.terms));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- our own agreement, signed by both, is uploaded and recorded --");
  {
    calls = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await page.evaluate(() => document.querySelector('.agr-panel [data-act="use-custom"]')?.click());
    await wait(400);
    const rec = () => page.evaluate(() => document.querySelector('[data-act="record-signed"]')?.disabled);
    t.ck("Record is shut until there is a file and a name", (await rec()) === true);
    const input = await page.$('[data-act="signed-file"]');
    await input.uploadFile(join(app, "public", "favicon.svg"));
    await page.evaluate(() => {
      const i = [...document.querySelectorAll(".agr-custom input")].find((x) => x.type !== "file");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Richard Braun"); i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    t.ck("and opens once both are there", (await rec()) === false);
    await page.evaluate(() => document.querySelector('[data-act="record-signed"]')?.click());
    for (let n = 0; n < 40 && !calls.some((c) => c[0] === "countersign"); n++) await wait(150);
    t.ck("it records the paper, uploads it, then confirms it, in that order",
      calls.map((c) => c[0]).join(",") === "issue,upload,doc,countersign", JSON.stringify(calls.map((c) => c[0])));
    t.ck("as their own paper, already signed, so nobody is emailed to sign it",
      calls[0]?.[1]?.source === "uploaded" && calls[0]?.[1]?.signedCopy === true, JSON.stringify(calls[0]?.[1]));
    t.ck("confirmed under the typed name", calls.find((c) => c[0] === "countersign")?.[1]?.typedName === "Richard Braun");
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- an agreement never emailed says so, and the button emails it --");
  {
    calls = [];
    LIVE = { id: "ag_old", status: "sent", source: "uploaded", waitingOn: "sub_upload", issuedAt: "2026-10-09 10:00:00",
      inForce: false, document: null,
      sends: [{ kind: "issued", at: "2026-10-09 10:00:00", by: "Richard Braun", to: null, emailed: false, emailTried: false }] };
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    const line = await page.evaluate(() => (document.querySelector('.agr-sends [data-send="issued"]')?.innerText || "").replace(/\s+/g, " "));
    t.ck("it does not claim an email failed", !/not emailed/.test(line) && /in SubSub only/.test(line), line);
    const btn = await page.evaluate(() => {
      const b = document.querySelector('.agr-panel [data-act="resend"]');
      return b ? { t: b.innerText.trim(), solid: b.classList.contains("btn-solid") } : null;
    });
    t.ck("the button says it sends the first email, as the primary action",
      btn?.t === "Email it to them" && btn?.solid === true, JSON.stringify(btn));
    await page.evaluate(() => document.querySelector('.agr-panel [data-act="resend"]')?.click());
    for (let n = 0; n < 30 && !calls.length; n++) await wait(150);
    t.ck("and pressing it emails them", calls[0]?.[0] === "resend");
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    LIVE = null;
  }

  console.log("\n-- text messages are coming soon, so they cannot be picked --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await page.evaluate(() => document.querySelector('.modal .sd-tabs [data-tab="overview"]')?.click());
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => /^Edit/.test(b.innerText.trim()))?.click());
    await wait(700);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => /More details/i.test(b.innerText))?.click());
    await wait(400);
    const sms = await page.evaluate(() => {
      const l = [...document.querySelectorAll(".notify-opt")].find((x) => /SMS/.test(x.innerText));
      if (!l) return null;
      const i = l.querySelector("input");
      return { disabled: i.disabled, checked: i.checked, soon: /Coming soon/.test(l.innerText), op: getComputedStyle(l).opacity };
    });
    t.ck("the SMS option is on the form", !!sms, JSON.stringify(sms));
    t.ck("grayed out, off, and says coming soon",
      sms?.disabled === true && sms?.checked === false && sms?.soon === true && Number(sms?.op) < 0.8, JSON.stringify(sms));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a sent agreement nobody has signed can be edited, and sending replaces it --");
  {
    issued = [];
    LIVE = { id: "ag_sent", status: "sent", source: "subsub_standard", waitingOn: "sub_sign", issuedAt: "2026-11-21 10:00:00",
      inForce: false, terms: { ...STANDING, warrantyMonths: 18 }, parties: PARTIES,
      document: { templateId: "subsub-standard-subcontract", templateVersion: "1.1.0", title: "SubSub Standard Subcontractor Agreement", sections: [] },
      sends: [{ kind: "issued", at: "2026-11-21 10:00:00", by: "Richard Braun", to: "rae@bay.test", emailed: true, emailTried: true }] };
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    t.ck("Edit terms is offered while it waits on them to sign",
      await page.evaluate(() => !!document.querySelector('.agr-panel [data-act="edit-terms"]')));
    await page.evaluate(() => document.querySelector('.agr-panel [data-act="edit-terms"]')?.click());
    await wait(400);
    const box = await overrideBox(page);
    t.ck("the editor opens on what was sent, not the defaults",
      box?.fields.find((f) => /Warranty on the work/i.test(f.label))?.value === "18",
      JSON.stringify(box?.fields.filter((f) => /Warranty on the work/i.test(f.label))));
    await setField(page, "Warranty on the work", 30);
    await wait(300);
    await page.evaluate(() => document.querySelector('.agr-panel [data-act="send-revised"]')?.click());
    for (let n = 0; n < 30 && !issued.length; n++) await wait(150);
    t.ck("sending asks the server to replace the one they have",
      issued[0]?.replace === true && issued[0]?.terms?.warrantyMonths === 30, JSON.stringify(issued[0] && { r: issued[0].replace, w: issued[0].terms?.warrantyMonths }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    LIVE = null;
  }

  console.log("\n-- Account -> Company no longer carries the terms --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".acct-tabs")) break; }
    const seen = await page.evaluate(() => ({ tabs: !!document.querySelector(".acct-tabs"),
      terms: /Your subcontractor agreement/i.test(document.body.innerText), grid: !!document.querySelector(".agr-fields") }));
    t.ck("the account screen opened, so the next check can fail", seen.tabs === true, JSON.stringify(seen));
    t.ck("and it has no standing terms panel", seen.terms === false && seen.grid === false, JSON.stringify(seen));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and reset puts it back --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await chooseStandard(page);
    await setField(page, "Respond to a warranty call within", 12);
    await wait(350);
    t.ck("a change is counted", /1 changed/.test((await overrideBox(page))?.toggle || ""));
    await page.evaluate(() => [...document.querySelectorAll("[data-agr-edit] button")]
      .find((b) => /my defaults/i.test(b.innerText))?.click());
    await wait(350);
    const box = await overrideBox(page);
    t.ck("reset clears the count", !/changed/i.test(box?.toggle || ""), box?.toggle);
    t.ck("and puts the value back", box?.fields.some((f) =>
      /Respond to a warranty call/i.test(f.label) && f.value === "48"),
      JSON.stringify(box?.fields.filter((f) => /respond/i.test(f.label))));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
