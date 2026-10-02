// THE SCREEN A DRAFT CAPTION IS EDITED ON.
//
// Driven in a browser because the three things most worth pinning are only
// true as drawn, and every one of them passes a static check:
//
//   AN UNKEPT DRAFT DOES NOT SAVE ON BLUR. Clicking away from a sentence
//   nobody has read must leave the record empty. A check that `PhotoCaption`
//   *mentions* the draft passes with the box auto-saving it, which is a
//   model's words recorded as the manager's on a document that settles a
//   deposit argument.
//
//   IT LOOKS LIKE A DRAFT. The chip bug this project already paid for was
//   markup saying `on` with no stylesheet rule behind it -- correct source,
//   invisible state, and only computed pixels can see it.
//
//   THE PICTURE IS ACTUALLY DOWNSCALED. The whole cost case rests on it, and
//   the downscale happens in the browser -- so the only place the claim is
//   checkable is the body of the request the browser sends.
//
//   node --no-warnings scripts/photo-draft-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { DRAFT_LONG_EDGE, MAX_DRAFT_BYTES } from "../shared/photodraft.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-photodraft-test");
const WEB = 5315, API = 9015;
const t = tally();

// A photograph the size one off a phone is, made here rather than committed:
// 2000x1500 is what the downscale has to actually shrink, and a 20KB base64
// literal in a test file is a thing nobody can read or change.
function png(w, h) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
  // Not a flat colour: a gradient is what makes a JPEG of it a plausible
  // size, so the byte cap is exercised against something real.
  const rows = Buffer.concat([...Array(h)].map((_, y) => Buffer.concat([
    Buffer.from([0]),
    Buffer.from([...Array(w)].map((__, x) => (x * 7 + y * 3) % 256)),
  ])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const SHOT = png(2000, 1500);

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

// The knobs each block sets before opening the screen.
let AI = true;
let PHOTOS = [];
let STATUS = "draft";
const DETAIL = () => ({
  id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: STATUS,
  finishedAt: STATUS === "finished" ? "2026-10-02 00:00:00" : null,
  jobId: null, createdAt: "2026-10-02 00:00:00", aiDrafts: AI,
  recipients: [], sends: [],
  rooms: [{ id: "r1", name: "Bathroom 1", status: "fail", note: "Basin cracked",
    position: 0, photos: PHOTOS }],
});

const sent = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") {
    return [200, [{ id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
      tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: STATUS, jobId: null,
      createdAt: "2026-10-02 00:00:00", rooms: 1, flagged: 1, unchecked: 0, sent: 0 }]];
  }
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL()];
  // The bytes, as a real decodable image -- the canvas has to be able to
  // load it or the downscale cannot be exercised at all.
  if (/^\/api\/inspections\/insp_1\/photos\/ph\d$/.test(path)) {
    return [200, null, { raw: SHOT, type: "image/png" }];
  }
  const cap = /^\/api\/inspections\/insp_1\/rooms\/r1\/photos\/(ph\d)$/.exec(path);
  if (cap && method === "PATCH") {
    sent.push({ what: "caption", id: cap[1], body });
    PHOTOS = PHOTOS.map((p) => p.id === cap[1] ? { ...p, caption: body.caption } : p);
    return [200, { ok: true, rooms: DETAIL().rooms }];
  }
  if (path === "/api/inspections/insp_1/rooms/r1/drafts" && method === "POST") {
    sent.push({ what: "draft", body });
    PHOTOS = PHOTOS.map((p, i) => ({ ...p, draft: `Drafted note ${i + 1}.`, draftUnclear: false }));
    return [200, { ok: true, drafted: PHOTOS.length, rooms: DETAIL().rooms }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openOne = async () => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1400 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Inspections/i.test((b.innerText || "").trim()))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".insp-row, .insp-card, .prop-tile button, button")]
    .find((b) => /3B|Move-out/i.test((b.innerText || "")))?.click());
  await wait(900);
  return { ctx, page };
};

// What the caption column looks like, read as the browser computed it.
const shots = (page) => page.evaluate(() => [...document.querySelectorAll(".insp-shot")].map((el) => {
  const box = el.querySelector(".insp-cap-box");
  const ro = el.querySelector(".insp-note-ro");
  const cs = box ? getComputedStyle(box) : null;
  return {
    value: box ? box.value : null,
    readOnlyText: ro ? (ro.innerText || "").trim() : null,
    isDraft: box ? box.classList.contains("is-draft") : false,
    // The chip lesson: the class is not the state, the pixels are.
    borderStyle: cs ? cs.borderTopStyle : null,
    tag: (el.querySelector(".insp-cap-tag")?.innerText || "").replace(/\s+/g, " ").trim(),
    keep: !!el.querySelector(".insp-cap-keep"),
    unclear: (el.querySelector(".insp-cap-unclear")?.innerText || "").replace(/\s+/g, " ").trim(),
  };
}));
const draftBtn = (page) => page.evaluate(() => {
  const b = document.querySelector(".insp-draft-go");
  return b ? { label: (b.innerText || "").replace(/\s+/g, " ").trim(), off: b.disabled,
    note: (document.querySelector(".insp-draft-note")?.innerText || "").replace(/\s+/g, " ").trim() } : null;
});

