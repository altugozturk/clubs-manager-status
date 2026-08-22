import { mkdir, writeFile } from "node:fs/promises";
import { validateResponseBody } from "./response-body.mjs";
import { validateWorkerHealthPayload } from "./worker-health.mjs";

const checks = [
  {
    id: "website",
    name: "Clubs Manager website",
    detail: "Public product and legal pages",
    method: "GET",
    url: "https://clubsmanager.xyz/",
    expectedStatus: 200,
    marker: "Run the club from Discord",
  },
  {
    id: "platform",
    name: "Clubs Manager platform",
    detail: "App and authenticated workspace entry",
    method: "GET",
    url: "https://app.clubsmanager.xyz/",
    expectedStatus: 200,
    marker: "Sign in with Discord to manage your club.",
  },
  {
    id: "tenant",
    name: "Tenant club pages",
    detail: "Wazzap tenant wildcard hostname",
    method: "GET",
    url: "https://wazzap-efc.clubsmanager.xyz/",
    expectedStatus: 200,
    marker: "<title>Wazzap eFC — Club home · Clubs Manager</title>",
    forbiddenMarkers: ["Feed unavailable", "Squad unavailable"],
  },
  {
    id: "wazzap",
    name: "Wazzap eFC",
    detail: "Standalone club site",
    method: "GET",
    url: "https://wazzapefc.com/",
    expectedStatus: 200,
    marker: "Wazzap eFC",
  },
  {
    id: "discord-guard",
    name: "Discord interaction signature guard",
    detail: "Endpoint reachability and unsigned-request rejection",
    method: "POST",
    url: "https://app.clubsmanager.xyz/api/discord/interactions",
    expectedStatus: 401,
    marker: "Invalid request signature.",
    body: "{}",
  },
  {
    id: "discord-worker",
    name: "Discord worker and delivery queues",
    detail: "Gateway, control plane, outbox, and durable delivery processors",
    method: "GET",
    url: "https://discord-worker-production-0ecb.up.railway.app/healthz",
    expectedStatus: 200,
    validateResponse: validateWorkerHealthPayload,
  },
];

const repository = process.env.GITHUB_REPOSITORY ?? "altugozturk/clubs-manager-status";
const token = process.env.GITHUB_TOKEN?.trim() ?? "";
const forcedFailure = process.env.MONITOR_FORCE_FAILURE?.trim() ?? "";
const apiBase = `https://api.github.com/repos/${repository}`;
const checkedAt = new Date();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function github(path, options = {}) {
  if (!token) return null;

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${options.method ?? "GET"} ${path} returned ${response.status}.`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function runCheck(check) {
  const startedAt = performance.now();

  if (forcedFailure === check.id) {
    return {
      ...check,
      ok: false,
      status: null,
      durationMs: Math.round(performance.now() - startedAt),
      reason: "Controlled incident test",
    };
  }

  try {
    const response = await fetch(check.url, {
      method: check.method,
      body: check.body,
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Content-Type": "application/json",
        "User-Agent": "Clubs-Manager-Status/1.0 (+https://github.com/altugozturk/clubs-manager-status)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    const statusMatches = response.status === check.expectedStatus;
    const validation = check.validateResponse
      ? check.validateResponse({
          bodyText: body,
          contentType: response.headers.get("content-type") ?? "",
        })
      : {
          ...validateResponseBody(check, body),
        };

    return {
      ...check,
      ok: statusMatches && validation.ok,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      reason: statusMatches
        ? validation.ok
          ? null
          : validation.reason
        : `Expected HTTP ${check.expectedStatus}, received ${response.status}`,
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      status: null,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : "Monitor request failed",
    };
  }
}

function monitorMarker(id) {
  return `<!-- monitor-id:${id} -->`;
}

async function reconcileIncidents(results) {
  if (!token) return [];

  const issues = await github("/issues?state=all&per_page=100&sort=created&direction=desc");
  const incidentIssues = Array.isArray(issues)
    ? issues.filter((issue) => !issue.pull_request && checks.some((check) => issue.body?.includes(monitorMarker(check.id))))
    : [];

  for (const result of results) {
    const current = incidentIssues.find(
      (issue) => issue.state === "open" && issue.body?.includes(monitorMarker(result.id)),
    );

    if (!result.ok && !current) {
      const created = await github("/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[Incident] ${result.name}`,
          body: `${monitorMarker(result.id)}\nAutomated monitoring detected a service check failure.\n\n- **Service:** ${result.name}\n- **Detected:** ${checkedAt.toISOString()}\n- **Reason:** ${result.reason}\n- **HTTP status:** ${result.status ?? "No response"}\n\nThis issue will close automatically after a successful recovery check.`,
        }),
      });
      result.incidentUrl = created?.html_url ?? null;
    } else if (!result.ok && current) {
      result.incidentUrl = current.html_url;
    } else if (result.ok && current) {
      await github(`/issues/${current.number}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: `Recovered automatically at ${checkedAt.toISOString()} after a successful production check.`,
        }),
      });
      await github(`/issues/${current.number}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
    }
  }

  const refreshed = await github("/issues?state=all&per_page=30&sort=updated&direction=desc");
  return Array.isArray(refreshed)
    ? refreshed
        .filter((issue) => !issue.pull_request && checks.some((check) => issue.body?.includes(monitorMarker(check.id))))
        .slice(0, 8)
        .map((issue) => ({
          title: issue.title,
          state: issue.state,
          url: issue.html_url,
          createdAt: issue.created_at,
          closedAt: issue.closed_at,
        }))
    : [];
}

