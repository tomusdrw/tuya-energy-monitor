# Heating runtime energy estimation

The owner wants practical anomaly detection for resistive electric heating whose
thermostats expose a relay/heating state but no energy counter. Extend the current
app, accounts, apartment totals, notifications and Docker deployment. Do not build
a second monitoring service. Estimate kWh as configured kW multiplied by observed
heating hours. This is an estimate, never billing-grade metering.

## Scope and constraints

- Existing account credentials, names, homes and IDs are reused. The owner can
  configure each device's rated heating power, status code, and explicit ON/OFF
  values in its detail page. The owner's follow-up requests an editable default
  within 1–1.5 kW per thermostat. Builder choice: prefill 1.25 kW for thermostats
  without configured power, label it as an assumption, and preserve saved values.
  Estimation remains disabled until a real heating signal is configured.
- Suggest recognized heating-state fields (for example work_state with
  heating/idle), but do not infer relay activity from thermostat power switch,
  selected mode, temperature or setpoint. Manual field mappings remain possible.
- Current recorded API responses do not contain a relay status for the owner's
  thermostats. A missing/unrecognized field stays unknown; implementing the
  method does not manufacture that missing signal.
- The owner previously said LAN access to the apartments is unavailable. Use the
  existing read-only Tuya sharing cloud integration. Builder choice: poll enabled
  estimators in batches every 60 seconds through the SDK's device-detail endpoint,
  retaining full inventory/counter refresh every 300 seconds. No new local keys,
  tinytuya, MQTT worker or control commands in this version. Persistent push is a
  future alternative if needed; polling is explicitly acceptable in the request.

## Runtime and data semantics

- A configurable field has exact typed scalar ON and OFF sets, nonempty and
  disjoint. Unknown values, absent fields, missing/offline devices mean unknown,
  never OFF. Only safe scalar status metadata is exposed in the authenticated UI.
- Persist each heating observation, its raw value, timestamp and configuration
  revision. For two valid online observations at increasing timestamps no more
  than 180 seconds apart, attribute the elapsed time to the previous state. An
  ON→OFF change therefore closes an ON interval at its observation time. OFF→ON
  closes a zero-energy observed interval. This polling approximation can miss
  short cycles; document it clearly.
- First observation is a baseline. Duplicates/out-of-order observations do not
  count twice. Unknown/offline observations break continuity. Long outages are
  missing intervals rather than extrapolated energy. A short restart can bridge
  at most the same 180-second limit using persisted state; longer downtime cannot.
- Store interval kWh, source (measured/estimated), ON milliseconds and config
  revision. Existing intervals migrate as measured without recalculation. Daily
  boundaries and DST use existing Europe/Warsaw interval splitting.
- Config changes start a new revision, break continuity and affect only future
  estimates. Past kWh remains calculated using its original power. Comparable
  anomaly history requires the same current source/revision for every device.
- A validated cumulative meter always takes precedence. Never add a runtime
  estimate on top of that same device's measured consumption. Source changes
  break continuity in both directions.

## Reports and interaction

- Existing totals include measured and estimated energy once the owner enables
  estimation; report both components separately, mark sums containing estimates
  with ≈, and retain coverage/missing-data warnings. Charts and history expose
  the same source split. State/source configuration must not retrospectively
  alter stored estimates.
- Device detail includes rated power and mapping form, suggested mapping when
  available, current heating state, daily and cumulative observed ON time, and
  recent raw observations for diagnostics. Show available status fields and
  current values even while estimation is disabled, so the owner can choose a
  real relay signal. The power default is an explicit assumption, not a measured
  value or relay confirmation.
- Existing individual daily thresholds, rolling anomalies and weekly summaries
  include estimates and clearly label them. Preserve outbox/deduplication rules.
  No extra same-weekday anomaly subsystem is needed: the prompt gives examples,
  and the existing configurable baseline plus absolute thresholds satisfies it.

## Verification and migration

Test additive migration of existing data; known ON/OFF integration; unknown,
offline, missing and long-gap handling; restarts and duplicate/out-of-order
events; power/mapping/source changes; midnight/DST; exact typed mappings;
mixed source totals and alert descriptions; insufficient/revised baselines;
cloud batching and omitted devices; API validation/authentication; UI save and
explicit unknown/no-signal states. Test synthetic fixtures separately from real
data. Preserve encrypted account sessions; back up the local SQLite DB before
the migration. No heater commands or live emails during verification.
