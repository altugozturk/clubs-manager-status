import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkerHealthPayload } from "./worker-health.mjs";

const ready = {
  lastErrorAt: null,
  lastSuccessAt: "2026-08-22T19:00:00.000Z",
  ready: true,
};

function validPayload() {
  return {
    controlPlane: { ...ready },
    cupDelivery: { ...ready },
    healthy: true,
    operationalAlerts: { ...ready },
    operationsDelivery: { ...ready },
    outbox: {
      healthy: true,
      oldestPendingAt: null,
      pending: 0,
      ready: true,
    },
    recruitmentDelivery: {
      ...ready,
      enabled: false,
      ready: false,
    },
    reliabilityScheduler: {
      lastCompletedAt: "2026-08-22T19:00:00.000Z",
      lastErrorAt: null,
      lastStartedAt: "2026-08-22T18:59:59.000Z",
      ready: true,
      running: false,
    },
    roleSync: { ...ready },
    sessionReminders: { ...ready },
    shards: [{
      connected: true,
      lastDispatchAt: "2026-08-22T19:00:00.000Z",
      ready: true,
      reconnects: 0,
      shardCount: 1,
      shardId: 0,
    }],
  };
}

function validate(payload) {
  return validateWorkerHealthPayload({
    bodyText: JSON.stringify(payload),
    contentType: "application/json; charset=utf-8",
  });
}

test("accepts the aggregate production health schema with an intentionally disabled queue", () => {
  assert.deepEqual(validate(validPayload()), { ok: true, reason: null });
});

test("rejects any unexpected field so customer data or secrets cannot become monitor inputs", () => {
  const payload = validPayload();
  payload.token = "must-not-be-accepted";
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "Worker health response returned an unexpected top-level schema",
  });
});

test("rejects an unhealthy durable queue even when the aggregate bit is stale", () => {
  const payload = validPayload();
  payload.operationsDelivery.ready = false;
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "Worker or durable queue health was not ready",
  });
});

test("requires a bounded JSON response", () => {
  assert.deepEqual(validateWorkerHealthPayload({
    bodyText: "x".repeat(32_769),
    contentType: "application/json",
  }), {
    ok: false,
    reason: "Worker health response exceeded the safe payload limit",
  });
});
