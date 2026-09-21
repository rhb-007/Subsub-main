// Stands in for Resend and Twilio so the sending path is exercised rather
// than assumed. Records everything for the test to read back.
import http from "node:http";
const sent = { email: [], sms: [] };
const srv = (port, kind) => http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__sent") {
      res.writeHead(200, {"content-type":"application/json"});
      return res.end(JSON.stringify(sent[kind]));
    }
    if (req.url === "/__clear") { sent[kind] = []; res.writeHead(200); return res.end("{}"); }
    let parsed;
    try { parsed = kind === "email" ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)); }
    catch { parsed = { raw: body }; }
    sent[kind].push(parsed);
    res.writeHead(kind === "email" ? 200 : 201, {"content-type":"application/json"});
    res.end(JSON.stringify({ id: `${kind}_${sent[kind].length}`, sid: `SM${sent[kind].length}` }));
  });
}).listen(port, "127.0.0.1", () => console.log(`${kind} stub on ${port}`));
srv(8904, "email"); srv(8905, "sms");
