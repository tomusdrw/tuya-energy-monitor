# Per-device Web Push notifications

Status: approved by the user and implemented on 2026-10-23. Validation and deployment limits are recorded in the implementation plan.

## Intent and agreed scope

Provide opt-in system notifications for the installed PWA and desktop browsers,
as an alternative to email. Each receiving installation/browser chooses its own
event categories. The user confirmed adding lost/restored readings and Tuya
account connection problems to the existing energy alerts and weekly summary.

The application remains a single-owner instance protected by an admin password.
Receiving devices are phones/browser profiles, distinct from monitored Tuya
devices. This does not introduce user accounts, device control, offline readings,
temperature thresholds, heating-cycle alerts, or a new notification inbox.

## Approaches

- **Recommended: standards-based Web Push**, using a service worker, the browser's
  push subscription and a Node sender. Covers background PWA and desktop delivery
  with one implementation; requires HTTPS and browser/OS permission. No separate
  notification-service account is required, though browser vendors operate the
  push transports.
- Foreground Notifications API alone would be smaller but depends on an open page,
  which does not meet the intended background notification behavior.
- A managed notification platform would add another account, recipient data store,
  SDK and operational dependency without a requirement that justifies them here.

Web Push is the only approach recommended for this scope. The implementation
choices below are agent proposals, not additional requirements agreed by the user.
This is a cross-cutting feature involving storage, delivery, event evaluation and
the settings UI, so it needs a full implementation plan after design approval.

## Current architecture and constraints

`server/notifications.ts` creates durable threshold, anomaly and weekly events.
The `notifications` table also holds Resend-specific attempts, payload and status.
Translations are stored under `notification-pl/<id>` in metadata. Preserve existing
event IDs, historical content, retry payloads and Resend idempotency behavior.

`server/app.ts` runs notification evaluation after collector/Tuya.ai passes and
starts email delivery independently of collection. The React UI polls authenticated
APIs; `AlertList` currently treats email status as the event's overall status.
The PWA has a manifest and icons, but no service worker or offline cache. SQLite is
at schema version 8. Keep React/Vite, Fastify, SQLite and English/Polish translations.

Use a push-only service worker served at `/sw.js`, with root scope and revalidation
headers. Do not add fetch interception or cache private responses. Register it
from the authenticated application; expose the static script without authentication
so browser update checks work after session expiry.

## Receiver settings and permission flow

Settings gains a **Notifications on this device** panel and a compact list of
registered receiving devices. Enablement requires a click on **Enable notifications**
and browser permission. Never request permission automatically on page load.

Each receiver stores a user-editable name, language (initially the current UI
language), enabled state and seven independent category toggles:

| Category | Initial selection when enabling |
| --- | --- |
| Daily energy threshold | On |
| Unusual energy usage | On |
| Weekly summary | Off |
| Readings lost | On |
| Readings restored | On |
| Tuya account connection problem | On |
| Tuya account connection restored | On |

Preferences cover all monitored homes in this first version. Source home/device
filters and quiet-hour schedules are outside this scope. The user sees the initial
selection before confirming enablement. Preferences are saved on the server and
survive browser reloads and server restarts. Unknown categories are rejected;
future categories default to off for existing receivers.

Provide **Send test notification**, **Disable on this device**, and rename,
category/language editing and revocation for other registered receivers. The
single owner may manage all receivers after login. The list exposes descriptive
metadata and sanitized delivery errors, never subscription endpoints or keys.

Use the actual PushSubscription endpoint identity to prevent duplicate receiver
rows across tabs; a local opaque receiver ID is a convenience, not authentication
or a hardware fingerprint. Reconcile `getSubscription()` with the server after
login and on return to settings. Refreshing an existing subscription must preserve
its preferences and must not silently reactivate a disabled/revoked receiver.
Endpoint rotation should preserve receiver preferences when the authenticated
browser still has its receiver ID. Losing both identity and browser data requires
explicit enablement as a new receiver. Permission rejection, unsupported APIs,
insecure origins and expired subscriptions have actionable localized states.

Explicit logout disables the current receiver server-side and cancels its pending
deliveries before ending the session, then attempts browser unsubscribe. The
logout request identifies the current receiver; revocation must succeed before
reporting completed logout. Naturally expiring the login cookie does not revoke
explicitly enabled push: delivery must work while the application is closed.
An owner password change revokes all receivers alongside existing sessions.
Messages already accepted by a vendor cannot be recalled reliably; keep a short
TTL for operational notices and explain this limit in deployment documentation.

