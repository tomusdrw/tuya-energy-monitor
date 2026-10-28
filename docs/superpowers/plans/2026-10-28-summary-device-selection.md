# Summary Device Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure heating and temperature participation next to apartment summaries with independent saved selections.

**Architecture:** Add a default-on temperature boolean to devices and filter current/historical apartment temperature aggregation. Reuse one native dialog with immediate per-device updates from both summary cards and device details.

**Tech Stack:** Existing React/TypeScript, Fastify/Zod, SQLite and node:test; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-summary-device-selection-design.md`

## Global Constraints

- Named groups remain in issue #15; humidity selection is outside this change.
- Preserve individual readings, energy selection/alerts and observation ownership.
- Include offline/absent known temperature sensors in the picker.
- Localize all new UI in English and Polish and support keyboard/mobile use.

## Review Focus

- Migration/restart preserves existing selections and defaults temperature participation on.
- Excluded, ignored, stale and temporarily missing sensors remain independently configurable.
- Empty selection is missing data; temperature exclusion does not affect humidity or energy.
- Failed saves retain prior selections; rapid saves and modal dismissal do not target another device/home.
- History and dashboard use current selection while retained observations keep their original apartment.

### Task 1: Saved temperature selection and aggregate filtering

**Files:** `server/db.ts`, `server/app.ts`, `server/energy.ts`, `server/climate.ts`, `shared/types.ts`, `tests/climate.test.ts`, `tests/device-monitoring.test.ts`, migration test fixtures/helpers.

**Interfaces:** DeviceView exposes `temperatureIncluded: boolean` and `hasTemperature: boolean`; PUT `/api/devices/:id` accepts optional `temperatureIncluded` alongside existing fields.

- [ ] Add failing tests for current/history exclusion, unchanged individual readings and humidity, empty selection, persistence, capability after missing readings, API validation/authentication and migration defaults.
- [ ] Run `node --import tsx --test tests/climate.test.ts tests/device-monitoring.test.ts`; confirm new assertions fail before implementation.
- [ ] Add schema v10, strict endpoint validation, capability metadata and temperature-only filtering.
- [ ] Update older migration reconstruction tests and run `npm test`; expect all tests passing.
- [ ] Commit backend changes and tests.

### Task 2: Shared picker and participation displays

**Files:** new `src/DeviceSelection.tsx`, `src/locales/selection.ts`, `tests/device-selection.test.ts`; modify `src/Climate.tsx`, `src/DeviceList.tsx`, `src/pages.tsx`, locales, styles and existing UI tests.

**Interfaces:** `DeviceSelection({homeId, mode: 'energy' | 'temperature', onSaved})` opens the shared picker; a separately exported selection list renders candidate devices for SSR tests.

- [ ] Add failing localized render tests for picker candidates/selected states, zero/stale readings, passive list participation and removal of switches.
- [ ] Run the focused UI tests and confirm the intended failures.
- [ ] Implement accessible native dialog, immediate saves with busy/error state and parent refresh, controls on summaries, shared shortcuts on device details, and responsive CSS.
- [ ] Run focused UI tests and `npm run build`; expect success.
- [ ] Commit UI changes and tests.

### Task 3: Integration verification and PR

**Files:** `README.md` and documentation above; review the whole branch.

- [ ] Update README for selection behavior, current-selection history and schema v10.
- [ ] Run full Node tests, Python bridge tests, build and formatting/diff checks.
- [ ] Exercise both pickers against a seeded local app in the collaborative browser: independent selections, failures, empty selection, stale sensors, reloading, keyboard focus, mobile layout and detail shortcuts.
- [ ] Obtain one independent whole-branch review and resolve important findings with regression coverage.
- [ ] Commit final changes, push the feature branch, open and link the PR to this thread.
