const authentication = require("./src/authentication");
const { handleError } = require("./src/middleware");
const jobCreate = require("./src/creates/job");
const tradeTrigger = require("./src/triggers/trade");

const { version } = require("./package.json");
const platformVersion = require("zapier-platform-core").version;

module.exports = {
  version,
  platformVersion,
  authentication,
  // One place, so every call gets the same treatment. A create that reported
  // its own errors nicely and a trigger that did not would be two behaviours
  // for one failure.
  afterResponse: [handleError],
  triggers: { [tradeTrigger.key]: tradeTrigger },
  creates: { [jobCreate.key]: jobCreate },
};
