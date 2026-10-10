// Build the marketing site's two free tools and a page per state for each.
//
//   npm run tools
//
// Writes check/ and handyman-limits/ at the repo root: a hub each, fifty-one
// state pages each, and a sitemap each, written from the same plan the pages
// are -- so neither can list a page that does not exist. Generated output:
// wiped and rewritten, never hand-edited.
//
// THE FACTS ARE THE APP'S, NOT A SECOND COPY. Every state, every handyman
// figure, every sentence the calculator says and every registry the checker
// names comes out of app/shared (states.js, handycap.js, handytool.js,
// licenselookup.js) or content/licensing/data.js. The calculator itself is
// handytool.js BUNDLED into the page, so a figure corrected in the app is
// corrected here the next time this runs, and the page cannot say something
// the app does not.
//
// ONE PAGE PER STATE EARNS ITS URL HERE, which the licensing reference refuses
// for trades -- and the difference is the content, not the count. Each state
// page leads with that state's own answer (its cap, its basis, what it takes
// to go above it; or its registry, its licensing body and whether it can be
// checked live), so no two pages say the same thing with a name swapped.

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { readChrome, atDepth } from "../../content/licensing/chrome.mjs";
import { STATES as LIC } from "../../content/licensing/data.js";
import { REF_SNIPPET } from "../../content/tools/ref.mjs";
import { US_STATES } from "../shared/states.js";
import { HANDYMAN_CAPS, HANDYCAP_AS_OF, HANDYMAN_GLOBAL_RULES, CAP_BASES } from "../shared/handycap.js";
import { LIVE_STATES } from "../shared/licenselookup.js";
import { asOfLabel } from "../shared/handytool.js";
import { TRADES } from "../shared/trades.js";
import { SUB_CASH_CENTS, REF_COOKIE_DAYS } from "../shared/referral.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = "https://subsub.work";
const API = "https://api.subsub.work/api";
// When the checker's pages last changed in substance. Moved by hand when the
// copy or the live states change, so a rebuild with nothing new does not tell
// search engines every page was rewritten today.
export const CHECK_UPDATED = "2026-10-09";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON-LD and inline config: JSON.stringify does not escape `<`, so a
// `</script>` anywhere in the data would close the block.
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const slug = (code) => code.toLowerCase();
const money = (n) => "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const stateRows = US_STATES.map(([code, name]) => ({ code, name, lic: LIC.find((s) => s.code === code) || null }));

// ---- what each state page says about itself ---------------------------------

// The handyman answer in one sentence, by basis -- four bases are four
// different sentences, never one with a number swapped in.
export function capSentence(code, name) {
  const row = HANDYMAN_CAPS[code];
  if (!row) return null;
  if (row.basis === "per_job") {
    return `In ${name}, a handyman can take on jobs up to ${money(row.cap)} (labor and materials together) without a contractor license. Above that: ${row.aboveCap}.`;
  }
  if (row.basis === "annual") {
    return `In ${name}, a handyman can earn up to ${money(row.cap)} a year without a contractor license, counted across every client. Above that: ${row.aboveCap}.`;
  }
  if (row.basis === "none") {
    return `${name} has no handyman exemption: unlicensed contracting is not exempt at any amount. What is needed: ${row.aboveCap}.`;
  }
  return `${name} does not license contractors at the state level, so there is no state handyman limit. City and county rules often apply instead.`;
}