function renderHtml(results, incidents) {
  const allOperational = results.every((result) => result.ok);
  const title = allOperational ? "All monitored systems operational" : "Service disruption detected";
  const summary = allOperational
    ? "Every external production check passed during the latest run."
    : `${results.filter((result) => !result.ok).length} monitored service check${results.filter((result) => !result.ok).length === 1 ? " is" : "s are"} currently failing.`;
  const cards = results
    .map(
      (result) => `
        <article class="service ${result.ok ? "service--up" : "service--down"}">
          <div>
            <p class="service__name">${escapeHtml(result.name)}</p>
            <p class="service__detail">${escapeHtml(result.detail)}</p>
          </div>
          <div class="service__state">
            <span>${result.ok ? "Operational" : "Incident"}</span>
            <small>${escapeHtml(`${result.durationMs} ms`)}</small>
          </div>
        </article>`,
    )
    .join("");
  const incidentRows = incidents.length
    ? incidents
        .map(
          (incident) => `
            <li>
              <a href="${escapeHtml(incident.url)}">${escapeHtml(incident.title)}</a>
              <span>${incident.state === "open" ? "Investigating" : `Resolved ${new Date(incident.closedAt ?? incident.createdAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}`}</span>
            </li>`,
        )
        .join("")
    : "<li><span>No incidents recorded.</span></li>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="description" content="Independent service status for Clubs Manager.">
    <title>Clubs Manager Status</title>
    <style>
      :root { color-scheme: dark; --ink: #f6f2e9; --muted: #a9a59d; --line: rgba(255,255,255,.11); --lime: #c7f36b; --red: #ff846e; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #0a0b0a; color: var(--ink); font: 16px/1.55 Inter, ui-sans-serif, system-ui, sans-serif; }
      body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 80% 10%, rgba(199,243,107,.08), transparent 34%), linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px); background-size: auto, 100% 32px; }
      main { width: min(780px, calc(100% - 32px)); margin: 0 auto; padding: 64px 0 80px; position: relative; }
      header { display: flex; justify-content: space-between; gap: 24px; align-items: center; margin-bottom: 72px; }
      .brand { color: var(--ink); text-decoration: none; font-weight: 800; letter-spacing: -.035em; font-size: 21px; }
      .eyebrow { margin: 0 0 14px; color: var(--lime); text-transform: uppercase; letter-spacing: .14em; font-size: 12px; font-weight: 800; }
      h1 { max-width: 700px; margin: 0; font-size: clamp(42px, 8vw, 72px); line-height: .98; letter-spacing: -.065em; }
      .summary { margin: 24px 0 50px; color: var(--muted); font-size: 18px; max-width: 580px; }
      .stamp { color: var(--muted); font-size: 13px; white-space: nowrap; }
      .services { border-top: 1px solid var(--line); }
      .service { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 24px 0; border-bottom: 1px solid var(--line); }
      .service__name { margin: 0 0 3px; font-weight: 750; letter-spacing: -.02em; }
      .service__detail { margin: 0; color: var(--muted); font-size: 14px; }
      .service__state { text-align: right; }
      .service__state span { display: block; font-weight: 750; }
      .service--up .service__state span { color: var(--lime); }
      .service--down .service__state span { color: var(--red); }
      .service__state small { color: var(--muted); }
      section { margin-top: 56px; }
      h2 { margin: 0 0 18px; font-size: 23px; letter-spacing: -.035em; }
      ul { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
      li { display: flex; justify-content: space-between; gap: 18px; padding: 17px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
      li a { color: var(--ink); text-decoration-thickness: 1px; text-underline-offset: 3px; }
      .note { margin-top: 56px; padding: 20px 22px; border: 1px solid var(--line); border-radius: 12px; color: var(--muted); font-size: 14px; background: rgba(255,255,255,.025); }
      footer { margin-top: 44px; color: var(--muted); font-size: 13px; }
      footer a { color: var(--ink); }
      @media (max-width: 600px) { main { padding-top: 34px; } header { margin-bottom: 50px; } .service { align-items: flex-start; } .service__detail { max-width: 220px; } li { flex-direction: column; gap: 4px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <a class="brand" href="https://clubsmanager.xyz">Clubs Manager</a>
        <span class="stamp">Updated ${escapeHtml(checkedAt.toISOString().replace("T", " ").replace(".000Z", " UTC"))}</span>
      </header>
      <p class="eyebrow">Independent service status</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="summary">${escapeHtml(summary)}</p>
      <div class="services">${cards}</div>
      <section>
        <h2>Incident history</h2>
        <ul>${incidentRows}</ul>
      </section>
      <p class="note"><strong>Coverage note.</strong> The Discord guard check proves that the interaction endpoint is reachable and rejects unsigned requests; only Discord can produce a genuine signed interaction. The worker check reads a strict aggregate health schema for the Gateway, control plane, outbox, and durable delivery queues. It never reads messages, customer data, credentials, or private configuration.</p>
      <footer>Checks run every five minutes from GitHub Actions. <a href="https://github.com/${escapeHtml(repository)}">View monitor source and incidents</a>.</footer>
    </main>
  </body>
</html>`;
}

const results = await Promise.all(checks.map(runCheck));
const incidents = await reconcileIncidents(results);
const payload = {
  checkedAt: checkedAt.toISOString(),
  overall: results.every((result) => result.ok) ? "operational" : "incident",
  checks: results.map(({ id, name, detail, ok, status, durationMs, reason, incidentUrl }) => ({
    id,
    name,
    detail,
    ok,
    status,
    durationMs,
    reason,
    incidentUrl: incidentUrl ?? null,
  })),
  incidents,
};

await mkdir("dist", { recursive: true });
await Promise.all([
  writeFile("dist/status.json", `${JSON.stringify(payload, null, 2)}\n`),
  writeFile("dist/index.html", renderHtml(results, incidents)),
  writeFile("dist/.nojekyll", ""),
]);

console.log(JSON.stringify(payload, null, 2));
