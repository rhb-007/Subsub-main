// Invited contractors: where they live, and what can be done about them.
//
// They used to live inside the "Invite a subcontractor" modal -- the form
// and the list of everyone outstanding, in the same box. Three things were
// wrong with that. The answer to "did I already invite them?" sat behind a
// button labelled "Invite", which is not where anybody looks. A general
// contractor onboarding twenty subcontractors got twenty rows stacked under
// a form in a 560px modal. And there was no way to send one again: the only
// recourse was a second invite, which leaves two live tokens for one person
// and a list that reads as two people.
//
// So they moved to the Contractors list, as a status, in front of the
// roster. The card is small on purpose -- until somebody accepts, all that
// exists is a name, an address, a link and a date, and a card the size of a
// real contractor's would read as a contractor whose details had gone
// missing.
//
// Needs the local stack: worker on 8787, mail/SMS stubs, dist served on
// 5191 with *.subsub.work mapped to it.
//
//   node scripts/invited-list-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const HOST = "outerhome.subsub.work";
const ACCOUNT = "acc_test";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());

const admin = await tok("admin@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const S = Date.now().toString(36);

// Everything this file creates, so the roster it borrows is handed back the
// way it was found. An earlier invite test left rows behind and two other
// suites started failing on counts that were right until it ran.
const made = [];
const mkInvite = async (body) => {
  const r = await (await fetch(`${API}/invites`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  if (r.id) made.push(r.id);
  return r;
};
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Signs in and lands on the Contractors tab, which is where invited
// contractors now are.
async function onContractors(width = 1280, height = 1400) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", "admin@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6000);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.textContent.trim()))?.click());
  await wait(1500);
  return { ctx, page, crashes };
}

const cards = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".invited-card")].map((c) => ({
    text: c.innerText, w: Math.round(c.getBoundingClientRect().width),
  })));

