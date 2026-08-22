import assert from "node:assert/strict";
import test from "node:test";
import { validateResponseBody } from "./response-body.mjs";

const tenant = {
  marker: "<title>Wazzap eFC — Club home · Clubs Manager</title>",
  forbiddenMarkers: ["Feed unavailable", "Squad unavailable"],
};

test("tenant response requires the expected club and healthy data projections", () => {
  assert.deepEqual(validateResponseBody(tenant, `${tenant.marker}<main>Official club home</main>`), {
    ok: true,
    reason: null,
  });
  assert.deepEqual(validateResponseBody(tenant, `${tenant.marker}<main>Feed unavailable</main>`), {
    ok: false,
    reason: "Response reported an unavailable data feed",
  });
  assert.deepEqual(validateResponseBody(tenant, `${tenant.marker}<main>Squad unavailable</main>`), {
    ok: false,
    reason: "Response reported an unavailable data feed",
  });
  assert.deepEqual(validateResponseBody(tenant, "<title>Another club</title>"), {
    ok: false,
    reason: "Expected response marker was absent",
  });
});

test("malformed response marker configuration fails closed", () => {
  assert.equal(validateResponseBody({ marker: "ok", forbiddenMarkers: [1] }, "ok").ok, false);
  assert.equal(validateResponseBody({}, "ok").ok, false);
});
