// Tenants: adding them, importing them, inviting them, and the invite being
// accepted at the other end.
//
// The sending is the part that cannot be checked any other way, so Resend and
// Twilio are stood in for and the messages read back: that the text is short
// enough to survive one segment, that the number reached Twilio in +E.164,
// that the link points at the customer's own address. A test that only
// checked rows landed in a table would have passed while nobody was told
// anything.
//
// Needs the local stack and the fixture:
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   npx wrangler d1 execute subsub-db --config=./wrangler.toml --local \
//     --file=./scripts/owner-scope-fixture.sql
// with .dev.vars pointing RESEND_API_BASE and TWILIO_API_BASE at the stand-in
// in scripts/send-stub.mjs.
//
//   node scripts/send-stub.mjs &
//   node scripts/tenants-test.mjs

const API=process.env.API_BASE || "http://127.0.0.1:8787/api", AUTH=process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token", ACCOUNT=process.env.ACCOUNT_ID || "acc_pm";
const tok = async (e)=>(await (await fetch(AUTH,{method:"POST",body:JSON.stringify({email:e})})).json()).access_token;
const call = async (t,path,opts={})=>{
  const r=await fetch(API+path,{...opts,headers:{"X-Account-Id":ACCOUNT,
    ...(t?{Authorization:`Bearer ${t}`}:{}),"content-type":"application/json",...(opts.headers||{})}});
  let body=null; try{body=await r.json();}catch{}
  return {status:r.status, body};
};
const sentEmails = async()=>(await (await fetch("http://127.0.0.1:8904/__sent")).json());
const sentSms = async()=>(await (await fetch("http://127.0.0.1:8905/__sent")).json());
await fetch("http://127.0.0.1:8904/__clear"); await fetch("http://127.0.0.1:8905/__clear");
let pass=0,fail=0; const ck=(n,ok,d="")=>{ok?pass++:fail++;console.log(`${ok?"  ok  ":"FAIL  "}${n}${d?"  -- "+d:""}`);};

// Fresh addresses each run: an address that already exists takes a
// different path, so reusing one would quietly stop testing the first.
const S = Date.now();
const pm = await tok("pm@example.test");
const mgr = await tok("manager1@example.test");   // assigned p1 and p9

console.log("\n-- adding one by hand --");
const one = await call(pm,"/tenants",{method:"POST",body:JSON.stringify({
  propertyId:"p1", firstName:"Rosa", lastName:"Lane",
  email:`rosa+${S}@example.test`, phone:"(206) 555-0134", unit:"4B" })});
ck("added", one.status===201 && one.body.name==="Rosa Lane", JSON.stringify(one.body?.sent));
ck("emailed and texted", one.body?.sent?.email==="sent" && one.body?.sent?.sms==="sent");
const em = await sentEmails(); const sm = await sentSms();
ck("the email names the building and the unit",
  /Building 1/.test(em[0]?.subject||"") && /Unit 4B/.test(em[0]?.text||""), em[0]?.subject);
ck("and carries a link to the branded address",
  /cascademanagement\.subsub\.work\/\?tenant=|app\.subsub\.work\/\?tenant=/.test(em[0]?.text||""));
ck("the text is short and carries the same link",
  (sm[0]?.Body||"").length < 320 && /\?tenant=/.test(sm[0]?.Body||""), `${(sm[0]?.Body||"").length} chars`);
ck("texted in E.164", sm[0]?.To === "+12065550134", sm[0]?.To);

console.log("\n-- two people in one unit --");
const two = await call(pm,"/tenants",{method:"POST",body:JSON.stringify({
  propertyId:"p1", firstName:"Ben", lastName:"Ortiz", email:`ben+${S}@example.test`, unit:"4B" })});
ck("both live at 4B", two.status===201);
const roster = await call(pm,"/tenants");
// Scoped to this run's own addresses: the table keeps what earlier runs put
// in it, and counting every 4B would be counting history.
const mine4B = roster.body.filter(t=>t.unit==="4B" && String(t.email||"").includes(`+${S}@`));
ck("the roster shows both, once each", mine4B.length===2,
  mine4B.map(t=>t.name).join(", "));

console.log("\n-- what is refused --");
ck("no name", (await call(pm,"/tenants",{method:"POST",body:JSON.stringify({propertyId:"p1",email:"x@y.com"})})).status===400);
ck("no way to reach them",
  (await call(pm,"/tenants",{method:"POST",body:JSON.stringify({propertyId:"p1",firstName:"No",lastName:"Contact"})})).status===400);
