# Quick Apartment Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Switch apartments directly from their detail header.

**Architecture:** Pass overview homes into HomePage. A focused HomeSwitcher supplies
the title control; HomePage keeps its range state and separates navigation from
detail loading/error states. Existing hash routing performs navigation.

**Tech Stack:** React, TypeScript, native select, CSS, node:test and React SSR.

**Spec:** docs/superpowers/specs/2026-10-23-apartment-switching-design.md

## Global Constraints

- No new dependencies or backend endpoints.
- Preserve English/Polish labels and mobile/keyboard accessibility.
- Preserve range state and isolate apartment readings and rules.

## Review Focus

- First/last, single and missing homes must not produce invalid navigation.
- Identical apartment names across accounts must remain distinguishable.
- Rapid switching and delayed detail responses must not expose stale readings.
- Changing apartments must preserve the selected history range.
- Long names and narrow screens must retain usable controls without overflow.

### Task 1: Implement and verify apartment switching

**Files:** Create `src/HomeSwitcher.tsx`, `tests/home-switcher.test.ts`; modify
`src/App.tsx`, `src/pages.tsx`, `src/components.tsx`, `src/locales/pages.ts`,
`src/styles.css`.

**Interfaces:** HomeSwitcher accepts `id: string` and
`homes: Pick<HomeView, 'id' | 'name' | 'accountLabel'>[]`. PageTitle accepts an
optional ReactNode `titleControl`; HomePage accepts overview `homes`.

- [x] Add SSR tests for selected option, position, boundary/empty/single homes,
  duplicate names, translations and accessible heading.
- [x] Run `npx tsx --test tests/home-switcher.test.ts`; expect failures for the
  missing switcher, then implement the component, title control and integration.
- [x] Run targeted tests; expect all passing.
- [x] Use the collaborative browser with isolated fixture data to check dropdown,
  arrows, Back/Forward, range preservation, delayed/error responses, rules and
  mobile overflow. Fixtures must not modify real accounts or settings.
- [x] Run `npm test`, `npm run build`, and formatting checks; expect exit 0.
- [x] Obtain a fresh review of the working diff, resolve material findings and
  leave the completed changes in this worktree for the user.
