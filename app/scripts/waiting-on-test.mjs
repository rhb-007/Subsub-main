// Who you are waiting on, and what an invited contractor is called.
//
// Four subcontractors were invited and the dashboard said nothing about any
// of them. The tile beside the gap, "Awaiting contractor reply", read zero
// -- because it counts trade slots on a job with an offer out, which is a
// different question wearing the same words. So a screen that looked like it
// was reporting on invites was reporting on work orders, and agreeing with
// itself.
//
// And the invited cards led with the person: four first names where the
// contractor cards beside them lead with the company. You hire Enterprise
// Roofing; Rodolfo Mendoza is who answers their phone.
//
//   node scripts/waiting-on-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-boot-test");
const WEB = 5206, API = 8917;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
// The four from the report, plus one created and never sent -- which is the
// case that means nobody has been asked anything at all.
const INVITES = [
  { id: "inv1", status: "open", companyName: "Enterprise Roofing", contact: "Rodolfo Mendoza",
    label: null, email: "enterprise.roofing@live.com", phone: "(425)466-0100", sentAt: ago(2) },
  { id: "inv2", status: "open", companyName: "Burd Roofing", contact: "Alex Burd",
    label: null, email: "alexburdroofing@gmail.com", phone: null, sentAt: ago(26) },
  { id: "inv3", status: "open", companyName: null, contact: "Vladimir Makaretc",
    label: null, email: "vladimirmodern22@gmail.com", phone: null, sentAt: ago(3) },
  { id: "inv4", status: "open", companyName: "King of Kings General", contact: "Adan Santiago Hernandez",
    label: null, email: "kingofkingsgeneral@gmail.com", phone: null, sentAt: null },
  // Answered. Must not be counted as outstanding.
  { id: "inv5", status: "accepted", companyName: "Sound Gutters", contact: "Pat Lee",
    label: null, email: "pat@soundgutters.test", phone: null, sentAt: ago(70) },
];
const CONNECTS = [
  { id: "cr1", status: "pending", company: "Cascade Roofworks", contact: "Miguel Alvarez",
    city: "Tacoma", state: "WA", createdAt: ago(5) },
  { id: "cr2", status: "accepted", company: "Olympic Siding", contact: null,
    city: "Olympia", state: "WA", createdAt: ago(90) },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/invites") return [200, INVITES];
  if (path === "/api/connect-requests") return [200, CONNECTS];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1280, height: 1400 } });
  await wait(2200);
  return r;
};

