import { mount, window } from './helpers/dom.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement, type ReactNode } from 'react';
import { EnergyChart } from '../src/components.js';
import { ClimateHistory } from '../src/Climate.js';
import { LanguageProvider } from '../src/i18n.js';
import type { HistoryPoint, ClimateHistoryPoint } from '../shared/types.js';

const points: HistoryPoint[] = [
  {
    day: '2026-10-22',
    kwh: 3.5,
    measuredKwh: 2,
    powerKwh: 1,
    estimatedKwh: 0.5,
    heatingHours: 1,
    coverage: 0.75,
  },
  {
    day: '2026-10-23',
    kwh: 0,
    measuredKwh: 0,
    powerKwh: null,
    estimatedKwh: null,
    heatingHours: null,
    coverage: 1,
  },
  {
    day: '2026-10-24',
    kwh: null,
    measuredKwh: null,
    powerKwh: null,
    estimatedKwh: null,
    heatingHours: null,
    coverage: 0,
  },
];

function localized(children: ReactNode, language: 'pl' | 'en' = 'pl') {
  return createElement(LanguageProvider, { initialLanguage: language, children });
}

test('hover shows the selected energy day immediately, including zero and missing readings, in both languages', async () => {
  for (const language of ['pl', 'en'] as const) {
    const view = await mount(localized(createElement(EnergyChart, { points }), language));
    try {
      const svg = view.container.querySelector('svg')!;
      const targets = svg.querySelectorAll('rect[tabindex="0"]');
      assert.equal(targets.length, 3, 'Every day needs a full-height hover target');
      assert.equal(view.container.querySelector('[role="tooltip"]'), null);
      await act(async () =>
        targets[0].dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
      );
      const tooltip = () => view.container.querySelector('[role="tooltip"]')!;
      assert.ok(tooltip());
      assert.equal(tooltip().querySelector('time')?.getAttribute('datetime'), '2026-10-22');
      for (const value of language === 'pl'
        ? ['3,50 kWh', '2,00 kWh', '1,00 kWh', '0,50 kWh', '75%']
        : ['3.50 kWh', '2.00 kWh', '1.00 kWh', '0.50 kWh', '75%']) {
        assert.ok(tooltip().textContent.includes(value), `Missing ${value}`);
      }
      await act(async () =>
        targets[1].dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
      );
      assert.ok(tooltip().textContent.includes(language === 'pl' ? '0,00 kWh' : '0.00 kWh'));
      await act(async () =>
        targets[2].dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
      );
      assert.ok(tooltip().textContent.includes(language === 'pl' ? 'Brak danych' : 'No data'));
      await act(async () =>
        svg.dispatchEvent(
          new window.PointerEvent('pointerout', {
            bubbles: true,
            relatedTarget: window.document.body,
          }),
        ),
      );
      assert.equal(tooltip(), null, 'Leaving the chart dismisses the tooltip');
    } finally {
      await view.unmount();
    }
  }
});

test('daily tooltips support keyboard focus, Escape, touch and changing the history range', async () => {
  const view = await mount(localized(createElement(EnergyChart, { points })));
  try {
    const target = view.container.querySelector('svg rect[tabindex="0"]');
    assert.ok(target);
    await act(async () =>
      target.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })),
    );
    const tooltip = view.container.querySelector('[role="tooltip"]');
    assert.ok(tooltip);
    assert.equal(target.getAttribute('aria-describedby'), tooltip.id);
    await act(async () =>
      target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    assert.equal(view.container.querySelector('[role="tooltip"]'), null);
    await act(async () =>
      target.dispatchEvent(
        new window.PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }),
      ),
    );
    assert.ok(view.container.querySelector('[role="tooltip"]'));
    await act(async () => {
      target.dispatchEvent(
        new window.PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }),
      );
      target.dispatchEvent(
        new window.PointerEvent('pointerout', {
          pointerType: 'touch',
          bubbles: true,
          relatedTarget: window.document.body,
        }),
      );
    });
    assert.ok(
      view.container.querySelector('[role="tooltip"]'),
      'Touch readings remain visible after releasing the finger',
    );
    await act(async () =>
      window.document.body.dispatchEvent(
        new window.PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }),
      ),
    );
    assert.equal(
      view.container.querySelector('[role="tooltip"]'),
      null,
      'Tapping outside dismisses the reading',
    );
    await act(async () =>
      target.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })),
    );
    assert.ok(view.container.querySelector('[role="tooltip"]'));
    await view.render(localized(createElement(EnergyChart, { points: points.slice(1) })));
    assert.equal(
      view.container.querySelector('[role="tooltip"]'),
      null,
      'Removed days must not leave stale values visible',
    );
  } finally {
    await view.unmount();
  }
});

test('climate hover shows average, minimum and maximum with units and preserves missing days', async () => {
  const missing = {
    average: null,
    minimum: null,
    maximum: null,
    count: 0,
    samples: 0,
    oldestObservedAt: null,
    latestObservedAt: null,
  };
  const history: ClimateHistoryPoint[] = [
    {
      day: '2026-10-22',
      temperature: { ...missing, average: -2, minimum: -5, maximum: 0, count: 2, samples: 4 },
      humidity: { ...missing, average: 0, minimum: 0, maximum: 0, count: 1, samples: 1 },
    },
    { day: '2026-10-23', temperature: missing, humidity: missing },
  ];
  const view = await mount(localized(createElement(ClimateHistory, { points: history })));
  try {
    const charts = view.container.querySelectorAll('svg');
    for (const [index, values] of [['-2,0 °C', '-5,0 °C', '0,0 °C'], ['0,0 %']].entries()) {
      const targets = charts[index].querySelectorAll('rect[tabindex="0"]');
      assert.equal(targets.length, 2);
      await act(async () =>
        targets[0].dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
      );
      const tooltip = view.container.querySelector('[role="tooltip"]')!;
      assert.ok(tooltip);
      for (const value of values) assert.ok(tooltip.textContent.includes(value));
      await act(async () =>
        targets[1].dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
      );
      assert.ok(
        view.container.querySelector('[role="tooltip"]')!.textContent.includes('Brak odczytów'),
      );
      await act(async () =>
        charts[index].dispatchEvent(
          new window.PointerEvent('pointerout', {
            bubbles: true,
            relatedTarget: window.document.body,
          }),
        ),
      );
    }
  } finally {
    await view.unmount();
  }
});
