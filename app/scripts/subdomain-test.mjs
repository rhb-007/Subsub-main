// Changing the address a company signs in at.
//
// The bug this exists to stop coming back: the account page let somebody type
// a new subdomain, said "Saved", and never sent it anywhere -- PATCH /api/account
// did not read the field at all. It looked saved until the next reload.
//
// Needs the local stack and the fixture:
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   npx wrangler d1 execute subsub-db --config=./wrangler.toml --local \
//     --file=./scripts/owner-scope-fixture.sql
//   node scripts/subdomain-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = process.env.ACCOUNT_ID || "acc_pm";

const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const call = async (t, path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { "X-Account-Id": ACCOUNT,
    ...(t ? { Authorization: `Bearer ${t}` } : {}), "content-type": "application/json", ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const admin = await tok("pm@example.test");
const manager = await tok("manager1@example.test");   // a pm seat, not an admin

const account = async () => (await call(admin, "/account")).body;
const started = (await account()).subdomain;
// A fresh name each run: saving the name it already has takes a different
// path, and that is the path that used to look like it worked.
const S = Date.now().toString(36);
const wanted = `cascade-${S}`;

console.log("\n-- it actually saves --");
const saved = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: wanted }) });
ck("accepted", saved.status === 200, JSON.stringify(saved.body));
ck("and says what it saved", saved.body?.subdomain === wanted, saved.body?.subdomain);
const reread = await account();
ck("still there on the next read", reread.subdomain === wanted, reread.subdomain);

console.log("\n-- the old address stops claiming to be live --");
// A moved account cannot keep the status of the hostname it has just left.
ck("status cleared by the move", reread.hostnameStatus == null, String(reread.hostnameStatus));
const byOld = await fetch(`${API}/account-by-subdomain/${started}`);
ck("nothing answers at the old name", byOld.status === 404, String(byOld.status));
const byNew = await fetch(`${API}/account-by-subdomain/${wanted}`);
ck("the new one does", byNew.status === 200 && (await byNew.json()).id === ACCOUNT);

console.log("\n-- what is refused --");
for (const [label, sub, want] of [
  ["a reserved word", "admin", 400],
  ["another reserved word", "billing", 400],
  ["too short", "ab", 400],
  ["a leading dash", "-nope", 400],
  ["a trailing dash", "nope-", 400],
  ["two dashes in a row", "no--pe", 400],
  ["a dot, which would be a different host", "a.b.c", 400],
  ["spaces", "my company", 400],
  ["upper case with a space", "My Company", 400],
]) {
  const r = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: sub }) });
  ck(`${label} (${sub})`, r.status === want && r.body?.error === "invalid_subdomain", `${r.status} ${r.body?.error}`);
}

console.log("\n-- and none of those changed anything --");
ck("still on the name we set", (await account()).subdomain === wanted);

console.log("\n-- somebody else's address --");
// acc_test holds "outerhome" in the seed. Taking it would point this account's
// contractors at another company's sign-in page, so it has to be refused --
// and refused without changing anything on the way past.
const taken = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: "outerhome" }) });
ck("a name another account holds is refused",
  taken.status === 409 && taken.body?.error === "subdomain_taken",
  `${taken.status} ${taken.body?.error || ""}`);
ck("and we still have ours", (await account()).subdomain === wanted);
const stillTheirs = await fetch(`${API}/account-by-subdomain/outerhome`);
ck("and they still have theirs",
  stillTheirs.status === 200 && (await stillTheirs.json()).id !== ACCOUNT);

console.log("\n-- saving the same name again --");
const again = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: wanted }) });
ck("is fine, and is not a move", again.status === 200 && again.body?.subdomain === wanted);

console.log("\n-- case and surrounding space --");
const messy = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: `  CASCADE-${S}  ` }) });
ck("tidied rather than refused", messy.status === 200 && messy.body?.subdomain === wanted, JSON.stringify(messy.body));

console.log("\n-- who may change it --");
const notAdmin = await call(manager, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: `mgr-${S}` }) });
ck("a property manager cannot", notAdmin.status === 403, String(notAdmin.status));
ck("and it is unchanged", (await account()).subdomain === wanted);

console.log("\n-- the other fields still work --");
const brand = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({
  name: "Cascade Management", useDefaultMark: true,
  theme: { bg: "#F4F6F4", surface: "#FFFFFF", text: "#12211C", accent: "#1F6B4A", btnText: "#FFFFFF" } }) });
ck("name and theme save without a subdomain in the body", brand.status === 200);
ck("and the address is left alone", brand.body?.subdomain === wanted, brand.body?.subdomain);
const badTheme = await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ theme: { bg: "not-a-color" } }) });
ck("a bad theme is still refused", badTheme.status === 400, String(badTheme.status));

// Put it back so a re-run starts where this one did.
await call(admin, "/account", { method: "PATCH", body: JSON.stringify({ subdomain: started }) });
ck("restored for the next run", (await account()).subdomain === started);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
