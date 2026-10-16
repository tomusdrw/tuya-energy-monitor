# Heating Runtime Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicitly labelled heating-runtime energy estimates to existing devices, apartment totals and alerts.

**Architecture:** Extend SQLite with estimation configuration, observations and interval provenance. Reuse the cloud adapter for batched 60-second state polling and the existing 300-second inventory collection. The current interval reporting pipeline combines measured and estimated kWh while preserving coverage and comparable configuration revisions.

**Tech Stack:** Existing Node/TypeScript, React, SQLite and Python Tuya sharing SDK; no added runtime dependencies.

**Spec:** docs/superpowers/specs/2026-10-16-runtime-estimation-design.md

## Global Constraints

- Poland calendar; cloud read-only; no LAN access or guessed rated powers.
- Status polling 60 seconds; full inventory 300 seconds; estimation maximum gap 180 seconds.
- Unknown is not OFF; first observation is a baseline; previous known state owns the interval.
- Valid cumulative meter takes precedence. Config revisions preserve historical kWh and isolate anomaly baselines.
- ON/OFF sets are typed, nonempty and disjoint. No automatic inference from switch, temperature or mode.
- All aggregate/chart/email estimates are visibly labelled, with measured/estimated split.
- No actual emails or heater commands in verification; preserve existing data and secrets.

## Review Focus

- Restart or missed cloud response while relay is ON must not extrapolate indefinitely (Task 1).
- Power/mapping changes or discovery of a real meter must not double-count or reprice history (Tasks 1, 3).
- Cloud field omission/type changes and batch omissions must become unknown promptly (Task 2).
- Daily/DST boundaries and heterogeneous sources must agree in UI, history and email (Tasks 1, 3).
- Enabled estimates without a valid relay signal must remain unknown, including after configuration saves (Tasks 1–3).

### Task 1: Persist configuration and integrate heating observations

**Files:** server/db.ts, new server/estimation.ts, server/energy.ts, server/app.ts, shared/types.ts, tests/estimation.test.ts, tests/api.test.ts.

**Interfaces:** `configureEstimation(db, deviceId, config, now)`, `recordHeatingState(db, deviceId, fields, online, now)` and `ingestHeatingSnapshot(db, accountId, states, requestedIds, now)`; device detail exposes configuration, suggestion, status fields and recent observations. Intervals carry source/on_ms/config_revision; `usage` adds measuredKwh/estimatedKwh/heatingHours/estimated count and accepts a comparable-current-configuration option.

- [ ] Add failing tests for 2 kW × 30 minutes = 1 kWh, OFF observed zero, unknown/no power missing, duplicates, gaps, reopen DB, config/source changes, mixed totals, midnight/DST and v1 migration; verify RED.
- [ ] Implement additive transactional schema migration, typed config validation, state integration and source-aware aggregation; verify GREEN.
- [ ] Add protected PUT /api/devices/:id/estimation; regression-test invalid power, overlapping states, authentication and saving without rewriting old data.
- [ ] Run npm test and typecheck; commit.

### Task 2: Expose status fields and collect enabled estimators every minute

**Files:** bridge/tuya.py, bridge/test_tuya.py, server/collector.ts, server/config.ts, server/energy.ts, tests/collector.test.ts, shared/types.ts.

**Interfaces:** Adapter `read` includes safe scalar fields with enum/boolean metadata. Adapter `states` accepts session/deviceIds and returns raw current fields plus online flags; missing requested devices remain absent and must break continuity. Collector serializes full/state calls and token updates; configuration declares statusPollSeconds=60.

- [ ] Add failing Python tests for enum/boolean/numeric field preservation, safe field filtering and batched state responses; add collector tests for 60/300 cadence, missing/offline/failed reads, refreshed tokens and no concurrent sync; verify RED.
- [ ] Add batched status reads (20 IDs per request), reuse existing credentials and preserve refresh handling on error; integrate estimator-only polling without fetching all specifications every minute.
- [ ] Run Node/Python tests and build; commit.

### Task 3: Surface estimates and include them in alerts

**Files:** src/EstimationForm.tsx, src/pages.tsx, src/App.tsx, src/components.tsx, src/styles.css, server/notifications.ts, tests/notifications.test.ts, tests/dashboard.test.ts, README.md.

**Interfaces:** UI consumes expanded EnergyStats/HistoryPoint/DeviceDetail. Notification comparisons use current source/revision and per-device coverage; thresholds/weeklies preserve historical stored totals and label estimated contributions.

- [ ] Add failing regressions for estimated threshold/weekly text, mixed sums, source/config changes excluding incomparable baselines, and rendered source/unknown labels; verify RED.
- [ ] Build per-device power/mapping controls, current-state and runtime display, source-aware chart/cards and diagnostic observations. Keep advanced DP setup understandable and exact.
- [ ] Include estimates in existing anomaly/threshold/weekly rules and document formula, gap policy, poll approximation, configuration and cloud/local limitations.
- [ ] Run full tests/build; back up/migrate/restart real preview; verify desktop/mobile save, states and account health. Test Docker login/restart.
- [ ] Request one independent final review, fix important findings with regressions, push and update existing PR; verify CI image publication.
