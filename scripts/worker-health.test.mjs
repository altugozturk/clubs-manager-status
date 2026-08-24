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
      enabled: true,
    },
    recruitmentDecisionDelivery: {
      ...ready,
      enabled: true,
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

test("accepts the strict production schema when both recruitment processors are enabled and ready", () => {
  assert.deepEqual(validate(validPayload()), { ok: true, reason: null });
});

test("rejects a missing decision-delivery processor", () => {
  const payload = validPayload();
  delete payload.recruitmentDecisionDelivery;
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "Worker health response returned an unexpected top-level schema",
  });
});

for (const [name, field] of [
  ["recruitment", "recruitmentDelivery"],
  ["decision", "recruitmentDecisionDelivery"],
]) {
  test(`rejects a disabled ${name} processor`, () => {
    const payload = validPayload();
    payload[field].enabled = false;
    assert.deepEqual(validate(payload), {
      ok: false,
      reason: "Worker or durable queue health was not ready",
    });
  });

  test(`rejects an unready ${name} processor`, () => {
    const payload = validPayload();
    payload[field].ready = false;
    assert.deepEqual(validate(payload), {
      ok: false,
      reason: "Worker or durable queue health was not ready",
    });
  });
}

test("rejects malformed decision-delivery health fields", () => {
  const payload = validPayload();
  payload.recruitmentDecisionDelivery.lastErrorAt = 500;
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "recruitmentDecisionDelivery returned invalid health field types",
  });
});

test("rejects a partial decision-delivery schema", () => {
  const payload = validPayload();
  delete payload.recruitmentDecisionDelivery.lastSuccessAt;
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "recruitmentDecisionDelivery returned an unexpected health schema",
  });
});

test("rejects unexpected decision-delivery fields", () => {
  const payload = validPayload();
  payload.recruitmentDecisionDelivery.applicantEmail = "must-not-be-accepted@example.invalid";
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "recruitmentDecisionDelivery returned an unexpected health schema",
  });
});

test("rejects any unexpected field so customer data or secrets cannot become monitor inputs", () => {
  const payload = validPayload();
  payload.token = "must-not-be-accepted";
  assert.deepEqual(validate(payload), {
    ok: false,
    reason: "Worker health response returned an unexpected top-level schema",
  });
});

test("rejects a non-object JSON payload without throwing", () => {
  assert.deepEqual(validateWorkerHealthPayload({
    bodyText: "null",
    contentType: "application/json",
  }), {
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
