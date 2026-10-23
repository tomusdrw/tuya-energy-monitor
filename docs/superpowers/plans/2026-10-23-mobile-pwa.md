# Mobile PWA implementation plan

**Goal:** Make the existing monitoring application comfortable to install and use on a phone, with complete information on every screen.

**Architecture:** Retain React, Vite, hash routes and English/Polish translations. Serve a static web manifest and raster versions of the existing icon from `public/`. Use a persistent mobile navigation bar and responsive content; continue fetching private monitoring data from the server.

**Constraints:** Preserve measurement semantics, authentication and desktop functionality. Do not cache private API data or promise offline monitoring. No new runtime dependencies. Support 320px phones, landscape, tablets and desktop; respect safe areas, keyboard access and reduced motion.

**Approach:** Improve the existing interface in place. CSS-only shrinking would keep hidden device metadata and unreadable chart labels; a new UI framework would add unnecessary scope. The implementation choices below are agent defaults based on the request.

- [x] Add manifest (stable id, start URL, scope, standalone, theme/background colors), 192/512px icons, maskable icon and Apple touch icon. Document installation and HTTPS requirements.
- [x] Replace the mobile drawer with five labeled bottom destinations; keep desktop sidebar, active apartment state on drill-down, refresh, language and logout. Add skip link and route focus/scroll handling.
- [x] Keep source, freshness and today's energy visible in responsive device rows. Put device history before configuration. Give primary consumption a full-width mobile card.
- [x] Make charts resize without shrinking text, and expose daily values through a touch/keyboard-accessible disclosure. Wrap forms, headings, badges, notifications and long names; use 44px targets and 16px mobile inputs.
- [x] Check populated, empty and failure states in both languages with the collaborative browser at 320/390/768/1280px. Exercise navigation, history range, configuration, QR connection and logout. Run the full test suite, production build, and inspect served PWA assets.

**Review focus:** Long Polish labels and raw device fields; long names/URLs; missing readings versus zero; chart date labels at 30 days; fixed navigation covering forms or focused controls.

**Validation record:** Initial test attempt found dependencies absent (`tsx: command not found`); run `npm ci` before baseline verification. Existing T3 worktree is already isolated.


## Completed verification

- `npm test`: 124 passing tests. The new daily-reading accessibility test first failed for the missing disclosure, then passed in English and Polish; zero remains distinct from missing data.
- `npm run build`: type checking, Vite production assets and server compilation pass. `git diff --check` passes.
- Browser: login, overview, apartments, apartment detail, four device source states, accounts, notifications, settings and not-found checked at 320/390/768/1024/1280px. No document overflow. Touch controls are at least 44px in mobile layouts; inputs use 16px text. Empty accounts/apartments/overview/notifications and a network failure were also exercised.
- Browser interactions: 30-day chart and daily disclosure, apartment navigation and active state, saving rules, saving estimation, expanding diagnostics, QR generation/error, language switching and logout/login.
- Independent read-only review identified a wide-phone landscape safe-area gap. Fixed the mobile breakpoint for short viewports up to 1100px wide and verified 932×430 with simulated 59px side/21px bottom insets; also checked the 901px transition.
- Production Fastify checks: manifest responds as `application/manifest+json`; root start URL and all four PNG dimensions resolve before login; private API still responds 401 with `Cache-Control: no-store`. Production browser loads/decode icons and logs in without development scripts or console errors.
- Limits: browser viewport checks are not physical iOS/Android installation or keyboard testing. QR tests used an isolated synthetic connector, not a live Tuya account. Offline monitoring is not provided.
