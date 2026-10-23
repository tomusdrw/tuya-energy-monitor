import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeSwitcher } from '../src/HomeSwitcher.js';
import { PageTitle } from '../src/components.js';
import { LanguageProvider } from '../src/i18n.js';

const homes = [
  { id: 'a', name: 'Centrum', accountLabel: 'Private' },
  { id: 'b', name: 'Mokotów', accountLabel: 'Private' },
  { id: 'c', name: 'Centrum', accountLabel: 'Rental' },
];

function render(id: string, language: 'en' | 'pl' = 'en', options = homes) {
  return renderToStaticMarkup(
    createElement(LanguageProvider, {
      initialLanguage: language,
      children: createElement(HomeSwitcher, { id, homes: options }),
    }),
  );
}

test('switcher selects the current apartment and identifies its neighbors in overview order', () => {
  const html = render('b');
  assert.match(html, /<option value="b" selected="">Mokotów<\/option>/);
  assert.match(html, /aria-label="Previous apartment: Centrum · Private"/);
  assert.match(html, /aria-label="Next apartment: Centrum · Rental"/);
  assert.match(html, /2 of 3/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('switcher disables the unavailable neighbor at either end without wrapping', () => {
  const first = render('a').match(/<button\b[^>]*>/g)!;
  assert.equal(first.length, 2);
  assert.match(first[0], /disabled=""/);
  assert.doesNotMatch(first[1], /disabled=""/);
  assert.match(first[1], /aria-label="Next apartment: Mokotów"/);
  const last = render('c').match(/<button\b[^>]*>/g)!;
  assert.doesNotMatch(last[0], /disabled=""/);
  assert.match(last[0], /aria-label="Previous apartment: Mokotów"/);
  assert.match(last[1], /disabled=""/);
});

test('switcher distinguishes duplicate names by account and translates accessible controls', () => {
  const html = render('b', 'pl');
  assert.match(html, /aria-label="Przełącz mieszkanie"/);
  assert.match(html, /aria-label="Poprzednie mieszkanie: Centrum · Private"/);
  assert.match(html, /aria-label="Następne mieszkanie: Centrum · Rental"/);
  assert.match(html, /2 z 3/);
  assert.match(html, /<option value="a">Centrum · Private<\/option>/);
  assert.match(html, /<option value="c">Centrum · Rental<\/option>/);
});

test('empty, single and unknown apartment lists do not offer misleading navigation', () => {
  assert.equal(render('a', 'en', []), '');
  assert.equal(render('a', 'en', homes.slice(0, 1)), '');
  assert.equal(render('missing'), '');
});

test('page title retains an apartment heading and subtitle when the selector replaces its visible title', () => {
  const html = renderToStaticMarkup(
    createElement(PageTitle, {
      title: 'Mokotów',
      subtitle: 'Private · Devices: 4',
      titleControl: createElement(HomeSwitcher, { id: 'b', homes }),
    }),
  );
  assert.match(html, /<h1\b[^>]*>Mokotów<\/h1>/);
  assert.match(html, /Private · Devices: 4/);
  assert.match(html, /<select\b/);
});
