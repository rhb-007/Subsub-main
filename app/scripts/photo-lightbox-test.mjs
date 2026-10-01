// Three photos of one leak, strung together.
//
// Reported looking at a tenant's report on a property manager's dashboard:
// "when viewing images of an issue a tenant sent me, they should be strung
// together, so you can increase size and arrow forward or back to view the
// other images without closing them."
//
// What was there was a one-picture lightbox — twice. The tenant's own view of
// their report had a copy and the manager's view of the same report had
// another, each drawing exactly the photo that was tapped, each closing on any
// click, and neither able to reach the next one. So three photos meant three
// round trips through a grid, and the ceiling, the floor and the meter reading
// could not be read in order.
//
// Two copies of one thing is two things to keep in step, so the fix is one
// component used from all three grids. What is asserted here is the behaviour
// rather than its presence: a static check that `PhotoLightbox` is MENTIONED
// passes with the arrows deleted, and a bare `/<PhotoLightbox/` over the file
// finds whichever of the mounts still exists — the trap this repository has
// recorded about `.embed-code-btn` and about `DocFileView`.
//
//   node --no-warnings scripts/photo-lightbox-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-lightbox-test");
const WEB = 5305, API = 9005;
const t = tally();

// Three real PNGs, each a different size, so "the picture changed" can be
// read off the frame rather than only off the caption beside it. A caption
// that moves over an image that does not is exactly the bug a lightbox with
// arrows can have.
const png = (w) => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcT = [...Array(256)].map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    let c = 0xffffffff;
    for (const b of body) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; ihdr[9] = 2;   // 8-bit truecolour
  // One zlib-stored block per row: filter byte 0 then w*3 bytes.
  const raw = Buffer.concat([...Array(w)].map(() =>
    Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)])));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

const SHOTS = [
  { id: "ph_1", name: "ceiling.png", w: 40 },
  { id: "ph_2", name: "floor.png", w: 60 },
  { id: "ph_3", name: "meter.png", w: 80 },
];
const BYTES = Object.fromEntries(SHOTS.map((s) => [s.id, png(s.w)]));

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@x.test", role: "admin" },
};
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@x.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_t", name: "Tess Nguyen", email: "tess@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const JOB = {
  accountId: "acc_x", id: "job_1", title: "Water coming through the ceiling",
  client: "", address: "12 Cedar St", area: "Seattle", zip: "98101", sqft: null, stories: null,
  time: "07:00", scope: "", materialSource: null, materialSupplier: null, materialBranch: null,
  materialsPaidBy: null, measurementDocs: [], notes: "", severity: "standard",
  createdAtIso: "2026-09-30T00:00:00Z", readOnly: false, inherited: false,
  atOwnedProperty: false, propertyId: "prop_1",
  trades: ["plumbing"], assignments: {}, status: "requested", date: "2026-10-20",
  requestedBy: "usr_t", approvedAt: null, declinedAt: null, withdrawnAt: null,
  createdAt: "Sep 30", photos: SHOTS.map(({ id, name }) => ({ id, name })),
  reportDetail: { unit: "3B", problem: "A leak", started: "Today", words: "It is dripping." },
};

// Serving one photo as a 404 is the only way to check that the frame says so
// rather than spinning: a stub that always succeeds cannot reach that branch.
let BREAK = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  const shot = /^\/api\/jobs\/job_1\/photos\/(ph_\d)$/.exec(path);
  if (shot) {
    if (shot[1] === BREAK) return [500, { error: "nope" }];
    return [200, null, { raw: BYTES[shot[1]], type: "image/png" }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, [JOB]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Cedar Flats", address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101",
    units: 24, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// What is on screen, from the lightbox itself.
const readBox = (page) => page.evaluate(() => {
  const box = document.querySelector(".ph-lightbox");
  if (!box) return { open: false };
  const img = box.querySelector(".phl-frame img");
  return {
    open: true,
    count: (box.querySelector(".phl-count")?.innerText || "").trim(),
    name: (box.querySelector(".phl-name")?.innerText || "").trim(),
    src: img?.getAttribute("src") || null,
    wide: img?.naturalWidth || 0,
    arrows: box.querySelectorAll(".phl-nav").length,
    gone: (box.querySelector(".phl-gone")?.innerText || "").trim(),
  };
});
const clickIn = (page, sel, n = 0) => page.evaluate((s, i) => {
  document.querySelectorAll(s)[i]?.click();
}, sel, n);
const press = async (page, key) => { await page.keyboard.press(key); await wait(350); };

const openReport = async () => {
  const { ctx, page } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1100 } });
  await wait(2600);
  // The dashboard row for the request IS the way into it.
  await clickIn(page, ".dash-sec .dash-row-open");
  await wait(900);
  return { ctx, page };
};