## Email and in-app history

Add a persisted global **Email notifications enabled** switch, initially on, in
addition to the existing Resend configuration indicator. This makes push a usable
alternative without requiring removal of server credentials. Enabling push never
silently disables email or another receiver. Email continues to include only
threshold, anomaly and weekly categories. New operational categories are push and
in-app only. When email is disabled, newly created events are marked skipped for
email; enabling it later does not backfill these events. Disabling cancels queued
email attempts; it cannot recall a request already in flight. Never rewrite an
already attempted payload or idempotency key.

All generated events remain in the existing Notifications page, independent of
push preferences. Label email and push delivery separately. A push provider's
acceptance means **Submitted**, not that the person saw/read the message. Aggregate
push status may show receiver counts; expose no secrets. The absent-email warning
must not describe push-only operation as broken. Historical records retain their
existing email status and are not sent retrospectively to new receivers.

## Additional event semantics and noise control

Existing threshold/anomaly rules and once-per-home-per-day deduplication are
unchanged; the weekly summary retains its Europe/Warsaw schedule. New notices
describe data availability, never infer zero consumption from missing data.

Persist operational condition state and episode identity across restarts. Evaluate
conditions on a bounded independent tick (once a minute) as well as after successful
collection passes; a slow collection call must not prevent freshness detection or
delivery retries. Serialize evaluation and avoid overlapping delivery loops.

**Reading availability:** consider included, non-ignored energy devices with a
supported measured, power or enabled estimation source. Exclude devices that have
never produced a usable reading. Reuse source-specific freshness semantics:
cumulative meters use `measurementFresh`, native power uses `hasFreshPower`,
estimation needs a fresh known heating state, and incremental energy additionally
needs a fresh stream heartbeat. Lack of an incremental consumption report alone
is not a failure. Offline/disappeared devices with previous usable readings count
as unavailable. Climate-only sensors are outside these energy-availability events.

A device must remain unavailable for 15 minutes after the first observation of
the unavailable condition before a loss event. Recovery requires 5 continuous
minutes of usable observations and a previously recorded loss episode. These
notification grace periods do not change the application's 3/15-minute energy
coverage rules. Group device transitions that mature in the same evaluation into
one message per home and direction, listing affected names and counts. Repeated
polls do not repeat an episode's event; restart does not produce another event.
Changing inclusion, source or estimator configuration resets the relevant baseline
without fabricating a loss/recovery. Fresh observations after restart are required
to confirm recovery; elapsed downtime alone cannot establish recovery.

**Account connections:** track Sharing/QR and configured Tuya.ai independently.
Sharing/QR uses its existing sync/error state. Add separate durable Tuya.ai
connectivity observations from the existing account-level `client.list` call,
guarded by the integration revision. A successful list establishes connection
health; an unsuccessful list establishes a connection problem. Do not infer an
account outage from `ai_last_success` or `ai_error`: these currently also describe
individual offline devices, absent counters, model errors and device access.
Individual detail/model failures remain device-availability failures. When there
are no eligible devices and no list request, mark this lane idle/unknown, not
unhealthy; do not add cloud requests solely for notification health checks.
No selected devices does not itself suppress account-level failures from calls
that still take place. Staleness is evaluated only for an active, expected-to-poll
lane. A connection problem persisting for 15 minutes emits once per provider
episode; recovery requires 5 continuous healthy minutes. Newly connected accounts
receive the same 15-minute initialization grace. Removing/replacing an integration
resets its baseline without a restored event. Do not describe generic read failures
as definitely expired tokens.

While an account/provider connection problem is active or pending confirmation,
suppress new device-loss episodes attributable to that provider; let the account
notice summarize the outage. Other independently functioning providers remain
eligible. After account recovery, start a fresh 15-minute grace for devices still
missing; do not send device-restored events for losses never recorded. A device
loss already recorded before an account outage retains its episode and may recover
once fresh observations establish recovery.

## Storage, delivery and API

Add an additive schema-v9 migration with receiver/subscription storage, a separate
push outbox and durable operational condition state. Store endpoint hashes with a
unique constraint and encrypt complete subscriptions with the existing encryption
key. Keep receiver secrets out of list responses, logs and human-readable errors.
Keep the existing email columns and add explicit channel semantics for skipped
delivery; do not bulk migrate old attempted messages into a new email queue.

