// Stands in for Cal's v2 API so the booking page can be driven locally.
//
// It answers the two shapes worker/demo.js expects and, on request, the ones
// it does not -- a booking page that shows no times because an upstream
// changed its payload is a failure worth having a test for.
//
//   node scripts/cal-stub.mjs            normal
//   SHAPE=flat node scripts/cal-stub.mjs the other documented slots shape
//   SHAPE=weird node scripts/cal-stub.mjs something nobody expects
import http from "node:http";

const SHAPE = process.env.SHAPE || "keyed";
const booked = [];
const taken = new Set();

const slotsFor = (day) => ["15:00", "16:00", "17:00", "18:00", "20:00", "21:00"]
  .map((t) => `${day}T${t}:00.000Z`).filter((iso) => !taken.has(iso));

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(obj));
    };
    if (u.pathname === "/__booked") return send(200, booked);
    if (u.pathname === "/__take") { taken.add(u.searchParams.get("start")); return send(200, { ok: true }); }
    if (u.pathname === "/__reset") { booked.length = 0; taken.clear(); return send(200, { ok: true }); }

    if (u.pathname === "/slots" && req.method === "GET") {
      if (!/^Bearer /.test(req.headers.authorization || "")) return send(401, { error: "no key" });
      if (req.headers["cal-api-version"] !== "2024-09-04") return send(400, { error: "wrong version" });
      const start = u.searchParams.get("start"), end = u.searchParams.get("end");
      // Weekdays only, first ten days of the range, which is plenty to pick from.
      const days = [];
      for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        days.push(d.toISOString().slice(0, 10));
        if (days.length >= 10) break;
      }
      if (SHAPE === "weird") return send(200, { status: "success", data: 42 });
      if (SHAPE === "flat") {
        return send(200, { status: "success", data: days.flatMap((d) => slotsFor(d).map((s) => ({ start: s }))) });
      }
      const data = {};
      days.forEach((d) => { data[d] = slotsFor(d).map((s) => ({ start: s })); });
      return send(200, { status: "success", data });
    }

    if (u.pathname === "/bookings" && req.method === "POST") {
      if (req.headers["cal-api-version"] !== "2024-08-13") return send(400, { error: "wrong version" });
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch { /* leave empty */ }
      if (taken.has(j.start)) return send(409, { error: "no_available_users_found_error" });
      taken.add(j.start);
      const uid = "bk_" + Math.random().toString(36).slice(2, 10);
      booked.push({ uid, ...j });
      return send(201, { status: "success", data: { uid, start: j.start } });
    }
    send(404, { error: "not stubbed: " + u.pathname });
  });
}).listen(8906, () => console.log(`cal stub on 8906 (${SHAPE})`));
