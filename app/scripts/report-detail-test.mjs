// What a tenant reported, kept and shown back.
//
// Three things that were all the same problem: the answers a tenant gives
// were composed into one sentence and the parts thrown away, so nothing
// could show them back or let them be corrected; there was no way to send a
// photo of the thing being reported; and a report could be taken back after
// a contractor had already been booked for it.
//
// Needs the local stack -- worker on 8787, stubs on 8902/8904/8905.
//
//   node scripts/report-detail-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const call = async (t, path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { "X-Account-Id": ACCOUNT,
    Authorization: `Bearer ${t}`, "content-type": "application/json", ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
// A real 1x1 PNG, so the content type is not merely claimed.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const putPhoto = async (t, name, bytes = PNG, type = "image/png") => {
  const r = await fetch(`${API}/uploads/report-photo/${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${t}`, "Content-Type": type },
    body: bytes });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

const pm = await tok("pm@example.test");
const S = Date.now().toString(36);
const email = `pia.${S}@example.test`;
await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Pia", lastName: "Nord", email, unit: "9C", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const link = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(email);

console.log("\n-- the answers are kept, not just the sentence --");
const detail = { problem: "My sink is leaking", started: "A few days ago", words: "Under the kitchen sink, worse at night.", unit: "9C" };
const made = await call(tn, "/jobs", { method: "POST", body: JSON.stringify({
  title: "My sink is leaking", propertyId: "p1", address: "101 Main St", trades: [], reportDetail: detail }) });
ck("the report is created", made.status === 200 || made.status === 201, JSON.stringify(made.body).slice(0, 120));
const id = made.body.id;
let mine = (await call(tn, "/jobs")).body.find((j) => j.id === id);
ck("what they picked comes back", mine?.reportDetail?.problem === detail.problem, mine?.reportDetail?.problem);
ck("when it started too", mine?.reportDetail?.started === detail.started, mine?.reportDetail?.started);
ck("and their own words", mine?.reportDetail?.words === detail.words, mine?.reportDetail?.words);
ck("the sentence a contractor reads is still composed from them",
  mine?.scope === "Unit 9C. Started: a few days ago. Under the kitchen sink, worse at night.", mine?.scope);

console.log("\n-- correcting every part of it --");
const ed = await call(tn, `/jobs/${id}/report`, { method: "PATCH", body: JSON.stringify({
  title: "Kitchen sink leak", reportDetail: { problem: "Water where it shouldn't be", started: "Today", words: "It got worse this morning." } }) });
ck("the edit is accepted", ed.status === 200, JSON.stringify(ed.body?.error || ""));
mine = (await call(tn, "/jobs")).body.find((j) => j.id === id);
ck("the title changed", mine.title === "Kitchen sink leak", mine.title);
ck("so did what it is", mine.reportDetail.problem === "Water where it shouldn't be", mine.reportDetail.problem);
ck("and when it started", mine.reportDetail.started === "Today", mine.reportDetail.started);
ck("the unit is not lost by an edit that never mentioned it", mine.reportDetail.unit === "9C", mine.reportDetail.unit);
ck("and the sentence was rewritten to match",
  mine.scope === "Unit 9C. Reported as: Water where it shouldn't be. Started: today. It got worse this morning.", mine.scope);

