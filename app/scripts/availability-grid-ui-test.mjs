// THE AVAILABILITY GRID: the right color on every day, and a free day opens
// the assign window.
//
// Reported as "status colors aren't correct, can't click on any available
// subcontractor dates". Two causes. A contractor with no crews listed (most
// of them) read as "every crew off", so every day was red and nothing was
// clickable, while the server has always read no crews as free. And the
// click handler re-checked bond + insurance + agreement on file, the old
// presence rule, so a handyman (who is asked for neither) could never be
// scheduled from the grid even on a green day.
//
//   node --no-warnings scripts/availability-grid-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-availgrid-test");
const WEB = 5636, API = 9336;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", role: "admin" },
};
const USERS = [{ id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
  subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const verified = (kinds) => Object.fromEntries(kinds.map((k) =>
  [k, { status: "verified", verifiedBy: "Richard Braun", verifiedAt: "2026-10-01T00:00:00Z" }]));
const sub = (id, company, extra = {}) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: ["plumbing"], caps: [], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "BAY1", available: true,
  licenseCheck: { found: true, status: "ACTIVE", expirationDate: "2030-12-31", checkedAt: "2026-10-20", licenseNumber: "BAY1" },
  unavailableDays: [], docReview: verified(["insurance", "bond", "contract", "w9"]), coverage: {},
  engagedAs: "subcontractor", status: "active", ...extra,
});
const OFF_DAY = key(3);
const SUBS = [
  sub("cmp_bay", "Bay Roofing"),
  sub("cmp_handy", "Pacific apartment maintenance", { engagedAs: "handyman", bond: false, insurance: false,
    contract: false, license: "", licenseCheck: null, docReview: verified(["w9"]) }),
  sub("cmp_gap", "Gap Electric", { docReview: {} }),
  sub("cmp_down", "Away Plumbing", { available: false }),
  sub("cmp_crew", "Crew Co", { crews: [{ id: "c1", name: "A", available: true, unavailableDays: [OFF_DAY], members: [] }] }),
];
const JOBS = [{
  id: "j1", accountId: "acc_pm", propertyId: null, title: "Declined faucet", status: "active",
  date: key(2), time: "10:00", address: "1 Main", area: "Seattle", zip: "98122", trades: ["plumbing"],
  assignments: { plumbing: { id: "wo1", wo: "WO-1", subId: "cmp_bay", company: "Bay Roofing", status: "declined",
    auto: false, value: "100", crewName: null } },
  notes: "", createdAt: "Oct 1", photos: [], severity: null, scope: "", measurementDocs: [],
  requestedBy: null, approvedAt: "2026-10-02", declinedAt: null, withdrawnAt: null, completedAt: null,
  readOnly: false, spans: {},
}];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (["/api/visits", "/api/properties", "/api/invites", "/api/connect-requests", "/api/my-connect-requests",
    "/api/tenants", "/api/clients", "/api/notices", "/api/my-notices", "/api/inspections", "/api/my-quotes",
    "/api/doc-shares", "/api/property-transfers", "/api/overflow-posts", "/api/threads"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
try {
  const m = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 1200 } });
  await wait(2000);
  await m.page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Availability/i.test(b.innerText.trim()))?.click());
  await wait(1500);
  const read = () => m.page.evaluate(() => {
    const rows = {};
    const grid = document.querySelector(".cal-grid");
    if (!grid) return null;
    const kids = [...grid.children];
    kids.forEach((el, i) => {
      if (!el.classList.contains("cal-sub")) return;
      const name = el.querySelector(".cal-sub-name").innerText.trim();
      const dot = el.querySelector(".avail-dot").className;
      const cells = kids.slice(i + 1, i + 15).map((c) => ({ day: c.dataset.day, cls: c.className }));
      rows[name] = { dot, cells };
    });
    return rows;
  });
  const g = await read();
  t.ck("the grid is drawn", !!g, "");
  const row = (n) => g?.[n] || { dot: "", cells: [] };
  const all = (n, re) => row(n).cells.length === 14 && row(n).cells.every((c) => re.test(c.cls));
  t.ck("a ready contractor with no crews is green and clickable every day", all("Bay Roofing", /\bup\b.*clickable/),
    JSON.stringify(row("Bay Roofing").cells.slice(0, 3)));
  t.ck("a declined offer does not draw the day as booked", !row("Bay Roofing").cells.some((c) => /booked/.test(c.cls)), "");
  t.ck("a ready handyman is green and clickable", all("Pacific apartment maintenance", /\bup\b.*clickable/), "");
  t.ck("a contractor with documents outstanding is amber (needs docs)", all("Gap Electric", /needdocs/), "");
  t.ck("its row dot is the outstanding-items amber", /\bgap\b/.test(row("Gap Electric").dot), row("Gap Electric").dot);
  t.ck("a ready, available row dot is green", /\bup\b/.test(row("Bay Roofing").dot), row("Bay Roofing").dot);
  t.ck("a contractor not taking work is red and not clickable", all("Away Plumbing", /\bdown\b/)
    && !row("Away Plumbing").cells.some((c) => /clickable/.test(c.cls)), "");
  const crew = row("Crew Co").cells;
  t.ck("a crew's day off is red", /\bdown\b/.test(crew.find((c) => c.day === OFF_DAY)?.cls || ""),
    crew.find((c) => c.day === OFF_DAY)?.cls);
  t.ck("its other days are green", /\bup\b/.test(crew[0]?.cls || ""), crew[0]?.cls);

  const clickOpens = async (name) => {
    if (!g) return false;
    await m.page.evaluate((n) => {
      const kids = [...document.querySelector(".cal-grid").children];
      const i = kids.findIndex((el) => el.classList.contains("cal-sub") && el.innerText.includes(n));
      kids[i + 2]?.click();
    }, name);
    await wait(700);
    const open = await m.page.evaluate(() => !!document.querySelector(".modal"));
    await m.page.keyboard.press("Escape");
    await m.page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(400);
    return open;
  };
  t.ck("pressing a free day for the ready contractor opens the assign window", await clickOpens("Bay Roofing"), "");
  t.ck("pressing a free day for the handyman opens the assign window", await clickOpens("Pacific apartment"), "");
  t.ck("the screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
