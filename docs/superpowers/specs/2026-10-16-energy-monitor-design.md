# Tuya Energy Monitor

## Intent and agreed scope

One owner monitors rented apartments across two Tuya / Smart Life accounts
(fewer than ten homes). Each Tuya home is an apartment. The owner wants to see
daily heating consumption, drill into devices, and investigate high usage before
contacting tenants. The app monitors; it never sends device commands.

The user requested continuing implementation now and deferring unavailable
thermostat energy data. Existing QR sessions confirmed cumulative energy on
some meters. Thermostats may expose no energy. Missing energy is never zero,
and apartment totals explicitly show their coverage.

Required: password protected, single owner, no signup; multiple account QR
connection; apartments and devices; daily history; separate daily kWh thresholds
per apartment; configurable rolling anomaly baseline; prompt email alerts via
Resend; weekly summaries even without alerts; monitoring health; Docker image
produced by GitHub Actions for self-hosting via Nori. Public MIT repository.

## Implementation decisions

React + TypeScript, Fastify, Node 24, SQLite on a persistent volume. A small
Python subprocess uses the official Tuya sharing SDK for QR and read-only
collection, avoiding a second implementation of its protocol. One container.
Polish interface, Europe/Warsaw calendar, light neutral dashboard with blue
accents, accessible responsive forms and charts. No Sites hosting: existing
GitHub repository and Docker deployment are the user's chosen destination.

Five-minute collection; fifteen-minute freshness/maximum interval. Only
validated cumulative energy fields with known kWh/Wh units and scale count.
Incremental reports cannot safely be summed by polling and remain unsupported.
Offline devices retain their last value but do not produce new consumption.
First sample establishes a baseline. Negative deltas, code changes and gaps
longer than fifteen minutes reset the baseline; no fabricated usage. Valid
intervals overlapping calendar boundaries are allocated proportionally and
the UI explains this approximation. Never import past app statistics as if
they had been collected. Store raw counters and valid intervals durably.

Devices with usable meters and thermostat/heater categories are initially
included; owner can include/exclude devices. Non-heating meters can be excluded.
No daily threshold until the owner sets one. Anomalies default to 14 previous
days, at least 7 qualifying days, 50% increase and 3 kWh absolute increase;
compare the same local time period with >=95% coverage for the same set of
metered devices. At least 30 minutes of today's data required. Controls allow
disabling anomalies and choosing window (7–90), percent and absolute increase.

Alert once per home/day/rule. Persist an outbox, retain the exact email body
and use a stable Resend idempotency key on retries. No blind retry beyond
Resend's 24-hour deduplication window. Emails disclose partial coverage,
top contributors, threshold/baseline and link to apartment. Weekly summary
Monday after 08:00 Warsaw for the preceding complete week; one per week,
includes usage, comparison, missing/stale devices and account status. Missing
Resend configuration leaves notifications visibly disabled; no emails in tests.

Owner password and 32-byte encryption key come from environment. Tuya tokens
are encrypted at rest with AES-256-GCM; never returned to UI or logs. Random
server-side sessions, HttpOnly/SameSite cookies, origin checks on writes,
login throttling, no unauthenticated account/energy endpoints. Container runs
unprivileged. No default password, no production demo readings.

## Screens and flows

- Overview: today's observed consumption and coverage, active alerts, account
  health, 14-day chart and apartment cards with individually configured limits.
- Apartment: selected period (7/14/30 days), daily history, device contribution,
  device links and per-apartment rules. Missing/incomplete data stays visible.
- Device: counter, measurement status, last check, energy history and inclusion.
- Accounts: connect using user code and QR; confirm; sync/reconnect; errors.
- Notifications: threshold/anomaly events and delivery status; weekly summaries.
- Settings: timezone display, collection interval, notification configuration
  status and operational/deployment instructions. Secrets configured via env.

Empty states explain how to connect accounts and why history starts at the
first two usable readings. Loading, errors and save results are visible.

## Delivery and validation

Meaningful tests cover counter resets/gaps/offline/duplicate samples, DST and
midnight, partial coverage, comparable anomaly history, outbox deduplication,
authentication/origin protection and token secrecy. Build/typecheck, Python
adapter checks, browser desktop/mobile smoke test, local Docker build and
container health check. CI validates PRs and builds images; main/tags publish
GHCR. Publishing deployment and live email setup need actual production
hostname/password/Resend variables; implementation does not invent those.
