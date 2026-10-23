# Quick apartment switching

The owner approved the dropdown-and-arrows proposal and requested implementation.

Replace the apartment title with a native apartment selector when multiple homes
are available. Previous/next buttons follow the overview's order, show the current
position, and stop at the ends. Keep the selected 7/14/30-day history range when
switching directly between apartments. Retain the back link, apartment heading for
assistive technology, account/device subtitle, and reading status.

The selector must work on desktop and mobile, with keyboard controls and English
and Polish labels. Disambiguate duplicate names using account labels. One home
keeps its ordinary heading. Keep navigation available while detail data loads or
fails; never display another apartment's readings or rules under the chosen name.

Approaches considered: dropdown plus arrows (chosen for direct selection and quick
sequential browsing on both screen sizes); tabs (space grows with home count);
sidebar list (desktop only without another mobile interaction).

Implementation decisions: reuse overview data and hash routes, preserve HomePage's
range state, and add no dependencies or backend endpoints. Out of scope: device
detail navigation, persistent range preferences, search and a global sidebar redesign.
