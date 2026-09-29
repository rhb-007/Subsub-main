// One place for the two things every file here needs, because a base URL
// written twice is a base URL that gets changed once.
const API = "https://api.subsub.work/api/v1";

// The token goes in a header, which is the whole reason this app exists rather
// than a Webhooks-by-Zapier step: Zapier can set one, and a token in a header
// is not a token in a URL somebody screenshots.
const authHeader = (z, bundle) => ({
  Authorization: `Bearer ${bundle.authData.apiKey}`,
});

module.exports = { API, authHeader };
