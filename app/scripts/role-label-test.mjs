// What the second seat on an account is called.
//
// The role is "pm" everywhere and does the same things everywhere: runs
// jobs, hires contractors, does not manage users. Only the word on it was
// wrong. Three of the four account kinds are property businesses, so
// "Property manager" was right for them and got applied to the fourth as
// well -- a general contractor, which has no buildings at all, so nobody in
// the account manages property and the badge described a job that does not
// exist there.
//
// The rule now: a general contractor's pm seat reads "Project manager",
// everyone else's reads "Property manager", and the permissions are
// identical. That second half is the part worth testing hardest, because a
// rename that quietly moves what somebody may do is far worse than the
// wrong word.
//
// Needs the local stack: worker on 8787, dist served on 5191 with
// *.subsub.work mapped to it.
//
//   node scripts/role-label-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const S = Date.now().toString(36);
// A pm seat inside the general contractor account. There is not one in the
// seed data -- the only two live in the managing agent account, which is
// exactly the gap that let the wrong word sit there unnoticed.
const GC_PM = { id: `usr_rl_${S}`, email: `pmgc.${S}@example.test`, name: `Robin Vance ${S}` };
d1(`INSERT INTO users (id, name, email) VALUES ('${GC_PM.id}', '${GC_PM.name}', '${GC_PM.email}');`);
d1(`INSERT INTO memberships (id, user_id, account_id, role) VALUES ('mem_rl_${S}', '${GC_PM.id}', 'acc_test', 'pm');`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

async function signIn(host, email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${host}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6000);
  return { ctx, page, crashes };
}

// Opens My account -> Users -> New user and reads the role picker. The
// badges are read before the form opens, because that is the roster.
async function rolePicker(page) {
  const click = (re) => page.evaluate((r) => [...document.querySelectorAll("button")]
    .find((b) => new RegExp(r, "i").test(b.innerText.trim()))?.click(), re);
  await click("^My account");
  await wait(1800);
  await click("^Users");
  await wait(1500);
  const badges = await page.evaluate(() =>
    [...document.querySelectorAll(".role-badge")].map((e) => e.innerText.trim()));
  await click("^New user");
  await wait(1500);
  return {
    badges,
    ...(await page.evaluate(() => ({
      // innerText, so the badge and chip styling (which upper-cases them)
      // is read the way somebody actually sees it.
      labels: [...document.querySelectorAll(".role-pick .rp-label")].map((e) => e.innerText.trim()),
      blurb: document.querySelector(".form-sub")?.innerText || "",
    }))),
  };
}
const has = (list, re) => list.some((x) => re.test(x));

