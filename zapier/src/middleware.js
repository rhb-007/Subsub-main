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

  // 401 must be thrown as a RefreshAuthError, or Zapier reports a broken Zap
  // rather than a connection that needs reconnecting -- and the person goes
  // looking at their fields instead of their token.
  if (response.status === 401 || body.error === "invalid_token") {
    throw new z.errors.RefreshAuthError(
      said || "That SubSub token was not recognised. Reconnect the account."
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
