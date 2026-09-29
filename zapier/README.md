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

**It deploys from GitHub Actions**, not from anybody's laptop: the *Deploy
Zapier app* workflow. Same reason the other three deploys are buttons -- a
deploy that needs a terminal is a deploy that cannot be pressed by the person
who needs to press it. `.github/workflows/deploy-zapier.yml` carries the
detail.

Two things in this directory that the first version got wrong, both found by
running `zapier validate` rather than by reasoning about it.

**`zapier-platform-core` is pinned EXACTLY**, not to a caret range. `zapier
validate` refuses a range outright -- and its reason is the better argument:
that version decides which Lambda runtime Zapier runs the app on, so a range
means "whatever npm happened to resolve on the machine that pushed", which is
not a thing to leave to chance. `^15.5.1` would have failed on the first push.

**`.zapierapprc` is COMMITTED.** It was gitignored here on the reasoning that
the app id belongs to Zapier's account rather than to this repository. Wrong
twice over: Zapier's own documentation says to commit it, and without it in the
repo nothing remembers which integration to push to -- so a second deploy would
register a SECOND integration rather than updating the first. It is an
identifier, not a secret. The secret is the deploy key, which lives in GitHub
and never here.

Until Zapier reviews it the app is **private**: shared by invite link or by
email, up to 200 users, and a link cannot be revoked once sent. That is the
right state for it -- a public listing wants screenshots and a support address,
which is a decision about marketing rather than code.
