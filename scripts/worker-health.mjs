const maxPayloadBytes = 32_768;

const deliveryHealthKeys = ["lastErrorAt", "lastSuccessAt", "ready"];
const topLevelKeys = [
  "controlPlane",
  "cupDelivery",
  "healthy",
  "operationalAlerts",
  "operationsDelivery",
  "outbox",
  "recruitmentDelivery",
  "reliabilityScheduler",
  "roleSync",
  "sessionReminders",
  "shards",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isTimestampOrNull(value) {
  if (value === null) return true;
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateDeliveryHealth(name, value) {
  if (!hasExactKeys(value, deliveryHealthKeys)) {
    return `${name} returned an unexpected health schema`;
  }
  if (typeof value.ready !== "boolean" ||
      !isTimestampOrNull(value.lastErrorAt) ||
      !isTimestampOrNull(value.lastSuccessAt)) {
    return `${name} returned invalid health field types`;
  }
  return null;
}

export function validateWorkerHealthPayload({ bodyText, contentType }) {
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, reason: "Worker health response was not JSON" };
  }
  if (Buffer.byteLength(bodyText, "utf8") > maxPayloadBytes) {
    return { ok: false, reason: "Worker health response exceeded the safe payload limit" };
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: "Worker health response contained invalid JSON" };
  }

  if (!hasExactKeys(payload, topLevelKeys)) {
    return { ok: false, reason: "Worker health response returned an unexpected top-level schema" };
  }
  if (typeof payload.healthy !== "boolean") {
    return { ok: false, reason: "Worker health response omitted its health state" };
  }

  for (const name of [
    "controlPlane",
    "cupDelivery",
    "operationalAlerts",
    "operationsDelivery",
    "roleSync",
    "sessionReminders",
  ]) {
    const reason = validateDeliveryHealth(name, payload[name]);
    if (reason) return { ok: false, reason };
  }

  if (!hasExactKeys(payload.reliabilityScheduler, ["lastCompletedAt", "lastErrorAt", "lastStartedAt", "ready", "running"]) ||
      !isTimestampOrNull(payload.reliabilityScheduler.lastCompletedAt) ||
      !isTimestampOrNull(payload.reliabilityScheduler.lastErrorAt) ||
      !isTimestampOrNull(payload.reliabilityScheduler.lastStartedAt) ||
      typeof payload.reliabilityScheduler.ready !== "boolean" ||
      typeof payload.reliabilityScheduler.running !== "boolean") {
    return { ok: false, reason: "reliabilityScheduler returned an unexpected health schema" };
  }

  if (!hasExactKeys(payload.recruitmentDelivery, [...deliveryHealthKeys, "enabled"]) ||
      typeof payload.recruitmentDelivery.enabled !== "boolean") {
    return { ok: false, reason: "recruitmentDelivery returned an unexpected health schema" };
  }
  const recruitmentReason = validateDeliveryHealth(
    "recruitmentDelivery",
    {
      lastErrorAt: payload.recruitmentDelivery.lastErrorAt,
      lastSuccessAt: payload.recruitmentDelivery.lastSuccessAt,
      ready: payload.recruitmentDelivery.ready,
    },
  );
  if (recruitmentReason) return { ok: false, reason: recruitmentReason };

  if (!hasExactKeys(payload.outbox, ["healthy", "oldestPendingAt", "pending", "ready"]) ||
      typeof payload.outbox.healthy !== "boolean" ||
      !isTimestampOrNull(payload.outbox.oldestPendingAt) ||
      !Number.isSafeInteger(payload.outbox.pending) ||
      payload.outbox.pending < 0 ||
      typeof payload.outbox.ready !== "boolean") {
    return { ok: false, reason: "outbox returned an unexpected health schema" };
  }

  if (!Array.isArray(payload.shards) || payload.shards.length < 1 || payload.shards.length > 100) {
    return { ok: false, reason: "Worker health response returned an invalid shard set" };
  }
  for (const shard of payload.shards) {
    if (!hasExactKeys(shard, ["connected", "lastDispatchAt", "ready", "reconnects", "shardCount", "shardId"]) ||
        typeof shard.connected !== "boolean" ||
        !isTimestampOrNull(shard.lastDispatchAt) ||
        typeof shard.ready !== "boolean" ||
        !Number.isSafeInteger(shard.reconnects) ||
        shard.reconnects < 0 ||
        !Number.isSafeInteger(shard.shardCount) ||
        shard.shardCount < 1 ||
        shard.shardCount > 100 ||
        !Number.isSafeInteger(shard.shardId) ||
        shard.shardId < 0 ||
        shard.shardId >= shard.shardCount) {
      return { ok: false, reason: "Worker health response returned invalid shard health" };
    }
  }

  const requiredReady = [
    payload.controlPlane.ready,
    payload.cupDelivery.ready,
    payload.operationalAlerts.ready,
    payload.operationsDelivery.ready,
    payload.outbox.healthy,
    payload.outbox.ready,
    payload.reliabilityScheduler.ready,
    payload.roleSync.ready,
    payload.sessionReminders.ready,
    ...payload.shards.flatMap((shard) => [shard.connected, shard.ready]),
  ];
  if (payload.recruitmentDelivery.enabled) {
    requiredReady.push(payload.recruitmentDelivery.ready);
  }
  if (!payload.healthy || requiredReady.some((ready) => !ready)) {
    return { ok: false, reason: "Worker or durable queue health was not ready" };
  }

  return { ok: true, reason: null };
}
