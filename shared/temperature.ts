import type { StatusField, TemperatureField, TemperatureMapping } from './types.js';

export function temperatureValue(
  fields: StatusField[],
  definition: TemperatureField,
): number | null {
  const field = fields.find((f) => f.code === definition.code);
  if (!field || typeof field.value !== 'number' || !Number.isFinite(field.value)) return null;
  // Full discovery can invalidate a saved mapping. Fast reads omit metadata.
  if (
    field.temperature !== undefined &&
    (field.temperature === null ||
      field.temperature.scale !== definition.scale ||
      field.temperature.unit !== definition.unit)
  )
    return null;
  const value = field.value / 10 ** definition.scale;
  return definition.unit === 'F' ? ((value - 32) * 5) / 9 : value;
}

export function suggestTemperatureMapping(fields: StatusField[]): TemperatureMapping | null {
  const find = (codes: string[]): TemperatureField | null => {
    for (const code of codes) {
      const field = fields.find((f) => f.code === code);
      if (field?.temperature && typeof field.value === 'number' && Number.isFinite(field.value)) {
        return { code, ...field.temperature };
      }
    }
    return null;
  };
  const current = find(['temp_current', 'current_temp', 'temp_current_f', 'current_temp_f']);
  const target = find(['temp_set', 'set_temp', 'temp_set_f', 'set_temp_f']);
  return current && target
    ? {
        current,
        target,
        switchCode: fields.some((f) => f.code === 'switch') ? 'switch' : null,
      }
    : null;
}

/** Temperature demand is an estimate of relay activity, not a relay measurement. */
export function temperatureHeatingState(
  fields: StatusField[],
  mapping: TemperatureMapping,
): 0 | 1 | null {
  const current = temperatureValue(fields, mapping.current);
  const target = temperatureValue(fields, mapping.target);
  if (current === null || target === null) return null;
  if (mapping.switchCode) {
    const power = fields.find((f) => f.code === mapping.switchCode)?.value;
    if (power === false || power === 0 || power === 'off') return 0;
    if (power !== true && power !== 1 && power !== 'on') return null;
  }
  // Ignore only floating-point conversion noise, not a thermostat hysteresis band.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(target)) * 8;
  return target - current > roundoff ? 1 : 0;
}