ck("a bad phone is caught, not silently never texted",
  (await call(pm,"/tenants",{method:"POST",body:JSON.stringify({propertyId:"p1",firstName:"A",lastName:"B",phone:"12"})})).status===400);
ck("a manager cannot add to a building that is not theirs",
  (await call(mgr,"/tenants",{method:"POST",body:JSON.stringify({propertyId:"p2",firstName:"A",lastName:"B",email:"a@b.com"})})).status===403);

console.log("\n-- bulk --");
const rows = Array.from({length:30},(_,i)=>({
  propertyId: i%2 ? "p1" : "p9", firstName:`Tenant${i}`, lastName:"Test",
  email:`bulk${S}-${i}@example.test`, phone:"206555" + String(1000+i), unit:`${i}A` }));
let all=[];
for (let i=0;i<rows.length;i+=25){
  const res = await call(pm,"/tenants/bulk",{method:"POST",body:JSON.stringify({rows:rows.slice(i,i+25)})});
  all.push(...(res.body.results||[]));
}
ck("all 30 went in", all.filter(r=>r.ok).length===30, `${all.filter(r=>r.ok).length}/30`);
ck("each one was emailed", all.every(r=>r.sent?.email==="sent"));
ck("a batch over 25 is refused rather than half-done",
  (await call(pm,"/tenants/bulk",{method:"POST",body:JSON.stringify({rows:Array(26).fill({})})})).status===400);

console.log("\n-- what a scoped manager sees --");
const mine = await call(mgr,"/tenants");
ck("only tenants of their own buildings",
  mine.body.every(t=>["p1","p9"].includes(t.propertyId)) && mine.body.length>0,
  `${mine.body.length} rows`);
const allT = await call(pm,"/tenants");
ck("the account sees more than they do", allT.body.length >= mine.body.length);

console.log("\n-- resend, then accept --");
await fetch("http://127.0.0.1:8904/__clear");
const r1 = await call(pm,`/tenants/${one.body.userId}/resend`,{method:"POST",body:"{}"});
ck("resend sends again", r1.status===200 && r1.body.sent.email==="sent");
const again = await sentEmails();
const link = (again[0]?.text||"").match(/\?tenant=([0-9a-f]{64})/)?.[1];
ck("and mints a fresh link", !!link);
const pub = await call(null, `/tenant-invite/${link}`);
ck("the page knows who they are without asking",
  pub.body.firstName==="Rosa" && pub.body.propertyName==="Building 1" && pub.body.unit==="4B",
  JSON.stringify(pub.body?.firstName));
ck("a short password is refused",
  (await call(null,`/tenant-invite/${link}`,{method:"POST",body:JSON.stringify({password:"abc"})})).status===400);
const acc = await call(null,`/tenant-invite/${link}`,{method:"POST",body:JSON.stringify({password:"correcthorse"})});
ck("a good one sets them up", acc.status===200 && acc.body.ok, JSON.stringify(acc.body));
ck("the link is spent", (await call(null,`/tenant-invite/${link}`)).status===410);
const after = await call(pm,"/tenants");
ck("the roster now shows them as signed in",
  after.body.find(t=>t.userId===one.body.userId)?.status==="active");

console.log("\n-- somebody added by phone alone --");
// No email on file, so the link they are texted has to ask for one rather
// than turn them away. This is the whole reason SMS invites are worth having.
const byPhone = await call(pm,"/tenants",{method:"POST",body:JSON.stringify({
  propertyId:"p1", firstName:"Tom", lastName:"Vance", phone:"2065550137", unit:"3C" })});
ck("added with no email", byPhone.status===201);
ck("and texted, not emailed", byPhone.body.sent.sms==="sent" && byPhone.body.sent.email===null);
await fetch("http://127.0.0.1:8905/__clear");
await call(pm,`/tenants/${byPhone.body.userId}/resend`,{method:"POST",body:"{}"});
const txt = await sentSms();
const plink = (txt[0]?.Body||"").match(/\?tenant=([0-9a-f]{64})/)?.[1];
const ppub = await call(null, `/tenant-invite/${plink}`);
ck("the page knows it must ask for an address", ppub.body?.needsEmail === true);
ck("and refuses a password with no address",
  (await call(null,`/tenant-invite/${plink}`,{method:"POST",body:JSON.stringify({password:"correcthorse"})})).status===400);
