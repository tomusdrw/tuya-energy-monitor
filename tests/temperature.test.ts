import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTemperatureMapping, temperatureHeatingState } from '../shared/temperature.js';
import type { StatusField, TemperatureMapping } from '../shared/types.js';

const mapping: TemperatureMapping = {
  current: { code: 'temp_current', scale: 1, unit: 'C' },
  target: { code: 'set_temp', scale: 0, unit: 'C' },
  switchCode: 'switch',
};
const fields = (current: any = 210, target: any = 22, power: any = true): StatusField[] => [
  { code: 'temp_current', value: current },
  { code: 'set_temp', value: target },
  { code: 'switch', value: power },
];

test('temperature comparison applies independent scales, equality is idle, switch off overrides demand', () => {
  for (const [current, target, power, expected] of [
    [210, 22, true, 1],
    [220, 22, true, 0],
    [230, 22, true, 0],
    [210, 22, false, 0],
    [210, 22, 0, 0],
    [210, 22, 1, 1],
    [-50, -4, true, 1],
    ['210', 22, true, null],
    [true, 22, true, null],
    [210, NaN, true, null],
    [Infinity, 22, true, null],
    [210, 22, 'unknown', null],
  ]) {
    assert.equal(temperatureHeatingState(fields(current, target, power), mapping), expected);
  }
});

test('temperature comparison requires fresh configured fields, including switch and compatible metadata', () => {
  for (const code of ['temp_current', 'set_temp', 'switch']) {
    assert.equal(
      temperatureHeatingState(
        fields().filter((f) => f.code !== code),
        mapping,
      ),
      null,
    );
  }
  assert.equal(temperatureHeatingState(fields().slice(0, 2), { ...mapping, switchCode: null }), 1);
  const changed = fields();
  changed[0].temperature = { scale: 0, unit: 'C' };
  assert.equal(temperatureHeatingState(changed, mapping), null);
  changed[0].temperature = null;
  assert.equal(temperatureHeatingState(changed, mapping), null);
  changed[0].temperature = { scale: 1, unit: 'C' };
  assert.equal(temperatureHeatingState(changed, mapping), 1);
});

test('temperature comparison converts Fahrenheit to Celsius before comparing', () => {
  const fahrenheit: TemperatureMapping = { ...mapping, target: { ...mapping.target, unit: 'F' } };
  assert.equal(temperatureHeatingState(fields(200, 68), fahrenheit), 0);
  assert.equal(temperatureHeatingState(fields(195, 68), fahrenheit), 1);
  assert.equal(temperatureHeatingState(fields(210, 68), fahrenheit), 0);
  const decimalFahrenheit = { ...fahrenheit, target: { ...fahrenheit.target, scale: 1 } };
  assert.equal(temperatureHeatingState(fields(205, 689), decimalFahrenheit), 0);
  assert.equal(temperatureHeatingState(fields(204, 689), decimalFahrenheit), 1);
});

test('discovery recognizes target aliases and requires declared scale and units, never guesses from magnitude', () => {
  for (const target of ['set_temp', 'temp_set', 'temp_set_f']) {
    const f = fields();
    f[0].temperature = { scale: 1, unit: 'C' };
    f[1] = { code: target, value: 22, temperature: { scale: 0, unit: 'C' } };
    assert.deepEqual(suggestTemperatureMapping(f), {
      ...mapping,
      target: { ...mapping.target, code: target },
    });
  }
  assert.equal(suggestTemperatureMapping(fields()), null);
  assert.equal(suggestTemperatureMapping([{ code: 'switch', value: true }]), null);
});
