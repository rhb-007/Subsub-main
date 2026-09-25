// A profile picture must not become a way to read the bucket.
//
// The avatar is stored as an R2 key on the user's row, and the route serves
// whatever key it finds there. That is safe only because the key is never
// taken from the request: uploads land under `${accountId}/…`, so a key that
// does not start with this account's id was not written by this account, and
// accepting one would let an admin point their own avatar at another
// account's insurance certificate and then fetch it through a route that
// asks no further questions.
//
// Also checked: reading somebody else's face requires sharing an account
// with them. A company logo is public because it has to render on a login
// page; a person's photograph is not a sign on a building.
//
//   node scripts/avatar-key-test.mjs

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

// The smallest D1 and R2 that get a request past auth and record what was
// written, so the assertions are about behaviour rather than about a mock.
const make = ({ role = "admin", accountId = "acc1", avatarKey = null, shareAccount = true } = {}) => {
  const writes = [];
  const reads = [];
  const row = (sql, binds) => {
    if (/FROM memberships WHERE user_id/i.test(sql)) {
      return { id: "mem1", role, account_id: accountId, user_id: "u1", company_id: null };
    }
    if (/FROM users u\s+JOIN memberships m/i.test(sql)) {
      // The avatar read: only answers when the target shares the account.
      return shareAccount ? { avatar_key: avatarKey } : null;
    }
    if (/FROM accounts WHERE id/i.test(sql)) return { id: accountId, kind: "general_contractor" };
    return null;
  };
  const DB = { prepare: (sql) => ({
    bind: (...b) => ({
      first: async () => row(sql, b),
      all: async () => ({ results: [] }),
      run: async () => { if (/UPDATE users SET avatar_key/i.test(sql)) writes.push(b[0]); return { meta: { changes: 1 } }; },
    }),
    first: async () => row(sql, []), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
  }) };
  const FILES = { get: async (k) => { reads.push(k); return { body: "bytes", httpMetadata: { contentType: "image/png" } }; } };
  return { env: { DB, FILES }, writes, reads };
};

const call = (env, path, init = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    ...init,
    headers: { "X-User-Id": "u1", "X-Account-Id": "acc1", "Content-Type": "application/json", ...(init.headers || {}) },
  }), env);

console.log("\n-- a key this account did not upload --");
for (const [key, what] of [
  ["acc2/avatar/abc-face.jpg", "another account's upload"],
  ["acc2/sub-doc/insurance.pdf", "another account's insurance certificate"],
  ["acc1/../acc2/avatar/face.jpg", "a path that climbs out"],
  ["/etc/passwd", "an absolute path"],
  ["avatar/face.jpg", "no account prefix at all"],
]) {
  const { env, writes } = make();
  const res = await call(env, "/api/me/avatar", { method: "PATCH", body: JSON.stringify({ avatarKey: key }) });
  const body = await res.json().catch(() => ({}));
  ck(`refused: ${what}`, res.status === 400 && body.error === "bad_key", `${res.status} ${JSON.stringify(body)}`);
  ck(`  and nothing was written`, writes.length === 0, JSON.stringify(writes));
}

console.log("\n-- a key it did --");
{
  const { env, writes } = make();
  const res = await call(env, "/api/me/avatar",
    { method: "PATCH", body: JSON.stringify({ avatarKey: "acc1/avatar/abc-face.jpg" }) });
  const body = await res.json().catch(() => ({}));
  ck("accepted", res.status === 200 && body.ok === true, `${res.status} ${JSON.stringify(body)}`);
  ck("and stored", writes[0] === "acc1/avatar/abc-face.jpg", JSON.stringify(writes));
}

console.log("\n-- and taking it off again --");
{
  const { env, writes } = make();
  const res = await call(env, "/api/me/avatar", { method: "PATCH", body: JSON.stringify({ avatarKey: null }) });
  ck("null is a value, not 'leave it alone'", res.status === 200 && writes[0] === null, JSON.stringify(writes));
}

console.log("\n-- the same guard on an admin setting somebody else's --");
{
  const { env, writes } = make();
  const res = await call(env, "/api/account-users/u2",
    { method: "PATCH", body: JSON.stringify({ avatarKey: "acc2/sub-doc/insurance.pdf" }) });
  const body = await res.json().catch(() => ({}));
  ck("refused there too", res.status === 400 && body.error === "bad_key", `${res.status} ${JSON.stringify(body)}`);
  ck("and nothing was written", writes.length === 0, JSON.stringify(writes));
}

console.log("\n-- reading a face --");
{
  const { env, reads } = make({ avatarKey: "acc1/avatar/abc-face.jpg" });
  const res = await call(env, "/api/account-users/u2/avatar");
  ck("comes back for somebody on the same roster", res.status === 200, String(res.status));
  ck("from the key on their row, not from the request",
    reads.length === 1 && reads[0] === "acc1/avatar/abc-face.jpg", JSON.stringify(reads));
  ck("and is not left in a shared cache",
    /private/.test(res.headers.get("Cache-Control") || ""), res.headers.get("Cache-Control"));
}
{
  const { env, reads } = make({ avatarKey: "acc1/avatar/abc.jpg", shareAccount: false });
  const res = await call(env, "/api/account-users/u9/avatar");
  ck("not for somebody you share no account with", res.status === 404, String(res.status));
  ck("and the bucket was never touched", reads.length === 0, JSON.stringify(reads));
}
{
  const { env } = make({ avatarKey: null });
  const res = await call(env, "/api/account-users/u2/avatar");
  ck("404 for somebody who has not set one", res.status === 404, String(res.status));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