try {
  console.log("\n-- an invite that was sent, and one that never left --");
  const email = `dana.${S}@harbourroofing.test`;
  const sent = await mkInvite({ email, phone: "206-555-0188", contact: `Dana Okafor ${S}`,
    companyName: "Harbour Roofing" });
  ck("the invite is created and sent", !!sent.id && !!sent.sentAt, String(sent.sentAt));
  const handover = await mkInvite({ label: `Handed over ${S}` });
  ck("and a link-only one is created and not sent", !!handover.id && !handover.sentAt, String(handover.sentAt));

  console.log("\n-- who may read the account's outstanding invites --");
  {
    // An invite token is a credential: whoever holds the link can file an
    // application against this account. This used to answer any authenticated
    // seat in the account, contractor and tenant seats included.
    const theirs = await tok("sub@example.test");
    const r = await fetch(`${API}/invites`, { headers: { Authorization: `Bearer ${theirs}`, "X-Account-Id": ACCOUNT } });
    ck("a contractor seat is refused", r.status === 403, String(r.status));
    const a = await fetch(`${API}/invites`, { headers: H });
    ck("and an admin is not", a.status === 200, String(a.status));
  }

  console.log("\n-- sending one again --");
  {
    const before = (await sentMail()).length;
    const again = await (await fetch(`${API}/invites/${sent.id}/resend`, { method: "POST", headers: H })).json();
    const mail = (await sentMail()).slice(before);
    ck("a second email leaves", mail.length === 1, `${mail.length} sent`);
    ck("to the same person", mail[0]?.to === email || (mail[0]?.to || [])[0] === email, JSON.stringify(mail[0]?.to));
    // The point of resending rather than reissuing: the link already sitting
    // in their inbox has to keep working.
    const token = (mail[0]?.text || "").match(/invite=([0-9a-f]{64})/)?.[1];
    ck("carrying the SAME token, so the first email still works",
      !!token && sent.url.includes(token), String(token).slice(0, 12));
    ck("and it is reported route by route", again.emailed === true && typeof again.texted === "boolean",
      `${again.emailed} / ${again.texted}`);
    ck("the sent time moves", !!again.sentAt, String(again.sentAt));
  }

  console.log("\n-- what cannot be sent again --");
  {
    const r = await fetch(`${API}/invites/${handover.id}/resend`, { method: "POST", headers: H });
    const b = await r.json();
    ck("a link made to hand over has nowhere to send", r.status === 400 && b.error === "no_contact",
      `${r.status} ${b.error}`);
    const gone = await mkInvite({ email: `gone.${S}@example.test`, contact: `Gone ${S}` });
    await fetch(`${API}/invites/${gone.id}`, { method: "DELETE", headers: H });
    const r2 = await fetch(`${API}/invites/${gone.id}/resend`, { method: "POST", headers: H });
    ck("nor can a revoked one be sent again", r2.status === 409, String(r2.status));
    const r3 = await fetch(`${API}/invites/inv_nonesuch/resend`, { method: "POST", headers: H });
    ck("and an id that is not this account's is a miss", r3.status === 404, String(r3.status));
  }

  console.log("\n-- they show up in the Contractors list --");
  const { ctx, page, crashes } = await onContractors();
  {
    const shown = await cards(page);
    ck("the invited strip is there", shown.length >= 2, `${shown.length} cards`);
    const dana = shown.find((c) => c.text.includes(`Dana Okafor ${S}`));
    ck("the one that was sent is named", !!dana, shown.map((c) => c.text.split("\n")[1]).join(" | "));
    ck("and marked as invited, not as a contractor", /invited/i.test(dana?.text || ""), dana?.text?.split("\n")[0]);
    ck("saying where it went", (dana?.text || "").includes(email), dana?.text);
    ck("and when", /Sent/.test(dana?.text || ""), dana?.text);

    const hand = shown.find((c) => c.text.includes(`Handed over ${S}`));
    // Created and sent are different facts, and one of them means nobody has
    // been asked anything yet.
    ck("a link nobody has sent says so rather than claiming a date",
      /Not sent/i.test(hand?.text || ""), hand?.text);

    // The whole point of the move: it is not in the modal any more. The
    // modal is opened from the dashboard, which is where somebody who wants
    // to invite one starts.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Dashboard/.test(b.textContent.trim()))?.click());
    await wait(1500);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /Invite a subcontractor/i.test(b.textContent))?.click());
    await wait(1500);
    const modal = await page.evaluate(() => document.querySelector(".inv-panel")?.innerText || "");
    ck("the invite modal opens", /Invite a subcontractor/i.test(modal), modal.split("\n")[0] || "no panel");
    ck("and no longer carries the list of everyone outstanding",
      !!modal && !modal.includes(`Dana Okafor ${S}`) && !modal.includes(`Handed over ${S}`),
      modal.split("\n").slice(0, 3).join(" / "));
    await page.keyboard.press("Escape");
    await wait(800);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Contractors/.test(b.textContent.trim()))?.click());
    await wait(1500);
  }

  console.log("\n-- and the search box reaches them --");
  {
    const type = async (v) => page.evaluate((val) => {
      const el = document.querySelector(".search-input input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    await type(`Dana Okafor ${S}`);
    await wait(600);
    const hit = await cards(page);
    ck("searching their name keeps them", hit.length === 1 && hit[0].text.includes(`Dana Okafor ${S}`),
      `${hit.length} cards`);
    await type("nobody by that name at all");
    await wait(600);
    ck("searching for somebody else does not", (await cards(page)).length === 0);
    await type("");
    await wait(600);
  }

  console.log("\n-- the panel is small, because there is little to say --");
  {
    await page.evaluate((name) => [...document.querySelectorAll(".invited-card")]
      .find((c) => c.innerText.includes(name))?.click(), `Dana Okafor ${S}`);
    await wait(900);
    const p = await page.evaluate(() => {
      const el = document.querySelector(".invited-panel");
      if (!el) return null;
      return { w: Math.round(el.getBoundingClientRect().width), text: el.innerText,
        acts: [...el.querySelectorAll(".invited-acts button")].map((b) => b.innerText.trim()) };
    });
    ck("it opens", !!p, String(p));
    ck("and is a small panel, not a contractor's full one", p.w <= 470, `${p.w}px`);
    ck("it names them", p.text.includes(`Dana Okafor ${S}`));
    ck("says where the invite went", p.text.includes(email));
    ck("and says what is not known yet rather than drawing empty sections",
      /Nothing else is known/i.test(p.text), p.text.split("\n").slice(0, 4).join(" / "));
    // Nothing that needs a contractor to exist. Checked as controls rather
    // than as words, since the panel's own sentence names the things that
    // are missing -- which is the point of it.
    ck("no rating, document pills or assign button", await page.evaluate(() => {
      const el = document.querySelector(".invited-panel");
      return !el.querySelector(".stars, .card-docs, .doc-pill, .req-docs-bar")
        && ![...el.querySelectorAll("button")].some((b) => /assign|request docs/i.test(b.innerText));
    }));
    ck("what it offers is copy, send again and revoke",
      p.acts.length === 3 && /Copy/i.test(p.acts[0]) && /again/i.test(p.acts[1]) && /Revoke/i.test(p.acts[2]),
      p.acts.join(" | "));

    console.log("\n-- send again, from the panel --");
    const before = (await sentMail()).length;
    await page.evaluate(() => [...document.querySelectorAll(".invited-acts button")]
      .find((b) => /again/i.test(b.innerText))?.click());
    await wait(2500);
    ck("an email actually leaves", (await sentMail()).length === before + 1,
      `${(await sentMail()).length - before} sent`);
    ck("and it says so", /Sent again to/i.test(await page.evaluate(() =>
      document.querySelector(".invited-panel")?.innerText || "")));

    console.log("\n-- revoke --");
    await page.evaluate(() => [...document.querySelectorAll(".invited-acts button")]
      .find((b) => /Revoke/i.test(b.innerText))?.click());
    await wait(2000);
    ck("the panel closes", await page.evaluate(() => !document.querySelector(".invited-panel")));
    ck("and they are off the list", !(await cards(page)).some((c) => c.text.includes(`Dana Okafor ${S}`)),
      (await cards(page)).map((c) => c.text.split("\n")[1]).join(" | "));
    const after = await (await fetch(`${API}/invites`, { headers: H })).json();
    ck("the invite is revoked on the server too, not just hidden",
      after.find((i) => i.id === sent.id)?.status === "revoked",
      after.find((i) => i.id === sent.id)?.status);
  }

  console.log("\n-- on a phone --");
  {
    await page.setViewport({ width: 390, height: 844 });
    await wait(900);
    const phone = await page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth + 2,
      cards: [...document.querySelectorAll(".invited-card")].map((c) => Math.round(c.getBoundingClientRect().width)),
    }));
    ck("nothing spills off the side", phone.sideways === false);
    ck("and a card is a usable width", phone.cards.every((w) => w > 200), phone.cards.join(", "));
  }

  ck("nothing threw along the way", crashes.length === 0, crashes.slice(0, 2).join(" ; "));
  await ctx.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  await browser.close();
  // Hand the account back as it was found.
  if (made.length) d1(`DELETE FROM sub_invites WHERE id IN (${made.map((i) => `'${i}'`).join(",")});`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
