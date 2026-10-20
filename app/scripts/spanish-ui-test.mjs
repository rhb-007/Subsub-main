// Spanish for the people who do the work: a Language setting (English /
// Espanol) in the profile menu, offered to contractor and handyman seats and a
// subcontractor account's own team, and their screens drawn in Spanish.
//
// What is asserted is the drawn page: the nav, the work list and its buttons
// read in Spanish, dates follow the language, the page says lang="es", the
// choice survives a reload -- and a hiring account is never offered Spanish
// and stays English even with Spanish remembered on the device, because its
// screens are not translated yet.
//
//   node --no-warnings scripts/spanish-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-spanish-test");
const WEB = 5563, API = 9263;
const SHOTS = process.env.LANG_SHOTS || "";
const t = tally();

const DAY = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let KIND = "subcontractor";
const acct = () => ({
  id: "acc_cas", name: "Cascade Apartment Services", subdomain: "cascade",
  kind: KIND, plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["painting"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_ric", name: "Ricard Brando", email: "rbraun@cascade.test", role: "admin" },
});
const MY_COMPANY = {
  companyId: "cmp_cas", company: "Cascade Apartment Services", contact: "Ricard Brando",
  email: "rbraun@cascade.test", phone: "2067778888", license: "CASCAAS881QT", ubi: "",
  city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_cas", openToHire: true, openAnswered: true,
  url: null, sharesSent: 0,
};
const base = (o) => ({
  wo: "WO-1", trade: "painting", auto: false, responseWindow: null, respondBy: null,
  respondedAt: null, crewName: null, value: "400", payKind: "fixed", rate: "", capHours: null,
  tradeScope: null, signedWO: null, here: false,
  accountId: "acc_pm", accountName: "Sound Property Management", accountKind: "property_manager",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", date: null, jobStatus: "active",
  severity: null, access: "tenant", visit: null, ...o,
});
const WORK = () => [
  // Accepted, no time: nobody is coming until Cascade says when.
  base({ woId: "wo_paint", wo: "WO-1", jobId: "job_paint", status: "accepted", respondedAt: "2026-10-10",
    title: "Paint is peeling off of the ceiling in both of the bathrooms" }),
  // An offer still open.
  base({ woId: "wo_gate", wo: "WO-2", jobId: "job_gate", status: "pending",
    respondBy: new Date(Date.now() + 20 * 3600e3).toISOString(), title: "Fix the side gate latch" }),
  // Booked: nothing to do.
  base({ woId: "wo_booked", wo: "WO-3", jobId: "job_booked", status: "accepted", respondedAt: "2026-10-02",
    title: "Patch the hallway drywall", date: DAY(6),
    visit: { id: "v_b", jobId: "job_booked", status: "confirmed", date: DAY(6), startTime: "09:00",
      endTime: "11:00", contractorAt: "2026-10-03", note: "" } }),
];

const posts = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "POST" && path.startsWith("/api/my-work/")) {
    posts.push({ path, body: typeof body === "string" ? JSON.parse(body || "{}") : body });
    if (path.endsWith("/visits")) return [201, { id: "v_new", status: "proposed", date: DAY(3) }];
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") {
    return KIND === "subcontractor" ? [200, MY_COMPANY] : [409, { error: "not_hireable" }];
  }
  if (path === "/api/my-work") return [200, { work: KIND === "subcontractor" ? WORK() : [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_ric", name: "Ricard Brando", email: "rbraun@cascade.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const navTexts = (page) => page.evaluate(() => [...document.querySelectorAll("nav button, .tabs button")]
  .map((b) => b.innerText.trim().split("\n")[0]).filter(Boolean));
// Language lives in My account -> Settings, not in the profile menu.
const openMenu = async (page) => {
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^(Settings|Configuración)$/.test(b.innerText.trim()))?.click());
  await wait(400);
};
const langRows = (page) => page.evaluate(() => [...document.querySelectorAll(".set-opt[lang]")]
  .map((b) => ({ label: b.innerText.trim(), on: b.getAttribute("aria-checked") === "true" })));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const goJobs = (page, re) => page.evaluate((src) => {
  const b = [...document.querySelectorAll("nav button, .tabs button")].find((x) => new RegExp(src).test(x.innerText.trim()));
  b?.click(); return !!b;
}, re);

try {
  console.log("\n-- a subcontractor account, English by default --");
  KIND = "subcontractor";
  const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_ric", accountId: "acc_cas" }, viewport: { width: 1100, height: 1000 } });
  await wait(2200);
  let nav = await navTexts(page);
  t.ck("the app is drawn, in English", nav.includes("My Jobs") && nav.includes("Dashboard"), JSON.stringify(nav));
  await openMenu(page);
  let rows = await langRows(page);
  t.ck("Settings offers English and Espanol, each in its own language",
    rows.map((r) => r.label).join(",") === "English,Español", JSON.stringify(rows));
  t.ck("English is chosen", rows[0]?.on && !rows[1]?.on);

  console.log("\n-- Espanol --");
  await page.evaluate(() => [...document.querySelectorAll(".set-opt[lang]")].find((b) => /Español/.test(b.innerText))?.click());
  await wait(400);
  nav = await navTexts(page);
  t.ck("the nav is in Spanish", nav.includes("Mis trabajos") && nav.includes("Inicio"), JSON.stringify(nav));
  t.ck("the page says lang=es", await page.evaluate(() => document.documentElement.lang) === "es");
  t.ck("the setting's own heading is Spanish", /Idioma/i.test(await page.evaluate(() => document.querySelector(".ss-main")?.innerText || "")));
  t.ck("My Jobs is reachable by its Spanish name", await goJobs(page, "^Mis trabajos"));
  await wait(900);
  const body = await page.evaluate(() => document.body.innerText);
  await shot(page, "es-myjobs");
    // Chrome's innerText applies text-transform, and these headings are upper
  // case on screen, so the checks ignore case.
  t.ck("what is waiting is said in Spanish", /Esperándolo a usted/i.test(body) && /Solicitudes de trabajo/i.test(body), body.slice(0, 400));
  t.ck("a job's line says what it needs in Spanish", /Fijar un horario/.test(body) && /Responder · quedan/.test(body), body.slice(0, 600));
  t.ck("the trade is named in Spanish", /Pintura/.test(body) && !/Painting/.test(body));
  t.ck("the greeting is Spanish", /Buen(os|as) (días|tardes|noches)|Todavía despierto/.test(body));
  t.ck("and no English heading is left on the work list",
    !/Waiting on you|Job requests|Current & upcoming|Good (morning|afternoon|evening)/i.test(body), (body.match(/Waiting on you|Job requests|Current & upcoming|Accept\b/g) || []).join(","));
  const day = DAY(6);
  const esMonth = new Date(`${day}T12:00:00`).toLocaleDateString("es-US", { month: "short" }).replace(".", "");
  t.ck("dates follow the language", body.toLowerCase().includes(esMonth.toLowerCase()), esMonth);

  // Open the waiting job and the offer, so their insides are drawn too.
  // One line opens a window; the offer is the one that asks a question.
  await page.evaluate(() => [...document.querySelectorAll('.jl-btn[aria-expanded="false"]')]
    .find((b) => /side gate/.test(b.innerText))?.click());
  await wait(700);
  await shot(page, "es-open");
  const open = await page.evaluate(() => document.body.innerText);
  t.ck("an opened offer asks in Spanish", /¿Acepta este trabajo\?/.test(open) || /Aceptar/.test(open), open.slice(0, 300));

  console.log("\n-- remembered --");
  await page.reload({ waitUntil: "domcontentloaded" }); await wait(2200);
  nav = await navTexts(page);
  t.ck("Spanish survives a reload", nav.includes("Mis trabajos"), JSON.stringify(nav));
  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- a hiring account is not offered it --");
  KIND = "property_manager";
  const pm = await visitApp(browser, { host: "cascade", webPort: WEB, seat: { userId: "u_ric", accountId: "acc_cas" },
    viewport: { width: 1100, height: 1000 }, onNewDocument: () => { try { localStorage.setItem("ss_lang", "es"); } catch { /* */ } } });
  await wait(2200);
  nav = await navTexts(pm.page);
  t.ck("its screens stay English even with Spanish remembered", nav.includes("Dashboard") && !nav.includes("Inicio"), JSON.stringify(nav));
  await openMenu(pm.page);
  rows = await langRows(pm.page);
  t.ck("and no Language setting is drawn", rows.length === 0 && (await pm.page.evaluate(() => document.querySelectorAll(".set-opt").length === 3)),
    JSON.stringify(rows));
  t.ck("the page says lang=en", await pm.page.evaluate(() => document.documentElement.lang) === "en");
  await pm.ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
