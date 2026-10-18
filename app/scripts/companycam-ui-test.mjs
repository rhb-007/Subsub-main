// CompanyCam on screen: connecting it in Account -> Integrations, and
// importing a project's photos and documents onto a job from the job form.
//
//   CONNECT IS THE CONTROL UNTIL A TOKEN IS BEHIND IT. A switch over nothing
//   changes nothing, so the row offers Connect, the token goes up once, and
//   the row redraws from the server's answer.
//
//   THE IMPORT BUTTON IS DRAWN ONLY WHEN THE STATUS ROUTE SAYS CONNECTED, and
//   what comes back is appended to the job's measurement documents, so the
//   save sends it like any upload.
//
//   node scripts/companycam-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-companycam-test");
const WEB = 5531, API = 9229;
const t = tally();

const ACCOUNT = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rae", name: "Rae", email: "rae@outerhome.test", role: "admin" },
};
let CONNECTED = false;
let REFUSE = false;
const connects = [];
const disconnects = [];
const imports = [];
const patched = [];
const integ = () => [
  { id: "api", name: "Zapier, Make and your own scripts", what: "w", uses: "An API key", soon: false, enabled: true, connect: null, connection: null },
  { id: "companycam", name: "CompanyCam", what: "Import photos", uses: "Your CompanyCam access token", soon: false,
    enabled: true, connect: "token", tokenHelp: "Create an access token in CompanyCam.",
    connection: CONNECTED ? { label: "Outerhome Roofing", connectedAt: "2026-10-18 09:00:00", lastOkAt: null, lastError: null } : null },
  { id: "hover", name: "Hover", what: "w", uses: "Your Hover account", soon: true, enabled: false, connect: null, connection: null },
];
const reply = () => [200, { integrations: integ(), onScale: true, migration: null, connMigration: null, sealing: true }];

