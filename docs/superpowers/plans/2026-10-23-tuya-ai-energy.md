# Tuya.ai energy implementation plan

> Execute inline with tests before implementation; finish with a fresh code review.

**Goal:** Optional encrypted Tuya.ai credentials on existing QR accounts, unlocking confirmed cumulative energy counters in the existing monitoring pipeline.

**Architecture:** A read-only HTTP adapter uses official end-user endpoints and a persistent per-device model cache. A separate collector lane supplies the existing readings/intervals pipeline. QR measurements have precedence, then confirmed Tuya.ai counters, then explicitly enabled estimation. Account and measurement provenance remain separate from QR session health.

**Spec:** The user's detailed implementation request in this thread.

**Tech stack:** Existing TypeScript/Fastify/SQLite/React and Python Sharing adapter; no new runtime dependencies.

## Confirmed evidence and limits

- Existing Sharing normalization supports cumulative codes and sum-type add_ele (including scale 3 with missing units). Reuse its scale/unit/code policy; keep its MQTT behavior.
- Official sources checked 2026-10-23: https://tuya.ai/developer/docs and https://github.com/tuya/tuya-openclaw-skills/tree/master/tuya-smart-control/references . GET devices/all returns result.devices with device_id; detail returns properties; model contains a JSON-encoded model with services[].properties[], abilityId and typeSpec.
- Diagnostics retained in /tmp/tuya-energy-debug-eclROQ/end-user-statistics-heater.json contain filtered real properties and model metadata, not complete raw response envelopes. Reconstruct only the documented envelopes; explicitly document this fixture provenance. Observed forward_energy_total=370, DP 101, scale 3, unit kW·h.
- Hourly zeros remain unexplained. Do not call statistics endpoints or backfill history.
- No retained live key: previous diagnostic script used an in-memory prompt. Do not claim a fresh live comparison.

## Decisions

- Preserve this existing isolated worktree. The user's full specification authorizes implementation; no additional design approval cycle.
- Validate access by exact device ID intersection with current QR inventory. Limit reads to this account's known IDs. Shared device access does not prove sole account ownership; names are never credentials.
- Keep QR authoritative for inventory and already supported measurements. Tuya.ai failures never enable estimation over an established meter. Remove/replace credentials through revision checks so in-flight results cannot revive them.
- Persist baselines and metadata in SQLite. Change of provider, credential generation or model scale/unit starts a new series. Failure/offline/missing values break continuity; normal samples use the existing 15-minute gap bound and Warsaw proportional day attribution.
- HTTP defaults: fixed region hosts from official key prefix mapping; GET only, no redirects, 10-second timeout, paced requests, at most 3 attempts for 1199/429, bounded Retry-After. Cache models for 24h. Tuya.ai collection every 300 seconds, independent of QR state polling.

## Review focus

- A delayed result after key deletion or replacement must not update credentials, cache, status or consumption.
- Repeated QR inventories must not erase Tuya.ai baselines or make stale meter values appear fresh.
- Source switching, delayed MQTT reports and enabled estimation must never overlap measured intervals.
- Malformed/partial models and detail values must not silently produce zero or infer units.
- Restart, midnight/DST and partial failures must preserve conservative coverage and alerts.

## Tasks

### Task 1: Contract and transport
- [x] Extract sanitized diagnostics into fixtures with documented envelope reconstruction.
- [x] Add failing model/detail, region, GET-only, pacing, timeout and retry tests.
- [x] Implement server/tuya-ai.ts and shared normalization policy also consumed by bridge/tuya.py.
- [x] Run focused contract tests and existing Python bridge tests.

### Task 2: Persistence and energy
- [x] Add failing baseline 0.370→0.420=0.050, source precedence, gap/reset/offline/day boundary and restart tests.
- [x] Migrate SQLite credentials/revisions/cache and measurement provenance; reuse measured intervals and usage().
- [x] Implement account-scoped validation/save/delete and independent Tuya.ai collection with revision checks.
- [x] Verify encryption, failed replacement, deletion history, account isolation, stale in-flight requests, cache expiry and QR refresh independence.

### Task 3: API and interface
- [x] Add failing API credential lifecycle/security and bilingual rendering tests.
- [x] Add PUT/DELETE account Tuya.ai routes using current authentication/origin checks.
- [x] Add account form and independent status/last successful reading; source/freshness on device views, EN/PL strings.
- [x] Check browser flows with controlled fixtures if preview is available.

### Task 4: Verification
- [x] Run npm test, Python unittest suite, npm run build, whitespace/format checks.
- [x] Review with a fresh reviewer; address material findings with regression tests.
- [x] Document verified offline evidence, key setup, source arbitration, cache/retry policy and unverified Smart Life history.

## Final verification (2026-10-23)

- `npm test`: 111 passed, including all existing tests and the required 0.370 → 0.420 kWh delta, encrypted credential lifecycle, isolation, restart, source precedence, transport errors and timer independence.
- `.venv/bin/python -m unittest discover -s bridge`: 23 passed.
- `npm run build`: type checks, production frontend and server compilation passed.
- Prettier on changed supported files and `git diff --check`: passed.
- T3 browser preview with an isolated in-memory fixture: English/Polish account form, valid save, failed replacement preserving configuration, cancel, deletion, source/freshness and mobile layout checked. No live credentials or device commands used.
- Compiled production server smoke: frontend/health, authenticated API, login and session persistence after process restart passed against a temporary database.
- Fresh independent code review found three issues; all corrected with regressions: AI scheduling behind QR, partial authorization blocking siblings, and fixed device order starving the end of a slow collection pass.
- Container smoke could not run locally: Docker socket permission denied; passwordless sudo unavailable. Existing CI container smoke remains configured.
- No safely available live Tuya.ai key; no new device read or same-period Smart Life comparison claimed. Hourly history remains unverified and unused.

Implementation stays in the existing T3 worktree. The user subsequently requested a pull request against main.
