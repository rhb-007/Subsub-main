const { API, authHeader } = require("./constants");

// The test call is a READ, deliberately.
//
// Zapier runs it when somebody connects and again whenever a call 401s, so it
// must be safe to repeat and must change nothing. Testing an API key by
// creating a job would put a test row on somebody's Jobs screen every time
// Zapier decided to re-check.
const test = async (z, bundle) => {
  const res = await z.request({ url: `${API}/me`, headers: authHeader(z, bundle) });
  return res.data;
};

module.exports = {
  type: "custom",
  fields: [
    {
      key: "apiKey",
      type: "password",
      required: true,
      label: "SubSub API token",
      // Said where they are pasting it, not in help text read afterwards --
      // the token is shown once and the panel is the only place it exists.
      helpText:
        "In SubSub: **My account → Profile → Connect your CRM → Create token**. " +
        "It starts `ssk_` and is shown once. The API is part of the Scale plan.",
    },
  ],
  test,
  // What the connection is called in their Zap. Somebody with two SubSub
  // accounts sees two connections; without this they see "SubSub" twice and
  // pick by guessing.
  connectionLabel: "{{account.name}}",
};
