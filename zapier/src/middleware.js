// Turn SubSub's refusals into sentences Zapier shows a person.
//
// Left alone, a 400 surfaces as "Got 400 calling POST /jobs" with the body
// buried, and the one useful thing in it -- WHICH field was wrong, named in
// the sender's own vocabulary -- never reaches the screen. Somebody then
// rebuilds a working Zap looking for a mistake that was reported and not
// shown.
const handleError = (response, z) => {
  if (response.status < 400) return response;

  const body = response.json || {};
  const fields = (body.errors || [])
    .map((e) => `${e.field}: ${e.message || e.code}`)
    .join("; ");
  const said = [body.message, fields].filter(Boolean).join(" — ");

  // 401 IS ExpiredAuthError AND MUST NOT BE RefreshAuthError, and the
  // difference is the whole of why the first connection attempt was
  // unexplainable.
  //
  // RefreshAuthError tells Zapier to go and REFRESH the credential, which is
  // right for session auth, where there is a refresh to perform. This app is
  // `custom` auth -- an API token with nothing to refresh -- so Zapier cannot
  // act on it, and it replaces our sentence with its own:
  //
  //   authentication failed: Cannot refresh authentication for app with auth
  //   type `custom`.
  //
  // Which names no token, no account and nothing to do about either. The one
  // useful fact -- what SubSub said, in SubSub's words -- is discarded by the
  // handler that exists to carry it, on the single call every person makes
  // before they can make any other. The same shape as a catch wide enough to
  // hide a real error, one layer out: the failure path ATE the message.
  //
  // ExpiredAuthError is the counterpart for a credential that cannot be
  // refreshed: Zapier keeps our words and asks the person to reconnect, which
  // is the only thing a bad token can be answered with.
  if (response.status === 401 || body.error === "invalid_token") {
    throw new z.errors.ExpiredAuthError(
      said || "That SubSub token was not recognised. Create a new one in "
        + "SubSub under My account -> Profile -> Connect your CRM, and "
        + "reconnect with it."
    );
  }
  if (body.error === "scale_required") {
    throw new z.errors.Error(
      said || "The SubSub API is part of the Scale plan.", "ScaleRequired", response.status
    );
  }
  throw new z.errors.Error(
    said || `SubSub answered ${response.status}.`,
    body.error || "SubSubError",
    response.status
  );
};

module.exports = { handleError };