try {
  console.log("\n-- the button that asks for a draft --");
  {
    AI = true; STATUS = "draft";
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "", draft: "", draftUnclear: false },
      { id: "ph2", name: "b.jpg", type: "image/jpeg", caption: "", draft: "", draftUnclear: false }];
    const { ctx, page } = await openOne();
    const b = await draftBtn(page);
    t.ck("it is offered on a room with photographs", !!b && !b.off, JSON.stringify(b));
    // The count rather than a bare verb: two is a different decision from
    // twelve when each one costs money.
    t.ck("and names how many it will read", /2 photos/.test(b?.label || ""), b?.label);
    // WHAT LEAVES, at the control. A photograph of the inside of somebody's
    // home going to a third party is not guessable from a button.
    t.ck("the note says the photo is read by Claude", /Claude/.test(b?.note || ""), b?.note);
    t.ck("and that nothing else about the property goes", /Nothing else about the/i.test(b?.note || ""), b?.note);
    t.ck("and that the manager edits every line", /you edit every line/i.test(b?.note || ""), b?.note);
    await ctx.close();
  }
  {
    // NOT CONFIGURED DRAWS NO BUTTON. Without this the press answers 503 and
    // the screen is a dead end with no explanation on it.
    AI = false;
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "", draft: "", draftUnclear: false }];
    const { ctx, page } = await openOne();
    t.ck("with no key behind it there is no button at all", (await draftBtn(page)) === null);
    // And the photographs are still there to caption by hand -- the feature
    // being off must not take the field with it.
    const rows = await shots(page);
    t.ck("but the caption box is still there to type in", rows.length === 1 && rows[0].value === "",
      JSON.stringify(rows));
    await ctx.close();
  }
  {
    AI = true;
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "",
      draft: "Already drafted.", draftUnclear: false }];
    const { ctx, page } = await openOne();
    // `all_drafted` draws nothing rather than a disabled button: it is the
    // ordinary state of a finished room, not a problem to explain.
    t.ck("a room already drafted offers nothing more", (await draftBtn(page)) === null);
    await ctx.close();
  }

  console.log("\n-- a draft arrives in the box and is not saved by it --");
  {
    AI = true; STATUS = "draft";
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "",
      draft: "Hairline crack across the basin, front left.", draftUnclear: false }];
    const { ctx, page } = await openOne();
    sent.length = 0;
    let rows = await shots(page);
    t.ck("the draft is in the box, where it will be read",
      rows[0]?.value === "Hairline crack across the basin, front left.", JSON.stringify(rows[0]));
    // THE CHIP LESSON. A class the stylesheet never heard of is markup that
    // says one thing and pixels that say nothing, and only this can see it.
    t.ck("and it LOOKS unkept rather than merely being marked so",
      rows[0]?.isDraft === true && rows[0]?.borderStyle === "dashed", JSON.stringify(rows[0]));
    t.ck("it says it is a draft", /Drafted/.test(rows[0]?.tag || ""), rows[0]?.tag);
    t.ck("and offers a way to keep it", rows[0]?.keep === true);

    // THE WHOLE RULE. Clicking away from a sentence nobody has read leaves
    // the record empty: a preselection mistaken for your own choice is worse
    // than a blank, and here the blank is the truth.
    await page.evaluate(() => {
      const box = document.querySelector(".insp-cap-box");
      box.focus(); box.blur();
    });
    await wait(600);
    t.ck("blurring an untouched draft saves NOTHING", sent.length === 0,
      JSON.stringify(sent.map((x) => x.what)));

    // Keeping it is the press that makes it the record.
    await page.evaluate(() => document.querySelector(".insp-cap-keep").click());
    await wait(700);
    t.ck("pressing Keep does save it", sent.filter((x) => x.what === "caption").length === 1,
      JSON.stringify(sent.map((x) => x.what)));
    t.ck("with the draft's own words", sent[0]?.body?.caption === "Hairline crack across the basin, front left.",
      JSON.stringify(sent[0]?.body));
    rows = await shots(page);
    t.ck("and it stops reading as a draft once it is theirs",
      rows[0]?.isDraft === false && rows[0]?.borderStyle !== "dashed", JSON.stringify(rows[0]));
    t.ck("so the Keep button goes with it", rows[0]?.keep === false);
    await ctx.close();
  }
  {
    // Editing a draft IS adopting it, so blur saves from then on -- the
    // difference being that somebody has now read it.
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "",
      draft: "Hairline crack.", draftUnclear: false }];
    const { ctx, page } = await openOne();
    sent.length = 0;
    // Through React's own setter, because assigning `.value` does not reach
    // a controlled component's onChange -- React tracks the value on the
    // node's descriptor, so a direct write leaves the box reading what it
    // did and the whole block reports the product as broken. The first
    // version of this did exactly that.
    await page.evaluate(() => {
      const box = document.querySelector(".insp-cap-box");
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      box.focus();
      set.call(box, "Hairline crack across the basin, about 40mm.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(200);
    const mid = await shots(page);
    t.ck("an edited draft stops wearing the dashed mark", mid[0]?.isDraft === false, JSON.stringify(mid[0]));
    await page.evaluate(() => document.querySelector(".insp-cap-box").blur());
    await wait(700);
    t.ck("and blurring it now saves", sent.filter((x) => x.what === "caption").length === 1,
      JSON.stringify(sent.map((x) => x.what)));
    t.ck("with what they typed rather than what was drafted",
      sent[0]?.body?.caption === "Hairline crack across the basin, about 40mm.", JSON.stringify(sent[0]?.body));
    await ctx.close();
  }
  {
    // AN UNREADABLE PHOTOGRAPH DOES NOT SEED THE BOX. "Too dark to tell" is
    // true and is not a condition record; seeding it would let somebody keep
    // it as one with a single press.
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "",
      draft: "Too dark to make out what the mark is.", draftUnclear: true }];
    const { ctx, page } = await openOne();
    const rows = await shots(page);
    t.ck("an unclear draft leaves the box empty", rows[0]?.value === "", JSON.stringify(rows[0]));
    t.ck("and offers no Keep", rows[0]?.keep === false);
    // Its words are still worth having: what it could not see is a reason to
    // take another photograph.
    t.ck("but says what it could not read", /Couldn't read this one/.test(rows[0]?.unclear || ""),
      rows[0]?.unclear);
    t.ck("in the model's own words", /Too dark/.test(rows[0]?.unclear || ""), rows[0]?.unclear);
    await ctx.close();
  }

  console.log("\n-- the picture that actually goes --");
  {
    AI = true; STATUS = "draft";
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg", caption: "", draft: "", draftUnclear: false }];
    const { ctx, page } = await openOne();
    sent.length = 0;
    await page.evaluate(() => document.querySelector(".insp-draft-go").click());
    await wait(4000);
    const call = sent.find((x) => x.what === "draft");
    t.ck("pressing it asks for a draft", !!call, JSON.stringify(sent.map((x) => x.what)));
    const one = call?.body?.photos?.[0];
    t.ck("naming the photograph", one?.id === "ph1", JSON.stringify(one?.id));
    t.ck("and carrying bytes", (one?.data || "").length > 100, String((one?.data || "").length));

    // THE COST CLAIM, CHECKED. The downscale is the browser's job, so this
    // is the only place it is observable -- and a 2000x1500 original left
    // alone costs four times what the quote assumed.
    const size = await page.evaluate((b64) => new Promise((ok) => {
      const i = new Image();
      i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => ok(null);
      i.src = `data:image/jpeg;base64,${b64}`;
    }), one?.data || "");
    t.ck("it is a decodable jpeg", !!size, JSON.stringify(size));
    t.ck("downscaled to the long edge the price was worked out from",
      size && Math.max(size.w, size.h) === DRAFT_LONG_EDGE, JSON.stringify(size));
    t.ck("with the aspect ratio kept, so nothing is stretched",
      size && Math.abs((size.w / size.h) - (2000 / 1500)) < 0.02, JSON.stringify(size));
    // And comfortably under the ceiling the Worker enforces, or the cap
    // would refuse an ordinary press.
    t.ck("and well inside the size cap the route enforces",
      (one?.data || "").length * 3 / 4 < MAX_DRAFT_BYTES,
      `${Math.round((one?.data || "").length * 3 / 4 / 1024)}KB of ${Math.round(MAX_DRAFT_BYTES / 1024)}KB`);

    const rows = await shots(page);
    t.ck("and the draft comes back into the box", /Drafted note 1/.test(rows[0]?.value || ""),
      JSON.stringify(rows[0]?.value));
    t.ck("wearing the dashed mark, because nobody has kept it yet",
      rows[0]?.isDraft === true && rows[0]?.borderStyle === "dashed", JSON.stringify(rows[0]));
    await ctx.close();
  }

  console.log("\n-- a finished inspection --");
  {
    AI = true; STATUS = "finished";
    PHOTOS = [{ id: "ph1", name: "a.jpg", type: "image/jpeg",
      caption: "Hairline crack across the basin.", draft: "Hairline crack.", draftUnclear: false }];
    const { ctx, page } = await openOne();
    // FINISHED IS A ONE-WAY DOOR. Everything stays readable and nothing
    // stays writable, which is what makes the report evidence months later.
    t.ck("there is no drafting on it", (await draftBtn(page)) === null);
    const rows = await shots(page);
    t.ck("and no box to type in", rows[0]?.value === null, JSON.stringify(rows[0]));
    t.ck("but the caption is still read", /Hairline crack across the basin/.test(rows[0]?.readOnlyText || ""),
      rows[0]?.readOnlyText);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close();
  api.close();
}

t.done();
