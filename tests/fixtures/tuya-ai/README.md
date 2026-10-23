# Tuya.ai contract fixtures

The properties and model fields come from the successful read-only diagnostic on
2026-10-23 (`end-user-statistics-heater.json`). It retained filtered `detail.properties`
and model properties, renaming `abilityId` to `dpId`; this fixture reverses that
rename. Energy value 370, DP 101, scale 3, and unit `kW·h` are unchanged.

The diagnostic did **not** retain complete response envelopes. `success`, `result`,
`device_id`, `services` and the JSON-encoded `model` wrapper are reconstructed from
the official Tuya contract. Device identity/name are synthetic; timestamps,
addresses, product identifiers, and credentials are omitted. These are recorded
payload fragments in documented envelopes, not a claim of an untouched raw capture.

Sources checked 2026-10-23:

- https://tuya.ai/developer/docs
- https://github.com/tuya/tuya-openclaw-skills/blob/master/tuya-smart-control/references/device-query.md
- https://github.com/tuya/tuya-openclaw-skills/blob/master/tuya-smart-control/references/device-control.md
