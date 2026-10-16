# English and Polish implementation plan

> **For agentic workers:** Implement the tasks below using test-driven development, then review the integrated changes. Independent file groups can be delegated using superpowers:dispatching-parallel-agents.

**Goal:** Default the application and documentation to English, with a persistent English/Polish interface switch.

**Architecture:** A React language provider remembers the explicit browser preference, defaulting to English regardless of browser language. English source messages and Polish dictionaries localize interface text and formatting. Server errors have English defaults and stable translations; email delivery uses English independently of the browser preference.

**Tech Stack:** Existing React, TypeScript, Fastify, SQLite, Node test runner; no new runtime dependencies.

**Spec:** User request in this thread; confirmed preference: browser-local interface language, emails in English.

## Global constraints

- Preserve Europe/Warsaw aggregation, account credentials, monitoring calculations, and user-provided names.
- Language selection is available before and after login and does not reset forms or navigation.
- English documentation describes current labels and language persistence.
- Preserve queued email payloads and idempotency guarantees.
- Existing isolated T3 worktree is the implementation workspace; no deployment is requested.

## Review focus

- Missing, invalid, or inaccessible browser storage falls back to English without crashing.
- Language changes update dates, numbers, accessibility labels and currently displayed errors.
- Mobile and logged-out users can reach the language switch.
- Account/device names and raw Tuya field values are never translated.
- Existing databases and already attempted email payloads remain compatible.

### Task 1: Language infrastructure

Files: `shared/i18n.ts`, `src/i18n.tsx`, `src/main.tsx`, `src/api.ts`, `index.html`, `tests/i18n.test.ts`.

- [x] Write and run failing tests for English defaults, saved Polish selection, invalid/unavailable storage, interpolation and locale formatting.
- [x] Implement `Language = 'en' | 'pl'`, `Messages = Record<string, string>` (English keys, Polish values), `translate(language, message, messages, params?)` and formatting helpers.
- [x] Implement `LanguageProvider`, `useI18n(messages?)`, and `LanguageSwitcher`. The hook exposes `language`, `setLanguage`, `t`, `number`, `date`, `day`, `percent`, and `energyNumber`. Provider accepts optional `initialLanguage` for server-rendered tests.
- [x] Localize API/network errors and make language changes re-render without remounting the app.
- [x] Verify focused tests.

### Task 2: Interface translations

Files: `src/App.tsx`, `src/components.tsx`, `src/pages.tsx`, `src/EstimationForm.tsx`, `src/locales/*.ts`, `src/styles.css`, `tests/dashboard.test.ts`.

- [x] Add failing English/Polish rendering assertions.
- [x] Translate all user-facing labels, help, empty states, form feedback, chart labels and accessibility text using per-file dictionaries.
- [x] Use locale-aware formatting; keep calendar calculations in Warsaw.
- [x] Add language controls on login and the authenticated shell; verify responsive placement.
- [x] Run rendering tests in both languages.

### Task 3: Server messages, notifications, documentation

Files: `server/app.ts`, `server/collector.ts`, `server/notifications.ts`, `server/energy.ts`, `server/db.ts` if necessary, `shared/systemMessages.ts`, notification localization helpers, relevant tests, `README.md`, existing documentation.

- [x] Add failing checks for English API errors and English notification emails independent of UI preference.
- [x] Keep new server and email messages English; support Polish display in the app and compatibility with known legacy messages.
- [x] Preserve immutable email retry payloads and existing monitoring data.
- [x] Update documentation and setup references to English labels, explain EN/PL behavior.
- [x] Verify API, notification and database compatibility tests.

### Task 4: Integrated verification

- [x] Run `npm test`, Python bridge tests, `npm run build`, and formatting checks.
- [x] Exercise default English, Polish selection, reload persistence, errors and navigation with T3 preview on an isolated local test database.
- [x] Review the complete diff, address material findings, report changes and remaining limitations.

## Verification results

- Baseline: 46 Node tests passing. Final, including integration with incremental energy reports: 76 Node tests and 17 Python bridge tests passing.
- Production build, both TypeScript configurations, formatting and diff whitespace checks passed.
- Independent review found no actionable issues; UI/system placeholder coverage checked.
- Browser smoke checks used an isolated in-memory synthetic database: English default, Polish selection, reload/sign-out persistence, invalid and blocked storage, live error translation, draft form retention, notifications in both languages, localized numbers, preserved names, and mobile selector visibility without horizontal overflow.
- Language support adds no schema migration; the integrated incremental-report feature uses schema v3. No production deployment was performed. Historical notification prose and already attempted delivery payloads remain unchanged.