try {
  console.log("\n-- the dashboard says who has not answered --");
  {
    const { ctx, page, crashes } = await open();
    // The section caps itself at three rows and offers the rest behind
    // "Show all", which is the house style for these roll-ups. Open it, or
    // half the assertions below are about rows that are deliberately not
    // drawn yet.
    const capped = await page.evaluate(() => {
      const h = [...document.querySelectorAll(".dash-sec h3")]
        .find((x) => /waiting on contractors/i.test(x.innerText));
      const n = h?.closest(".dash-sec")?.querySelectorAll(".dash-row").length;
      const more = h?.closest(".dash-sec")?.querySelector(".dash-more");
      if (more) more.click();
      return { n, hadMore: !!more, label: more?.innerText.trim() };
    });
    t.ck("it caps itself rather than running down the page",
      capped.n === 3 && capped.hadMore, JSON.stringify(capped));
    t.ck("and offers the rest", /show all 5/i.test(capped.label || ""), String(capped.label));
    await wait(250);

    const sec = await page.evaluate(() => {
      const h = [...document.querySelectorAll(".dash-sec h3")]
        .find((x) => /waiting on contractors/i.test(x.innerText));
      if (!h) return null;
      const s = h.closest(".dash-sec");
      return {
        count: h.querySelector(".sec-count")?.textContent,
        rows: [...s.querySelectorAll(".dash-row")].map((r) => ({
          title: r.querySelector(".dr-title")?.innerText.trim(),
          meta: r.querySelector(".dr-meta")?.innerText.replace(/\s+/g, " ").trim(),
        })),
        note: s.querySelector(".rollup-note")?.innerText.replace(/\s+/g, " ").trim(),
      };
    });
    t.ck("the section is on the dashboard", !!sec, String(sec));
    // Without it the rest read a null and the run dies on the first one,
    // hiding every other assertion behind a stack trace.
    if (!sec) { t.ck("...so nothing below it could be checked", false); await ctx.close(); t.done(); }
    t.ck("four open invites and one pending request, not the answered ones",
      sec.count === "5", `${sec.count} · ${JSON.stringify(sec.rows.map((r) => r.title))}`);
    t.ck("an accepted invite is not counted",
      !sec.rows.some((r) => /Sound Gutters/i.test(r.title)), JSON.stringify(sec.rows.map((r) => r.title)));
    t.ck("nor an accepted connect request",
      !sec.rows.some((r) => /Olympic Siding/i.test(r.title)), JSON.stringify(sec.rows.map((r) => r.title)));

    const ent = sec.rows.find((r) => /Enterprise Roofing/.test(r.title));
    t.ck("a row leads with the company", !!ent, JSON.stringify(sec.rows.map((r) => r.title)));
    t.ck("and still names the person", /Rodolfo Mendoza/.test(ent?.meta || ""), String(ent?.meta));
    t.ck("and says how long they have had it", /invited .*ago/i.test(ent?.meta || ""), String(ent?.meta));

    // The one nobody has actually been sent. Saying "invited 0 minutes ago"
    // about a link still sitting in the app is the worst kind of wrong.
    const unsent = sec.rows.find((r) => /King of Kings/i.test(r.title));
    t.ck("an unsent invite says nobody has it",
      /not sent/i.test(unsent?.meta || ""), String(unsent?.meta));

    const conn = sec.rows.find((r) => /Cascade Roofworks/.test(r.title));
    t.ck("a connect request says it was a connect request, not an invite",
      /asked to connect/i.test(conn?.meta || ""), String(conn?.meta));

    // Somebody with no company on file still has to be identifiable.
    t.ck("a contact with no company falls back to their name",
      sec.rows.some((r) => /Vladimir Makaretc/.test(r.title)), JSON.stringify(sec.rows.map((r) => r.title)));

    t.ck("it says who is NOT in the list, so the absence reads as an answer",
      /drop off here on their own/i.test(sec.note || ""), String(sec.note));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));

    // The tile that caused the confusion.
    const tiles = await page.$$eval(".dash-card .dc-lab", (n) => n.map((x) => x.innerText.trim()));
    t.ck("the work-order tile no longer claims to be about contractors replying",
      !tiles.some((x) => /^awaiting contractor reply$/i.test(x)), tiles.join(" | "));
    t.ck("and says what it actually counts",
      tiles.some((x) => /job offers awaiting a reply/i.test(x)), tiles.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and the invited cards on the Contractors screen --");
  {
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => {
      [...document.querySelectorAll("nav.tabs button")].find((b) => /contractors/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".invited-card", { timeout: 6000 });
    // .invited-card is shared with the connect-request cards below, which
    // are a different list answering a different question. Scoped to the
    // invited strip, or Cascade Roofworks is counted as an invite.
    const cards = await page.$$eval(".invited-strip.is-invited .invited-card", (n) => n.map((c) => ({
      head: c.querySelector("b")?.innerText.trim(),
      sub: c.querySelector(".invited-to")?.innerText.trim(),
    })));
    t.ck("four are shown", cards.length === 4, JSON.stringify(cards.map((c) => c.head)));
    t.ck("headed by the company", cards.some((c) => c.head === "Enterprise Roofing"),
      JSON.stringify(cards.map((c) => c.head)));
    t.ck("not by the person", !cards.some((c) => c.head === "Rodolfo Mendoza"),
      JSON.stringify(cards.map((c) => c.head)));
    const ent = cards.find((c) => c.head === "Enterprise Roofing");
    t.ck("the person moved to the line below", /Rodolfo Mendoza/.test(ent?.sub || ""), String(ent?.sub));
    t.ck("and the address is still there", /enterprise\.roofing@live\.com/.test(ent?.sub || ""), String(ent?.sub));
    const vlad = cards.find((c) => /Vladimir/.test(c.head));
    t.ck("somebody with no company is still headed by their name", !!vlad,
      JSON.stringify(cards.map((c) => c.head)));
    t.ck("and is not repeated underneath themselves",
      !/Vladimir Makaretc/.test(vlad?.sub || ""), String(vlad?.sub));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
