# Temperature-based heating estimation

The user wants runtime estimates for thermostats such as those in Świdnicka that expose current and target temperatures but no relay state.

Use a selectable temperature method: current temperature below target means estimated heating; equality or above means idle. An exposed thermostat power switch must be on; off means idle, and an absent/invalid configured switch means unknown. Missing/non-numeric temperatures, offline devices, and gaps remain unknown. Normalize each temperature using its own declared scale and unit. Recognize `set_temp`/`temp_set` and `current_temp`/`temp_current`, including Fahrenheit equivalents. Do not guess numeric scales or add arbitrary hysteresis.

## Approaches

- Keep only relay estimation: cannot support the requested devices.
- Replace every relay mapping: discards a more direct signal and changes existing configuration.
- Add temperature estimation alongside relay estimation (implementation choice): suggest it when no relay mapping exists; retain saved configurations and measured energy/power precedence. The user was asked optionally whether to make it universal; absent further direction, use this default.

Store the selected temperature fields, units, scales, and optional switch in a nullable configuration column. Cloud status discovery exposes numeric temperature metadata independently of current readings; persist these definitions separately so missing values cannot conceal a scale change. Fast polls reuse saved configuration, never stale temperature values. Changed metadata invalidates the saved mapping until refreshed. Configuration changes start a new baseline and do not recalculate history. Existing energy integration and its 180-second continuity limit stay in use.

The UI offers the two methods, detected temperature fields, and explains that temperature demand is an approximation rather than an observed relay. Energy still requires enabled estimation and rated heating power. No device commands, live account changes, historical backfill, or dependencies are required.
