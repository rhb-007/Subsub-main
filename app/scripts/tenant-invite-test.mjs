// Opening an invite that has already gone out: correcting it, changing the
// wording, sending it again, and calling it off.
//
// The thing worth checking is not that rows change -- it is what actually
// leaves. So the stand-ins are read back: that an edited subject and body
// arrive, that the sign-in link survives being deleted from the draft, and
// that a revoked link stops working for the person holding it.
//
//   node scripts/send-stub.mjs &
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   node scripts/tenant-invite-test.mjs

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
const sentEmails = async () => (await (await fetch("http://127.0.0.1:8904/__sent")).json());
const sentSms = async () => (await (await fetch("http://127.0.0.1:8905/__sent")).json());
const clear = async () => { await fetch("http://127.0.0.1:8904/__clear"); await fetch("http://127.0.0.1:8905/__clear"); };

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const pm = await tok("pm@example.test");
const mgr = await tok("manager1@example.test");   // scoped to p1 and p9
const S = Date.now().toString(36);

await clear();
console.log("\n-- somebody to work on --");
const made = await call(pm, "/tenants", { method: "POST", body: JSON.stringify({
  propertyId: "p1", firstName: "Iris", lastName: "Vale",
  email: `iris.${S}@example.test`, phone: "(206) 555-0180", unit: "3A", channels: ["email"] }) });
ck("added", made.status === 201, JSON.stringify(made.body?.sent));
const uid = made.body.userId;

console.log("\n-- reading the invite before sending it --");
const got = await call(pm, `/tenants/${uid}/invite`);
ck("it opens", got.status === 200);
ck("with their record on it",
  got.body?.name === "Iris Vale" && got.body?.unit === "3A" && got.body?.propertyId === "p1");
ck("and says an invite is outstanding", got.body?.openInvite === true);
ck("the email address is still editable, because they have not signed in",
  got.body?.emailLocked === false);
ck("the draft carries a subject and a body",
  !!got.body?.draft?.subject && !!got.body?.draft?.message);
ck("with a placeholder where the link goes, not a live token",
  got.body.draft.message.includes(got.body.linkToken) && !/\/\?tenant=[0-9a-f]{64}/.test(got.body.draft.message),
  got.body.linkToken);
ck("and a text message short enough to send as one", got.body.draft.sms.length < 320,
  `${got.body.draft.sms.length} chars`);

console.log("\n-- correcting the record --");
const fixed = await call(pm, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify({
  firstName: "Iris", lastName: "Vale-Ng", email: `iris.fixed.${S}@example.test`,
  phone: "(206) 555-0181", unit: "3B", propertyId: "p9" }) });
ck("it saves", fixed.status === 200, JSON.stringify(fixed.body));
const after = await call(pm, `/tenants/${uid}/invite`);
ck("the name changed", after.body?.name === "Iris Vale-Ng", after.body?.name);
ck("the address changed", after.body?.email === `iris.fixed.${S}@example.test`);
ck("the unit changed", after.body?.unit === "3B");
ck("and so did the building", after.body?.propertyId === "p9", after.body?.propertyName);
ck("the draft follows the correction", after.body.draft.message.includes("3B"));

console.log("\n-- what an edit is refused for --");
for (const [label, patch, want, code] of [
  ["a name with nothing in it", { firstName: "", lastName: "" }, 200, null],   // keeps the old one
  ["an address that isn't one", { email: "not-an-address" }, 400, "bad_email"],
  ["half a phone number", { phone: "206555" }, 400, "bad_phone"],
  ["no way to reach them at all", { email: "", phone: "" }, 400, "contact_required"],
  ["a building on another account", { propertyId: "p-nope" }, 400, "property_not_found"],
]) {
  const r = await call(pm, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify(patch) });
  ck(label, r.status === want && (!code || r.body?.error === code), `${r.status} ${r.body?.error || ""}`);
}
const taken = await call(pm, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify({ email: "pm@example.test" }) });
ck("an address somebody else here already uses", taken.status === 409 && taken.body?.error === "email_taken",
  `${taken.status} ${taken.body?.error}`);
ck("and none of that changed anything",
  (await call(pm, `/tenants/${uid}/invite`)).body?.email === `iris.fixed.${S}@example.test`);

console.log("\n-- scoping --");
// usr_mgr has p1 and p9. The tenant is on p9 now, so they can reach them --
// but must not be able to move them to a building they do not have.
const moveOut = await call(mgr, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify({ propertyId: "p2" }) });
ck("a scoped manager cannot move a tenant into a building they don't have",
  moveOut.status === 403 && moveOut.body?.error === "forbidden", `${moveOut.status} ${moveOut.body?.error}`);
const other = await call(pm, "/tenants", { method: "POST", body: JSON.stringify({
  propertyId: "p2", firstName: "Otto", lastName: "Pell", email: `otto.${S}@example.test`, channels: ["email"] }) });
const otherId = other.body.userId;
ck("and cannot open one in a building that isn't theirs",
  (await call(mgr, `/tenants/${otherId}/invite`)).status === 403);
ck("nor edit them", (await call(mgr, `/tenants/${otherId}`, { method: "PATCH", body: JSON.stringify({ unit: "X" }) })).status === 403);
ck("nor call their invite off", (await call(mgr, `/tenants/${otherId}/revoke`, { method: "POST" })).status === 403);

console.log("\n-- sending wording of their own --");
await clear();
const custom = await call(pm, `/tenants/${uid}/resend`, { method: "POST", body: JSON.stringify({
  channels: ["email", "sms"],
  subject: `Third time asking, Iris`,
  message: `Iris -- this is the third time. Please set your password:\n\n{link}\n\n-- Cascade`,
  sms: `Iris, please set your password: {link}` }) });
