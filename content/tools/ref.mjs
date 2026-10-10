// THE REFERRAL TOUCH, on the marketing site.
//
// A link carrying ?ref=<code> lands on a page of subsub.work; signing up
// happens on another page of it, and a Passport or a claim happens on
// app.subsub.work. A cookie on the parent domain is the only thing all three
// can read, so this writes one -- overwriting whatever was there, which IS the
// last-touch rule -- and tells the API a link was opened so the referrer can
// see the count. It names whose code it was on any element carrying
// data-ref-from, so a GC landing from a sub's link reads who invited them.
//
// ONE SOURCE. The generated pages insert this string; the hand-written pages
// (gc.html, subs.html, get-started.html, pricing.html) carry a copy, and
// app/scripts/site-tools-test.mjs fails if any copy differs from this one or
// if the alphabet, the cookie name or its life drift from shared/referral.js.
//
// `window.SUBSUB_API` is set by each page, the same convention
// book-a-demo.html already uses.
//
// `&via=passport` names the channel. A Passport's "Manage your whole sub
// network like this" lands here with the sub's code, and crediting that as a
// plain link would lose the one fact the referrer's screen is about: which of
// their doors brought the GC in. Anything else reads as a link.

import { CODE_ALPHABET, REF_COOKIE, REF_COOKIE_DAYS } from "../../app/shared/referral.js";

export const REF_SNIPPET = `<script>/* subsub-ref v1 */
(function(){try{
var API=window.SUBSUB_API||'https://api.subsub.work/api';
var q=new URLSearchParams(location.search).get('ref');
if(!q)return;
var ch=new URLSearchParams(location.search).get('via')==='passport'?'passport':'link';
var c=String(q).toUpperCase().replace(/[\\s-]/g,'');
if(!/^[${CODE_ALPHABET}]{8}$/.test(c))return;
var dom=/(^|\\.)subsub\\.work$/.test(location.hostname)?';domain=.subsub.work':'';
document.cookie='${REF_COOKIE}='+c+'.'+ch+'.'+Math.floor(Date.now()/1000)+';path=/;max-age=${REF_COOKIE_DAYS * 86400};samesite=lax'+(location.protocol==='https:'?';secure':'')+dom;
fetch(API+'/referrals/touch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c,channel:ch})})
.then(function(r){return r.json();}).then(function(j){
if(!j||!j.ok||!j.from)return;
var els=document.querySelectorAll('[data-ref-from]');
for(var i=0;i<els.length;i++){els[i].textContent=j.from+' invited you to SubSub.';els[i].hidden=false;}
}).catch(function(){});
}catch(e){}})();
</script>`;

// Read the cookie back, for the signup form. The same shape the Worker's
// parseRefCookie reads; null when there is none or it is not ours.
export const REF_READER = `function ssReadRef(){try{
var m=document.cookie.match(/(?:^|;\\s*)${REF_COOKIE}=([A-Z0-9]{8})\\.(link|code|claim|passport)\\.(\\d{9,11})/);
return m?{code:m[1],channel:m[2],at:new Date(Number(m[3])*1000).toISOString()}:null;
}catch(e){return null;}}`;
