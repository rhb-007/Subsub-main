// CompanyCam, read from its own published OpenAPI spec (companycam/openapi-spec,
// Core API v2) rather than from memory. Every field name in this file is one
// that spec names: Project {id, name, address, featured_image, updated_at},
// Photo {id, project_id, uris, description, captured_at, status,
// processing_status}, Document {id, project_id, name, url, content_type,
// byte_size}, ImageURI {type, uri, url}, Address {street_address_1, city,
// state, postal_code}.
//
// WHAT IT IS FOR: a job carries its measurements, takeoffs and drawings as
// files the work order opens. A roofer's measurement report and the photos of
// the roof very often already live in CompanyCam, so the job form imports
// them from there instead of making somebody download and re-upload them.
//
// AN IMPORT IS A COPY. The bytes are fetched once and stored as an ordinary
// measurement document, so the work order keeps opening it after the
// CompanyCam project is archived, the account disconnects, or the token is
// revoked -- the same reason a compliance pack is a live record rather than
// an attachment, pointed the other way: here the job is the record.

export const CC_API_BASE = "https://api.companycam.com/v2";

// A page of a project's photos. The spec allows 100; a picker showing more
// than this at once is a wall nobody scans on an iPad.
export const CC_PHOTO_PAGE = 60;
export const CC_PROJECT_PAGE = 25;
// One import, at most. Matches the measurement documents a job may carry.
export const CC_MAX_IMPORT = 20;

const s = (v) => (v == null ? "" : String(v)).trim();

// A URL is used only when it is https. Everything here comes back from
// CompanyCam's own API under the account's token, never from the browser,
// but a plain http link would still be fetched in the clear.
export function ccHttps(u) {
  const v = s(u);
  // A host and nothing a URL cannot hold: no spaces, no control characters.
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/.test(v) ? v : "";
}

// ImageURI carries `uri` (required) and `url`. Prefer the variants in order,
// and fall back to whatever https variant there is.
export function ccImageUrl(uris, prefer = ["original", "web", "thumbnail"]) {
  const list = Array.isArray(uris) ? uris : [];
  for (const want of prefer) {
    const hit = list.find((u) => u && u.type === want && ccHttps(u.url || u.uri));
    if (hit) return ccHttps(hit.url || hit.uri);
  }
  const any = list.find((u) => u && ccHttps(u.url || u.uri));
  return any ? ccHttps(any.url || any.uri) : "";
}

export function ccAddressLine(a) {
  if (!a || typeof a !== "object") return "";
  const street = [s(a.street_address_1), s(a.street_address_2)].filter(Boolean).join(" ");
  const place = [s(a.city), [s(a.state), s(a.postal_code)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ");
}

const when = (unix) => {
  const n = Number(unix);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

// What the picker draws. Nothing else of the project leaves the Worker: its
// contact, its notepad, its collaborators and its geofence are CompanyCam's
// record of the customer, and the picker needs a name and a place.
export function ccProjectView(p) {
  if (!p || !s(p.id)) return null;
  return {
    id: s(p.id),
    name: s(p.name) || ccAddressLine(p.address) || "Untitled project",
    address: ccAddressLine(p.address),
    thumb: ccImageUrl(p.featured_image, ["thumbnail", "web"]),
    updatedAt: when(p.updated_at),
    deleted: p.status === "deleted",
  };
}

// A photo can be imported only once CompanyCam has finished with it and it is
// not deleted. A pending one has no original to copy yet.
export function ccPhotoUsable(ph) {
  if (!ph || ph.status === "deleted") return false;
  const ps = ph.processing_status;
  if (ps && ps !== "processed" && ps !== "duplicate") return false;
  return !!ccImageUrl(ph.uris, ["original", "web"]);
}

export function ccPhotoView(ph) {
  if (!ph || !s(ph.id)) return null;
  return {
    id: s(ph.id),
    description: s(ph.description),
    capturedAt: when(ph.captured_at),
    thumb: ccImageUrl(ph.uris, ["thumbnail", "web"]),
    usable: ccPhotoUsable(ph),
  };
}

export function ccDocView(d) {
  if (!d || !s(d.id)) return null;
  return {
    id: s(d.id),
    name: s(d.name) || `Document ${s(d.id)}`,
    type: s(d.content_type).toLowerCase(),
    size: Number(d.byte_size) || null,
    usable: !!ccHttps(d.url),
  };
}

// The body of an import, cleaned: a project and the ids picked in it. Ids are
// CompanyCam's own (digit strings in the spec); anything else is dropped
// rather than sent on to their API in a path.
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export function cleanCcImport(body) {
  const b = body && typeof body === "object" ? body : {};
  const projectId = s(b.projectId);
  if (!ID.test(projectId)) return { error: "project_required" };
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(s).filter((x) => ID.test(x)))];
  const photos = ids(b.photos);
  const documents = ids(b.documents);
  if (!photos.length && !documents.length) return { error: "nothing_picked" };
  if (photos.length + documents.length > CC_MAX_IMPORT) return { error: "too_many", max: CC_MAX_IMPORT };
  return { projectId, photos, documents };
}

// The name a copied photo is stored under. CompanyCam photos have no file
// name, so it says where it came from and what it shows.
export function ccPhotoFileName(ph, type) {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const what = s(ph?.description).replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 40).replace(/\s+/g, "-");
  return `CompanyCam-${what ? what + "-" : ""}${s(ph?.id)}.${ext}`;
}
