# Energy Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete first self-hosted monitoring application while explicitly representing unsupported thermostat energy.

**Architecture:** React consumes an authenticated Fastify JSON API. SQLite stores account metadata, encrypted tokens, counters, valid consumption intervals and an email outbox. A bounded Python SDK subprocess handles Tuya requests; a serial background loop collects, evaluates rules and delivers email.

**Tech Stack:** Node 24, TypeScript, React, Vite, Fastify, node:sqlite, Python Tuya sharing SDK.

**Spec:** docs/superpowers/specs/2026-10-16-energy-monitor-design.md

## Global Constraints

- Polish interface, Europe/Warsaw calendar, single owner; no device commands.
- Five-minute collection; fifteen-minute freshness/maximum interval.
- Missing energy is never zero. Only validated cumulative counters are used.
- One Docker container, SQLite volume, public MIT repository, no secrets in git.
- No default threshold; anomaly window 14 days, minimum 7 comparable days, 50% and 3 kWh increase; 95% coverage; 30-minute minimum elapsed time.
- No live emails in verification. Never retry uncertain delivery beyond 24 hours.

## Review Focus

- Counter resets, offline snapshots and long gaps must not invent consumption (Task 1).
- DST/calendar boundaries and changed monitored-device membership must not corrupt comparisons (Tasks 1, 4).
- Missing devices/accounts must remain visible and cannot turn into reassuring zeros (Tasks 2, 3).
- Authentication, malformed requests and refreshed credentials must not expose tokens or corrupt saved connections (Task 2).
- Retries/restarts must not duplicate mail, and summaries must work without alerts (Task 4).

### Task 1: Durable measurements and energy calculations

**Files:** package.json, tsconfig*.json, vite.config.ts, shared/types.ts, server/db.ts, server/energy.ts, server/crypto.ts, tests/energy.test.ts.

**Interfaces:** Produces `openDatabase(path): DatabaseSync`, `ingestSnapshot(db, accountId, snapshot, now): void`, `getOverview(db, now, days): Overview`, `getHome(db, id, now, days): HomeDetail | null`. Shared response types live in shared/types.ts. Internally intervals carry device_id/start/end/kwh.

- [ ] Write tests for baseline/delta, reset, duplicate, offline, gap, unsupported, midnight and DST; run `npm test` expecting failure before implementation.
- [ ] Implement schema, encrypted secrets and interval-based aggregation; run `npm test` expecting pass.
- [ ] Commit the tested foundation.

### Task 2: Authenticated API and cloud connector

**Files:** server/config.ts, server/app.ts, server/tuya.ts, server/collector.ts, server/main.ts, bridge/tuya.py, bridge/requirements.txt, scripts/import-session.ts, tests/api.test.ts, bridge/test_tuya.py.

**Interfaces:** Consumes Task 1. Produces `createApp(config, dependencies?): Promise<FastifyInstance>`, `callTuya(operation, payload): Promise<any>`, `Collector.sync(): Promise<void>`. `Config` defines origin, password, dataDir, encryptionKey, Python path and Resend vars. QR start/confirm require authenticated same-origin requests. Public API types match shared/types.ts.

- [ ] Test unauthorized reads, wrong password, origin rejection, logout, validation and secret-free responses; run before route implementation and expect failure.
- [ ] Implement authentication, account connect/reconnect, apartment rules, device inclusion and serial collection. Test Python classification of counters and unsupported/incremental/offline devices with unittest before filling adapter behavior.
- [ ] Run `npm test` and `python -m unittest discover -s bridge` expecting pass; commit.

### Task 3: Responsive monitoring UI

**Files:** index.html, src/main.tsx, src/App.tsx, src/api.ts, src/components.tsx, src/styles.css.

**Interfaces:** Consumes typed API from Tasks 1–2. Hash routes: overview, home/:id, device/:id, accounts, alerts, settings. Form mutation invalidates displayed data. No secrets in localStorage.

- [ ] Implement accessible navigation, login, overview, apartment/device histories, rules, account QR flow and operational states using real API.
- [ ] Run `npm run build` expecting typecheck and Vite success; exercise login/navigation/save/empty states through T3 preview on desktop/mobile.
- [ ] Commit UI.

### Task 4: Alerts, weekly summaries and durable delivery

**Files:** server/notifications.ts, tests/notifications.test.ts; modify server/collector.ts and server/app.ts.

**Interfaces:** Consumes Task 1 reports. Produces `evaluateNotifications(db, now): void`, `deliverPending(db, config, now, transport?): Promise<void>`. Outbox key uniquely scopes rule/home/date or weekly period. Persist payload before request.

- [ ] Write tests for per-home daily dedupe, comparable rolling baseline, insufficient/changed coverage, weekly no-alert report, retry identity and 24h uncertain cutoff; run expecting failure.
- [ ] Implement notification evaluation, escaped text emails, bounded Resend fetch/retries and status display; run full tests expecting pass.
- [ ] Commit.

### Task 5: Reproducible deployment and end-to-end verification

**Files:** Dockerfile, compose.yaml, .dockerignore, .env.example, .github/workflows/ci.yml, README.md; optional script for separate QA fixture.

**Interfaces:** Container listens on 3000, persists /data; GET /healthz only reveals process health. Environment documented. Import CLI consumes saved session path outside repo and encrypts before storage.

- [ ] Document local and Docker startup, account connection, energy semantics, email setup, backups, limitations and CI image tags.
- [ ] Run full tests/typecheck/build, Docker build and authenticated container smoke test, then preview real account metadata without fabricating history.
- [ ] Review whole branch with a fresh reviewer, resolve important issues with regressions and rerun affected checks.
- [ ] Commit and hand over runnable application and remaining deployment variables.
