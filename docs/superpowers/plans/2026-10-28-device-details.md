# Device details implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Show device state at a glance and change configuration only through Edit → Save / Cancel.

**Architecture:** Keep the existing React/Vite interface and data model. Extract device details from pages.tsx into a read-only overview and a conditionally mounted configuration form. Submit monitoring participation and estimation in one database transaction.

**Tech Stack:** React, TypeScript, Fastify, SQLite, node:test.

**Spec:** The user's request: minimal device details, current state first, explicit editing and Save / Cancel. Scope is device details; apartment lists and apartment notification rules retain their current behavior.

## Global constraints

- English source copy and Polish translations; locale-aware values.
- No device control commands or changes to energy calculations.
- Existing source precedence, unknown readings, freshness and historical data remain meaningful.
- Existing worktree and production dependencies; no new UI framework. Happy DOM is used only for development tests.

## Design

Use the same page for editing, with a compact device header and one form. A dialog would constrain the existing field-mapping controls on phones. The default view shows daily energy, source-appropriate live state, climate, monitoring participation, reading timestamps and history. Technical explanations and raw fields remain available in a collapsed disclosure. Missing data and errors stay visible.

Entering edit captures a configuration draft. Background readings can update without replacing that draft. Cancel unmounts the form without writes. Save writes monitoring and any changed estimation atomically; failure keeps the draft and error visible. Successful save returns the canonical device state and returns to overview. Device navigation resets the draft.

## Review focus

- A rejected estimation must not persist monitoring changes (task 1).
- Unchanged estimation must not create a new revision or reset observations (task 1).
- Polling and probing must not overwrite edited fields (task 2/browser).
- Native-power, meter, estimated, missing, ignored and stale devices must remain understandable (task 2).
- Cancel/reopen, failed save, device navigation and mobile overflow (task 3/browser).

## Task 1: Atomic settings save

Files: server/app.ts, server/estimation.ts, tests/device-monitoring.test.ts.

- [x] Add API tests for combined changes, rejected payloads, unchanged revisions and rollback on storage failure.
- [x] Run the tests and observe the new unsupported-payload failure.
- [x] Extend PUT /devices/:id with optional estimation; reuse existing validation and allow configureEstimation inside an existing transaction. Return canonical device data with the requested history range.
- [x] Run the focused tests.

## Task 2: Read-only overview and explicit editor

Files: src/DevicePage.tsx, src/DeviceConfiguration.tsx (existing EstimationForm refactored), src/DeviceDiagnostics.tsx, src/pages.tsx, src/api.ts, src/locales/, src/styles.css, tests/pages-i18n.test.ts, tests/device-details.test.ts.

- [x] Add rendering coverage for a default view with no configuration controls and source-appropriate data in both languages.
- [x] Implement overview, diagnostics disclosure and conditionally mounted draft editor with one Save / Cancel pair.
- [x] Keep dirty drafts stable and reset drafts on cancel/device navigation; do not submit untouched suggested mappings.
- [x] Add responsive styling and run focused tests/typecheck.

## Task 3: Integration verification

- [x] Run npm test and npm run build.
- [x] Use an isolated local fixture and T3 preview to exercise edit/cancel/save, validation/failure and background refresh.
- [x] Check desktop and 390px layouts and keyboard focus.
- [x] Review the final diff and update README with the new flow.

## Verification record

- Full suite: 191 tests passed; production build and both TypeScript projects passed.
- Browser checks against an isolated in-memory fixture: Cancel issued zero writes and restored keyboard focus to Edit; reopen reset the draft; failed Save kept the values and error; successful Save updated the overview.
- Participation-only save preserved estimation revision 0; a new probe and 30-second polling preserved draft values.
- Reproduced a late-save/navigation race before the fix. Keyed the data-owning component by device ID and verified that another device's draft survives the late response.
- Fixed a mobile CSS collision with the device list's energy grid area. Verified metric widths and no horizontal overflow at 390px.
- Independent code review identified the navigation race and an ambiguous footer; both addressed.

## Maintenance notes

- `DevicePageContent` owns the fetched data and must stay keyed by device ID. Keying only `DeviceDetails` does not isolate a late save response from a previous page. `tests/device-editing.test.ts` covers that navigation race.
- `DeviceDetails` captures the device object when Edit opens. Keep this draft separate from live data; cancelling and reopening picks up the latest saved configuration.
- `DeviceConfiguration.markEstimationEdited` freezes the selected method, mapping and temperature definition. Both field changes and suggestion buttons must call it: buttons do not emit a change event. Otherwise a probe can switch the method after an explicit user choice.
- `estimationEdited` tracks edits to estimation only. A participation-only save must omit `estimation`, so suggested values and the assumed 1.25 kW default do not become persisted configuration unintentionally.
- `PUT /api/devices/:id?days=N` validates before writing, updates participation and optional estimation in one transaction, and returns the canonical device with N days of history. `configureEstimation` joins an existing transaction; standalone callers still get their own transaction. Unchanged estimation must not create a new revision or observation barrier.
- `tests/device-details.test.ts` checks localized read-only rendering, `tests/device-editing.test.ts` mounts real React components with controlled HTTP responses, and `tests/device-monitoring.test.ts` checks the real API and SQLite transaction. The DOM helper must load before `react-dom/client` performs event-support detection. Test helpers never belong in production components.
- Keep mobile styles specific to this page. In particular, the device-list `.device-energy` class has a grid-area assignment and must not be reused for the overview metric.

Reflection follow-up: added automated interaction coverage and reproduced then fixed probe-driven method changes after accepting temperature or relay suggestions. Removed unused styles from the old estimation panel. A larger state-management rewrite is unnecessary for the current scope.

Reflection verification: 200 tests passed, including 9 component interaction tests; production build and TypeScript checks passed. The DOM suite replaces manual-only coverage of editing behavior; layout still requires a real browser.
