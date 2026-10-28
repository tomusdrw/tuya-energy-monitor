# Summary device selection

Implement the scope approved in the conversation: configure heating participation and temperature sensors from their respective apartment summaries using one shared selection UI. Named groups remain a separate feature in issue #15.

## Behavior

- Heating uses the existing saved `included` selection, totals, history and alerts.
- Temperature gets an independent, default-on `temperatureIncluded` selection. It applies to the apartment average, minimum, maximum, counts and temperature history, including the overview card. Individual readings remain available.
- Humidity retains its current behavior; an independent humidity selection was not agreed.
- A shared accessible picker opens from the energy and temperature summaries and from shortcuts on device details. Checkboxes save immediately, show pending/error states and preserve selection when a request fails.
- Temperature candidates include devices with previously observed temperatures even when currently offline, absent or missing a reading. Empty selection and unavailable readings show a dash, never a fabricated zero.
- Remove participation switches and the Monitoring column from device lists. Keep ignore/restore actions and show participation labels, including “Poza średnią”. Ignore/restore retains its existing energy-only semantics.
- Existing heating selections survive the change. Temperature selections survive collection, rediscovery and restart. History uses the current selection without deleting samples or changing which apartment owned an observation.
- English and Polish copy, responsive layout and keyboard access follow existing application conventions.

## Approaches

The initial proposal allowed a per-device checkbox, but editing devices individually is cumbersome. The user selected configuration next to both summaries for consistency. A shared native dialog keeps one interaction pattern on desktop/mobile and lets device details open the same picker without adding route variants. An indoor/outdoor category would not cover arbitrary exclusions.

## Implementation choices

Persist one boolean in schema v10; expose temperature capability based on retained readings/history. Extend the existing authenticated device update endpoint. Keep the current aggregation rules and freshness cutoff, filtering only the selected temperature contributors. Do not add dependencies, remote heater control, new notification types or group configuration.

## Integration with main

Rebased onto #16 (separate device details and explicit configuration editing). Preserve its existing Edit/Save/Cancel workflow and atomic configuration endpoint; add the shared picker shortcuts to the new read-only detail view. Temperature updates compose with estimation updates in the same transaction.
