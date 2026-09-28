// What a subcontractor's own account looks like once they are inside it.
//
// They signed up to send a compliance pack. What they were given was a hiring
// account's home screen: a set-up checklist reading "Bring your subcontractors
// in -- 0 of 3", "Approve their documents" and "Create your first job", and no
// nav item for their own documents at all.
//
// None of those three is wrong for a general contractor. All three are wrong
// for a roofer, and "0 of 3" reads as a quota they are already failing on a
// screen they have just arrived at.
//
// What this covers:
//
//   THE CHECKLIST IS THEIRS: add the four documents, send them to somebody.
//   Not a shorter version of the hiring list -- a different list.
//
//   AND IT NAMES WHAT IS MISSING. "2 of 4" does not say which two, which is
//   the only thing worth knowing at that moment.
//
//   MY DOCUMENTS IS IN THE NAV. The panel already existed in Account ->
//   Company; ROLES.admin just had no way to it but Account, Company, scroll.
//   One implementation, two ways in -- a second copy would be two components
//   holding the same upload state.
//
//   AND ITS BADGE COUNTS PRESENCE, NOT APPROVAL. missingDocs() asks whether a
//   HIRING account has verified a document, and nobody verifies your own --
//   each client reviews separately -- so that test is false forever and the
//   badge would read 4 after uploading all four.
//
//   node scripts/sub-home-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-subhome-test");
const WEB = 5267, API = 8969;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = (kind) => ({
  id: "acc_orcas", name: "Orcas Roofing", subdomain: "orcasroofing", kind,
  plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_jason", name: "Jason", email: "jason@orcas.test", role: "admin" },
});

let KIND = "subcontractor";
const patched = [];
const uploaded = [];
const shared = [];
const savedCompany = [];
let WEATHER = {};
let MY_COMPANY = {
  companyId: "cmp_own_acc_orcas", company: "Orcas Roofing", contact: "Jason",
  email: "jason@orcas.test", license: null, docs: {}, sharesSent: 0,
  findable: true, code: null, url: null,
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/account" && method === "PATCH") {
    patched.push(body);
    if (body && body.kind) KIND = body.kind;   // the server would, so the stub does
    return [200, ACCOUNT(KIND)];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT(KIND)];
  if (path === "/api/account") return [200, ACCOUNT(KIND)];
  if (path === "/api/my-company" && method === "PATCH") {
    savedCompany.push(body);
    if (body && body.openToHire !== undefined) {
      MY_COMPANY = { ...MY_COMPANY, openToHire: !!body.openToHire, openAnswered: true };
    }
    return [200, { ok: true }];
  }
  if (path === "/api/my-company") return [200, MY_COMPANY];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/weather") return [200, WEATHER];
  if (path === "/api/account-users") return [200, [
    { id: "u_jason", name: "Jason", email: "jason@orcas.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  // Uploading from the pack card is the real two-call path: the file to R2,
  // then the row against the company. The stub answers both and records the
  // second, so the test can say WHICH document was uploaded and against which
  // company id rather than only that something happened.
  if (path.startsWith("/api/uploads/")) return [200, { key: `k_${path.split("/")[3]}` }];
  const doc = path.match(/^\/api\/subs\/([^/]+)\/documents\/([^/]+)$/);
  if (doc && method === "POST") {
    uploaded.push({ companyId: doc[1], kind: doc[2], ...body });
    // The server works the expiry out, so the card has to re-read rather than
    // invent one -- which is what makes a stale row visible here.
    MY_COMPANY = { ...MY_COMPANY,
      docs: { ...MY_COMPANY.docs, [doc[2]]: { fileName: body?.fileName || "f.pdf" } } };
    return [200, { ok: true }];
  }
  if (path === "/api/doc-shares" && method === "POST") {
    shared.push(body);
    return [200, { ok: true }];
  }
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "orcasroofing", webPort: WEB,
    seat: { userId: "u_jason", accountId: "acc_orcas" },
    viewport: { width: 1200, height: 1400 } });
  for (let n = 0; n < 30; n++) {
    await wait(250);
    if (await r.page.$(".gs-card")) break;
  }
  return r;
};
const steps = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".gs-steps li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()));
const navItems = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav.tabs button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));

