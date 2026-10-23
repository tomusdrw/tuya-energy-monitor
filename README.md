<img src="assets/icon.svg" width="64" height="64" alt="">

# Tuya Energy Monitor

A self-hosted web app for monitoring heating energy consumption across multiple
Tuya and Smart Life accounts, homes, and devices.

The application includes an English-default dashboard with an English/Polish
language switch, password login,
apartment/device drill-down, history, individual thresholds, anomaly detection
and Resend notifications. Energy support depends on what each device exposes
through Tuya's sharing API. Unsupported devices remain visible as missing data.
The application never controls heaters or changes their settings.

## Run with Docker

1. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (12+ characters).
2. Generate `ENCRYPTION_KEY` with `openssl rand -hex 32` and save it in `.env`.
3. Set `APP_ORIGIN` to the exact URL you will open in your browser.
4. Run `docker compose up -d --build` to build from this checkout, or
   `docker compose pull && docker compose up -d --no-build` for the published image.
5. Open the configured URL and sign in with `ADMIN_PASSWORD`.

Compose binds to `127.0.0.1:3000` by default. For private remote access, set
`BIND_IP` to the host's Tailscale IP and use that address in `APP_ORIGIN`.
For public access, put the container behind an HTTPS reverse proxy and set
`APP_ORIGIN=https://your-domain`. HTTPS origins use Secure session cookies.
An incorrect origin prevents form submissions. There is no public signup.

For Nori: use the GHCR image, container port `3000`, a persistent volume at
`/data`, and the variables from `.env.example`. Run one application instance
per database. `/healthz` checks process health; connection/measurement health
is visible after login. The container runs as UID/GID 1000. A bind-mounted
data directory must be writable by that user.

## Language

English is the default, including on the sign-in screen. Use the **Language**
selector to switch between **English** and **Polski** before or after signing in.
The selection is saved in this browser and retained after a reload or sign-out;
other browsers start in English. If browser storage is blocked, the selection
still works for the current page session. Browser language is not used to change
the default automatically.

Interface text, errors, dates and numbers follow the selected language. Apartment
and device names, account labels, and raw Tuya field names/values stay as supplied.
The monitoring calendar and weekly schedule always use **Europe/Warsaw**.

New automatic emails are in **English**, independently of the interface language.
New notifications can be displayed in either interface language. Notifications
created before language support retain their original text; already attempted
email payloads remain unchanged so delivery retries keep their idempotency guarantee.
Documentation uses the English interface labels.

## Connect and configure

- Open **Connected accounts**, choose **Add account**, and enter the account's
  User Code from Tuya/Smart Life → Me → Settings → Account and Security.
- Scan the QR with the correct mobile account. The consent screen can say
  **Home Assistant**, because this compatibility connector uses Tuya's
  official sharing SDK and its public Home Assistant client registration.
- Confirm in the dashboard; repeat for the second account. Reconnecting the
  same Tuya identity preserves its settings and history.
- Review the device selection in each apartment. Recognized meters and
  thermostat categories are included initially. Some thermostats identify as
  generic sockets; include those manually. Exclude unrelated appliance meters.
- Set a daily threshold **independently for each apartment**. No threshold is
  enabled by default. Adjust or disable anomaly detection in the same form.

Accounts and devices remain scoped to their account, even if names match.
Background collection refreshes inventory and energy counters every five minutes,
and polls native power meters and enabled runtime estimators every 60 seconds
in batches of 20 devices.
Cloud requests are serialized; slow cloud responses can delay a cycle. Failed
inventory attempts retry on the five-minute cadence without suppressing relay
polls. Email delivery has its own serialized job so Resend delays do not block
state collection.
No local network access to the apartments is needed. Cloud errors are displayed;
expired authorization can be renewed with **Reconnect**. Credentials are
encrypted with AES-256-GCM before storage and never returned to the browser.

## Native power measurements

Devices exposing active power through `cur_power`, `power` or `work_power` are
supported automatically: no rated power or heating-state configuration is needed.
The device page shows current watts and **Energy from measured power**. Existing
device inclusion choices are preserved; include the device in the apartment total
if it was previously excluded.

