# Outdoor Temperature Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this existing isolated worktree. Steps use checkbox syntax.

**Goal:** Compare indoor daily temperatures to outdoor model history and a clearly distinct three-day forecast, with an address per apartment.
**Architecture:** Separate authenticated weather routes and cached provider adapters; persisted apartment locations; a summary/editor and an extended temperature series.
**Tech Stack:** Existing Fastify, SQLite, Zod, React, SVG and node:test.
**Spec:** docs/superpowers/specs/2026-11-14-outdoor-temperature-design.md

## Global Constraints

English/Polish; Europe/Warsaw calendar dates; data-first editing; no interpolated gaps; no new dependencies. Work in the existing worktree. Do not publish or deploy.

## Review Focus

- Zero/negative/missing outside values and no indoor readings: graph scale and gaps must remain valid.
- Location changes and delayed responses: old weather must never appear for another location.
- Failed save and background refresh: retain draft and support retry/cancel.
- Date rollover and DST: use calendar dates, exactly three days after today.
- Provider failures/malformed responses: retain indoor chart, finite timeouts and bounded caches.

## Task 1: Backend

- [x] Add API tests proving authenticated location save/read/clear, apartment isolation, invalid coordinates and provider failures.
- [x] Add adapter tests proving date mapping, forecast flags, missing and zero values, request coalescing and cache expiry.
- [x] Implement shared types, schema v11 home_locations, server/weather.ts and server/weatherRoutes.ts; inject the provider in app.ts.
- [x] Run the new backend tests.

## Task 2: UI

- [x] Add interaction tests for location drafts, failed/duplicate save, switching apartments and bilingual rendering; chart tests for dashed forecast and gaps.
- [x] Implement src/HomeLocation.tsx and src/OutdoorWeather.tsx; update Climate.tsx to extend only temperature, with legend, tooltip and daily details.
- [x] Integrate in pages.tsx and add translations/styles.
- [x] Run new UI tests and existing climate tests.

## Task 3: Verification

- [x] Document provider terms, data provenance and schema migration in README.
- [x] Run npm test and npm run build, inspect changes and fix material findings.

## Verification record

- `npm test`: 234 passed, 0 failed.
- `npm run build`: TypeScript and production build passed.
- Live Photon query returned five address candidates; Open-Meteo returned 17 days
  for a 14-day history, including today and three future forecast days, with no gaps.
- Read-only independent review found no significant defects. Suggested rollover/DST
  and provider failure/retry coverage was added and passed in the final suite.
- `git diff --check` passed. Changes remain in this worktree; no deployment.
