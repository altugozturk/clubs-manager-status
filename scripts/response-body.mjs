export function validateResponseBody(check, body) {
  if (typeof check?.marker !== "string" || typeof body !== "string") {
    return { ok: false, reason: "Response marker validation was not configured" };
  }
  if (!body.includes(check.marker)) {
    return { ok: false, reason: "Expected response marker was absent" };
  }
  const forbiddenMarkers = check.forbiddenMarkers ?? [];
  if (!Array.isArray(forbiddenMarkers) || !forbiddenMarkers.every((marker) => typeof marker === "string")) {
    return { ok: false, reason: "Forbidden response marker validation was malformed" };
  }
  if (forbiddenMarkers.some((marker) => body.includes(marker))) {
    return { ok: false, reason: "Response reported an unavailable data feed" };
  }
  return { ok: true, reason: null };
}
