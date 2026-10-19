# Device field discovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Configure heating estimation by selecting discovered fields and states, without typing field codes or JSON.

**Architecture:** Reuse inventory metadata and the serialized collector for an authenticated refresh endpoint. Share typed choice/suggestion helpers between the server and React form. Keep existing saved configurations and energy accounting semantics.

**Tech stack:** Existing React/TypeScript, Fastify, SQLite, Python Tuya adapter.

**Spec:** User-approved description in this conversation: automatic available fields/states, recognized heating suggestions, clickable heating/idle assignment, rediscovery, power input, explicit missing-signal feedback. User authorized implementation without further questions.

## Global constraints

- Read-only Tuya requests; reuse the existing token owner and collection queue.
- English and Polish UI; exact typed values remain distinct.
- Do not automatically enable estimation or infer relay activity from a thermostat switch.
- Preserve saved mappings, unsaved edits, and historical consumption.
- Execute inline in the existing T3 worktree; leave changes available for review.

## Review focus

- Missing enum metadata: only observed choices and boolean domains are offered, with no invented numeric states.
- Identical-looking string/number/boolean values retain their original types.
- Rediscovery failures and omitted devices must not report old data as newly discovered.
- Refreshing options must not discard saved values or in-progress edits.
- Switching fields must not carry the old field's heating/idle mapping across.

## Task 1: Discovery data and refresh API

Files: `shared/estimation.ts`, `server/estimation.ts`, `server/app.ts`, `bridge/tuya.py`, corresponding tests.

Interfaces: typed `statusChoices(field)` and `suggestHeatingMapping(field)` helpers; `POST /api/devices/:id/probe` returns `EstimationView` after awaiting inventory refresh.

- [x] Add failing tests for metadata fallback, typed choices and conservative suggestions, authenticated refresh success/failure.
- [x] Run targeted tests and confirm the missing behavior.
- [x] Implement helpers, metadata fallback and refresh using `Collector.sync()`.
- [x] Verify targeted TypeScript and Python tests.

## Task 2: Selection-based configuration

Files: `src/EstimationForm.tsx`, `src/styles.css`, `src/locales/estimation.ts`, `tests/pages-i18n.test.ts`, `README.md`.

Interfaces: use Task 1 helpers and refresh endpoint; existing configuration PUT stays unchanged.

- [x] Add failing render tests for field/state selectors, saved missing values, no-signal feedback.
- [x] Implement field selection, per-value heating/idle/unknown selectors, suggested initial mapping and refresh feedback.
- [x] Preserve edits on refresh; clear/recommend mapping when switching fields; retain saved absent fields/values.
- [x] Update English/Polish copy, responsive styling and configuration documentation.

## Task 3: Verification and review

- [x] Run `npm test`, `python -m unittest discover -s bridge`, `npm run build` and formatting checks.
- [x] Exercise save, field changes, typed values, rediscovery and failure feedback in the collaborative browser using synthetic data.
- [x] Request an independent code review, address material findings, and record final evidence.

## Execution notes

- Existing linked worktree verified; no extra checkout needed.
- Ruling: user explicitly requested no further questions, so proceed inline without a second approval gate.
- Ruling: rediscovery reuses full inventory refresh, which already retrieves specifications; avoid introducing a second credential-refresh path.

## Final verification

- `npm test`: 84 tests passed.
- `.venv/bin/python -m unittest discover -s bridge`: 19 tests passed.
- `npm run build`: type checks and production build passed.
- Browser: confirmed suggested initial mapping, save payloads, typed scalar values, field switching, preserved edits on rediscovery, failed rediscovery feedback, Polish copy and 390 px layout without horizontal overflow. Synthetic Tuya responses only; no live device commands.
- Independent review identified incomplete enum metadata and a suggested mapping changing after power/enable edits. Both reproduced and fixed. Also fixed a concurrent-inventory refresh race with a regression test.
- Baseline Python environment lacked the SDK; installed the existing pinned requirements in the ignored local `.venv`. No dependency versions changed.