try {
  console.log("\n-- inside a general contractor --");
  const gc = await signIn("outerhome.subsub.work", "admin@example.test");
  {
    const p = await rolePicker(gc.page);
    ck("the picker is actually there", p.labels.length >= 3, p.labels.join(" | "));
    ck("the seat offered is a project manager", has(p.labels, /^project manager$/i), p.labels.join(" | "));
    ck("and property manager is not offered at all", !has(p.labels, /property manager/i),
      p.labels.join(" | "));
    // The sentence under the heading named the role too.
    ck("the sentence explaining the roles says it as well",
      /project managers do everything else/i.test(p.blurb), p.blurb);
    // Admin, owner and contractor are untouched -- only this one seat is
    // renamed, and renaming the wrong one would be its own bug.
    ck("admin is still admin", has(p.labels, /^admin$/i), p.labels.join(" | "));
    ck("and a contractor is still a contractor", has(p.labels, /^contractor$/i), p.labels.join(" | "));
    ck("and the roster badges say it too",
      has(p.badges, /^project manager$/i) && !has(p.badges, /property manager/i),
      p.badges.join(" | "));
    ck("nothing threw", gc.crashes.length === 0, gc.crashes.slice(0, 2).join(" ; "));
    await gc.ctx.close();
  }

  console.log("\n-- inside a managing agent, which is unchanged --");
  {
    const pm = await signIn("cascademanagement.subsub.work", "pm@example.test");
    const p = await rolePicker(pm.page);
    ck("the picker is actually there", p.labels.length >= 3, p.labels.join(" | "));
    ck("the seat offered is still a property manager", has(p.labels, /^property manager$/i), p.labels.join(" | "));
    ck("and project manager is not offered there", !has(p.labels, /project manager/i),
      p.labels.join(" | "));
    ck("and its roster still says property manager", has(p.badges, /^property manager$/i), p.badges.join(" | "));
    ck("the sentence matches", /property managers do everything else/i.test(p.blurb), p.blurb);
    ck("nothing threw", pm.crashes.length === 0, pm.crashes.slice(0, 2).join(" ; "));
    await pm.ctx.close();
  }

  console.log("\n-- what the renamed seat sees, signed in as one --");
  {
    const s = await signIn("outerhome.subsub.work", GC_PM.email);
    const header = await s.page.evaluate(() => document.body.innerText);
    ck("they are in", /Outerhome/i.test(header), header.split("\n")[0]);
    ck("and their own seat is named as a project manager",
      /project manager/i.test(header) && !/property manager/i.test(header),
      (header.match(/.*manager.*/i) || ["nothing said"])[0]);
    // The rename must not move a single tab. A pm sees the same six places
    // whatever the account is called.
    const tabs = await s.page.evaluate(() => [...document.querySelectorAll(".drawer-nav button, nav button")]
      .map((b) => b.innerText.trim().split("\n")[0]).filter(Boolean));
    for (const t of ["Dashboard", "Contractors", "Availability", "Jobs", "Uniforms"]) {
      ck(`they still get ${t}`, tabs.some((x) => x.startsWith(t)), tabs.join(" | "));
    }
    // And a general contractor has no buildings, which is the reason the
    // word was wrong in the first place.
    ck("and no Properties tab, because there are no buildings here",
      !tabs.some((x) => /^Properties/.test(x)), tabs.join(" | "));
    ck("nothing threw", s.crashes.length === 0, s.crashes.slice(0, 2).join(" ; "));
    await s.ctx.close();
  }

  console.log("\n-- and the permissions are the same permissions --");
  {
    // The word changed; nothing else may have. Checked against the API,
    // which is where a permission actually lives.
    const theirs = await tok(GC_PM.email);
    const H = { Authorization: `Bearer ${theirs}`, "X-Account-Id": "acc_test", "content-type": "application/json" };
    const subs = await fetch(`${API}/subs`, { headers: H });
    ck("they can read the contractor roster", subs.status === 200, String(subs.status));
    const made = await fetch(`${API}/invites`, { method: "POST", headers: H,
      body: JSON.stringify({ label: `Role label ${S}` }) });
    ck("they can hand out an invite, as a pm always could", made.status === 201, String(made.status));
    const row = made.status === 201 ? await made.json() : null;
    // Still not an admin: revoking is admin-only and stays that way.
    const rev = await fetch(`${API}/invites/${row?.id}`, { method: "DELETE", headers: H });
    ck("and still cannot revoke one, which was never theirs", rev.status === 403, String(rev.status));
    const users = await fetch(`${API}/account-users`, { method: "POST", headers: H,
      body: JSON.stringify({ name: "Nope", email: `nope.${S}@example.test`, role: "pm" }) });
    ck("nor add a user to the account", users.status === 403, String(users.status));
    if (row?.id) d1(`DELETE FROM sub_invites WHERE id = '${row.id}';`);
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  await browser.close();
  // In reference order, and everything this seat touched: creating an
  // invite writes an activity row and a mail log line that both point back
  // at them, and a users row cannot go while anything still names it.
  for (const sql of [
    `DELETE FROM sub_invites WHERE created_by = '${GC_PM.id}';`,
    `DELETE FROM activity WHERE user_id = '${GC_PM.id}';`,
    `DELETE FROM email_log WHERE sent_by = '${GC_PM.id}';`,
    `DELETE FROM memberships WHERE user_id = '${GC_PM.id}';`,
    `DELETE FROM users WHERE id = '${GC_PM.id}';`,
  ]) {
    try { d1(sql); } catch (e) { console.log("cleanup:", sql, String(e.message).slice(0, 60)); }
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