console.log("\n-- photos --");
const up = await putPhoto(tn, "leak.png");
ck("a tenant may upload a photo", up.status === 200 && !!up.body.key, JSON.stringify(up.body).slice(0, 90));
ck("and is told how big it was", up.body.size === PNG.length, String(up.body.size));
const att = await call(tn, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: up.body.key, name: "leak.png", type: "image/png", size: PNG.length }] }) });
ck("attaching it works", att.status === 200 && att.body.photos?.length === 1, JSON.stringify(att.body).slice(0, 90));
const photoId = att.body.photos[0].id;
ck("the R2 key is never sent to the browser", !JSON.stringify(att.body).includes(up.body.key));
const got = await fetch(`${API}/jobs/${id}/photos/${photoId}`, { headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${tn}` } });
const back = Buffer.from(await got.arrayBuffer());
ck("and it comes back byte for byte", got.status === 200 && back.equals(PNG), `${got.status}, ${back.length} bytes`);
ck("as the type it went up as", got.headers.get("content-type") === "image/png", got.headers.get("content-type"));
mine = (await call(tn, "/jobs")).body.find((j) => j.id === id);
ck("the report lists it", mine.photos?.length === 1 && mine.photos[0].name === "leak.png", JSON.stringify(mine.photos));

console.log("\n-- what is not a photo --");
ck("a PDF is refused", (await putPhoto(tn, "x.pdf", Buffer.from("%PDF-1.4"), "application/pdf")).status === 415);
ck("so is an empty file", (await putPhoto(tn, "x.png", Buffer.alloc(0))).status === 400);
ck("and one over the size limit", (await putPhoto(tn, "big.png", Buffer.alloc(11 * 1024 * 1024))).status === 413);
const forged = await call(tn, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: "acc_test/report-photo/someone-elses.png", name: "x", type: "image/png" }] }) });
ck("a key belonging to another account is ignored", forged.body?.error === "nothing_to_add", JSON.stringify(forged.body));
const climb = await call(tn, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: `${ACCOUNT}/report-photo/../../etc/passwd`, name: "x", type: "image/png" }] }) });
ck("so is one trying to climb out", climb.body?.error === "nothing_to_add", JSON.stringify(climb.body));

console.log("\n-- six is the limit --");
for (let i = 0; i < 5; i++) {
  const u = await putPhoto(tn, `more${i}.png`);
  await call(tn, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: u.body.key, name: `more${i}.png`, type: "image/png", size: PNG.length }] }) });
}
mine = (await call(tn, "/jobs")).body.find((j) => j.id === id);
ck("six went on", mine.photos.length === 6, String(mine.photos.length));
const seventh = await putPhoto(tn, "seventh.png");
const over = await call(tn, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: seventh.body.key, name: "seventh.png", type: "image/png", size: PNG.length }] }) });
ck("the seventh is refused, and says the limit", over.body?.error === "too_many" && over.body.max === 6, JSON.stringify(over.body));

console.log("\n-- taking one off --");
const rm = await call(tn, `/jobs/${id}/photos/${photoId}`, { method: "DELETE" });
ck("it goes", rm.status === 200 && rm.body.photos.length === 5, String(rm.body.photos?.length));
ck("and is no longer fetchable",
  (await fetch(`${API}/jobs/${id}/photos/${photoId}`, { headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${tn}` } })).status === 404);

console.log("\n-- somebody else's report --");
const other = `rex.${S}@example.test`;
await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Rex", lastName: "Vale", email: other, unit: "2D", channels: ["email"] }) });
const sent2 = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const link2 = sent2[sent2.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${link2}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tn2 = await tok(other);
const peek = await fetch(`${API}/jobs/${id}/photos/${mine.photos[1].id}`, { headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${tn2}` } });
ck("another tenant cannot see the photo", peek.status === 403, String(peek.status));
ck("nor attach one to it",
  (await call(tn2, `/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ photos: [] }) })).status === 403);
ck("the manager can see it",
  (await fetch(`${API}/jobs/${id}/photos/${mine.photos[1].id}`, { headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${pm}` } })).status === 200);

console.log("\n-- withdrawing, once somebody is booked --");
await call(pm, `/jobs/${id}/approve`, { method: "POST" });
const asg = await call(pm, `/jobs/${id}/assign`, { method: "POST", body: JSON.stringify({ trade: "plumbing", companyId: "cmp_r", responseWindow: "24h" }) });
ck("a contractor is put on it", asg.status === 201, JSON.stringify(asg.body).slice(0, 90));
const wd = await call(tn, `/jobs/${id}/withdraw`, { method: "POST", body: JSON.stringify({ note: "changed my mind" }) });
ck("the tenant can no longer take it back", wd.status === 409 && wd.body?.error === "contractor_assigned", JSON.stringify(wd.body));
ck("and it really is not withdrawn",
  !(await call(tn, "/jobs")).body.find((j) => j.id === id)?.withdrawnAt);

console.log("\n-- before anyone is booked, they still can --");
const fresh = await call(tn, "/jobs", { method: "POST", body: JSON.stringify({
  title: `Draughty window ${S}`, propertyId: "p1", address: "101 Main St", trades: [],
  reportDetail: { problem: "Draughty window", started: "Today", words: "", unit: "9C" } }) });
const wd2 = await call(tn, `/jobs/${fresh.body.id}/withdraw`, { method: "POST", body: JSON.stringify({ note: "it was just open" }) });
ck("withdrawing an unassigned report still works", wd2.status === 200 && wd2.body?.ok, JSON.stringify(wd2.body));
ck("a closed report will not take photos",
  (await call(tn, `/jobs/${fresh.body.id}/photos`, { method: "POST", body: JSON.stringify({ photos: [{ key: seventh.body.key, name: "x.png", type: "image/png" }] }) })).body?.error === "closed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
