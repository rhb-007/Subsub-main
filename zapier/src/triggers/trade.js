const { API, authHeader } = require("../constants");

// A hidden trigger whose only job is to fill a dropdown.
//
// Nobody builds a Zap that fires when a trade exists, so `hidden: true`: it
// would otherwise sit in the trigger list as a thing that never happens.
//
// The list comes from SubSub rather than being written here, because the same
// file validates the POST -- so what somebody picks from and what the route
// accepts cannot disagree. A hardcoded copy would drift the first time a trade
// is added, and the symptom would be a job refused for naming a trade the
// dropdown itself offered.
const perform = async (z, bundle) => {
  const res = await z.request({ url: `${API}/trades`, headers: authHeader(z, bundle) });
  // Zapier requires an `id` on every row it lists.
  return (res.data.trades || []).map((t) => ({ id: t.id, label: t.label }));
};

module.exports = {
  key: "trade",
  noun: "Trade",
  display: {
    label: "Trade",
    description: "The trades SubSub knows about. Used to fill the Trades field.",
    hidden: true,
  },
  operation: {
    perform,
    sample: { id: "roofing", label: "Roofing" },
  },
};
