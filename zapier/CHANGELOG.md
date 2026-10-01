# Changelog

Versions of the SubSub Zapier integration. `zapier promote` refuses to run
without this file, which is the right refusal: promoting moves real Zaps onto
a new version, and the people on them are entitled to a record of what changed
under their feet.

One heading per pushed version, newest first.

## 1.1.0

- **Property** is now a dropdown of the buildings on your account, instead of a
  box asking for a SubSub property ID. The id is a UUID, so the field could
  only be used by going to look one up, and a wrong one was a job refused for
  naming a building that does not exist.
- The API token field links to the setup instructions.

## 1.0.0

First version.

- **Create Job.** Posts a scheduled job to SubSub with its trades unassigned,
  ready to assign contractors to. Your CRM's own job id is required, so a
  webhook retry answers with the job that already exists rather than creating
  a second one.
- **Trades** is a dropdown filled from SubSub, so a trade cannot be typed
  wrong into a slot nobody can then fill.
- **SubSub property ID** can be given instead of an address, for a building
  already on your account.
- The connection is a SubSub API token (**My account → Profile → Connect your
  CRM**), and it is labelled with the account name, so two SubSub accounts in
  one Zapier account are told apart.