Atomically create each event and its matching push-outbox rows, keyed uniquely by
event and receiver. Enqueue only for enabled receivers/categories at event creation;
never backfill old events on subscription or category enablement. Recheck eligibility
before each send and cancel unsent work when a receiver/category is disabled.
Freeze the compact localized push payload at enqueue time (title, short body,
event ID/tag, same-origin hash URL and icon). Bound payload by UTF-8 bytes; detailed
energy accounting remains in the authenticated app.

Use the maintained `web-push` Node library for VAPID and payload encryption, with
an injectable sender for tests. Configure persistent `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a real contact `mailto:` or HTTPS URL) on
the server; supply a key-generation command and Docker/environment documentation.
Return only the public key to clients. Push configuration is independent of Resend;
an unconfigured sender leaves existing monitoring operational. Validate complete
configuration and key consistency with actionable startup/configuration errors.

The push worker is independent of email and collection, processes bounded batches
fairly across receivers, times out requests and persists exponential retry state.
Use a 1-hour deadline for operational messages and 24 hours for energy/weekly
messages; vendor TTL cannot exceed the remaining deadline. Each grouped device
event records its member episode IDs and includes its observation time: its body
is a historical snapshot, not a claim about all devices' current condition.
Cancel an unsent group only when every member is superseded (all lost members have
recovered, or all recovered members have relapsed). With a partially superseded
group, retain the original timestamped payload, so the remaining valid notices
are not lost and retries remain immutable. Account notices have one episode and
are cancelled as soon as superseded. HTTP 404/410 expires a subscription and cancels its
outbox; 429/5xx/network failures retry with bounded backoff and Retry-After; other
4xx are surfaced without repeated immediate attempts. A failed recipient must not
block healthy recipients or email. Await workers before closing SQLite.

After a crash between provider acceptance and saving success, a retry can duplicate
delivery: do not promise exactly-once delivery. Use stable per-event notification
tags and push topics to reduce duplicate visible notifications. New episodes have
different identities. No claim that remote acceptance proves user-visible delivery.

Authenticated endpoints provide push configuration, receiver listing,
subscription/reconciliation, preference updates, revocation and rate-limited test
delivery, plus the global email preference. Retain same-origin mutation checks,
bounded bodies and strict Zod schemas. Treat a supplied endpoint as untrusted:
require HTTPS, validate browser-vendor destinations, reject credentials, arbitrary
ports, local/private network targets and redirects. The implementation must prevent
SSRF, not merely validate URL syntax. Detailed vendor-host validation is left to
the builder after checking current browser endpoints.

The service worker displays one system notification per received push with a
stable tag. It handles notification clicks by focusing/navigating an existing
same-origin application window or opening one, preserving the intended hash route
through login. Validate the destination against this origin and allowed app routes.
Show notifications even while the app is foregrounded, avoiding a second page-level
system notification for the same event. The Notifications page is the in-app history.

## Verification and implementation boundaries

Test version-8 migration and preserved historical email retries; independent device
preferences; permission-denied/no-subscription states; authenticated/CSRF-protected
CRUD; endpoint validation; password/logout revocation; event/outbox atomicity;
expired endpoints, retries and cancellation; language and payload limits; source
freshness, initialization, outages/recovery, flapping, changed configuration,
incremental zero usage, provider suppression and restart behavior. Exercise service
worker display/click logic and browser settings at mobile/desktop widths in EN/PL.
Run the full existing tests, type checks and build after implementation.

Use mocked push transports and synthetic monitoring data for automated tests.
Genuine end-to-end delivery needs HTTPS and an opted-in browser; physical iPhone
delivery/OS background restrictions cannot be certified by viewport simulation.
The UI must report unsupported configurations instead of claiming universal delivery.
HTTPS is required outside localhost; iOS/iPadOS requires an installed Home Screen
web app. Closing a page is supported, but OS/browser settings and connectivity
control actual delivery. A stopped application server cannot detect/send outages.

The builder chooses module decomposition, CSS layout within the existing design,
indexes and bounded batch sizes. No hosting deployment or real notification send
to an existing recipient is part of preparing this design.

## Primary references checked

- [Push API and subscription/service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [WebKit: Web Push for Home Screen apps and permission gestures](https://webkit.org/blog/13878/)
- [Node web-push library and VAPID/TTL options](https://github.com/web-push-libs/web-push)
