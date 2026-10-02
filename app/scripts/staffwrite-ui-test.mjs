// THE FORM OVER A CONTRACTOR WHO ANSWERS FOR THEMSELVES.
//
// Reported from an impersonated session as having no way to upload a document
// for such a sub. The cause was not about staff at all: the Documents block was
// gated on `locked`, which answers "may I rewrite their company record" --
// a different question from "may I put a certificate on file for them", which
// `mayWriteCompanyDocs` has always answered with any live engagement. So the
// route took the upload and the screen offered no control, for EVERY account.
//
// Driven in a browser because that is the only place the claim exists. The
// route was always right; what was wrong was what got drawn, and an assertion
// that the component mentions `uploadDoc` passed throughout.
//
// WHAT THIS SUITE CANNOT REACH, said rather than faked: the staff branch.
// `resumeSession` deliberately refuses to resume an impersonated session -- a
// refresh ends it, which is what stops the flag going stale against the token
// the API is checking -- so there is no way to land this harness in one. The
// staff half is pinned on the route instead, in `staffwrite-test.mjs`, where it
// is driven through a real `impersonation_sessions` row.
//
//   node --no-warnings scripts/staffwrite-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-staffwrite-test");
const WEB = 5323, API = 9021;
const t = tally();

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["painting"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Dana Reyes", email: "dana@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Dana Reyes", email: "dana@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const verified = { status: "verified", checks: {}, limits: {} };
const sub = (over) => ({
  id: over.id, engagementId: `en_${over.id}`, accountId: "acc_x",
  company: over.company, contact: "Juan Soto", phone: "(206)555-0111", email: "juan@x.test",
  city: "Seattle", state: "WA", zip: "98101", license: "PACAM*111",
  licenseCheck: null, crews: [], coverage: { mode: "cities", cities: ["Seattle"] },
  available: true, unavailableDays: [], warranty: null,
  insurance: 1, bond: 0, contract: 0, w9: 0,
  docFiles: { insurance: "coi-2026.pdf" },
  notify: { email: true, sms: false }, docReview: { insurance: verified },
  categories: ["painting"], caps: [], rating: null, ratedJobs: 0, accepted: 0, declined: 0,
  notes: "", status: "active", propertyIds: [], autoSchedule: false, engagedAs: "subcontractor",
  docs: { insurance: { fileName: "coi-2026.pdf", expiresOn: "2030-01-01" } },
  docState: "missing", docAssignable: false, docSoonest: null,
  ...over,
});
// The only pair either direction can be told apart on: one company answers for
// itself, one does not, on the same account with the same documents.
const SUBS = () => [
  sub({ id: "cmp_pac", company: "Pacific apartment maintenance",
    answersForItself: true, hasPortal: true }),
  sub({ id: "cmp_har", company: "Harbour Glass",
    answersForItself: false, hasPortal: false }),
];

const calls = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, SUBS()];
  const up = /^\/api\/subs\/([^/]+)\/documents\/([^/]+)$/.exec(path);
  if (up && method === "POST") {
    calls.push({ what: "upload", companyId: up[1], kind: up[2], fileName: body?.fileName });
    return [200, { ok: true }];
  }
  if (up && method === "DELETE") {
    calls.push({ what: "delete", companyId: up[1], kind: up[2] });
    return [200, { ok: true }];
  }
  if (/^\/api\/subs\/[^/]+$/.test(path) && method === "PATCH") {
    calls.push({ what: "patch", body });
    return [200, { ok: true }];
  }
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") {
    return [200, { status: "none", ready: false, requirements: [], configured: false }];
  }
  if (path === "/api/jobs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits"
    || path === "/api/inspections") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openEdit = async (company) => {
  const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
  await wait(2600);
  // The roster noun follows the account kind, so this matches either word.
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^(Sub)?contractors/i.test((b.innerText || "").trim()))?.click());
  await wait(800);
  await page.evaluate((who) => {
    const c = [...document.querySelectorAll(".grid .card")]
      .find((x) => new RegExp(who, "i").test(x.innerText || ""));
    if (c) c.click();
  }, company);
  await wait(800);
  await page.evaluate(() => [...document.querySelectorAll(".modal button")]
    .find((b) => /^Edit$/i.test((b.innerText || "").trim()))?.click());
  await wait(800);
  return { ctx, page };
};

