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
and polls enabled runtime estimators every 60 seconds in batches of 20 devices.
Cloud requests are serialized; slow cloud responses can delay a cycle. Failed
inventory attempts retry on the five-minute cadence without suppressing relay
polls. Email delivery has its own serialized job so Resend delays do not block
state collection.
No local network access to the apartments is needed. Cloud errors are displayed;
expired authorization can be renewed with **Reconnect**. Credentials are
encrypted with AES-256-GCM before storage and never returned to the browser.

## Thermostat runtime estimates

In **Apartments → device → Heating runtime estimation**:

1. Expand **Available fields and latest states**. Confirm a field that actually reports
   the heating relay, such as `work_state`. A general `switch`, selected mode or
   temperature setpoint is **not** evidence that the heater is drawing power.
2. Set the total rated **heating circuit power in kW** (for example 1200 W =
   1.2 kW), not the thermostat's own power or maximum relay rating. Thermostat
   forms (`wk`) prefill **1.25 kW** when no power is saved, an editable assumption
   within the owner's suggested 1–1.5 kW range. Existing configured values are
   preserved. This default does not enable estimation or confirm a relay signal.
3. Select the field and its exact ON/OFF values. The form accepts JSON arrays:
   `["heating"]` / `["standby", "idle"]`, `[true]` / `[false]`, or `[1]` / `[0]`.
   Strings, numbers and booleans are distinct. Confirm any suggested mapping
   against the actual device. Unsupported values remain unknown.
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
estimates only. Previous energy is never recalculated. A real cumulative meter
always takes precedence for the same device. Totals containing estimates use
**≈**, with measured/estimated components and coverage shown separately in
cards, chart tooltips and notifications. Coverage measures observed time, not
accuracy of the rated-power assumption.

The existing sharing-cloud credentials are reused. Local TinyTuya/MQTT push is
not implemented: this installation has no access to the apartments' LANs. The
adapter performs read-only cloud polling; no device commands are sent. The
runtime method **requires an exposed relay signal**. If the current API returns
only a thermostat switch and temperature settings, enabling estimation cannot
recover that missing signal; the panel explicitly stays unknown. Raw recent
observations are available in the device detail for diagnostics, and complete
history remains in SQLite `heating_observations` and `intervals`.

## What the numbers mean

- **Counter** is the device's cumulative kWh. The first reading is a baseline,
  not that day's usage. History starts when two valid readings are available.
- Only known cumulative consumption codes with validated units/scales are used.
  Energy returned to the grid is excluded. Incremental reports cannot safely be
  added by polling, so this version labels them unsupported.
- Offline samples, counter resets, a change of counter field, and intervals
  longer than 15 minutes leave gaps. Old offline values are shown as counters
  but do not create new consumption. Read time means the cloud was queried,
  not that the device sent a new measurement at that instant.
- Five-minute intervals crossing midnight are allocated proportionally. Daily
  values are therefore estimates at polling resolution. Warsaw calendar days
  respect daylight saving changes.
- Coverage is the observed fraction of time across selected devices, including
  configured runtime estimates. A partial
  total is an observed subtotal, never a projection for missing heaters. `—`
  means unavailable; `0` requires actual consecutive valid readings.
- Device inclusion applies to the currently displayed historical totals too.
  Anomalies require adequate history for the current set of measured and configured estimated devices.
- Past Smart Life app statistics and thermostat-specific monthly fields are
  not imported. No tariff or billing calculation is performed.

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
intervals as measured. Back up before upgrading; do not run an older application
against a migrated database.

Run one process per database. Raw readings, heating observations and intervals are retained; size grows
with time and the number of devices. Schedule volume backups and monitor disk
space. The first version has no data retention or account deletion UI.

Integration references: [Tuya sharing SDK](https://github.com/tuya/tuya-device-sharing-sdk),
[Home Assistant Tuya data limitations](https://www.home-assistant.io/integrations/tuya/),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## License

[MIT](LICENSE)
