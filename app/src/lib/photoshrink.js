// SHRINKING A PHOTOGRAPH BEFORE IT IS UPLOADED.
//
// Reported as inspections taking "a very long time to load or import". A
// photograph straight off a phone is 3 to 12 MB at 4032x3024, and every one
// travelled that size three times: up when it was taken, down again for its
// thumbnail, and decoded at full size again when its note was drafted. A room
// of twelve was the better part of a hundred megabytes over a mobile
// connection, standing in an empty flat.
//
// 2048px on the long edge is still sharper than any screen it is read on and
// shows a hairline crack or a scuff plainly, which is what an inspection
// photograph is for. At JPEG 0.85 it is a few hundred kilobytes: about a
// tenth of the original.
//
// IT NEVER MAKES THINGS WORSE. A file that is already small, one the browser
// cannot decode (HEIC in a browser that does not read it), an animated GIF,
// or a result that came out larger than what went in, all go up exactly as
// they were. Failing to shrink costs time; failing to upload costs the photo.
//
// Re-encoding drops the camera's metadata, which includes the GPS position
// the phone stamped on it. When a photograph was taken is already recorded
// against the row, so nothing the record relies on is lost with it.

export const PHOTO_LONG_EDGE = 2048;
export const PHOTO_QUALITY = 0.85;
// A photograph that is BOTH under this and within the long edge is left
// alone: re-encoding it buys almost nothing. One that is small on disk but
// large in pixels is still shrunk, because a 12-megapixel picture costs the
// same to decode and draw however well it compressed.
export const SHRINK_ABOVE_BYTES = 600 * 1024;

const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function shrinkPhoto(file) {
  if (!file || !SHRINKABLE.has(String(file.type || "").toLowerCase())) return file;
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error("decode_failed"));
      i.src = src;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return file;
    if (file.size <= SHRINK_ABOVE_BYTES && Math.max(w, h) <= PHOTO_LONG_EDGE) return file;
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", PHOTO_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const base = String(file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Several at once rather than one after another, but not all at once: a
// phone on one bar uploading twelve in parallel finishes none of them for a
// long time. Results come back in the order the files went in.
export async function inPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