export function checkSentence(code, name, lic) {
  const live = LIVE_STATES.includes(code);
  const body = lic?.baseline?.body;
  const reg = lic?.registry;
  if (live) {
    return `Check a ${name} contractor's registration, bond and insurance against ${body || "the state"}'s own records, free. Search by registration number or business name.`;
  }
  const who = lic?.baseline?.licence === "none"
    ? `${name} does not license construction contractors at the state level`
    : `${body ? `${body} licenses contractors in ${name}` : `${name} licenses contractors`}`;
  return `${who}. ${reg?.name ? `The state's own lookup is ${reg.name}.` : ""} SubSub's live check covers ${LIVE_STATES.map((c) => US_STATES.find(([k]) => k === c)?.[1]).join(", ")} today, with more states coming.`.replace(/\s+/g, " ").trim();
}

// ---- the page shell ----------------------------------------------------------

const PAGE_CSS = `
.tl-wrap{max-width:860px;margin:0 auto;padding:40px 22px 64px}
.tl-eyebrow{display:inline-block;font:600 12.5px/1 Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--forest);background:#E7EFEA;padding:7px 10px;border-radius:999px}
.tl-wrap h1{font-family:'Bricolage Grotesque',Inter,sans-serif;font-size:clamp(30px,5vw,44px);line-height:1.08;margin:14px 0 12px;color:var(--ink)}
.tl-lede{font-size:18px;line-height:1.55;color:var(--muted);margin:0 0 26px;max-width:660px}
.tl-card{background:#fff;border:1px solid var(--rule);border-radius:14px;padding:22px;margin:0 0 22px;box-shadow:0 1px 2px rgba(12,28,22,.05)}
.tl-form{display:grid;gap:14px}
.tl-row{display:grid;gap:12px;grid-template-columns:1fr}
@media (min-width:640px){.tl-row-2{grid-template-columns:1fr 1fr}.tl-row-3{grid-template-columns:1fr 1fr 1fr}}
.tl-field{display:flex;flex-direction:column;gap:6px;font:600 13.5px/1.2 Inter,sans-serif;color:var(--ink)}
.tl-field input,.tl-field select{font:16px Inter,sans-serif;min-height:48px;padding:10px 12px;border:1px solid #C5D0CA;border-radius:10px;background:#fff;color:var(--ink);width:100%;box-sizing:border-box}
.tl-mode{display:flex;gap:8px;flex-wrap:wrap}
.tl-mode label{display:inline-flex;align-items:center;gap:7px;border:1px solid #C5D0CA;border-radius:999px;padding:9px 14px;font:600 14px Inter,sans-serif;cursor:pointer;min-height:44px;box-sizing:border-box}
.tl-mode input:checked + span{color:var(--forest)}
.tl-mode label:has(input:checked){border-color:var(--forest);background:#E7EFEA}
.tl-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 22px;border-radius:10px;border:0;background:var(--forest);color:#fff;font:700 16px Inter,sans-serif;cursor:pointer;text-decoration:none}
.tl-btn-gold{background:var(--gold);color:#20160A}
.tl-btn[disabled]{opacity:.6;cursor:default}
.tl-result{margin-top:18px}
.tl-verdict{border-radius:12px;padding:16px 18px;margin:0 0 14px;border:1px solid}
.tl-verdict h2{font-family:'Bricolage Grotesque',Inter,sans-serif;font-size:22px;margin:0 0 6px}
.tl-verdict p{margin:4px 0 0;line-height:1.5}
.tl-yes,.tl-ok{background:#EAF4EE;border-color:#B9D8C6;color:#123E2B}
.tl-no,.tl-bad{background:#FBEDEA;border-color:#EBC3B9;color:#6E2615}
.tl-maybe{background:#FDF4E4;border-color:#EDD3A2;color:#5C3D07}
.tl-note{font-size:14px;color:var(--muted);line-height:1.5;margin:10px 0 0}
.tl-table{width:100%;border-collapse:collapse;font-size:15px}
.tl-table th{text-align:left;font-weight:600;color:var(--muted);padding:9px 12px 9px 0;vertical-align:top;width:34%}
.tl-table td{padding:9px 0;border-top:1px solid var(--rule);vertical-align:top}
.tl-table tr:first-child td,.tl-table tr:first-child th{border-top:0}
.tl-table th{border-top:1px solid var(--rule)}
.tl-gate{background:var(--bone);border-radius:12px;padding:16px;display:grid;gap:10px}
.tl-gate p{margin:0;line-height:1.5}
.tl-matches{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.tl-matches li{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--rule);border-radius:10px;padding:10px 12px}
.tl-matches button{min-height:40px}
.tl-cta{background:var(--forest);color:#fff;border-radius:14px;padding:22px;margin:22px 0}
.tl-cta h2{font-family:'Bricolage Grotesque',Inter,sans-serif;color:#fff;margin:0 0 8px;font-size:22px}
.tl-cta p{margin:0 0 14px;color:#D6E3DC;line-height:1.5}
.tl-legal{font-size:13.5px;color:var(--muted);line-height:1.5;border-left:3px solid var(--gold);padding:4px 0 4px 12px;margin:18px 0}
.tl-rules{padding-left:20px;line-height:1.6;color:var(--ink)}
.tl-states{columns:2 160px;column-gap:24px;padding:0;list-style:none;margin:0}
.tl-states li{break-inside:avoid;padding:4px 0}
.tl-states a{color:var(--forest);font-weight:600;text-decoration:none}
.tl-states a:hover{text-decoration:underline}
.tl-faq h3{font-size:17px;margin:18px 0 6px}
.tl-faq p{margin:0;line-height:1.55;color:var(--ink)}
.tl-err{color:var(--red);font-weight:600;margin:8px 0 0}
.tl-ok-msg{color:var(--forest);font-weight:600;margin:8px 0 0}
.tl-crumb{font-size:14px;margin:0 0 6px}
.tl-crumb a{color:var(--forest)}
[hidden]{display:none !important}
`;

function shell({ chrome, depth, title, description, canonical, h1, eyebrow, lede, body, faq = [], script = "", modified }) {
  const graph = [{ "@type": "WebPage", "@id": canonical, url: canonical, name: title,
    description, dateModified: modified }];
  if (faq.length) {
    graph.push({ "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  }
  const faqHtml = faq.length ? `<section class="tl-faq" aria-labelledby="faq-h"><h2 id="faq-h">Questions</h2>${
    faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</section>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${atDepth(chrome.icons, depth)}
${chrome.fonts}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og-image.png">
<script type="application/ld+json">${js({ "@context": "https://schema.org", "@graph": graph })}</script>
${chrome.css}
<style>${PAGE_CSS}</style>
<script>window.SUBSUB_API = window.SUBSUB_API || (/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8787/api' : '${API}');</script>
</head>
<body>
${atDepth(chrome.header, depth)}
<main class="tl-wrap">
<span class="tl-eyebrow">${esc(eyebrow)}</span>
<h1>${esc(h1)}</h1>
<p class="tl-lede">${lede}</p>
${body}
${faqHtml}
</main>
${atDepth(chrome.footer, depth)}
${REF_SNIPPET}
${script}
</body>
</html>
`;
}

const stateOptions = (selected) => `<option value="">Choose a state</option>${
  US_STATES.map(([c, n]) => `<option value="${c}"${c === selected ? " selected" : ""}>${esc(n)}</option>`).join("")}`;
const statesList = (base, depth) => `<ul class="tl-states">${
  stateRows.map((s) => `<li><a href="${"../".repeat(depth)}${base}/${slug(s.code)}/">${esc(s.name)}</a></li>`).join("")}</ul>`;
const ctaBlock = (depth, head, text) => `<section class="tl-cta">
<h2>${esc(head)}</h2>
<p>${esc(text)}</p>
<a class="tl-btn tl-btn-gold" href="${"../".repeat(depth)}pricing.html">See plans and start free</a>
</section>`;

// ---- the licence checker ----------------------------------------------------

function checkScript(fixedState) {
  const reg = Object.fromEntries(stateRows.map((s) => [s.code, {
    name: s.name, registry: s.lic?.registry?.name || null, url: s.lic?.registry?.url || null,
    body: s.lic?.baseline?.body || null }]));
  return `<script>
(function(){
var API=window.SUBSUB_API, LIVE=${js(LIVE_STATES)}, REG=${js(reg)}, FIXED=${js(fixedState || "")};
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function refCode(){var m=document.cookie.match(/(?:^|;\\s*)ss_ref=([A-Z0-9]{8})\\./);return m?m[1]:null;}
function money(n){return n==null?'':'$'+String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');}
var out=$('tlResult'), last=null;
function post(path, body){return fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {ok:r.ok,status:r.status,body:b};});});}
function fail(res, st){
  var r=REG[st]||{}, code=res&&res.body&&res.body.error;
  var msg={registry_unavailable:'The state\\u2019s lookup did not answer just now. Try again in a minute'+(r.url?', or use <a href="'+esc(r.url)+'" rel="noopener" target="_blank">'+esc(r.registry)+'</a> directly':'')+'.',
    slow_down:'That is a lot of lookups in a few minutes. Wait a little and try again.',
    bad_license:'That does not look like a registration number. Check it and try again.',
    name_too_short:'Type at least three letters of the business name.',
    bad_email:'That email address does not look right.'}[code]||'Something went wrong. Try again in a moment.';
  out.innerHTML='<p class="tl-err" role="alert">'+msg+'</p>';
}
function notLive(st){
  var r=REG[st]||{};
  out.innerHTML='<div class="tl-verdict tl-maybe"><h2>'+esc(r.name)+' is not live yet</h2>'
   +'<p>SubSub checks '+LIVE.map(function(c){return esc((REG[c]||{}).name);}).join(', ')+' against the state\\u2019s own records today.'
   +(r.url?' Until '+esc(r.name)+' is live, look them up on <a href="'+esc(r.url)+'" rel="noopener" target="_blank">'+esc(r.registry)+'</a>.':'')+'</p></div>'
   +'<form class="tl-gate" id="tlNotify"><p><b>Want an email when '+esc(r.name)+' goes live?</b></p>'
   +'<label class="tl-field">Email<input type="email" id="tlNotifyEmail" autocomplete="email" required></label>'
   +'<button class="tl-btn" type="submit">Tell me when it\\u2019s live</button><p id="tlNotifyMsg" class="tl-note"></p></form>';
  $('tlNotify').addEventListener('submit',function(e){e.preventDefault();
    post('/public/leads',{email:$('tlNotifyEmail').value.trim(),tool:'check',state:st,detail:{notifyWhenLive:true},ref:refCode()})
      .then(function(res){$('tlNotifyMsg').className=res.ok?'tl-ok-msg':'tl-err';
        $('tlNotifyMsg').textContent=res.ok?'Done. We\\u2019ll email you when '+r.name+' is live.':'That didn\\u2019t save. Check the address and try again.';});});
}
function gate(st, pv){
  out.innerHTML='<div class="tl-verdict tl-maybe"><h2>Found: '+esc(pv.name||'a registration')+'</h2>'
   +'<p>Registration #'+esc(pv.license)+(pv.city?' \\u00b7 '+esc(pv.city):'')+'</p></div>'
   +'<form class="tl-gate" id="tlGate"><p><b>See the status, the expiry date, the bond and the insurance.</b> Enter your email and the full record appears here.</p>'
   +'<label class="tl-field">Work email<input type="email" id="tlEmail" autocomplete="email" required></label>'
   +'<button class="tl-btn" type="submit">Show the full record</button>'
   +'<p class="tl-note">Free. The record is the state\\u2019s own public data; we keep your email to send you SubSub news you can unsubscribe from.</p></form>';
  $('tlGate').addEventListener('submit',function(e){e.preventDefault();
    var btn=this.querySelector('button'); btn.disabled=true;
    post('/public/license-lookup',{state:st,license:pv.license,email:$('tlEmail').value.trim(),ref:refCode()})
      .then(function(res){btn.disabled=false; if(!res.ok) return fail(res,st); full(st,res.body);});});
}
function full(st, b){
  var f=b.full||{}, v=b.verdict||{}, r=REG[st]||{};
  var bond=f.bond?[f.bond.surety,f.bond.amount!=null?money(f.bond.amount):'',f.bond.expires?'until '+f.bond.expires:''].filter(Boolean).join(' \\u00b7 '):'None on record';
  var ins=f.insurance?[f.insurance.carrier,f.insurance.coverage!=null?money(f.insurance.coverage):'',f.insurance.expires?'until '+f.insurance.expires:''].filter(Boolean).join(' \\u00b7 '):'None on record';
  var rows=[['Business',f.name],['Registration #',f.license],['Status',f.status],['Type',f.licenseType],['Expires',f.expirationDate],['Bond',bond],['Insurance',ins]]
    .filter(function(x){return x[1];});
  out.innerHTML='<div class="tl-verdict tl-'+esc(v.tone||'maybe')+'"><h2>'+esc(v.head)+'</h2><p>'+esc(v.why)+'</p></div>'
   +'<table class="tl-table">'+rows.map(function(x){return '<tr><th>'+esc(x[0])+'</th><td>'+esc(x[1])+'</td></tr>';}).join('')+'</table>'
   +'<p class="tl-note">From '+esc(b.source)+', checked today. SubSub is not the state: for a decision that matters, confirm it'
   +(r.url?' on <a href="'+esc(r.url)+'" rel="noopener" target="_blank">'+esc(r.registry)+'</a>':'')+'.</p>';
}
function matches(st, list){
  if(!list.length){out.innerHTML='<p class="tl-err">No '+esc((REG[st]||{}).name)+' registration matches that name. Try fewer words, or search by registration number.</p>';return;}
  out.innerHTML='<p><b>'+list.length+' match'+(list.length===1?'':'es')+'.</b> Pick the one you mean.</p><ul class="tl-matches">'
   +list.map(function(m,i){return '<li><span><b>'+esc(m.name)+'</b><br>#'+esc(m.license)+(m.city?' \\u00b7 '+esc(m.city):'')+'</span>'
     +'<button class="tl-btn" type="button" data-i="'+i+'">Check this one</button></li>';}).join('')+'</ul>';
  Array.prototype.forEach.call(out.querySelectorAll('button[data-i]'),function(b){b.addEventListener('click',function(){
    gate(st, list[Number(b.getAttribute('data-i'))]);});});
}
$('tlCheck').addEventListener('submit',function(e){
  e.preventDefault();
  var st=FIXED||$('tlState').value, mode=(document.querySelector('input[name=tlMode]:checked')||{}).value||'license', q=$('tlQuery').value.trim();
  if(!st){out.innerHTML='<p class="tl-err">Choose a state first.</p>';return;}
  if(LIVE.indexOf(st)<0){notLive(st);return;}
  if(!q){out.innerHTML='<p class="tl-err">'+(mode==='name'?'Type the business name.':'Type the registration number.')+'</p>';return;}
  var btn=this.querySelector('button[type=submit]'); btn.disabled=true; out.innerHTML='<p class="tl-note">Checking the state\\u2019s records\\u2026</p>';
  var body={state:st,ref:refCode()}; body[mode==='name'?'name':'license']=q;
  post('/public/license-lookup',body).then(function(res){
    btn.disabled=false;
    if(!res.ok) return fail(res,st);
    if(res.body.matches) return matches(st,res.body.matches);
    if(!res.body.found){out.innerHTML='<div class="tl-verdict tl-bad"><h2>No '+esc((REG[st]||{}).name)+' record for that number</h2><p>Check the number with them, or search by business name. A registration that cannot be found is not one you can rely on.</p></div>';return;}
    gate(st,res.body.preview);
  }).catch(function(){btn.disabled=false;out.innerHTML='<p class="tl-err">Could not reach SubSub. Check your connection and try again.</p>';});
});
var sel=$('tlState'); if(sel) sel.addEventListener('change',function(){ if(sel.value && LIVE.indexOf(sel.value)<0) notLive(sel.value); else out.innerHTML=''; });
if(FIXED && LIVE.indexOf(FIXED)<0) notLive(FIXED);
})();
</script>`;
}

function checkForm(fixed) {
  const live = !fixed || LIVE_STATES.includes(fixed);
  return `<section class="tl-card">
<form class="tl-form" id="tlCheck" novalidate>
${fixed ? "" : `<label class="tl-field">State<select id="tlState">${stateOptions("")}</select></label>`}
${live ? `<div class="tl-mode" role="radiogroup" aria-label="Search by">
<label><input type="radio" name="tlMode" value="license" checked> <span>Registration number</span></label>
<label><input type="radio" name="tlMode" value="name"> <span>Business name</span></label>
</div>
<label class="tl-field">Registration number or business name<input id="tlQuery" autocomplete="off" inputmode="text"></label>
<div><button class="tl-btn" type="submit">Check</button></div>` : ""}
</form>
<div class="tl-result" id="tlResult" aria-live="polite"></div>
</section>`;
}

function checkHub(chrome) {
  const depth = 1;
  return shell({ chrome, depth, modified: CHECK_UPDATED,
    title: "Is your sub legit? Free contractor license checker | SubSub",
    description: "Check a contractor's registration, bond and insurance against the state's own records. Free. Washington is live; every state links to its own board.",
    canonical: `${SITE}/check/`, eyebrow: "Free tool", h1: "Is your sub legit?",
    lede: "Check a contractor’s registration, bond and insurance against the state’s own records before they set foot on your job. Free. <b>Washington</b> is live today; every other state links straight to its own board.",
    body: checkForm(null)
      + ctaBlock(depth, "Stop checking subs one at a time",
        "SubSub re-checks every sub's license every night and watches their insurance expiry for you, so a lapsed certificate never reaches a job site.")
      + `<section><h2>Check by state</h2>${statesList("check", depth)}</section>`,
    script: checkScript(null),
    faq: [
      { q: "How do I check if a contractor is licensed?",
        a: "Look the registration up on the state's own licensing board. In Washington, SubSub checks L&I's public records for you, including the bond and the insurance on file. For every other state, the state page here names the board and links its lookup." },
      { q: "Is this contractor license check free?",
        a: "Yes. The records are the state's public data. The full record appears once you enter an email address." },
    ],
  });
}

function checkState(chrome, s) {
  const depth = 2;
  const live = LIVE_STATES.includes(s.code);
  const sentence = checkSentence(s.code, s.name, s.lic);
  const reg = s.lic?.registry;
  const body = s.lic?.baseline;
  const faq = [
    { q: `How do I check a ${s.name} contractor's license?`,
      a: live ? `Search by registration number or business name above. SubSub reads ${body?.body || "the state"}'s public records and shows the status, the expiry date, the bond and the insurance on file.`
        : `Use ${reg?.name || "the state licensing board's lookup"}${reg?.url ? ` at ${reg.url}` : ""}. SubSub's live check does not cover ${s.name} yet.` },
  ];
  if (body?.detail) faq.push({ q: `Does ${s.name} require contractors to be licensed?`, a: body.detail });
  return shell({ chrome, depth, modified: CHECK_UPDATED,
    title: `Check a ${s.name} contractor license | SubSub`,
    description: live
      ? `Look up any ${s.name} contractor's registration, bond and insurance in seconds, from ${body?.body || "the state"}'s own records. Free.`
      : `How to verify a ${s.name} contractor: ${body?.body ? `who licenses them (${body.body})` : "who licenses them"}, where to look them up, and what to ask for before they start.`,
    canonical: `${SITE}/check/${slug(s.code)}/`, eyebrow: `${s.name} · Free tool`,
    h1: `Check a ${s.name} contractor’s license`,
    lede: esc(sentence),
    body: `<p class="tl-crumb"><a href="../">All states</a> · <a href="../../licensing/${slug(s.code)}/">${esc(s.name)} licensing rules</a></p>`
      + checkForm(s.code)
      + (reg?.url ? `<p class="tl-note">The state’s own lookup: <a href="${esc(reg.url)}" rel="noopener" target="_blank">${esc(reg.name)}</a>${reg.note ? `. ${esc(reg.note)}` : "."}</p>` : "")
      + ctaBlock(depth, `Keep every ${s.name} sub's paperwork current`,
        "SubSub tracks every sub's license, insurance and W-9, warns you before a certificate lapses under a booked job, and keeps the live copy instead of a stale PDF."),
    script: checkScript(s.code), faq,
  });
}

// ---- the handyman calculator --------------------------------------------------

function calcScript(fixedState, bundle) {
  return `<script>${bundle}</script>
<script>
(function(){
var API=window.SUBSUB_API, FIXED=${js(fixedState || "")};
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function refCode(){var m=document.cookie.match(/(?:^|;\\s*)ss_ref=([A-Z0-9]{8})\\./);return m?m[1]:null;}
var out=$('tlCalcOut');
function current(){return {state:FIXED||$('tlState').value, jobValue:Number(String($('tlValue').value).replace(/[^0-9.]/g,''))||0, jobType:$('tlType').value};}
function render(){
  var q=current();
  if(!q.state){out.innerHTML='<p class="tl-note">Choose a state to see its limit.</p>';$('tlEmailBox').hidden=true;return;}
  var v=window.SSCALC.handyVerdict(q);
  if(!v){out.innerHTML='';return;}
  out.innerHTML='<div class="tl-verdict tl-'+esc(v.tone)+'"><h2>'+esc(v.answer)+'</h2><p><b>'+esc(v.head)+'</b></p><p>'+esc(v.why)+'</p>'
    +(v.note?'<p class="tl-note">'+esc(v.note)+'</p>':'')+'</div>';
  $('tlEmailBox').hidden=false;
}
['tlValue','tlType','tlState'].forEach(function(id){var el=$(id); if(el){el.addEventListener('input',render);el.addEventListener('change',render);}});
$('tlEmailForm').addEventListener('submit',function(e){
  e.preventDefault(); var q=current(), msg=$('tlEmailMsg');
  fetch(API+'/public/leads',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:$('tlCalcEmail').value.trim(),tool:'handyman_limits',state:q.state,detail:{jobValue:q.jobValue,jobType:q.jobType},ref:refCode()})})
  .then(function(r){msg.className=r.ok?'tl-ok-msg':'tl-err';msg.textContent=r.ok?'Sent. Check your inbox.':'That didn\\u2019t send. Check the address and try again.';})
  .catch(function(){msg.className='tl-err';msg.textContent='Could not reach SubSub. Try again in a moment.';});
});
render();
})();
</script>`;
}

function calcForm(fixed) {
  const types = [`<option value="general">General repairs (no specific trade)</option>`,
    ...TRADES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`)].join("");
  return `<section class="tl-card">
<form class="tl-form" id="tlCalc" onsubmit="return false">
<div class="tl-row ${fixed ? "tl-row-2" : "tl-row-3"}">
${fixed ? "" : `<label class="tl-field">State<select id="tlState">${stateOptions("")}</select></label>`}
<label class="tl-field">Job value (labor and materials)<input id="tlValue" inputmode="decimal" autocomplete="off" placeholder="$"></label>
<label class="tl-field">Kind of work<select id="tlType">${types}</select></label>
</div>
</form>
<div class="tl-result" id="tlCalcOut" aria-live="polite"></div>
<div id="tlEmailBox" hidden>
<form class="tl-gate" id="tlEmailForm"><p><b>Email me this answer</b>, with the state’s rules, for when the customer asks.</p>
<label class="tl-field">Email<input type="email" id="tlCalcEmail" autocomplete="email" required></label>
<button class="tl-btn" type="submit">Send it</button><p id="tlEmailMsg" class="tl-note"></p></form>
</div>
</section>
<p class="tl-legal"><b>Not legal advice.</b> Verify with your state licensing board before relying on it. These limits were compiled from secondary sources and change; city and county rules can apply on top. Data last updated ${esc(asOfLabel(HANDYCAP_AS_OF))}.</p>
<section><h2>Rules that apply in every state</h2><ul class="tl-rules">${HANDYMAN_GLOBAL_RULES.map((r) => `<li>${esc(r)}.</li>`).join("")}</ul></section>`;
}

function calcHub(chrome, bundle) {
  const depth = 1;
  return shell({ chrome, depth, modified: HANDYCAP_AS_OF,
    title: "Handyman license limits by state: how much can a handyman charge? | SubSub",
    description: "Enter a state, a job value and the kind of work to see whether a handyman can legally do it without a contractor license. All 50 states and DC. Free.",
    canonical: `${SITE}/handyman-limits/`, eyebrow: "Free tool", h1: "Can a handyman legally do this job?",
    lede: "Pick the state, the job value and the kind of work. We compare it with that state’s handyman exemption: the most a handyman can charge without a contractor license.",
    body: calcForm(null)
      + ctaBlock(depth, "Hire handymen without guessing",
        "SubSub warns you before a work order goes over the state's handyman limit, tracks every sub's license and insurance, and keeps the record when somebody asks.")
      + `<section><h2>Handyman limits by state</h2>${statesList("handyman-limits", depth)}</section>`,
    script: calcScript(null, bundle),
    faq: [
      { q: "How much can a handyman charge without a license?",
        a: "It depends on the state. Some set a limit per job, some per year, some have no exemption at all, and some do not license contractors at the state level. Pick a state above for its figure." },
      { q: "Can a handyman do electrical or plumbing work?",
        a: `${HANDYMAN_GLOBAL_RULES[0]}. Those trades need their own license whatever the job is worth.` },
    ],
  });
}

function calcState(chrome, s, bundle) {
  const depth = 2;
  const row = HANDYMAN_CAPS[s.code];
  const sentence = capSentence(s.code, s.name);
  const extra = [row.note, row.verify ? "This figure has not been confirmed against the state board; check it before relying on it" : ""]
    .filter(Boolean).join(". ");
  const faq = [
    { q: `How much can a handyman charge in ${s.name} without a license?`, a: sentence },
  ];
  if (extra) faq.push({ q: `Is there anything else to know about ${s.name}'s handyman limit?`, a: `${extra}.` });
  const shortCap = row.basis === "per_job" ? `${money(row.cap)} a job`
    : row.basis === "annual" ? `${money(row.cap)} a year`
      : row.basis === "none" ? "no exemption" : "no state license";
  return shell({ chrome, depth, modified: HANDYCAP_AS_OF,
    title: `${s.name} handyman license limit (${shortCap}) | SubSub`,
    description: `${sentence} Check a job value free.`.slice(0, 300),
    canonical: `${SITE}/handyman-limits/${slug(s.code)}/`, eyebrow: `${s.name} · Free tool`,
    h1: `Handyman license limits in ${s.name}`,
    lede: esc(sentence) + (extra ? ` <span class="tl-note">${esc(extra)}.</span>` : ""),
    body: `<p class="tl-crumb"><a href="../">All states</a> · <a href="../../licensing/${slug(s.code)}/">${esc(s.name)} licensing rules</a> · <a href="../../check/${slug(s.code)}/">Check a ${esc(s.name)} contractor</a></p>`
      + calcForm(s.code)
      + ctaBlock(depth, `Hire ${s.name} handymen without guessing`,
        "SubSub warns you before a work order goes over the state's handyman limit, and keeps every sub's license and insurance current."),
    script: calcScript(s.code, bundle), faq,
  });
}


// ---- the two landing pages ------------------------------------------------------
//
// /subs and /gc, at the site root, each with ONE call to action. Generated with
// the tools because they share the chrome, the referral snippet and the
// data-ref-from line that names who invited the visitor -- a sub's or a GC's
// referral link lands on /gc, so that page says whose it was.
//
// What they claim is what SubSub does today, feature for feature: the
// compliance pack and its live link, renewals reaching everyone it was sent
// to, one list of work across every client, the nightly licence re-check
// where the state can be read. Nothing promised that is still being built.

const benefit = (n, head, text) => `<div class="ld-card"><span class="ld-n">${n}</span><h3>${esc(head)}</h3><p>${esc(text)}</p></div>`;
const LANDING_CSS = `
.ld-from{display:block;margin:0 0 12px;font:600 15px Inter,sans-serif;color:var(--forest)}
.ld-grid{display:grid;gap:14px;grid-template-columns:1fr;margin:8px 0 26px}
@media (min-width:760px){.ld-grid{grid-template-columns:repeat(3,1fr)}}
.ld-card{background:#fff;border:1px solid var(--rule);border-radius:14px;padding:20px}
.ld-card h3{font-family:'Bricolage Grotesque',Inter,sans-serif;font-size:19px;margin:10px 0 6px}
.ld-card p{margin:0;line-height:1.5;color:var(--muted)}
.ld-n{display:inline-flex;width:34px;height:34px;border-radius:50%;background:var(--forest);color:var(--gold);align-items:center;justify-content:center;font:800 16px 'Bricolage Grotesque',Inter,sans-serif}
.ld-list{line-height:1.7;padding-left:20px}
.ld-cta{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:6px 0 30px}
.ld-small{font-size:14px;color:var(--muted)}
`;

function landingSubs(chrome) {
  return shell({ chrome, depth: 0, modified: CHECK_UPDATED,
    title: "One profile. Every GC. Free for subcontractors | SubSub",
    description: "Keep your license, insurance and W-9 in one live profile and send it to any general contractor in seconds. Free forever for subcontractors.",
    canonical: `${SITE}/subs`, eyebrow: "For subcontractors \u00b7 Free forever", h1: "One profile. Every GC.",
    lede: "<span class=\"ld-from\" data-ref-from hidden></span>Your license, insurance and W-9 in one live profile. Hand it to any general contractor in seconds, and stop emailing the same certificate every month.",
    body: `<div class="ld-cta"><a class="tl-btn tl-btn-gold" href="get-started.html?as=subcontractor">Make your free profile</a>
<span class="ld-small">No card, no trial. A sub never pays for SubSub.</span></div>
<div class="ld-grid">
${benefit(1, "Send it once, it stays current", "One link carries your certificate of insurance, bond and license with the live expiry date, instead of a PDF that goes stale in somebody's inbox.")}
${benefit(2, "Renew once, everyone gets it", "Upload next year's certificate and every GC you've sent your pack to is sent the new one automatically.")}
${benefit(3, "Every job in one place", "Work orders, times and job requests from every GC you work for, in one list on your phone.")}
</div>
<section class="tl-card"><h2>What a GC sees when you send it</h2>
<ul class="ld-list">
<li>Your carrier, policy number, coverage and the date it runs out, live.</li>
<li>Your bond and your license, and in Washington the state's own record of it.</li>
<li>That your W-9 is on file. The form itself stays private: a GC reads it only inside SubSub, never from an emailed link.</li>
</ul></section>
${referTerms()}
<style>${LANDING_CSS}</style>` });
}

// The referral terms a sub is held to. The supply-house flyer prints one line
// about the $100 and sends people here for the rest, because a flyer sits on a
// counter for a year and cannot change when the offer does: this page can.
// The amount and the window come off the constants the Worker pays and
// attributes by, so the page cannot promise a figure the ledger does not keep.
export const SUB_REFER_AMOUNT = `$${SUB_CASH_CENTS / 100}`;
function referTerms() {
  return `<section class="tl-card" id="refer"><h2>Bring your GCs. Get ${SUB_REFER_AMOUNT}.</h2>
<ul class="ld-list">
<li>Make your free profile, then open <b>Get your GCs on SubSub</b> in the menu and send your link or code to the GCs you work for.</li>
<li>When a GC signs up through your link or code and pays for SubSub for the first time, we pay you ${SUB_REFER_AMOUNT}. Once per GC, for as many GCs as you bring.</li>
<li>Signing up is not enough: the GC has to start paying. A GC on the free plan earns you nothing until they upgrade.</li>
<li>If a GC used more than one link, the one they used last before signing up counts. A link is remembered for ${REF_COOKIE_DAYS} days.</li>
<li>It has to be a company that hires: a general contractor, a property manager, a portfolio manager or a building owner. Another sub signing up does not count, and neither does your own company.</li>
<li>Paid by check or bank transfer after a quick review.</li>
</ul></section>`;
}

function landingGc(chrome) {
  return shell({ chrome, depth: 0, modified: CHECK_UPDATED,
    title: "Run your whole sub network in one place | SubSub",
    description: "Every sub's license, insurance, W-9, availability and work orders in one roster you control, with a warning before a certificate lapses under a booked job.",
    canonical: `${SITE}/gc`, eyebrow: "For general contractors and property managers", h1: "Your whole sub network, in one place.",
    lede: "<span class=\"ld-from\" data-ref-from hidden></span>Every sub\u2019s license, insurance, W-9, availability and work orders, current and in one roster you control. Not a directory: the subs you already have, and the ones you meet on site.",
    body: `<div class="ld-cta"><a class="tl-btn tl-btn-gold" href="pricing.html">See plans and start free</a>
<span class="ld-small">Free on Basic for up to 3 subs. Scale is $99 a month.</span></div>
<div class="ld-grid">
${benefit(1, "Paperwork that keeps itself current", "Subs upload their own certificates. SubSub tracks every expiry and asks for the renewal before it lapses under a job you've booked.")}
${benefit(2, "Licenses checked, not assumed", "Washington registrations are checked against L&I every night, bond and insurance included. Every other state links straight to its board.")}
${benefit(3, "Scheduling that asks the right people", "Send a work order, the sub accepts and confirms the time, the tenant is asked last. Nobody turns up to a job nobody agreed.")}
</div>
<section class="tl-card"><h2>Bring your subs in without typing them up</h2>
<ul class="ld-list">
<li>Scan a sub's QR code on site, or send them a link: they fill in their own details and documents.</li>
<li>Subs who already use SubSub connect in one tap, with their paperwork already on file.</li>
<li>Their documents stay theirs. You see what they share with you and nothing about anybody else's roster.</li>
</ul></section>
<style>${LANDING_CSS}</style>` });
}

// ---- the build ------------------------------------------------------------------

export function plan() {
  return [
    { dir: "check", url: `${SITE}/check/`, lastmod: CHECK_UPDATED },
    ...stateRows.map((s) => ({ dir: `check/${slug(s.code)}`, url: `${SITE}/check/${slug(s.code)}/`, lastmod: CHECK_UPDATED, state: s, kind: "check" })),
    { dir: "handyman-limits", url: `${SITE}/handyman-limits/`, lastmod: HANDYCAP_AS_OF },
    ...stateRows.map((s) => ({ dir: `handyman-limits/${slug(s.code)}`, url: `${SITE}/handyman-limits/${slug(s.code)}/`, lastmod: HANDYCAP_AS_OF, state: s, kind: "calc" })),
  ];
}

export async function build({ quiet = false } = {}) {
  for (const s of stateRows) {
    if (!HANDYMAN_CAPS[s.code] || !CAP_BASES.includes(HANDYMAN_CAPS[s.code].basis)) {
      throw new Error(`handycap.js has no usable row for ${s.code}`);
    }
  }
  const chrome = readChrome(join(root, "for-general-contractors.html"));
  const bundled = await esbuild({ entryPoints: [join(root, "content/tools/calc-entry.js")], bundle: true,
    format: "iife", minify: true, write: false, platform: "browser", target: "es2017" });
  const bundle = bundled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

  for (const d of ["check", "handyman-limits"]) rmSync(join(root, d), { recursive: true, force: true });
  const pages = plan();
  for (const p of pages) {
    const html = p.dir === "check" ? checkHub(chrome)
      : p.dir === "handyman-limits" ? calcHub(chrome, bundle)
        : p.kind === "check" ? checkState(chrome, p.state)
          : calcState(chrome, p.state, bundle);
    mkdirSync(join(root, p.dir), { recursive: true });
    writeFileSync(join(root, p.dir, "index.html"), html);
  }
  writeFileSync(join(root, "subs.html"), landingSubs(chrome));
  writeFileSync(join(root, "gc.html"), landingGc(chrome));
  for (const d of ["check", "handyman-limits"]) {
    const mine = pages.filter((p) => p.dir === d || p.dir.startsWith(`${d}/`));
    writeFileSync(join(root, d, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${mine.map((p) => `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${p.state ? "0.6" : "0.8"}</priority>\n  </url>`).join("\n")}
</urlset>
`);
  }
  if (!quiet) {
    console.log(`Wrote ${pages.length} pages, subs.html, gc.html, check/sitemap.xml and handyman-limits/sitemap.xml`);
    console.log(`Live licence checks: ${LIVE_STATES.join(", ")}. Every other state links to its own board.`);
    const owed = Object.keys(HANDYMAN_CAPS).filter((k) => HANDYMAN_CAPS[k].verify).sort();
    console.log(`Handyman figures not yet confirmed against the state board (${owed.length}): ${owed.join(", ")}`);
  }
  return pages;
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
