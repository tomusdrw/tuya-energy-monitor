# Native power measurement implementation plan

**Goal:** Automatically derive consumption for devices such as 26/1 F1 from their reported active power, without configuring a rated heating power.

**Design:** Prefer cumulative/incremental kWh, then validated active power (`cur_power`, `power`, `work_power`), then configured relay estimates. Integrate consecutive power samples by the trapezoidal rule, at the existing 60-second polling cadence with a maximum 180-second gap. Persist observations and metadata so short restarts preserve continuity. Missing, invalid, offline, omitted and failed observations break continuity. Field, scale and source changes establish a new baseline. Do not infer active power from current and voltage, invent backfill, or extrapolate beyond the final observation.

**Alternatives:** Fixed rated-power estimates require manual configuration and miss variable loads. Current × voltage is insufficient to determine active AC power without a power factor. Native energy counters remain preferable when available. Power integration is the selected implementation assumption because the request identifies actual power readings.

**Presentation:** Track power-derived kWh separately from meter kWh and relay estimates, including history, coverage and notifications. Mark sampled calculations with ≈ and explain that they use measured power. A native power device needs no heating-power form. Keep English/Polish translations consistent. Preserve historical values and explicit device inclusion choices.

**Stack:** Existing Python Tuya adapter, TypeScript/Fastify, SQLite and React. No new dependencies.

## Tasks

- [x] Adapter tests first: validate W/kW scaling, standard unitless `cur_power` only at scale 1, reject conflicting units/invalid readings, preserve meter precedence. Return a validated power field descriptor even when its current reading is missing.
- [x] Backend tests first: SQLite migration and persisted power observations; full and fast polling integration; zeros, gaps, failures, duplicate/out-of-order data, changes of source/scale, midnight allocation and historical preservation. Test collection without an enabled estimator.
- [x] Presentation tests first: separate power totals and source labels in English/Polish, visible instantaneous W and automatic-use explanation, no manual power requirement. Include alert totals and chart data; update README.
- [x] Verify `npm test`, `python -m unittest discover -s bridge`, `npm run build`; review the final diff and fix confirmed defects.

## Review focus

- A metadata-only power field must not treat an absent value as zero or fall back to rated-power estimates.
- A meter appearing after power integration must establish a baseline and never overlap existing energy.
- A failed request or omitted device within 180 seconds must still break continuity.
- A schema/scale change must not reinterpret a prior power observation.
- Native power history must remain distinct from relay-derived heating hours, including when the current source changes.

## Execution record

Implementation stays in the existing isolated T3 worktree. The user's request authorizes the feature; implementation choices above are assumptions made to fulfill that request. No deployment or live account changes are part of this work.

Verification: all 94 TypeScript tests and 28 Python tests passed; production build and typecheck passed. A read-only independent review found one static-rendered chart tooltip issue, reproduced by a failing assertion and fixed. Browser verification on synthetic data confirmed Polish native-source labels, current watts, chart bars, no rated-power inputs and no horizontal overflow. Live device 26/1 F1 was not queried.