try {
  console.log("\n-- the greeting knows what time it is --");
  {
    KIND = "subcontractor";
    WEATHER = {};
    // Frozen clocks, because a greeting that depends on when the suite runs
    // is a greeting that fails at 5am and nobody knows why.
    const at = async (hour) => {
      const r = await visitApp(browser, { host: "orcasroofing", webPort: WEB,
        seat: { userId: "u_jason", accountId: "acc_orcas" },
        viewport: { width: 1200, height: 1400 },
        onNewDocument: `(() => {
          const H = ${hour};
          const Real = Date;
          class Fixed extends Real {
            constructor(...a) { super(...(a.length ? a : [Real.now()])); }
            getHours() { return H; }
          }
          Fixed.now = Real.now;
          window.Date = Fixed;
        })()` });
      for (let n = 0; n < 30; n++) {
        await wait(200);
        if (await r.page.$(".dash-hello h2")) break;
      }
      const text = await r.page.evaluate(() =>
        document.querySelector(".dash-hello h2")?.innerText.trim() || "");
      await r.ctx.close();
      return text;
    };

    t.ck("morning says morning", /^Good morning, Jason$/.test(await at(8)), await at(8));
    t.ck("the afternoon says afternoon", /^Good afternoon, Jason$/.test(await at(14)));
    t.ck("the evening says evening", /^Good evening, Jason$/.test(await at(20)));
    // Somebody on a dashboard at 3am is doing something they will remember.
    t.ck("and the small hours get their own", /^Still up, Jason$/.test(await at(3)));
  }

  console.log("\n-- and shows the weather when there is any --");
  {
    KIND = "subcontractor";
    WEATHER = { tempF: 54.4, code: 61, place: "Seattle" };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 30; n++) {
      await wait(200);
      if (await page.$(".hello-wx")) break;
    }
    const wx = await page.evaluate(() => {
      const el = document.querySelector(".hello-wx");
      return el ? { text: el.innerText.trim(), title: el.getAttribute("title") } : null;
    });
    t.ck("the chip is there", !!wx, String(wx));
    t.ck("rounded to a whole degree", /^54°F/.test(wx?.text || ""), wx?.text);
    t.ck("and named in words a roofer would use", /Rain$/.test(wx?.text || ""), wx?.text);
    t.ck("with the place on the tooltip", wx?.title === "Seattle", String(wx?.title));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and is silent when there is not --");
  {
    // Decoration. An account with no city on it, or an outbound call that
    // failed, must cost a chip and never a dashboard.
    KIND = "subcontractor";
    WEATHER = {};
    const { ctx, page, crashes } = await open();
    await wait(900);
    t.ck("no chip at all", await page.evaluate(() => !document.querySelector(".hello-wx")));
    t.ck("but the greeting is still there",
      await page.evaluate(() => /^Good /.test(
        document.querySelector(".dash-hello h2")?.innerText.trim() || "")
        || /^Still up/.test(document.querySelector(".dash-hello h2")?.innerText.trim() || "")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the checklist a subcontractor gets --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: {}, sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    const list = await steps(page);
    const all = list.join(" | ");

    t.ck("there is a checklist", list.length > 0, String(list.length));
    // THE THREE THAT WERE WRONG.
    t.ck("nothing about bringing subcontractors in", !/bring your subcontractors/i.test(all), all);
    t.ck("nothing about approving their documents", !/approve their documents/i.test(all), all);
    t.ck("and no create-your-first-job", !/first job/i.test(all), all);

    // THE TWO THAT MATTER.
    // One row per thing, because a counter does not say which two are missing
    // and the two it does not name are the whole task.
    t.ck("the trades line is about being hired, not hiring",
      /trades you want to be hired for/i.test(all), all);
    t.ck("insurance is its own row", /certificate of insurance/i.test(all), all);
    t.ck("so is the bond", /surety bond/i.test(all), all);
    t.ck("so is the W-9", /add your w-9/i.test(all), all);
    t.ck("and sending it is the last one", /send your pack/i.test(all), all);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and it moves as they do the work --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: { insurance: { fileName: "coi.pdf" }, w9: { fileName: "w9.pdf" } },
      sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    // Only the CURRENT step carries its note and buttons; a finished one is
    // its title and a tick. So the thing to assert is which row is which.
    const marked = await page.evaluate(() =>
      [...document.querySelectorAll(".gs-steps li")].map((li) => ({
        title: li.querySelector("b")?.innerText.trim() || "",
        state: li.className.replace("gs-step ", "").trim(),
      })));
    const stateOf = (re) => (marked.find((m) => re.test(m.title)) || {}).state;
    t.ck("insurance is ticked off", stateOf(/certificate of insurance/i) === "done",
      JSON.stringify(marked));
    t.ck("the W-9 too", stateOf(/w-9/i) === "done", JSON.stringify(marked));
    t.ck("and the bond is the one it is asking for now",
      stateOf(/surety bond/i) === "now", JSON.stringify(marked));
    t.ck("with the rest still to come",
      stateOf(/license/i) === "later", JSON.stringify(marked));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the pack is on the dashboard, permanently --");
  {
    // The set-up checklist is temporary by design -- it disappears when
    // finished and can be dismissed before that -- and what it stands in front
    // of is the thing the account is FOR. Somebody asked for their insurance on
    // a job site needs that answer every day, not only in week one.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1234",
      docs: { insurance: { fileName: "coi.pdf", expiresOn: "2027-06-30" },
        bond: { fileName: "bond.pdf", expiresOn: "2024-01-01" } },
      sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows li")].map((li) => ({
        label: li.querySelector(".cpr-lab")?.innerText.trim(),
        note: li.querySelector(".cpr-note")?.innerText.trim(),
        state: li.className.trim(),
      })));
    t.ck("the card is there", rows.length > 0, JSON.stringify(rows.length));
    const row = (re) => rows.find((r) => re.test(r.label || "")) || {};
    // The date, not just "on file" -- a certificate current today and lapsing
    // Friday is the whole reason this card exists, and "on file" is the claim
    // an attached PDF already makes and cannot keep.
    t.ck("a current document carries its expiry date",
      /Expires/i.test(row(/insurance/i).note || "") && /2027/.test(row(/insurance/i).note || ""),
      JSON.stringify(row(/insurance/i)));
    t.ck("and is green", /tone-green/.test(row(/insurance/i).state || ""),
      JSON.stringify(row(/insurance/i)));
    t.ck("a lapsed one says so and is red",
      /Expired/i.test(row(/bond/i).note || "") && /tone-red/.test(row(/bond/i).state || ""),
      JSON.stringify(row(/bond/i)));
    t.ck("one not added says that", /Not added/i.test(row(/w-9/i).note || ""),
      JSON.stringify(row(/w-9/i)));
    // Optional, and off this card. It is the HIRING account's own form, and
    // plenty of contractors never send one -- so a row for it here is a to-do
    // most subcontractors can never tick.
    t.ck("no signed-agreement row on the dashboard card",
      !rows.some((r) => /agreement/i.test(r.label || "")),
      JSON.stringify(rows.map((r) => r.label)));
    // The dot carries the state, so it must not be the only thing that does.
    t.ck("every row says its state in words too",
      rows.every((r) => (r.note || "").length > 0), JSON.stringify(rows));
    t.ck("the licence row names the state it is from",
      /OR/.test(row(/license/i).label || ""), JSON.stringify(row(/license/i)));

    // THE ONE THAT MUST NOT BE HARDCODED. A UBI is Washington's Unified
    // Business Identifier and does not exist in the other fifty, so a row for
    // it in Oregon is a line nobody there can ever complete.
    t.ck("no UBI row outside Washington",
      !rows.some((r) => /UBI/i.test(r.label || "")), JSON.stringify(rows.map((r) => r.label)));

    // And the send is in the card, as one button rather than an always-open
    // form: six rows plus a field and a paragraph made the card longer than
    // the thing it summarises.
    const sendBtn = await page.evaluate(() =>
      document.querySelector(".cpack-go")?.innerText.replace(/\s+/g, " ").trim() || "");
    t.ck("there is a send CTA on the card", /send to contractor/i.test(sendBtn), sendBtn);
    t.ck("and the form is not open until it is pressed",
      await page.evaluate(() => !document.querySelector(".cpack .qsend-row input")));
    await page.evaluate(() => document.querySelector(".cpack-go")?.click());
    for (let n = 0; n < 25; n++) { await wait(150); if (await page.$(".qs-modal")) break; }
    t.ck("pressing it opens the email form in a modal",
      await page.evaluate(() => !!document.querySelector(".qs-modal .qsend-row input")));

    // Only two of four are on file here, so it must not claim the pack is
    // complete -- and it must still offer the send, because the server allows
    // it and the commonest ask is for the certificate alone.
    const note = await page.evaluate(() =>
      document.querySelector(".cpack-sendnote")?.innerText.replace(/\s+/g, " ").trim() || "");
    t.ck("a partial pack says what is still missing",
      /still to come/i.test(note) && /W-9/i.test(note), note);
    t.ck("and does not claim to be complete", !/everything is on file/i.test(note), note);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the dot is a traffic light, and amber is the point of it --");
  {
    // Green / amber / red comes from docStatus in shared/docs.js, not from a
    // comparison written on the card. A second opinion on "close to expiring"
    // would make this card disagree with every roster in the product about the
    // same certificate.
    KIND = "subcontractor";
    const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1", ubi: "",
      docs: {
        insurance: { fileName: "coi.pdf", expiresOn: iso(400) },   // green
        bond: { fileName: "bond.pdf", expiresOn: iso(12) },        // amber
        w9: { fileName: "w9.pdf" },                                // green, never expires
      }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows li")].map((li) => ({
        label: li.querySelector(".cpr-lab")?.innerText.trim(),
        note: li.querySelector(".cpr-note")?.innerText.trim(),
        cls: li.className.trim(),
        tick: !!li.querySelector(".cpr-dot svg"),
      })));
    const r = (re) => rows.find((x) => re.test(x.label || "")) || {};

    t.ck("plenty of room left is green", /tone-green/.test(r(/insurance/i).cls || ""),
      JSON.stringify(r(/insurance/i)));
    t.ck("inside the warning window is amber", /tone-amber/.test(r(/bond/i).cls || ""),
      JSON.stringify(r(/bond/i)));
    // A blank expiry means "does not expire", never "unknown" -- if it meant
    // doubt, two thirds of every roster would sit permanently amber and people
    // would learn to ignore the colour.
    t.ck("no expiry means it does not expire, so green",
      /tone-green/.test(r(/w-9/i).cls || "") && /on file/i.test(r(/w-9/i).note || ""),
      JSON.stringify(r(/w-9/i)));

    // The colour must not be the only thing that says it.
    t.ck("amber says how long is left in words too", /\d+d\b/.test(r(/bond/i).note || ""),
      JSON.stringify(r(/bond/i)));
    t.ck("and still names the date", /Expires/i.test(r(/bond/i).note || ""),
      JSON.stringify(r(/bond/i)));
    // A tick means "nothing to do". Amber is on file AND needs renewing.
    t.ck("green carries the tick", r(/insurance/i).tick === true, JSON.stringify(r(/insurance/i)));
    t.ck("amber does not", r(/bond/i).tick === false, JSON.stringify(r(/bond/i)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and the optional agreement never holds the pack back --");
  {
    // All three REQUIRED documents, no agreement. The pack is done.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1", ubi: "",
      docs: { insurance: { fileName: "a" }, bond: { fileName: "b" }, w9: { fileName: "d" } },
      sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const go = await page.evaluate(() => ({
      cls: document.querySelector(".cpack-go")?.className || "",
      note: document.querySelector(".cpack-sendnote")?.innerText || "",
      sub: document.querySelector(".cpack-sub")?.innerText || "",
    }));
    t.ck("three of three counts as complete", /btn-solid/.test(go.cls), go.cls);
    t.ck("and it says so", /everything is on file/i.test(go.note), go.note);
    t.ck("no agreement is named as outstanding", !/agreement/i.test(go.note), go.note);
    t.ck("and the readiness line does not count it", !/of 5\b/.test(go.sub), go.sub);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- every pack row can be answered from the row --");
  {
    // The card named the missing thing and then offered no way to supply it,
    // so the only route from "certificate of insurance: Not added" to a
    // certificate on file was Account, Company, scroll. That is where a
    // checklist item goes cold.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", license: "", ubi: "",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    uploaded.length = 0;
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }

    const controls = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows li")].map((li) => ({
        label: li.querySelector(".cpr-lab")?.innerText.trim(),
        cta: li.querySelector(".cpr-do")?.innerText.replace(/\s+/g, " ").trim() || "",
        file: !!li.querySelector(".cpr-do input[type=file]"),
        tick: !!li.querySelector(".cpr-dot svg"),
      })));
    const c = (re) => controls.find((x) => re.test(x.label || "")) || {};

    t.ck("a missing document offers Upload", /^Upload$/i.test(c(/bond/i).cta), JSON.stringify(c(/bond/i)));
    t.ck("and it really is a file input", c(/bond/i).file === true, JSON.stringify(c(/bond/i)));
    t.ck("one on file offers Replace instead", /^Replace$/i.test(c(/insurance/i).cta),
      JSON.stringify(c(/insurance/i)));
    // The confirmation. An empty ring while it is missing, a tick once it is
    // there -- one mark, in one place, so the row reads at a glance.
    t.ck("and carries a tick", c(/insurance/i).tick === true, JSON.stringify(c(/insurance/i)));
    t.ck("a missing one does not", c(/bond/i).tick === false, JSON.stringify(c(/bond/i)));

    // A licence number is a column somebody types, not a file. A button
    // reading Upload over a text field is a screen that lies.
    t.ck("the licence row says Add, not Upload", /^Add$/i.test(c(/license/i).cta),
      JSON.stringify(c(/license/i)));
    t.ck("and offers no file input", c(/license/i).file === false, JSON.stringify(c(/license/i)));
    t.ck("nor does the UBI row", /^Add$/i.test(c(/UBI/i).cta) && c(/UBI/i).file === false,
      JSON.stringify(c(/UBI/i)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and uploading from the card actually uploads --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1", ubi: "",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    uploaded.length = 0;
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }

    // Drive the real input rather than calling the handler, so the wiring
    // between the label, the hidden input and the two API calls is what is
    // under test.
    const handle = await page.evaluateHandle(() => {
      const li = [...document.querySelectorAll(".cpack-rows li")]
        .find((x) => /bond/i.test(x.querySelector(".cpr-lab")?.innerText || ""));
      return li?.querySelector("input[type=file]");
    });
    const el = handle.asElement();
    t.ck("the bond row has a file input to drive", !!el);
    if (el) {
      const tmp = join(app, "dist-subhome-test", "bond.pdf");
      (await import("node:fs")).writeFileSync(tmp, "%PDF-1.4 bond");
      await el.uploadFile(tmp);
      for (let n = 0; n < 40 && !uploaded.length; n++) await wait(150);
    }
    t.ck("it uploaded exactly once", uploaded.length === 1, JSON.stringify(uploaded));
    t.ck("against the right document", uploaded[0]?.kind === "bond", JSON.stringify(uploaded[0]));
    t.ck("and the caller's own company", uploaded[0]?.companyId === "cmp_own_acc_orcas",
      JSON.stringify(uploaded[0]));

    // Re-read, not patched in place: the row's note is the expiry the SERVER
    // worked out, so a locally invented "On file" would disagree with it the
    // moment a certificate carries a date.
    for (let n = 0; n < 40; n++) {
      await wait(150);
      const done = await page.evaluate(() => {
        const li = [...document.querySelectorAll(".cpack-rows li")]
          .find((x) => /bond/i.test(x.querySelector(".cpr-lab")?.innerText || ""));
        return !!li && li.classList.contains("ok");
      });
      if (done) break;
    }
    const after = await page.evaluate(() => {
      const li = [...document.querySelectorAll(".cpack-rows li")]
        .find((x) => /bond/i.test(x.querySelector(".cpr-lab")?.innerText || ""));
      return { ok: li?.classList.contains("ok"), tick: !!li?.querySelector(".cpr-dot svg"),
        cta: li?.querySelector(".cpr-do")?.innerText.trim() };
    });
    t.ck("the row ticks over without a reload", after.ok === true && after.tick === true,
      JSON.stringify(after));
    t.ck("and now offers Replace", /Replace/i.test(after.cta || ""), JSON.stringify(after));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a complete pack leads with the send --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1", ubi: "",
      docs: { insurance: { fileName: "a" }, bond: { fileName: "b" },
        contract: { fileName: "c" }, w9: { fileName: "d" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const go = await page.evaluate(() => {
      const b = document.querySelector(".cpack-go");
      return { cls: b?.className || "", note: document.querySelector(".cpack-sendnote")?.innerText || "" };
    });
    t.ck("the CTA is the primary button once everything is on file",
      /btn-solid/.test(go.cls), go.cls);
    t.ck("and says so", /everything is on file/i.test(go.note), go.note);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a Washington company is asked for its UBI --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", ubi: null, license: "ORCASR891QZ",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".cpack-rows .cpr-lab")].map((x) => x.innerText.trim()));
    t.ck("the UBI row appears in WA", labels.some((l) => /UBI/i.test(l)), labels.join(" | "));
    const all = (await steps(page)).join(" | ");
    t.ck("and it is a checklist step there too", /Add your UBI/i.test(all), all);
    t.ck("with the licence naming Washington", /Washington contractor license/i.test(all), all);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- with nothing on file there is nothing to send --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", docs: {}, sharesSent: 0, ubi: null };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    // The server refuses an empty pack with nothing_on_file, so a send field
    // here would be a button the server will refuse.
    t.ck("no send field with an empty pack",
      await page.evaluate(() => !document.querySelector(".cpack .qsend-row input")));
    t.ck("and it says what unlocks it",
      await page.evaluate(() => !!document.querySelector(".cpack-empty")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- being hired as a subcontractor is a switch, and it is off by default --");
  {
    // Findable used to be a side effect of having filled the profile in: an
    // email, a mobile or a licence on the row, and any account typing one of
    // those whole values could ask you to connect. Right for a subcontractor,
    // wrong for a general contractor who signed up to run a roster -- and
    // nobody ever asked them.
    KIND = "general_contractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", docs: {}, sharesSent: 0,
      openToHire: false, openAnswered: false };
    savedCompany.length = 0;
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Compliance pack/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".mydocs")) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Company")?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".open-hire")) break; }

    const sw = await page.evaluate(() => {
      const el = document.querySelector(".open-hire");
      return el ? { on: el.classList.contains("on"),
        checked: el.querySelector("[role=switch]")?.getAttribute("aria-checked"),
        text: el.innerText.replace(/\s+/g, " ").trim(),
        findable: !!document.querySelector(".hire-state") } : null;
    });
    t.ck("the switch is there", !!sw, String(sw));
    t.ck("and a general contractor starts closed", sw?.on === false, JSON.stringify(sw));
    t.ck("said in the markup too, not only the colour", sw?.checked === "false", String(sw?.checked));
    t.ck("it names what it does",
      /available to be hired as a subcontractor/i.test(sw?.text || ""), sw?.text);
    // The QR code is somebody handing their details over, which is asking --
    // so it keeps working whatever the lookup does.
    t.ck("and says the QR code still works", /qr code still works/i.test(sw?.text || ""), sw?.text);
    // Nothing to say about being findable while nobody can look you up.
    t.ck("the findable line is hidden while it is off", sw?.findable === false, JSON.stringify(sw));

    await page.evaluate(() => document.querySelector(".open-hire [role=switch]")?.click());
    for (let n = 0; n < 30 && !savedCompany.length; n++) await wait(150);
    t.ck("flipping it saves", savedCompany.length === 1, JSON.stringify(savedCompany));
    t.ck("sending only the switch", Object.keys(savedCompany[0] || {}).join(",") === "openToHire",
      JSON.stringify(savedCompany[0]));
    t.ck("and turning it on", savedCompany[0]?.openToHire === true, JSON.stringify(savedCompany[0]));
    await wait(400);
    t.ck("the findable line appears once it is on",
      await page.evaluate(() => !!document.querySelector(".hire-state")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a subcontractor account starts open, because that is why they are here --");
  {
    KIND = "subcontractor";
    // The SERVER decides the default from the account kind and sends the
    // answer; the screen renders it rather than deriving a second opinion.
    MY_COMPANY = { ...MY_COMPANY, openToHire: true, openAnswered: false };
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Compliance pack/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".mydocs")) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Company")?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".open-hire")) break; }
    t.ck("a subcontractor starts open",
      await page.evaluate(() => !!document.querySelector(".open-hire.on")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the pack tab carries the same lights as the card --");
  {
    KIND = "subcontractor";
    const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    MY_COMPANY = { ...MY_COMPANY, state: "OR", openToHire: true,
      docs: {
        insurance: { fileName: "coi.pdf", expiresOn: iso(400) },
        bond: { fileName: "bond.pdf", expiresOn: iso(9) },
        w9: { fileName: "w9.pdf" },
      }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Compliance pack/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".mydocs")) break; }
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".mydoc")].map((d) => ({
        label: d.querySelector("b")?.innerText.trim(),
        cls: d.className, note: d.querySelector(".cx-sub")?.innerText.trim(),
        tick: !!d.querySelector(".mydoc-dot svg") })));
    const r = (re) => rows.find((x) => re.test(x.label || "")) || {};

    // This tab is where somebody acts on their paperwork, so it cannot answer
    // "is this current?" differently from the card that sent them here.
    t.ck("plenty of room left is green", /tone-green/.test(r(/certificate of insurance/i).cls || ""),
      JSON.stringify(r(/certificate of insurance/i)));
    t.ck("and carries the tick", r(/certificate of insurance/i).tick === true,
      JSON.stringify(r(/certificate of insurance/i)));
    t.ck("inside the warning window is amber", /tone-amber/.test(r(/surety bond/i).cls || ""),
      JSON.stringify(r(/surety bond/i)));
    t.ck("which says how long is left", /\d+d\b/.test(r(/surety bond/i).note || ""),
      JSON.stringify(r(/surety bond/i)));
    t.ck("and what to do about it", /renew it/i.test(r(/surety bond/i).note || ""),
      JSON.stringify(r(/surety bond/i)));
    t.ck("never added is red", /tone-red/.test(r(/subcontractor agreement/i).cls || ""),
      JSON.stringify(r(/subcontractor agreement/i)));
    // A blank expiry means does not expire, never unknown.
    t.ck("no expiry means green, not amber", /tone-green/.test(r(/W-9/i).cls || ""),
      JSON.stringify(r(/W-9/i)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the compliance pack is reachable from the nav --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    const nav = await navItems(page);
    t.ck("it is in the nav at all", nav.some((x) => /^Compliance pack/i.test(x)), nav.join(" | "));
    // Presence, not approval: nobody verifies your own documents, so a badge
    // built on missingDocs() would read 4 after all four were uploaded. And
    // REQUIRED only -- the signed agreement is optional, so counting it would
    // leave a red number that never clears, which is how people learn to stop
    // reading badges. Insurance is on file, so: bond and W-9.
    const item = nav.find((x) => /^Compliance pack/i.test(x)) || "";
    t.ck("and badges the two required ones not on file", /\b2\b/.test(item), item);

    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Compliance pack/i.test(b.innerText))?.click());
    for (let n = 0; n < 25; n++) {
      await wait(200);
      if (await page.$(".mydocs")) break;
    }
    t.ck("pressing it lands on the documents themselves",
      await page.evaluate(() => !!document.querySelector(".mydocs")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- Account is four tabs now, not one that scrolls forever --");
  {
    // Company held seven panels: account kind, the whole trades grid, the
    // emergency contractor, the hireable profile, four documents, the send
    // panel, a QR code, incoming requests, the branding studio and eighty
    // lines of embed markup. The things people open it for most were furthest
    // down.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", license: "", ubi: "",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    // In through the compliance pack, which is the route somebody actually takes and
    // the one the suite already proves works.
    await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
      .find((b) => /^Compliance pack/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".mydocs")) break; }
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => b.innerText.trim())
        .filter((x) => ["Profile", "Company", "Branding", "Compliance pack", "Users",
          "Tenants", "Subscription"].includes(x)));

    t.ck("Branding is its own tab", tabs.includes("Branding"), tabs.join(" | "));
    // Branded, because "My documents" is not what a general contractor calls
    // them when they ask: they ask for your compliance pack, and the dashboard
    // card has said so all along.
    t.ck("and the documents tab is the compliance pack",
      tabs.includes("Compliance pack"), tabs.join(" | "));
    t.ck("not called My documents any more", !tabs.includes("My documents"), tabs.join(" | "));
    t.ck("Company is still there", tabs.includes("Company"), tabs.join(" | "));

    // Company keeps what the ACCOUNT is, and hands over what it was carrying
    // for other people.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Company")?.click());
    await wait(700);
    const co = await page.evaluate(() => ({
      docs: !!document.querySelector(".mydocs"),
      embed: !!document.querySelector(".embed-strip"),
      licence: !!document.querySelector(".fld-nums"),
      kind: /Account type/i.test(document.body.innerText),
      qr: !!document.querySelector(".cx-code"),
    }));
    t.ck("Company still says what the account is", co.kind === true, JSON.stringify(co));
    // The details FIRST. This tab opened on the account kind, the trades grid
    // and the emergency contractor -- three panels of settings -- with the
    // company's own name, licence and address below all of it. Settings are
    // what you change once; this is what you correct.
    const order = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".settings-panel")];
      const idx = (re) => panels.findIndex((x) => re.test(x.querySelector("h4")?.innerText || ""));
      return { details: idx(/working as a subcontractor/i), kind: idx(/account type/i),
        headings: panels.map((x) => x.querySelector("h4")?.innerText.trim()) };
    });
    t.ck("the company details are the first panel", order.details === 0,
      JSON.stringify(order.headings));
    t.ck("above the account type", order.details < order.kind, JSON.stringify(order.headings));
    t.ck("and still holds the licence and UBI", co.licence === true, JSON.stringify(co));
    t.ck("but no longer the documents", co.docs === false, JSON.stringify(co));
    t.ck("nor the embed snippet", co.embed === false, JSON.stringify(co));
    t.ck("nor the QR code", co.qr === false, JSON.stringify(co));
    // The branding studio is NOT asserted here on purpose: .brand-preview only
    // renders on Scale and this account is Basic, so a check for its absence
    // would pass whatever the tab said. test:embedplace covers the branding
    // tab on a Scale account, where the assertion can actually fail.

    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Compliance pack")?.click());
    await wait(700);
    const dp = await page.evaluate(() => ({
      docs: !!document.querySelector(".mydocs"),
      send: /Send your compliance pack/i.test(document.body.innerText),
      // One fetch, one source of truth: the two halves are one component with
      // a section prop, and only ever one of them is mounted.
      copies: document.querySelectorAll(".mydocs").length,
    }));
    t.ck("the documents are on their own tab", dp.docs === true, JSON.stringify(dp));
    t.ck("with the send panel beside them", dp.send === true, JSON.stringify(dp));
    t.ck("and there is exactly one of them", dp.copies === 1, String(dp.copies));

    // The code is on Profile. It is not a company setting -- it is the thing
    // you hold up on a job site -- and it already sits beside "Send my
    // documents" in the header menu for exactly that reason.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Profile")?.click());
    for (let n = 0; n < 30; n++) {
      await wait(200);
      if (await page.$(".cx-code")) break;
    }
    const pr = await page.evaluate(() => {
      const el = document.querySelector(".cx-code");
      return { there: !!el,
        heading: /Your code/i.test(document.body.innerText),
        copies: document.querySelectorAll(".cx-code").length };
    });
    t.ck("the QR code is on Profile", pr.there === true, JSON.stringify(pr));
    t.ck("under its own heading", pr.heading === true, JSON.stringify(pr));
    t.ck("and only once", pr.copies === 1, String(pr.copies));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and an account nobody can hire has no code to show --");
  {
    // A code for a company nobody can hire is a code for nothing, so the gate
    // that was on it inside Company had to travel with it.
    KIND = "property_manager";
    const { ctx, page, crashes } = await open();
    // Through the header's user menu, which is the route on a wide screen --
    // the drawer's copy of "My account" is display:none at this width.
    await page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
    await wait(400);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
    await wait(900);
    // Prove the panel is actually open first. "No QR code" on a screen that
    // never rendered is an assertion that cannot fail.
    const opened = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Profile"));
    t.ck("the account screen opened", opened === true, String(opened));
    t.ck("no QR code for a property manager",
      await page.evaluate(() => !document.querySelector(".cx-code")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- Manage lands on the pack and rings what is outstanding --");
  {
    // Scrolling to the right part of a long page is half of it. Somebody
    // pressing Manage has a specific question -- what is still missing -- and
    // a page that only scrolls has answered "here is your company profile".
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", license: "", ubi: "",
      docs: { insurance: { fileName: "coi.pdf" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    await page.evaluate(() => [...document.querySelectorAll(".cpack .sh-all")]
      .find((b) => /manage/i.test(b.innerText))?.click());
    for (let n = 0; n < 40; n++) { await wait(200); if (await page.$(".mydocs")) break; }

    t.ck("it opens the documents panel", await page.evaluate(() => !!document.querySelector(".mydocs")));
    t.ck("and not a second copy of the documents",
      await page.evaluate(() => document.querySelectorAll(".mydocs").length === 1),
      String(await page.evaluate(() => document.querySelectorAll(".mydocs").length)));

    for (let n = 0; n < 40; n++) { await wait(150); if (await page.$(".mydoc.lit")) break; }
    const lit = await page.evaluate(() => ({
      docs: [...document.querySelectorAll(".mydoc")].map((d) => ({
        label: d.querySelector("b")?.innerText.trim(), lit: d.classList.contains("lit") })),
      license: !!document.querySelector(".fld-nums .fld.lit input"),
      licenseLit: [...document.querySelectorAll(".fld-nums .fld")]
        .map((f) => ({ label: (f.innerText || "").split("\n")[0].trim(), lit: f.classList.contains("lit") })),
    }));
    const d = (re) => lit.docs.find((x) => re.test(x.label || "")) || {};

    // Only what is OUTSTANDING. Ringing a certificate already on file points
    // at the wrong thing; ringing all six when five are done buries the one
    // that matters.
    t.ck("a missing document is ringed", d(/surety bond/i).lit === true, JSON.stringify(lit.docs));
    t.ck("and so is the W-9", d(/W-9/i).lit === true, JSON.stringify(lit.docs));
    t.ck("one already on file is NOT ringed", d(/certificate of insurance/i).lit === false,
      JSON.stringify(lit.docs));
    // The licence and the UBI are on Company now, with the rest of the company
    // record, and they have their own Add buttons on the card that go there.
    // So Manage rings the documents and nothing else -- one press cannot ring
    // two tabs.
    t.ck("the licence field is not on this tab", lit.licenseLit.length === 0,
      JSON.stringify(lit.licenseLit));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and it rings nothing when there is nothing to do --");
  {
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "OR", license: "CCB-1", ubi: "",
      docs: { insurance: { fileName: "a" }, bond: { fileName: "b" },
        contract: { fileName: "c" }, w9: { fileName: "d" } }, sharesSent: 0 };
    const { ctx, page, crashes } = await open();
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".cpack")) break; }
    await page.evaluate(() => [...document.querySelectorAll(".cpack .sh-all")]
      .find((b) => /manage/i.test(b.innerText))?.click());
    for (let n = 0; n < 40; n++) { await wait(200); if (await page.$(".mydocs")) break; }
    await wait(600);
    t.ck("nothing is ringed when everything is done",
      await page.evaluate(() => !document.querySelector(".lit")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- pressing New job asks a question, and never sells a plan --");
  {
    // Creating a job is the hiring side's act. Sending a pack is the other
    // direction -- it says you work for somebody. So this is where a
    // subcontractor account stops being one, and the screen ASKS rather than
    // prompting an upgrade: it costs nothing, so a price, a plan name or a
    // limit on it would be inventing a transaction.
    KIND = "subcontractor";
    MY_COMPANY = { ...MY_COMPANY, state: "WA", docs: { insurance: { fileName: "c.pdf" } } };
    patched.length = 0;
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^\+?\s*New job$/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 25; n++) { await wait(200); if (await page.$(".bh-form")) break; }
    const said = await page.evaluate(() =>
      document.querySelector(".bh-form")?.innerText.replace(/\s+/g, " ").trim() || "");
    const head = await page.evaluate(() =>
      document.querySelector(".bh-form h2")?.innerText.trim() || "");

    t.ck("something opened", said.length > 0, said.slice(0, 60));
    // It is a question. Not "you need a general contractor account", which is a
    // requirement being announced -- somebody who does not hire anybody should
    // be able to read the heading and answer no.
    t.ck("the heading is a question", head.endsWith("?"), head);
    t.ck("and it asks about hiring", /hire/i.test(head), head);
    t.ck("it says why the button did nothing",
      /creating a job means somebody is going to work for you/i.test(said), said.slice(0, 160));
    t.ck("and what saying yes lets them do",
      /roster/i.test(said) && /create jobs/i.test(said), said);
    // Nothing is bought here, so nothing about buying is on it -- and that
    // includes the reassurance. Naming a plan to say it is included still
    // raises the question it is answering.
    t.ck("nothing to pay is said once", /nothing to pay/i.test(said), said);
    t.ck("no plan is named at all",
      !/\$/.test(said) && !/\bBasic\b/.test(said) && !/\bScale\b/.test(said)
        && !/upgrade/i.test(said) && !/\bplan\b/i.test(said), said);
    t.ck("and no limit is quoted",
      !/\b\d+\s+(contractors?|users?|jobs?)\b/i.test(said), said);
    t.ck("nothing they set up is lost",
      /nothing you have set up changes/i.test(said) && /still be hired/i.test(said), said);
    t.ck("it says what will change on their screen",
      /checklist/i.test(said) && /sign-in/i.test(said), said);
    t.ck("and that it is reversible", /change it back/i.test(said), said);
    t.ck("no job form opened behind it",
      await page.evaluate(() => !document.querySelector(".job-form")));

    // The chrome is the other half, and the words were clean before it was.
    // `up-badge` is the amber tint that means a limit has been hit and `up-buy`
    // is the green box a price sits in, so wearing either says "upgrade" to
    // somebody who has not read a word yet.
    t.ck("it does not wear the upgrade gate's chrome",
      await page.evaluate(() => {
        const f = document.querySelector(".bh-form");
        return !!f && !f.classList.contains("up-form")
          && !f.querySelector(".up-badge, .up-buy, .up-gets, .up-amt");
      }));

    // And pressing yes switches the account rather than only closing.
    await page.evaluate(() => [...document.querySelectorAll(".bh-form button")]
      .find((b) => /^yes\b/i.test(b.innerText.trim()))?.click());
    for (let n = 0; n < 30 && !patched.length; n++) await wait(200);
    t.ck("confirming patches the account", patched.length === 1, JSON.stringify(patched));
    t.ck("to the hiring kind", patched[0]?.kind === "general_contractor",
      JSON.stringify(patched[0]));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and afterwards the account reads as one --");
  {
    // The kind decides the checklist and the tagline, so the proof it took is
    // that the home screen changed.
    KIND = "general_contractor";
    MY_COMPANY = { ...MY_COMPANY, docs: { insurance: { fileName: "c.pdf" } } };
    const { ctx, page, crashes } = await open();
    const all = (await steps(page)).join(" | ");
    t.ck("the checklist is the hiring one now",
      /bring your subcontractors/i.test(all) && /first job/i.test(all), all);
    t.ck("and no longer asks for their own pack",
      !/certificate of insurance \(COI\)/i.test(all), all);
    // They are still hireable, so the pack itself has not gone anywhere.
    t.ck("but the compliance pack card is still there",
      await page.evaluate(() => !!document.querySelector(".cpack")));
    t.ck("and so is the compliance pack",
      (await navItems(page)).some((x) => /^Compliance pack/i.test(x)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a general contractor's home is untouched --");
  {
    KIND = "general_contractor";
    MY_COMPANY = { ...MY_COMPANY, docs: {}, sharesSent: 0, license: null };
    const { ctx, page, crashes } = await open();
    const all = (await steps(page)).join(" | ");
    t.ck("they are still asked to bring subcontractors in",
      /bring your subcontractors/i.test(all), all);
    t.ck("and to create a first job", /first job/i.test(all), all);
    t.ck("and are not asked for a compliance pack of their own",
      !/compliance pack/i.test(all), all);
    // They can be hired too, so the documents item is theirs as well.
    t.ck("but the compliance pack is there, because they can be hired",
      (await navItems(page)).some((x) => /^Compliance pack/i.test(x)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and an account that cannot be hired has no documents item --");
  {
    KIND = "property_manager";
    MY_COMPANY = { ...MY_COMPANY, docs: {} };
    const { ctx, page, crashes } = await open();
    // A landlord is nobody's subcontractor; an item answering 403 is worse
    // than no item.
    t.ck("no compliance pack for a property manager",
      !(await navItems(page)).some((x) => /^Compliance pack/i.test(x)),
      (await navItems(page)).join(" | "));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