const pacc = await call(null,`/tenant-invite/${plink}`,{method:"POST",
  body:JSON.stringify({password:"correcthorse", email:`tom+${S}@example.test`})});
ck("with one, they are set up", pacc.status===200 && pacc.body.ok, JSON.stringify(pacc.body));
ck("and the roster carries the address they gave",
  (await call(pm,"/tenants")).body.find(t=>t.userId===byPhone.body.userId)?.email === `tom+${S}@example.test`);

// ---------------------------------------------------------------------------
// And what a tenant can actually reach once they are in. Previously a file of
// its own, against the link-based flow that has since been replaced; the
// questions did not change when the way in did.
// ---------------------------------------------------------------------------
console.log("\n-- what a tenant sees --");
const rosa = await tok(`rosa+${S}@example.test`);
const rp = await call(rosa,"/properties");
ck("only their own building", rp.body?.length===1 && rp.body[0].id==="p1",
  JSON.stringify(rp.body?.map(p=>p.id)));
ck("and none of the building's existing work", (await call(rosa,"/jobs")).body.length===0);
for (const [label, path, method] of [
  ["the roster", "/tenants", "GET"],
  ["the contractor list", "/subs", "GET"],
  ["service calls", "/service-calls", "GET"],
  ["the cross-account booking feed", "/jobs/all-bookings", "GET"],
  ["adding a tenant", "/tenants", "POST"],
]) ck(`refused: ${label}`, (await call(rosa, path, { method, body: method==="POST" ? "{}" : undefined })).status===403);
const au = await call(rosa,"/account-users");
ck("the member list is just them", au.body?.length===1);

console.log("\n-- reporting something --");
ck("not at a building that is not theirs",
  (await call(rosa,"/jobs",{method:"POST",body:JSON.stringify(
    {title:"x",propertyId:"p9",trades:["plumbing"]})})).status===403);
const rep = await call(rosa,"/jobs",{method:"POST",body:JSON.stringify(
  {title:"Kitchen faucet won't shut off",propertyId:"p1",trades:["plumbing"]})});
ck("but yes at their own, as a request", rep.status===201 && rep.body.requested===true);
ck("and they can see it", (await call(rosa,"/jobs")).body.some(j=>j.id===rep.body.id));

console.log("\n-- and it reaches the people who can act --");
ck("the manager of that building sees it",
  !!(await call(mgr,"/jobs")).body.find(j=>j.id===rep.body.id));
ck("nothing can be assigned until approved",
  (await call(pm,`/jobs/${rep.body.id}/assign`,{method:"POST",body:JSON.stringify(
    {trade:"plumbing",companyId:"cmp_r"})})).status===409);
ck("the tenant cannot approve their own report",
  (await call(rosa,`/jobs/${rep.body.id}/approve`,{method:"POST"})).status===403);
ck("the manager can", (await call(mgr,`/jobs/${rep.body.id}/approve`,{method:"POST"})).status===200);

console.log("\n-- and neighbours are not each other's business --");
// A real second login in the same unit, not an assumption about one. Rosa
// has just reported something; Ola must see none of it.
await fetch("http://127.0.0.1:8904/__clear");
const olaAdd = await call(pm,"/tenants",{method:"POST",body:JSON.stringify({
  propertyId:"p1", firstName:"Ola", lastName:"Ruiz", email:`ola+${S}@example.test`, unit:"4B" })});
const olaMail = await sentEmails();
const olaTok = (olaMail[0]?.text||"").match(/\?tenant=([0-9a-f]{64})/)?.[1];
await call(null,`/tenant-invite/${olaTok}`,{method:"POST",body:JSON.stringify({password:"correcthorse"})});
const ola = await tok(`ola+${S}@example.test`);
const olaJobs = await call(ola,"/jobs");
ck("a second tenant in the same unit sees none of the first's reports",
  olaJobs.status===200 && olaJobs.body.length===0, `${olaJobs.body?.length} jobs`);
ck("while the first still sees her own",
  (await call(rosa,"/jobs")).body.length===1);
ck("a tenant is sent no values",
  (await call(rosa,"/jobs")).body.every(j=>Object.values(j.assignments||{}).every(a=>!("value" in a))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
