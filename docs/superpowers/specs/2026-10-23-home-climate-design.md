# Home temperature and humidity

Add a current summary and history of environmental readings for each Tuya home. The user explicitly selected both current values and history. Each metric shows the arithmetic mean, minimum, maximum, contributing device count and oldest contributing cloud-read time. Each device contributes once per metric, with equal weight. Missing values are not zero.

## Approaches

- Derive climate values from energy status and freshness: smaller storage change, but fast power polling could falsely freshen an old environmental measurement.
- Store normalized current climate readings with a dedicated read timestamp: chosen implementation default. Reuses the five-minute full inventory read without additional cloud requests, independent of energy sources and monitoring settings.
- Store climate time series and charts: added at the user's request, using the same full inventory observations.

## Data and behavior

Recognize known current-temperature and current-humidity fields using the device's numeric type, explicit scale and unit. Convert Fahrenheit to Celsius, and retain humidity as percent (0–100). Never use target temperature/humidity, arbitrary numeric DPs or guessed scales. Prefer one valid current reading per metric on each device, including metadata supplied in functions. Standard sensor fields are documented at https://developer.tuya.com/en/docs/iot/zigbee-temperature-and-humidity-sensor-function-definition?id=K9tp1654imwjp.

All present, online devices with valid observations at most 15 minutes old contribute, including devices excluded or ignored for energy monitoring. A temperature-only device still contributes to temperature; humidity uses its own denominator. Aggregate separately for each home/account. Offline, absent, invalid, missing or old readings are unavailable. Poll time denotes when the cloud was queried, not the sensor's measurement time. A fast energy poll must not renew climate freshness.

Add nullable humidity and climate observation timestamp columns in schema v8. Do not backfill timestamps for old temperature values. Retain the existing normalized temperature column. Full snapshots replace climate values, including nulls for missing readings; existing duplicate/out-of-order handling applies. New server input defaults humidity to null for older snapshots.

Persist valid online observations in `climate_observations`, with device, home at observation time, timestamp, Celsius and percent. A unique device/timestamp prevents duplication. Historical home membership does not change when a device moves. Historical values survive devices going offline or disappearing. Reuse the existing 7/14/30-day range and Europe/Warsaw day boundaries, including DST. For each day and metric, calculate each device's sample mean first, then average those device means with equal weight; min/max cover actual observations. Show device and sample counts so sparse days are not presented as complete. Do not interpolate gaps or backfill earlier Tuya statistics.

## Interface and verification

Add compact temperature/humidity averages to home cards, detailed summary cards and separate daily temperature/humidity charts to the home page. Include an accessible daily-readings disclosure, including empty days. Show current device values in the device list and detail, with climate cloud-read times. Explain equal weighting, unavailable readings and independence from energy selection in English and Polish. Retain responsive layouts and accessible text labels. No new dependencies, device commands, energy calculations or notifications are required.

Verify adapter normalization; independent per-metric denominators; zero, negative Celsius and missing readings; offline/absent/stale filtering; account isolation; monitoring independence; duplicate snapshots; database migration; localized rendering; and mobile layout.