const form = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll(".doc-manage-row")].map((r) => ({
    label: (r.querySelector(".dm-label")?.innerText || "").trim(),
    file: (r.querySelector(".dm-file")?.innerText || "").trim() || null,
    upload: !!r.querySelector(".dm-upload"),
    replace: !!r.querySelector(".dm-replace"),
    del: !!r.querySelector(".dm-delete"),
  }));
  return {
    rows,
    refusal: !!document.querySelector(".doc-block:not(.doc-block-staff)"),
    staffNote: !!document.querySelector(".doc-block-staff"),
    // The company half lives on step 1 and is simply absent on a locked form.
    steps: [...document.querySelectorAll(".sf-steps button")].length,
    companyBox: !!document.querySelector(".modal input[placeholder]")
      && !![...document.querySelectorAll(".modal label")]
        .find((l) => /^Company/i.test((l.innerText || "").trim())),
  };
});

try {
  console.log("\n-- a contractor who answers for themselves --");
  {
    const { ctx, page } = await openEdit("Pacific apartment maintenance");
    const f = await form(page);
    // The rule has not moved: the company half is still not theirs to rewrite.
    t.ck("the refusal pane is still drawn", f.refusal === true, JSON.stringify(f));
    t.ck("and the three-step company form is still gone", f.steps === 0, String(f.steps));
    t.ck("no staff note, because this is not a staff session", f.staffNote === false);

    // THE REPORTED BUG. The documents block was hidden by the same gate, and
    // the route would have taken every one of these uploads.
    t.ck("the documents block is drawn", f.rows.length === 4, JSON.stringify(f.rows.map((r) => r.label)));
    t.ck("all four kinds are on it",
      ["IRS Form W-9", "Certificate of insurance", "Surety bond", "Subcontractor agreement"]
        .every((l) => f.rows.some((r) => r.label === l)), JSON.stringify(f.rows.map((r) => r.label)));
    t.ck("the three with nothing on file offer Upload",
      f.rows.filter((r) => r.upload).length === 3, JSON.stringify(f.rows));
    t.ck("and the one on file offers Replace",
      f.rows.filter((r) => r.replace).length === 1 && f.rows.find((r) => r.replace)?.file === "coi-2026.pdf",
      JSON.stringify(f.rows.find((r) => r.replace)));

    // UPLOADING IS ADDITIVE AND DELETING IS NOT. The route is unchanged and
    // still allows a delete; the screen declines to put a control that takes
    // somebody off every roster they are on onto a record they answer for.
    t.ck("but nothing offers Delete on their record",
      f.rows.every((r) => !r.del), JSON.stringify(f.rows));
    // AND IT SAYS WHERE THE FILE GOES, which is the one thing not guessable
    // from the row: a certificate added here lands on their shared record and
    // every account that hires them reads the same one.
    const note = await page.evaluate(() =>
      [...document.querySelectorAll(".dm-later")].map((p) => (p.innerText || "").replace(/\s+/g, " ").trim()).join(" "));
    t.ck("the note says the file lands on their own record",
      /goes onto their record/i.test(note), note);
    t.ck("and that nothing of theirs is replaced",
      /Nothing of theirs is replaced/i.test(note), note);

    // AND THE BUTTON IS WIRED, not merely present -- which is the half a
    // selector cannot see.
    const before = calls.filter((c) => c.what === "upload").length;
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".doc-manage-row")]
        .find((r) => /Surety bond/i.test(r.innerText || ""));
      const input = row?.querySelector("input[type=file]");
      if (!input) return false;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], "bond.pdf", { type: "application/pdf" }));
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    await wait(900);
    const sent = calls.filter((c) => c.what === "upload");
    t.ck("picking a file actually uploads it", sent.length === before + 1, JSON.stringify(sent));
    t.ck("against the right company and kind",
      sent.at(-1)?.companyId === "cmp_pac" && sent.at(-1)?.kind === "bond", JSON.stringify(sent.at(-1)));
    await ctx.close();
  }

  console.log("\n-- and a record this account typed in --");
  {
    // THE OTHER BRANCH, IN THE SAME PLACE. A change that hid Delete from
    // everybody, or drew the refusal pane over every contractor, passes a suite
    // that only drives the locked one -- the diagonal coverage that left
    // `hiresLabel` half-wired.
    const { ctx, page } = await openEdit("Harbour Glass");
    // An unlocked form opens on step 1 -- the company half, which is the whole
    // thing a locked one does not have. The documents sit on step 2 beside the
    // trades, where a locked form lands directly.
    await page.evaluate(() => [...document.querySelectorAll(".sf-steps button")][1]?.click());
    await wait(500);
    const f = await form(page);
    t.ck("no refusal pane", f.refusal === false, JSON.stringify(f));
    t.ck("the full three-step form is there", f.steps === 3, String(f.steps));
    t.ck("the documents block is there too", f.rows.length === 4);
    t.ck("and Delete is offered on a record nobody else answers for",
      f.rows.filter((r) => r.del).length === 1, JSON.stringify(f.rows));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
