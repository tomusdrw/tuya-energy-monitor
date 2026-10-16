import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  readLanguage,
  saveLanguage,
  translate,
  formatNumber,
  formatDate,
  formatDay,
} from '../shared/i18n.js';
import { LanguageProvider, LanguageSwitcher } from '../src/i18n.js';

test('English is the default with absent, invalid or inaccessible preference storage', () => {
  assert.equal(readLanguage(), 'en');
  assert.equal(readLanguage({ getItem: () => 'de' }), 'en');
  assert.equal(
    readLanguage({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    'en',
  );
  assert.match(readFileSync('index.html', 'utf8'), /<html lang="en">/);
});

test('explicit Polish preference survives saving and reading, with storage failure tolerated', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  saveLanguage('pl', storage);
  assert.equal(readLanguage(storage), 'pl');
  saveLanguage('en', storage);
  assert.equal(readLanguage(storage), 'en');
  assert.doesNotThrow(() =>
    saveLanguage('pl', {
      setItem: () => {
        throw new Error('blocked');
      },
    }),
  );
});

test('translations interpolate complete sentences and preserve user-supplied names literally', () => {
  const messages = { 'Account {name} needs attention.': 'Konto {name} wymaga uwagi.' };
  assert.equal(
    translate('en', 'Account {name} needs attention.', messages, { name: 'Łódź {other}' }),
    'Account Łódź {other} needs attention.',
  );
  assert.equal(
    translate('pl', 'Account {name} needs attention.', messages, { name: 'Home' }),
    'Konto Home wymaga uwagi.',
  );
  assert.equal(translate('pl', 'Unknown message', messages), 'Unknown message');
});

test('formats numbers and dates for the selected language without changing Warsaw calendar dates', () => {
  assert.equal(formatNumber('en', 1.25), '1.25');
  assert.equal(formatNumber('pl', 1.25), '1,25');
  assert.equal(formatNumber('en', null), '—');
  assert.equal(formatDate('en', null), 'No readings yet');
  assert.equal(formatDate('pl', null), 'Jeszcze nie odczytano');
  const at = Date.parse('2026-10-16T22:30:00Z');
  assert.match(formatDate('en', at, false), /17 Oct/);
  assert.match(formatDate('pl', at, false), /17 paź/);
  assert.match(formatDay('en', '2026-10-16'), /16 Oct/);
  assert.match(formatDay('pl', '2026-10-16'), /16 paź/);
  assert.notEqual(formatDate('en', 0), 'No readings yet');
});

test('language switch is accessible in either language and reflects the selection', () => {
  for (const language of ['en', 'pl'] as const) {
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, {
        initialLanguage: language,
        children: createElement(LanguageSwitcher),
      }),
    );
    assert.ok(html.includes('English'));
    assert.ok(html.includes('Polski'));
    assert.ok(html.includes(language === 'en' ? 'Language' : 'Język'));
    assert.match(html, new RegExp(`<option[^>]*value="${language}"[^>]*selected=""`));
  }
});
