# The SubSub Zapier integration

A job scheduled in a CRM arrives in SubSub with its trades unassigned, which is
the queue an account opens SubSub to clear.

## Why this exists when a webhook already works

`/api/v1/hooks/generic/<token>` has worked since the receiver shipped, and a
Zapier **Webhooks by Zapier** step can call it today. So this app buys three
things and no new capability:

- **No URL to paste.** A token in a URL is a secret in a field somebody
  screenshots. Here it is a Zapier connection, entered once, stored by them.
- **A trades dropdown.** The webhook step asks somebody to type
  `windows_doors` from memory. A typo is a job that arrives with a slot nobody
  can fill, discovered when the crew does not turn up.
- **Findability.** "SubSub" in Zapier's app directory is a door; a URL in our
  documentation is not.

It uses the **header** endpoint (`POST /api/v1/jobs`), not the path-token one,
because Zapier can set an `Authorization` header. The path token exists for
systems that cannot.

## What is in it

- **Authentication** — API key. Tested against `GET /api/v1/me`, which is also
  what labels the connection, so somebody with three SubSub accounts can tell
  their Zapier connections apart.
- **Create Job** — the five required fields and the optional ones, one to one
  with the published documentation.
- **Trade** (hidden trigger) — powers the dropdown from `GET /api/v1/trades`.
  Hidden because nobody builds a Zap that triggers on a trade.

## Deploying it

This is Zapier Platform CLI source. It is committed here rather than built in
their Visual Builder so it can be reviewed, tested and changed in one place --
a Visual Builder app is configuration nobody outside that console can read.

```
cd zapier
npm install
npx zapier login
npx zapier register "SubSub"   # first time only
npx zapier push
```

`zapier login` wants a Zapier account. Nothing here holds one, and no SubSub
credential is involved: the API token belongs to whoever connects the app.

Until it is pushed and reviewed by Zapier, the app is **private** — usable by
invitation. That is the right state for it: a public listing wants screenshots
and a support address, which is a decision about marketing rather than code.
