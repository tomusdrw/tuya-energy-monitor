# Home Climate Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show current temperature and humidity aggregates and daily history per home from available devices.

**Architecture:** Normalize cloud readings in the Python bridge; persist humidity and an independent climate timestamp in SQLite v8. Aggregate server-side and expose the same summary in home detail and overview. Reuse React components and existing i18n.

**Tech Stack:** Python, TypeScript, Node SQLite, React, existing Node/Python test runners.

**Spec:** `docs/superpowers/specs/2026-10-23-home-climate-design.md`

## Global constraints

- No new dependencies, device commands or additional cloud requests.
- Read every five minutes; exclude observations older than 15 minutes.
- All present online sensors count independently of energy inclusion/ignore settings.
- Celsius and percent; explicit scale/unit metadata; current readings only.
- English and Polish interface; missing data stays unavailable.

## Review focus

- Fast energy polling must not make old climate values current.
- Temperature/humidity denominators differ; zero remains a valid reading.
- Invalid or absent fields in a new snapshot must clear previous values.
- Identical remote IDs in separate accounts must not mix values.
- v7 data has no provable climate timestamp and stays unavailable until refreshed.

### Task 1: Adapter and API

- [x] Add failing Python adapter tests and `tests/climate.test.ts` integration tests covering the spec and review focus.
- [x] Run the focused tests and inspect expected missing-behavior failures.
- [x] Add current climate normalization in `bridge/tuya.py`; preserve existing energy and estimator contracts.
- [x] Migrate `server/db.ts` to v8; update snapshot ingestion and device/home views in `server/energy.ts`.
- [x] Add typed `ClimateMetric`/`ClimateSummary` and `server/climate.ts` aggregation. API fields: home `climate`, device `humidity` and `climateObservedAt`; retain current `temperature`.
- [x] Persist valid observations with historical home membership, expose `HomeDetail.climateHistory` for the existing range, and test daily equal-device weighting, missing days, persistence, home movement and Warsaw midnight/DST.
- [x] Run adapter, climate and existing regression tests.

### Task 2: Interface

- [x] Add localized rendering tests for filled, partial and empty climate summaries and device values.
- [x] Implement `src/Climate.tsx` and `src/locales/climate.ts`, integrate home cards, home page, device list and detail; add daily temperature/humidity charts and accessible readings, with responsive styles.
- [x] Document cadence, freshness, weighting, supported fields and migration in README.
- [x] Run all Node/Python tests, formatting checks and build; inspect desktop/mobile preview using synthetic data.
- [x] Review the complete diff and address concrete defects.

## Verification

- Node suite: 149 passed; Python bridge suite: 35 passed.
- Type checks, production build, Prettier and git diff checks passed.
- Synthetic browser preview checked at 1280, 390 and 320 px; no horizontal overflow or console errors. The 30-day range and accessible daily readings were exercised.
- Independent read-only review found no Critical/Important defects. Clarified supported metadata wording in README. Physical sensor freshness and unsupported live device schemas cannot be established without live payloads; the UI explains cloud-read timestamps.