ck("it sends", custom.status === 200 && custom.body?.edited === true, JSON.stringify(custom.body?.sent));
const em = (await sentEmails())[0];
ck("the subject is the one that was typed", em?.subject === "Third time asking, Iris", em?.subject);
ck("and so is the body", /this is the third time/.test(em?.text || ""));
ck("with the real link put in where the placeholder was",
  /\/\?tenant=[0-9a-f]{64}/.test(em?.text || "") && !em.text.includes("{link}"));
// Resend takes `to` as a list, so the stand-in records one.
const recipient = (m) => [].concat(m?.to || []).join(", ");
ck("it went to the corrected address", recipient(em) === `iris.fixed.${S}@example.test`, recipient(em));
const sm = (await sentSms())[0];
ck("the text is the one that was typed, with the link in it",
  /please set your password/i.test(sm?.Body || "") && /\?tenant=/.test(sm?.Body || ""));
ck("and went to the corrected number", sm?.To === "+12065550181", sm?.To);

console.log("\n-- a message with the link taken out still carries one --");
await clear();
await call(pm, `/tenants/${uid}/resend`, { method: "POST", body: JSON.stringify({
  channels: ["email"], subject: "No link in this one", message: "Just some words." }) });
const noLink = (await sentEmails())[0];
ck("the link is appended rather than dropped", /\/\?tenant=[0-9a-f]{64}/.test(noLink?.text || ""),
  (noLink?.text || "").slice(-70));

console.log("\n-- an empty message is not a message --");
ck("no body", (await call(pm, `/tenants/${uid}/resend`, { method: "POST",
  body: JSON.stringify({ channels: ["email"], subject: "x", message: "   " }) })).body?.error === "empty_message");
ck("no subject", (await call(pm, `/tenants/${uid}/resend`, { method: "POST",
  body: JSON.stringify({ channels: ["email"], subject: "", message: "words" }) })).body?.error === "empty_subject");

console.log("\n-- the standard wording still goes when nothing was edited --");
await clear();
await call(pm, `/tenants/${uid}/resend`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
const plain = (await sentEmails())[0];
ck("it falls back to the default", /report repairs/i.test(plain?.subject || ""), plain?.subject);

console.log("\n-- calling it off --");
const before = await call(pm, `/tenants/${uid}/invite`);
ck("there is one outstanding to call off", before.body?.openInvite === true);
const off = await call(pm, `/tenants/${uid}/revoke`, { method: "POST" });
ck("it is called off", off.status === 200 && off.body?.revoked >= 1, JSON.stringify(off.body));
ck("and nothing is outstanding now", (await call(pm, `/tenants/${uid}/invite`)).body?.openInvite === false);
ck("they are still on the roster -- called off, not deleted",
  (await call(pm, "/tenants")).body.some((t) => t.userId === uid));
ck("calling off again is harmless", (await call(pm, `/tenants/${uid}/revoke`, { method: "POST" })).body?.revoked === 0);

console.log("\n-- and the link in their hand has stopped working --");
// The last link sent, from the stand-in, is the one they are holding.
const held = (plain?.text || "").match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
const lookup = await fetch(`${API}/tenant-invite/${held}`);
ck("their link is refused", lookup.status === 410, `${lookup.status}`);

console.log("\n-- sending again after calling off --");
await clear();
const again = await call(pm, `/tenants/${uid}/resend`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) });
ck("works, and mints a fresh one", again.status === 200 && again.body?.sent?.email === "sent");
const fresh = (await sentEmails())[0]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
ck("a different link from the one that was called off", fresh && fresh !== held);
ck("and this one works", (await fetch(`${API}/tenant-invite/${fresh}`)).status === 200);

console.log("\n-- once they are in, their sign-in address is not ours to move --");
const set = await fetch(`${API}/tenant-invite/${fresh}`, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
ck("they set a password", set.status === 200, String(set.status));
const locked = await call(pm, `/tenants/${uid}/invite`);
ck("the invite now reads as signed in", locked.body?.status === "active");
ck("and their address is locked", locked.body?.emailLocked === true);
const move = await call(pm, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify({ email: `moved.${S}@example.test` }) });
ck("moving it is refused", move.status === 409 && move.body?.error === "email_locked", `${move.status} ${move.body?.error}`);
ck("but the rest of the record still edits",
  (await call(pm, `/tenants/${uid}`, { method: "PATCH", body: JSON.stringify({ unit: "4Z" }) })).status === 200);
ck("and there is nothing left to call off",
  (await call(pm, `/tenants/${uid}/revoke`, { method: "POST" })).body?.error === "already_accepted");

console.log("\n-- somebody reachable only by phone --");
const phoneOnly = await call(pm, "/tenants", { method: "POST", body: JSON.stringify({
  propertyId: "p1", firstName: "Sol", lastName: "Reyes", phone: "(206) 555-0199", unit: "1A" }) });
ck("can be added with no email at all", phoneOnly.status === 201, JSON.stringify(phoneOnly.body?.sent));
const solInv = await call(pm, `/tenants/${phoneOnly.body.userId}/invite`);
ck("and opens with no address on file", solInv.status === 200 && solInv.body?.email === null);
ck("their address can still be filled in later",
  (await call(pm, `/tenants/${phoneOnly.body.userId}`, { method: "PATCH",
    body: JSON.stringify({ email: `sol.${S}@example.test` }) })).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