const JOBS = () => [{
  id: "job_1", accountId: "acc_gc", propertyId: null, title: "Lee reroof", status: "active",
  date: "2026-11-06", time: "09:00", address: "14 Alder Way, Seattle", area: "Seattle", zip: "98101",
  trades: ["roofing"], assignments: {}, notes: "", createdAt: "2026-10-01", photos: [], severity: null,
  client: "Lee", sqft: 1800, stories: 2, scope: "Reroof", measurementDocs: [], materialSource: null,
  materialsPaidBy: "Outerhome", requestedBy: null, approvedAt: null, declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "none", accessUserId: null, reportDetail: null,
  propertyName: null, visit: null,
}];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/integrations/companycam/connection" && method === "PUT") {
    connects.push(body);
    if (REFUSE) return [400, { error: "token_refused", detail: "Unauthorized: token invalid" }];
    CONNECTED = true;
    return reply();
  }
  if (path === "/api/integrations/companycam/connection" && method === "DELETE") {
    disconnects.push(1); CONNECTED = false; return reply();
  }
  if (path === "/api/integrations") return reply();
  if (path === "/api/companycam/status") return [200, CONNECTED ? { connected: true, label: "Outerhome Roofing" } : { connected: false, reason: "not_connected" }];
  if (path === "/api/companycam/projects") return [200, { projects: [
    { id: "9001", name: "Lee residence", address: "14 Alder Way, Seattle, WA 98101", thumb: "", updatedAt: null, deleted: false },
  ], page: 1, more: false }];
  if (path === "/api/companycam/projects/9001") return [200, {
    project: { id: "9001", name: "Lee residence", address: "14 Alder Way, Seattle, WA 98101", thumb: "" },
    documents: [{ id: "d1", name: "roof-measurements.pdf", type: "application/pdf", size: 20, usable: true }],
    photos: [{ id: "p1", description: "North slope", thumb: "", usable: true },
      { id: "p2", description: "", thumb: "", usable: false }],
  }];
  if (path === "/api/companycam/import" && method === "POST") {
    imports.push(body);
    return [200, { docs: [{ key: "acc_gc/measurement-doc/u1-roof-measurements.pdf", name: "roof-measurements.pdf", type: "application/pdf", size: 20 }], skipped: [] }];
  }
  if (/^\/api\/jobs\/[^/]+$/.test(path) && method === "PATCH") { patched.push(body); return [200, { ok: true }]; }
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/api-tokens") return [200, []];
  if (path === "/api/crm-rules") return [200, { rules: [], unmapped: [] }];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_gc", company: "Outerhome", docs: {}, openToHire: true }];
  if (path === "/api/weather") return [200, {}];
  if (path === "/api/account-users") return [200, [
    { id: "u_rae", name: "Rae", email: "rae@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/visits" || path === "/api/invites" || path === "/api/clients" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections" || path === "/api/change-orders"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/my-work") return [200, { work: [] }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openIntegrations = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_rae", accountId: "acc_gc" }, viewport: { width: 1200, height: 1600 } });
  await r.page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
  await wait(400);
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
  for (let n = 0; n < 40; n++) { await wait(200); if (await r.page.$(".seg-tabs, nav.tabs")) break; }
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Integrations")?.click());
  for (let n = 0; n < 40; n++) { await wait(200); if (await r.page.$(".integ-row")) break; }
  await wait(400);
  return r;
};
const ccRow = (page) => page.evaluate(() => {
  const el = document.querySelector('.integ-row[data-integ="companycam"]');
  return el ? {
    text: el.innerText.replace(/\s+/g, " ").trim(),
    hasSwitch: !!el.querySelector(".oh-switch"),
    hasConnect: !!el.querySelector(".integ-connect"),
    tokenBox: !!el.querySelector(".integ-token input"),
  } : null;
});
const setVal = (page, sel, value) => page.evaluate(([ss, vv]) => {
  const el = document.querySelector(ss);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, vv);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [sel, value]);
const press = (page, sel, text) => page.evaluate(([ss, tt]) => {
  const b = [...document.querySelectorAll(ss)].find((x) => x.innerText.trim().startsWith(tt));
  if (!b) return false;
  b.click(); return true;
}, [sel, text]);

try {
  console.log("\n-- connecting --");
  {
    const { page, ctx } = await openIntegrations();
    const before = await ccRow(page);
    t.ck("the CompanyCam row is on the panel", !!before, JSON.stringify(before));
    t.ck("it offers Connect, not a switch", before?.hasConnect && !before?.hasSwitch, JSON.stringify(before));
    t.ck("and says it is not connected", /Not connected/.test(before?.text || ""), before?.text);
    await press(page, '.integ-row[data-integ="companycam"] button', "Connect");
    await wait(300);
    t.ck("Connect opens a token box", (await ccRow(page))?.tokenBox === true);

    REFUSE = true;
    await setVal(page, ".integ-token input", "cc_wrong_token_123");
    await wait(200);
    await press(page, ".integ-token button", "Connect CompanyCam");
    await wait(600);
    const refused = await ccRow(page);
    t.ck("a refused token is named, with CompanyCam's words", /didn't accept that token/.test(refused?.text || "") && /token invalid/.test(refused?.text || ""), refused?.text);
    t.ck("and the row is still not connected", refused?.hasConnect && !refused?.hasSwitch);

    REFUSE = false;
    await setVal(page, ".integ-token input", "cc_live_token_abcdef");
    await wait(200);
    await press(page, ".integ-token button", "Connect CompanyCam");
    await wait(700);
    t.ck("the token was sent once per press, trimmed", connects.length === 2 && connects[1].token === "cc_live_token_abcdef", JSON.stringify(connects));
    const after = await ccRow(page);
    t.ck("connected, it says to which CompanyCam account", /Connected to Outerhome Roofing/.test(after?.text || ""), after?.text);
    t.ck("and now has a switch and no Connect", after?.hasSwitch && !after?.hasConnect, JSON.stringify(after));
    t.ck("the token is not on the screen", !(await page.evaluate(() => document.body.innerText.includes("cc_live_token_abcdef"))));
    const hover = await page.evaluate(() => document.querySelector('.integ-row[data-integ="hover"]')?.innerText || "");
    t.ck("Hover still says coming soon", /Coming soon/.test(hover), hover);
    await ctx.close();
  }

  console.log("\n-- importing onto a job --");
  {
    const { page, ctx } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rae", accountId: "acc_gc" }, viewport: { width: 1200, height: 1800 } });
    await wait(2000);
    await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^jobs/i.test(b.innerText.trim()))?.click());
    await wait(1200);
    await openCards(page);
    await page.evaluate(() => document.querySelector(".job-card .job-title-edit")?.click());
    await wait(700);
    await page.evaluate(() => [...document.querySelectorAll(".modal .job-steps button")]
      .find((b) => b.innerText.includes("Materials"))?.click());
    await wait(600);
    const btn = await page.evaluate(() => !!document.querySelector(".modal .meas-cc"));
    t.ck("the job form offers Import from CompanyCam", btn);
    await page.evaluate(() => document.querySelector(".modal .meas-cc")?.click());
    await wait(900);
    const search = await page.evaluate(() => document.querySelector(".cc-search input")?.value || "");
    t.ck("the search starts on the job's street", search === "14 Alder Way", search);
    t.ck("the project is listed", await page.evaluate(() => !!document.querySelector('[data-cc-project="9001"]')));
    await page.evaluate(() => document.querySelector('[data-cc-project="9001"]')?.click());
    await wait(700);
    const disabled = await page.evaluate(() => document.querySelector('[data-cc-photo="p2"]')?.disabled);
    t.ck("a photo still processing cannot be picked", disabled === true);
    await page.evaluate(() => document.querySelector(".cc-doc input")?.click());
    await page.evaluate(() => document.querySelector('[data-cc-photo="p1"]')?.click());
    await wait(300);
    const label = await page.evaluate(() => [...document.querySelectorAll(".cc-modal .modal-actions button")].map((b) => b.innerText.trim()));
    t.ck("the button counts what is picked", label.includes("Import 2"), JSON.stringify(label));
    await press(page, ".cc-modal .modal-actions button", "Import 2");
    await wait(900);
    t.ck("the import names the project and the picked ids, no URLs",
      imports.length === 1 && imports[0].projectId === "9001"
      && JSON.stringify(imports[0].documents) === '["d1"]' && JSON.stringify(imports[0].photos) === '["p1"]', JSON.stringify(imports));
    t.ck("the picker closes", !(await page.evaluate(() => !!document.querySelector(".cc-modal"))));
    const rows = await page.evaluate(() => [...document.querySelectorAll(".modal .meas-row .meas-name")].map((x) => x.innerText));
    t.ck("the imported file is on the job's list", rows.includes("roof-measurements.pdf"), JSON.stringify(rows));
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /save/i.test(b.innerText))?.click());
    await wait(900);
    const sent = patched[patched.length - 1]?.measurementDocs || [];
    t.ck("saving sends it as a stored document", sent.some((d) => d.key === "acc_gc/measurement-doc/u1-roof-measurements.pdf"), JSON.stringify(patched));
    await ctx.close();
  }

  console.log("\n-- not connected: no button --");
  {
    CONNECTED = false;
    const { page, ctx } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rae", accountId: "acc_gc" }, viewport: { width: 1200, height: 1800 } });
    await wait(2000);
    await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^jobs/i.test(b.innerText.trim()))?.click());
    await wait(1200);
    await openCards(page);
    await page.evaluate(() => document.querySelector(".job-card .job-title-edit")?.click());
    await wait(700);
    await page.evaluate(() => [...document.querySelectorAll(".modal .job-steps button")]
      .find((b) => b.innerText.includes("Materials"))?.click());
    await wait(600);
    const there = await page.evaluate(() => ({
      upload: !!document.querySelector(".modal .meas-upload input[type=file]"),
      cc: !!document.querySelector(".modal .meas-cc"),
    }));
    t.ck("the upload is still there (the form really opened)", there.upload, JSON.stringify(there));
    t.ck("and there is no import button", !there.cc, JSON.stringify(there));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
