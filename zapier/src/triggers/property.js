const { API, authHeader } = require("../constants");

// A hidden trigger whose only job is to fill the SubSub property dropdown.
//
// Hidden for the reason the trade one is: nobody builds a Zap that fires when
// a building exists, and it would otherwise sit in the trigger list as a thing
// that never happens.
//
// The field it fills was a TEXT BOX asking for a uuid. Nobody holds one of
// those in their head, so the only way to use it was to go and find the id --
// and a wrong one is a job refused with `property_not_found`, which an
// integrator reads as a broken Zap. Same shape as typing `windows_doors`,
// which is the whole reason the trades dropdown exists.
//
// PAGED, because Zapier shows the first page of a dropdown and nothing says
// there are more. A building missing from the list is indistinguishable from a
// building that is not on the account, so the page number goes through.
const perform = async (z, bundle) => {
  const page = bundle.meta?.page || 0;
  const res = await z.request({
    url: `${API}/properties`,
    params: { page },
    headers: authHeader(z, bundle),
  });
  // The label is assembled by SubSub, not here: this app is not the only
  // caller of that route, and two of them would name the same building two
  // ways.
  return (res.data.properties || []).map((p) => ({ id: p.id, label: p.label }));
};

module.exports = {
  key: "property",
  noun: "Property",
  display: {
    label: "Property",
    description: "The buildings on your SubSub account. Used to fill the Property field.",
    hidden: true,
  },
  operation: {
    canPaginate: true,
    perform,
    sample: {
      id: "5b0f2a1c-0000-4000-8000-000000000000",
      label: "Alder Court -- 14 Alder Way, Seattle",
    },
  },
};
