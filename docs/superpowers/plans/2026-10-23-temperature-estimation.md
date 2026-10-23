# Temperature Estimation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Estimate thermostat heating from current and target temperature when relay state is unavailable.

**Architecture:** Add temperature metadata to status fields and a nullable persisted temperature mapping to estimation configuration. Reuse existing runtime integration and expose method selection in the current form.

**Tech Stack:** Python bridge, TypeScript, SQLite, React.

**Spec:** `docs/superpowers/specs/2026-10-23-temperature-estimation-design.md`

## Global Constraints

- Normalize each temperature using its own declared scale and unit.
- No device commands, live account changes, historical backfill, or dependencies are required.
- Existing energy integration and its 180-second continuity limit stay in use.

## Review Focus

- Unequal temperature scales must not reverse the comparison.
- Missing readings and missing configured switches must break continuity.
- Full reads with changed metadata must invalidate a stale mapping.
- Existing relay settings, historical estimates, and measured-source precedence survive migration.
- A newly discovered temperature-only device must allow enabling estimation in PL and EN.

### Task 1: Temperature metadata and comparison

Files: `bridge/tuya.py`, `bridge/test_tuya.py`, `shared/types.ts`, new `shared/temperature.ts`, new `tests/temperature.test.ts`.

Interfaces: `TemperatureField {code, scale, unit}`, `TemperatureMapping {current, target, switchCode}`; `suggestTemperatureMapping(fields)` returns a mapping or null; `temperatureHeatingState(fields, mapping)` returns 1, 0, or null.

- [x] Add failing tests for scale/unit normalization, aliases, equality, switches, invalid/missing inputs and incompatible metadata.
- [x] Run targeted Python/TypeScript tests and verify expected failures.
- [x] Implement metadata extraction, discovery and comparison.
- [x] Rerun targeted tests.

### Task 2: Configuration, integration and UI

Files: `server/db.ts`, `server/estimation.ts`, `shared/types.ts`, `src/EstimationForm.tsx`, locale files, `README.md`, estimation/API/UI tests.

- [x] Add failing integration tests for temperature-derived kWh, configuration persistence, missing reads, baseline changes and migration; add rendered form tests.
- [x] Add schema-v7 nullable temperature configuration with legacy relay defaults; retain main's v6 ignored-device migration.
- [x] Extend estimation validation, observations and discovery; retain configuration on fast polls and break on metadata changes.
- [x] Add selectable method and detected temperature fields to the form; explain estimation in PL/EN and README.
- [x] Run `npm test`, `python -m unittest discover -s bridge`, and `npm run build`.

### Task 3: Review and verification

- [x] Review the entire diff for the listed failure modes with a fresh reviewer.
- [x] Resolve material findings with regression coverage.
- [x] Report exact checks and any limitations. Leave changes in the current isolated worktree for review.

## Verification record

- `npm test`: 141 passed after integrating main (including migration from the released v6 schema).
- `.venv/bin/python -m unittest discover -s bridge`: 31 passed.
- `npm run build`: passed (both TypeScript configurations and Vite).
- Browser smoke test with an in-memory database: temperature-only device selected the method by default; Polish form enabled/saved it; reload retained configuration; 21°C versus 22°C produced state `on` and positive estimated kWh.
- Independent review found conversion roundoff at equal C/F temperatures and missing-reading metadata invalidation. Both reproduced with failing tests, fixed, and verified with the full suites.
- Scope choice: preserve saved relay configurations and measured-source precedence; suggest temperatures when a recognized relay mapping is unavailable. No live accounts were changed.
