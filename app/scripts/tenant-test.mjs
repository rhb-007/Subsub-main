// Tenants: the link, the sign-up, the report, and everything they must not
// reach along the way.
//
// Like the owner suite next door, this talks to a running Worker rather than
// importing handlers -- the question is not whether the filters exist but
// whether every route is behind one. The sign-up half is the part that cannot
// be tested any other way: it is the only flow in the product that creates a
// seat for somebody who has no account at all, so it runs unauthenticated,
// and "unauthenticated" and "unguarded" are one exemption apart.
//
// Needs the local stack and the fixture:
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   npx wrangler d1 execute subsub-db --config=./wrangler.toml --local \
//     --file=./scripts/owner-scope-fixture.sql
//
//   node scripts/tenant-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = process.env.ACCOUNT_ID || "acc_pm";
const tok = async (e) => (await (await fetch(AUTH,{method:"POST",body:JSON.stringify({email:e})})).json()).access_token;
const call = async (t, path, opts={}) => {
  const r = await fetch(API+path, { ...opts, headers: { "X-Account-Id": ACCOUNT,
    ...(t ? { Authorization: `Bearer ${t}` } : {}), "content-type":"application/json", ...(opts.headers||{}) }});
  let body=null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
let pass=0, fail=0;
const ck=(n,ok,d="")=>{ok?pass++:fail++;console.log(`${ok?"  ok  ":"FAIL  "}${n}${d?"  -- "+d:""}`);};

// Fresh addresses per run: a tenant who already exists takes a different
// path through accept(), so reusing one would quietly stop testing signup.
const stamp = Date.now();
const T1 = `tenant1+${stamp}@example.test`;
const T2 = `tenant2+${stamp}@example.test`;

const pm = await tok("pm@example.test");
const mgr = await tok("manager1@example.test");   // scoped to p1, p9
const dana = await tok("owner1@example.test");    // owner of p1, p2

console.log("\n-- creating a tenant link --");
const open = await call(pm, "/tenant-invites", { method:"POST", body: JSON.stringify({ label: "Flat 4B" }) });
ck("a manager can make an open link", open.status === 201 && open.body.url.includes("?tenant="), open.body?.url);
const tied = await call(pm, "/tenant-invites", { method:"POST", body: JSON.stringify({ label:"Flat 1A", propertyId:"p1" }) });
ck("and one tied to a building", tied.status === 201 && tied.body.propertyName === "Building 1");
ck("a scoped manager must name one of theirs",
  (await call(mgr, "/tenant-invites", { method:"POST", body: JSON.stringify({ label:"x" }) })).status === 400);
ck("and cannot name a building that is not theirs",
  (await call(mgr, "/tenant-invites", { method:"POST", body: JSON.stringify({ propertyId:"p2" }) })).status === 403);
ck("an owner cannot make one at all",
  (await call(dana, "/tenant-invites", { method:"POST", body: JSON.stringify({ propertyId:"p1" }) })).status === 403);

console.log("\n-- what the link shows before anyone signs in --");
const openTok = open.body.url.split("?tenant=")[1];
const tiedTok = tied.body.url.split("?tenant=")[1];
const pub = await call(null, `/tenant-invite/${openTok}`);
ck("an open link offers the buildings to choose from", pub.status === 200 && pub.body.properties.length === 16);
const pubTied = await call(null, `/tenant-invite/${tiedTok}`);
ck("a tied link names one and does not list the rest",
  pubTied.body.fixedProperty === "p1" && pubTied.body.properties.length === 1);
ck("and it carries the manager's branding, not SubSub's",
  pubTied.body.account.name === "Cascade Management");

console.log("\n-- accepting one --");
const acc = await call(null, `/tenant-invite/${tiedTok}`, { method:"POST",
  body: JSON.stringify({ name:"Sam Cole", email:T1, unit:"1A" }) });
ck("a tenant can set themselves up", acc.status === 200 && acc.body.ok, JSON.stringify(acc.body));
ck("the link is spent", (await call(null, `/tenant-invite/${tiedTok}`)).status === 410);
// A tied link must not be talked into another building.
const acc2 = await call(null, `/tenant-invite/${openTok}`, { method:"POST",
  body: JSON.stringify({ name:"Mal", email:"mal@example.test", propertyId:"nope" }) });
ck("an unknown building is refused", acc2.status === 404, `status ${acc2.status}`);

console.log("\n-- what a tenant sees --");
const sam = await tok(T1);
const props = await call(sam, "/properties");
ck("only their own building", props.status === 200 && props.body.length === 1 && props.body[0].id === "p1",
  JSON.stringify((props.body||[]).map(p=>p.id)));
const jobs0 = await call(sam, "/jobs");
ck("and none of the building's existing work", jobs0.body.length === 0,
  `${jobs0.body?.length} jobs`);
for (const [label, path, method] of [
  ["the contractor list", "/subs", "GET"],
  ["tenant links", "/tenant-invites", "GET"],
  ["service calls", "/service-calls", "GET"],
  ["the booking feed", "/jobs/all-bookings", "GET"],
]) ck(`refused: ${label}`, (await call(sam, path, { method })).status === 403);
const au = await call(sam, "/account-users");
ck("the member list is just them", au.body?.length === 1 && au.body[0].email === T1);

console.log("\n-- reporting something --");
ck("not at a building that is not theirs",
  (await call(sam, "/jobs", { method:"POST", body: JSON.stringify(
    { title:"x", propertyId:"p9", trades:["plumbing"] })})).status === 403);
const rep = await call(sam, "/jobs", { method:"POST", body: JSON.stringify(
  { title:"Kitchen tap won't stop running", propertyId:"p1", trades:["plumbing"], scope:"Unit 1A." })});
ck("but yes at their own, as a request", rep.status === 201 && rep.body.requested === true);
const mineNow = await call(sam, "/jobs");
ck("and they can see it", mineNow.body.length === 1 && mineNow.body[0].id === rep.body.id);

console.log("\n-- and it reaches the people who can act --");
const mgrSees = (await call(mgr, "/jobs")).body.find((j) => j.id === rep.body.id);
ck("the scoped manager of that building sees it", !!mgrSees && !!mgrSees.requestedBy && !mgrSees.approvedAt);
ck("the account sees it too", !!(await call(pm, "/jobs")).body.find((j)=>j.id===rep.body.id));
// Dana owns p1, so a repair there is hers to know about.
ck("so does the building's owner", !!(await call(dana, "/jobs")).body.find((j)=>j.id===rep.body.id));
ck("nothing can be assigned until approved",
  (await call(pm, `/jobs/${rep.body.id}/assign`, { method:"POST", body: JSON.stringify(
    { trade:"plumbing", companyId:"cmp_r" })})).status === 409);
ck("the tenant cannot approve their own report",
  (await call(sam, `/jobs/${rep.body.id}/approve`, { method:"POST" })).status === 403);
ck("the manager can", (await call(mgr, `/jobs/${rep.body.id}/approve`, { method:"POST" })).status === 200);

console.log("\n-- a second tenant in the same building --");
const open2 = await call(pm, "/tenant-invites", { method:"POST", body: JSON.stringify({ propertyId:"p1" }) });
const t2 = open2.body.url.split("?tenant=")[1];
await call(null, `/tenant-invite/${t2}`, { method:"POST",
  body: JSON.stringify({ name:"Ola", email:T2, unit:"2C" }) });
const ola = await tok(T2);
const olaJobs = await call(ola, "/jobs");
ck("sees none of the first tenant's reports", olaJobs.body.length === 0, `${olaJobs.body?.length} jobs`);

console.log("\n-- money --");
ck("a tenant is sent no values",
  (await call(sam,"/jobs")).body.every((j)=>Object.values(j.assignments||{}).every((a)=>!("value" in a))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