try {
  console.log("\n-- the manager's view of a tenant's report --");
  {
    const { ctx, page } = await openReport();
    const thumbs = await page.evaluate(() => document.querySelectorAll(".modal .ph-grid .ph-thumb img").length);
    t.ck("all three photos arrive as thumbnails", thumbs === 3, String(thumbs));

    await clickIn(page, ".modal .ph-grid .ph-thumb", 0);
    await wait(500);
    let b = await readBox(page);
    t.ck("tapping one opens the lightbox", b.open === true, JSON.stringify(b));
    // THE COUNTER IS WHAT MAKES THE ARROWS MEAN SOMETHING. Without it, a set
    // you can move through does not say where in it you are.
    t.ck("it says which of the set this is", b.count === "1 of 3", JSON.stringify(b));
    t.ck("and names the file", b.name === "ceiling.png", JSON.stringify(b));
    t.ck("with an arrow each way", b.arrows === 2, JSON.stringify(b));
    const first = b.src;

    // FORWARD, WITHOUT CLOSING. This is the whole report.
    await clickIn(page, ".ph-lightbox .phl-nav", 1);
    await wait(400);
    b = await readBox(page);
    t.ck("Next moves on, and the lightbox stays open", b.open === true && b.count === "2 of 3",
      JSON.stringify(b));
    t.ck("and the PICTURE changed, not only the caption",
      b.src !== first && b.wide === 60, JSON.stringify({ src: b.src !== first, wide: b.wide }));

    await clickIn(page, ".ph-lightbox .phl-nav", 0);
    await wait(400);
    b = await readBox(page);
    t.ck("Previous goes back", b.count === "1 of 3" && b.wide === 40, JSON.stringify(b));

    // AND IT WRAPS. A dead Next on the last of three is a control whose whole
    // job is to be pressed, doing nothing, with nothing saying why.
    await clickIn(page, ".ph-lightbox .phl-nav", 0);
    await wait(400);
    b = await readBox(page);
    t.ck("Previous from the first wraps to the last", b.count === "3 of 3" && b.wide === 80,
      JSON.stringify(b));
    await clickIn(page, ".ph-lightbox .phl-nav", 1);
    await wait(400);
    b = await readBox(page);
    t.ck("and Next from the last wraps to the first", b.count === "1 of 3" && b.wide === 40,
      JSON.stringify(b));

    // The keyboard, because this is a picture viewer and arrow keys are what
    // somebody reaches for.
    await press(page, "ArrowRight");
    t.ck("the right arrow key moves on", (await readBox(page)).count === "2 of 3");
    await press(page, "ArrowLeft");
    t.ck("the left arrow key goes back", (await readBox(page)).count === "1 of 3");

    // CLOSING CLOSES THE PICTURE AND NOT THE REPORT, which is the half that
    // matters: the report is what somebody came to read, and a lightbox that
    // took it with it would make looking at a photo cost the page.
    //
    // Worth saying what is NOT pinned here. `PhotoLightbox` stops Escape
    // from travelling, and `Modal` happens to bind no Escape handler at all,
    // so removing that stopPropagation changes nothing today -- it is there
    // against the day Modal grows one, and a test cannot tell. What these two
    // do catch is the lightbox having no Escape of its own, and the box being
    // rendered outside `.modal`, where its own backdrop click would reach
    // `.modal-backdrop` and close the report underneath.
    await press(page, "Escape");
    const after = await page.evaluate(() => ({
      box: !!document.querySelector(".ph-lightbox"),
      report: !!document.querySelector(".modal .ph-grid"),
    }));
    t.ck("Escape shuts the picture", after.box === false, JSON.stringify(after));
    t.ck("and leaves the report open", after.report === true, JSON.stringify(after));

    // The backdrop is still a way out, which is what it always was.
    await clickIn(page, ".modal .ph-grid .ph-thumb", 2);
    await wait(500);
    t.ck("the third thumbnail opens at the third photo",
      (await readBox(page)).count === "3 of 3", JSON.stringify(await readBox(page)));
    await page.evaluate(() => {
      const box = document.querySelector(".ph-lightbox");
      box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await wait(350);
    const left = await page.evaluate(() => ({
      box: !!document.querySelector(".ph-lightbox"),
      report: !!document.querySelector(".modal .ph-grid"),
    }));
    t.ck("clicking the backdrop shuts it", left.box === false, JSON.stringify(left));
    t.ck("and that does not take the report with it", left.report === true, JSON.stringify(left));

    await ctx.close().catch(() => {});
  }

  console.log("\n-- a photo that will not load says so, in the frame --");
  {
    BREAK = "ph_2";
    const { ctx, page } = await openReport();
    await clickIn(page, ".modal .ph-grid .ph-thumb", 0);
    await wait(500);
    // Only two thumbnails are buttons now, so the index of the first is still
    // the first PHOTO -- which is what the lightbox is opened at.
    let b = await readBox(page);
    t.ck("the set is still three long", b.count === "1 of 3", JSON.stringify(b));
    await clickIn(page, ".ph-lightbox .phl-nav", 1);
    await wait(500);
    b = await readBox(page);
    // A FAILURE IS SAID, NOT SPUN. Loading for ever over a photo that is never
    // coming is the worse of the two, because there is nothing to do about it.
    t.ck("the one that failed is named as failed", /Couldn/.test(b.gone), JSON.stringify(b));
    t.ck("and the set can still be walked past it",
      b.count === "2 of 3", JSON.stringify(b));
    await clickIn(page, ".ph-lightbox .phl-nav", 1);
    await wait(400);
    b = await readBox(page);
    t.ck("the third still draws", b.count === "3 of 3" && b.wide === 80, JSON.stringify(b));
    await ctx.close().catch(() => {});
    BREAK = null;
  }

  console.log("\n-- one photo has nowhere to go, and says nothing about it --");
  {
    const keep = JOB.photos;
    JOB.photos = [{ id: "ph_1", name: "ceiling.png" }];
    const { ctx, page } = await openReport();
    await clickIn(page, ".modal .ph-grid .ph-thumb", 0);
    await wait(500);
    const b = await readBox(page);
    t.ck("it opens", b.open === true, JSON.stringify(b));
    // NO ARROWS AND NO COUNTER. A dead control is something people press
    // twice before reading, and "1 of 1" is a number about nothing.
    t.ck("with no arrows", b.arrows === 0, JSON.stringify(b));
    t.ck("and no counter", b.count === "", JSON.stringify(b));
    t.ck("but still the picture and its name", b.wide === 40 && b.name === "ceiling.png",
      JSON.stringify(b));
    await ctx.close().catch(() => {});
    JOB.photos = keep;
  }

  console.log("\n-- and there is ONE of it, not one per screen --");
  {
    const { readFileSync } = await import("node:fs");
    const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    // COUNTED rather than looked for: a bare /<PhotoLightbox/ finds whichever
    // mount still exists, which is how a fix applied to one of two copies
    // passes -- the `.embed-code-btn` trap this repository already records.
    //
    // One definition, two mounts (the tenant's report and the manager's view
    // of it), and THREE grids feeding them: the tenant modal draws its photos
    // in both its edit and its read-only pane, and both share its lightbox.
    // So the grids are counted separately -- a grid left on the old
    // url-and-name shape would open nothing and nothing else here would see
    // it.
    const defs = (APP.match(/function PhotoLightbox\(/g) || []).length;
    const uses = (APP.match(/<PhotoLightbox\b/g) || []).length;
    const fed = (APP.match(/onLoaded=\{seeShot\}/g) || []).length;
    t.ck("one component", defs === 1, String(defs));
    t.ck("mounted in both modals", uses === 2, String(uses));
    t.ck("and every grid feeds it", fed === 3, String(fed));
    // The old shape is gone with it: a <button> wrapping an <img>, which
    // cannot carry the arrows because a button inside a button is not a thing.
    t.ck("and the old one-picture copy is gone",
      !/className="ph-lightbox" onClick=\{\(\) => setLightbox\(null\)\}/.test(APP));
  }

} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
