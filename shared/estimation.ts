import type { EstimationConfig, StatusField, StatusValue } from './types.js';

export type HeatingMapping = Pick<EstimationConfig, 'heatingCode' | 'onValues' | 'offValues'>;

/** Keep raw types: the string "1", number 1 and boolean true are different states. */
export function statusChoices(field: StatusField): StatusValue[] {
  return [
    ...new Set([
      ...(field.values ?? []),
      ...(typeof field.value === 'boolean' ? [true, false] : []),
      field.value,
    ]),
  ];
}

export function suggestHeatingMapping(field: StatusField): HeatingMapping | null {
  if (!['work_state', 'heating_state', 'heat_state', 'relay_state'].includes(field.code))
    return null;
  const values = statusChoices(field);
  const onValues = values.filter((v) => ['heating', 'heat', true, 1].includes(v));
  const offValues = values.filter((v) => ['standby', 'idle', 'off', false, 0].includes(v));
  return onValues.length && offValues.length
    ? { heatingCode: field.code, onValues, offValues }
    : null;
}
