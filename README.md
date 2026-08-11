# Clubs Manager Status

Independent production monitoring and incident history for Clubs Manager.

- Public status page: <https://altugozturk.github.io/clubs-manager-status/>
- Product: <https://clubsmanager.xyz>
- Checks: every five minutes from GitHub Actions
- Incidents: opened and resolved automatically as GitHub Issues

The repository contains no application code, customer data, credentials, or private configuration. It uses the workflow-scoped `GITHUB_TOKEN`; no personal access token or third-party monitoring account is required.

## Coverage

- Clubs Manager public website
- Platform entry and canonical tenant route
- Wazzap eFC standalone site
- Discord interaction endpoint reachability and signature rejection

The Discord check intentionally sends an unsigned request and expects rejection. It proves endpoint reachability and the signature guard, not full signed command execution.

## Controlled incident test

Run **Monitor and publish status** manually and choose a monitor ID under `force_failure`. The workflow opens an incident and publishes it. Run it again with `none` to verify recovery and automatic issue closure.
