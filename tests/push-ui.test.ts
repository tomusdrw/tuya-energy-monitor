import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n.js';
import { PushPreferencesForm } from '../src/PushSettings.js';
import { defaultPushKinds } from '../shared/push.js';
import { AlertList } from '../src/components.js';

test('receiver form localizes all categories and exposes the initial opt-in selection', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(PushPreferencesForm, {
          initial: { name: 'My phone', language, kinds: defaultPushKinds },
          onSave: async () => {},
          submitLabel: 'Enable notifications',
          disabled: false,
        }),
      }),
    );
    assert.ok(html.includes(language === 'pl' ? 'Przywrócenie odczytów' : 'Readings restored'));
    assert.ok(
      html.includes(language === 'pl' ? 'Problem z połączeniem Tuya' : 'Tuya connection problem'),
    );
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 7);
    assert.equal((html.match(/checked=""/g) ?? []).length, 6);
    assert.match(html, /name="receiverName"/);
  }
});

test('history labels push acceptance separately from skipped email delivery in both languages', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(AlertList, {
          items: [
            {
              id: 'x',
              homeId: null,
              kind: 'threshold',
              title: 'Energy',
              body: 'Body',
              createdAt: 1,
              status: 'skipped',
              sentAt: null,
              error: null,
              push: { submitted: 1, pending: 0, failed: 0, cancelled: 0 },
            },
          ],
        }),
      }),
    );
    assert.ok(html.includes(language === 'pl' ? 'Email: pominięto' : 'Email: not requested'));
    assert.ok(html.includes(language === 'pl' ? 'Push: przekazano 1' : 'Push: submitted 1'));
  }
});