Units and decimal scales come from Tuya's field specifications (W or kW).
For the standard `cur_power` field only, an omitted unit with scale 1 is treated
as W, following [Tuya's function definition](https://developer.tuya.com/en/docs/iot/product-standard-function-introduction?id=K9tp15ceh63gr).
Current and voltage alone are not converted to active power: AC power also depends
on the power factor. Conflicting units and invalid values remain missing data.

Consumption is integrated from consecutive readings using their average power:
**kWh = (previous W + current W) / 2 × elapsed hours / 1000**. Polls run every
60 seconds; both observations must be valid and online, no more than 180 seconds
apart. Missing/offline devices, invalid readings and failed requests break
continuity. A field or scale change starts a new baseline. There is no backfill
or extrapolation after the last reading; a short restart can bridge valid persisted
observations within the same 180-second limit.

Power-derived consumption appears separately as **From power**, including history,
coverage and notifications, and uses **≈** because polling can miss load changes
and Tuya may return cached values. It uses actual measured power, rather than an
assumed heating rating, but is not a direct kWh counter or billing measurement.
Cumulative counters and live incremental kWh reports take precedence, followed by
power integration, then configured runtime estimates. Source changes preserve
history and start a new baseline without adding two sources for the same interval.

## Thermostat runtime estimates

In **Apartments → device → Heating runtime estimation**:

1. Available fields and states are loaded automatically. Recognized heating signals
   are marked **Suggested** and preselected for new configurations. Use **Detect again**
   to refresh fields and specifications from Tuya through the existing inventory sync.
   Confirm a field that actually reports the heating relay, such as `work_state`.
   A general `switch`, selected mode or temperature setpoint is **not** evidence that
   the heater is drawing power. If no recognized signal is found, the form says so.
2. Set the total rated **heating circuit power in kW** (for example 1200 W =
   1.2 kW), not the thermostat's own power or maximum relay rating. Thermostat
   forms (`wk`) prefill **1.25 kW** when no power is saved, an editable assumption
   within the owner's suggested 1–1.5 kW range. Existing configured values are
   preserved. This default does not enable estimation or confirm a relay signal.
3. Select a detected field, then assign each available state to **Heating active**,
   **Idle**, or **Unknown / ignore**. No field names or JSON need to be typed.
   Choices come from Tuya's metadata and observed states; booleans offer both values.
   Strings, numbers and booleans remain distinct. If metadata is incomplete, detect
   again after the device reports the other state. Confirm suggested assignments
   against the actual device. Unassigned values remain unknown. Refreshing preserves
   edits and saved mappings, including saved values absent from the latest reading.
4. Enable and save. The first new observation establishes a baseline; consecutive
   valid observations produce estimates. Device history includes daily kWh and
   the panel shows today's and lifetime observed heating hours.

**Estimated kWh = rated kW × observed heating hours.** A known previous state
owns the interval until the next known, online observation, at most 180 seconds
later. ON→OFF closes an ON interval; OFF→ON closes an observed zero interval.
Missing fields, unknown values, offline/omitted devices and failed requests
break continuity immediately. A short restart can bridge up to 180 seconds using
persisted state; longer gaps stay missing. Nothing is extrapolated after the last
observation. Polling can miss short cycles, transitions are only approximated,
and Tuya may return cached state. This is for overuse detection, not billing.

Each estimate stores its original kWh, ON time and configuration revision.
Changing power, mapping or enablement starts a new baseline and affects future
estimates only. Previous energy is never recalculated. Cumulative meters and
incremental energy reports and native power measurements take precedence for the
same device. Totals containing estimates or power-derived consumption use
**≈**, with measured/estimated components and coverage shown separately in
cards, chart tooltips and notifications. Coverage measures observed time, not
accuracy of the rated-power assumption.

The existing sharing-cloud credentials are reused. Local TinyTuya/MQTT push is
not implemented: this installation has no access to the apartments' LANs. The
runtime adapter uses read-only cloud polling; incremental energy uses cloud MQTT
reports. No device commands are sent. The runtime method **requires an exposed
relay signal**. If the current API returns
only a thermostat switch and temperature settings, enabling estimation cannot
recover that missing signal; the panel explicitly stays unknown. Raw recent
observations are available in the device detail for diagnostics, and complete
history remains in SQLite `heating_observations` and `intervals`.

## What the numbers mean

- **Counter** is the device's cumulative kWh. The first reading is a baseline,
  not that day's usage. History starts when two valid readings are available.
- Known cumulative consumption codes and incremental fields marked `sum` by Tuya
  are supported, with validated units/scales. Energy returned to the grid is excluded.
  Some single-phase meters omit the unit for the standard `add_ele` field. With an
  explicit `sum` report type and scale 3, its documented kWh unit is used (184 means
  0.184 kWh per report). Other missing units and contradictory units remain unsupported.
  Incremental consumption comes only from live MQTT reports, never from polled status.
  Each account has a persistent Python worker; polling and MQTT share one serialized
  API client so they cannot race to refresh the same credentials.
- Incremental reports are stored durably in SQLite and deduplicated by account,
  device, field and Tuya report ID (`dataId`). When no report ID is available, the
  device timestamp is the fallback identity; conflicting reports for the same field
  and timestamp count once. Equal values from distinct reports still count separately.
  Reports without a valid device timestamp, retained messages and negative values
  are ignored. Valid late reports are assigned to their reported Warsaw date.
- Incremental history begins when the device is discovered as an incremental source.
  There is no backfill after an application/network outage. The device page shows
  subscription health and the last energy report separately from cloud polling.
  Point reports do not establish time coverage or prove zero consumption during
  silence: their sum remains partial, with no time coverage added. This also prevents
  anomaly comparisons from treating missing reports as complete days. Daily threshold
  alerts and weekly summaries include the observed increments.
- Incremental and cumulative measurements take precedence over power integration and configured runtime
  estimation. Old estimates remain in history; new estimates stop when a measured
  source is discovered, and reports predating that transition are ignored.
- Offline samples, counter resets, a change of counter field, and intervals
  longer than 15 minutes leave gaps. Old offline values are shown as counters
  but do not create new consumption. Read time means the cloud was queried,
  not that the device sent a new measurement at that instant.
- Five-minute intervals crossing midnight are allocated proportionally. Daily
  values are therefore estimates at polling resolution. Warsaw calendar days
  respect daylight saving changes.
- Coverage is the observed fraction of time across selected devices, including
  power integration and configured runtime estimates. A partial
  total is an observed subtotal, never a projection for missing heaters. `—`
  means unavailable; `0` requires actual consecutive valid readings.
- Device inclusion applies to the currently displayed historical totals too.
  Anomalies require adequate history for the current set of measured and configured estimated devices.
- Past Smart Life app statistics and thermostat-specific monthly fields are
  not imported. No tariff or billing calculation is performed.
- A report-type entry alone does not supply an energy reading. Some heaters advertise
  `forward_energy_total` in report configuration but omit both its value and schema
  from the sharing API, even while Smart Life displays daily/monthly/yearly energy
  statistics. Their `work_power` is exposed as `powerW` in the monitoring API; it is
  not a kWh counter. Validated `work_power` readings are now integrated into energy
  history automatically. Runtime estimation using `work_state` and a confirmed
  fixed heating power remains a fallback when native power is unavailable.
  Tuya provides separate [device statistics APIs](https://developer.tuya.com/en/docs/cloud/device-data-statistic?id=Ka7g7nvnad1rm)
  and [end-user hourly statistics APIs](https://tuya.ai/developer/docs#statistics).
  The existing sharing session was rejected by these APIs in live diagnostics;
  they require separate authentication. An authenticated Tuya.ai diagnostic confirmed
  that the Eco Heater (without a display), product `csibqkjs0mijthmw`, exposes
  `forward_energy_total` as DP 101 with scale 3 and unit `kW·h`: raw 370 is a
  **cumulative counter of 0.370 kWh**, not a daily consumption reading. Its statistics
  use `MINUX`. A successful hourly query for 2026-10-22 returned 24 zero values,
  despite Smart Life showing consumption for that day and a previously observed
  DP 101 value of 268 (0.268 kWh). The reason for this discrepancy is unresolved;
  those hourly zeros are not validated consumption data. The confirmed counter
  is available from `GET /v1.0/end-user/devices/{device_id}/detail` in
  `properties.forward_energy_total`, with its scale and unit supplied by
  `GET /v1.0/end-user/devices/{device_id}/model`. Consumption can be calculated
  from consecutive valid counter readings; the first reading is only a baseline.
  The monitor does not yet poll this separate API or ingest cumulative
  MQTT reports. Statistics requests must be paced, deduplicated and retried with
  backoff on Tuya error 1199 (rate limiting). Units and time boundaries must be
  verified before importing statistics. Unknown raw DP IDs are not treated as
  energy by guessing their meaning or scale.

The stream uses the pinned [Tuya sharing SDK](https://github.com/tuya/tuya-device-sharing-sdk/tree/0.2.15)
and its local DP conversion strategies. Report identity and timestamps follow
Tuya's [device message format](https://developer.tuya.com/en/docs/iot/message-type?id=Kavqerli65a1u).

## Alerts and weekly summaries

Configure `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified with Resend) and
`EMAIL_TO`, then restart. With no email configuration, detected events remain
visible in **Notifications** and nothing is sent.

Daily threshold alerts evaluate after collection and are limited to one per
apartment per Warsaw date. Partial sums may trigger a threshold and are clearly
labelled. The preceding day is also checked so a reading that straddles midnight
can still trigger its alert. The message includes the date, limit, device
contributions and a direct link.

Anomalies default to a 14-day window, a 50% increase and at least 3 kWh extra.
Both conditions must hold. At least seven prior days and today's elapsed period
must have 95% coverage **for every compared device** with the same current source and estimation
configuration revision. The comparison uses the
same local time of day and begins after 30 minutes. Windows with different actual
durations across a daylight-saving change are excluded; this can suspend anomaly
detection on the transition day. A new meter, changed power/mapping or data gap can
delay the baseline; lack of an alert does not establish normal consumption.

Weekly summaries are due Monday after 08:00 Europe/Warsaw, with catch-up after
restart. They cover the preceding calendar week, comparison with the week before,
account health and missing/stale devices, including weeks without alerts.

The durable email outbox stores the exact payload before sending and retains
the same Resend idempotency key on retries. Automatic retries stop after 23 hours
(a safety margin within Resend's 24-hour window) and require checking delivery
in Resend. Definitive API rejections are marked failed. Unsent messages older
than 24 hours expire instead of flooding the inbox when email is first enabled.
New alerts use corrected configuration after restart.

## Development

Node 24+ and Python 3.11+:

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r bridge/requirements.txt
cp .env.example .env
# Fill required variables and set PYTHON_BIN=.venv/bin/python.
npm test
.venv/bin/python -m unittest discover -s bridge
npm run build
npm start
```

For live editing, run `npm run dev` and `npm run dev:ui` separately, and use
`APP_ORIGIN=http://localhost:5173` for the Vite browser origin. A production build
serves frontend and API from the single Node process. `npm run format` formats
the source. No tests send emails or issue device commands.

For interface copy, use English source messages with Polish translations in
`src/locales/` and the `useI18n` hook for text, dates and numbers. System error
translations live in `shared/systemMessages.ts`; notification templates live in
`server/notificationMessages.ts`. Keep placeholders identical in both languages
and interpolate user-provided names instead of translating them.

To import a private session from the earlier diagnostic prototype, stop any
other process refreshing that session, then run:

```sh
npm run import-session -- /private/path/session.json "Account label"
```

The session is encrypted into the database; no token is printed. Imported
diagnostic reports are not inserted as historical consumption. Local `.env`,
`data/`, virtual environments and temporary diagnostics are ignored by Git and
excluded from the Docker build context.

## Images and CI

GitHub Actions runs tests, type checks, frontend build and a Docker container
smoke test. Pushes publish `ghcr.io/tomusdrw/tuya-energy-monitor` with an immutable
`sha-<full-commit>` tag and branch tag. `main` additionally publishes `latest`;
version tags publish that version. Pull requests build and test without publishing.
Use an immutable SHA tag in Nori for repeatable deployments. The workflow uses
the repository's `GITHUB_TOKEN`; no registry password is needed in repository secrets.
GHCR package visibility may need to be set to public in GitHub Package settings
before an unauthenticated server can pull it.

## Backup and operation

Keep `/data` and the original encryption key together in your secure backups.
Stop the container before copying the volume, or use SQLite's online backup
API; copying just an active `.sqlite` file can miss WAL data. Restart afterwards.
Test restores before relying on a backup. Retain the encryption key across
upgrades; a different key cannot decrypt existing accounts and startup fails.
Changing the admin password invalidates sessions on the next startup.

Schema v2 migrates existing readings and intervals additively, marking prior
intervals as measured. Schema v3 adds incremental report storage and subscription
state. Language support uses existing metadata and requires no additional schema
migration. Back up before upgrading; do not run an older application against a
migrated database.

Run one process per database. Raw readings, heating observations and intervals are retained; size grows
with time and the number of devices. Schedule volume backups and monitor disk
space. The first version has no data retention or account deletion UI.

Integration references: [Tuya sharing SDK](https://github.com/tuya/tuya-device-sharing-sdk),
[Home Assistant Tuya data limitations](https://www.home-assistant.io/integrations/tuya/),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## License

[MIT](LICENSE)
