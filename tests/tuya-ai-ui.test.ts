import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n.js';
import { TuyaAiForm } from '../src/TuyaAiForm.js';

test('account Tuya.ai form renders secure entry, independent status and key actions in both languages', () => {
  for (const language of ['en', 'pl'] as const) {
    for (const configured of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(LanguageProvider, {
          initialLanguage: language,
          children: createElement(TuyaAiForm, {
            account: {
              id: 'a',
              tuyaAi: {
                configured,
                region: configured ? 'EU' : null,
                lastSuccess: configured ? Date.parse('2026-10-23T10:00Z') : null,
                error: null,
                healthy: configured,
                meteredDevices: configured ? 1 : 0,
              },
            },
            onSaved: () => {},
          }),
        }),
      );
      assert.ok(html.includes('Tuya.ai'));
      assert.ok(
        html.includes(language === 'en' ? 'Last successful reading' : 'Ostatni udany odczyt'),
      );
      assert.ok(html.includes(language === 'en' ? 'Smart Life history' : 'historii Smart Life'));
      if (configured) {
        assert.ok(html.includes(language === 'en' ? 'Change' : 'Zmień'));
        assert.ok(html.includes(language === 'en' ? 'Remove' : 'Usuń'));
        assert.ok(!html.includes('type="password"'));
      } else {
        assert.ok(html.includes('type="password"'));
        assert.ok(
          html.includes('autoComplete="off"') || html.includes('autoComplete="new-password"'),
        );
        assert.ok(html.includes(language === 'en' ? 'Check and save' : 'Sprawdź i zapisz'));
      }
    }
  }
});
