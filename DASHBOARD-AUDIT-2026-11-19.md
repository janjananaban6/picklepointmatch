# Dashboard code audit — 19 November 2026

## Scope
Reviewed `dashboard.html` and its linked `dashboard.css` and `dashboard.js`. Changes are limited to these three dashboard files; the rest of the application was left as supplied.

## Findings
- `dashboard.html` is a small page shell (65 lines) with one stylesheet reference and one deferred script reference. No repeated page sections or duplicate asset includes were found.
- `dashboard.css` had accumulated repeated responsive/layout overrides from successive iterations. Ninety-one exact duplicate declarations (same selector, media context, property, value and priority) were removed, keeping the last occurrence so the effective cascade is retained. The stylesheet still contains intentionally layered responsive overrides; those were not blindly flattened because doing so could change the design.
- `dashboard.js` had no duplicate top-level function declarations in the audit. Its repeated background refresh behavior did, however, rebuild the dashboard ranking panel and replay its entrance animation even when the displayed ranking markup was unchanged.

## Updates made
- Removed 91 exact redundant CSS declarations.
- Corrected the narrow-phone dashboard side stack so the map and court-status panels return to a single-column layout at widths up to 600px, rather than being forced back into cramped two-column layout by a later tablet rule.
- Used stable small-viewport-height sizing (`svh`, with `vh` fallback) for the dashboard frame on mobile/tablet to reduce layout movement when browser chrome expands or collapses.
- Prevented unchanged dashboard rankings from being re-created on every background refresh; preserved the ranking panel's scroll position when the ranking content actually changes and limited the entrance animation to first render.
- Changed attendance bars so existing bars transition to new heights without collapsing to zero and popping back up. First appearance animation and reduced-motion handling remain supported.
- Updated dashboard asset query strings to force browsers to fetch the revised CSS and JavaScript.

## Validation
- `node --check dashboard.js` passed.
- The CSS parsed successfully with PostCSS: 1,231 rules and 4,237 declarations after cleanup.
- The served dashboard CSS and JavaScript assets both returned HTTP 200 from the local audit server.
- A browser-rendered screenshot/device simulation could not be completed because the available browser environment blocked page navigation. Therefore the source-level fixes are validated, but final visual confirmation on actual desktop, iPad and mobile browsers remains recommended.


## Follow-up fix — duplicate names in Overall Player Rankings

### Finding
- The dashboard's ranking helpers (`getRankedPlayers()` and `topRankedPlayers()`) previously ranked every Registered Player Cloud profile independently. They did not collapse duplicate profiles with the same normalized player name.
- Match and attendance statistics are already indexed by normalized player name. As a result, repeated profiles for the same displayed name could appear as multiple ranking rows while sharing the same name-based statistics.
- The included `data/registered-players.csv` snapshot did not contain exact duplicate names when checked. The live hosted database may contain older records that are not present in the uploaded project snapshot; the UI fix protects against those without deleting stored profiles.

### Updates made
- Added consistent player-name normalization that ignores common zero-width formatting characters, which can make visually identical names compare unequal.
- Added a ranking-only deduplication pass keyed by normalized player name. Both the dashboard's top-20 `ranking-panel` and the full Player Rankings page now use the de-duplicated list.
- When duplicate profiles are found, the ranking keeps the most complete profile, fills missing profile details from the other copy, and preserves the highest saved match/win/loss counters. It does not delete or rewrite Registered Player Cloud records.
- Bumped the dashboard JavaScript asset version so browsers fetch the update.

### Validation
- `node --check dashboard.js` passed.
- Regression test passed using duplicate records with case differences, extra whitespace, and zero-width characters; the dashboard top rankings and full ranking list both returned one row for that normalized name.
- ZIP archive integrity check passed.
- The live Render database is not directly accessible from the supplied source archive, so existing duplicate source records (if any) are left untouched. They are hidden as duplicate ranking rows by this non-destructive fix.


## Follow-up fix — name expansion and previous-name protection

### Behavior
- Editing an existing Registered Player Cloud profile from a shorter name (for example, `Juan`) to an expanded name (`Juan Dela Cruz`) now saves the former spelling in `nameAliases` **after** the canonical name changes.
- The current name and saved previous names are used for exact normalized duplicate checks in player registration, profile updates, imports, queue safeguards, panel lists, and dashboard rankings. Case, repeated spaces, Unicode normalization, and zero-width formatting characters are ignored.
- CSV export/import preserves the aliases as a JSON array, so the link between the old and expanded spelling survives an export/re-import and shared database save.
- Two unrelated names that merely share a first name are not automatically merged. The app uses a saved former-name relationship rather than guessing from a prefix.

### Important usage
- Open the existing player in Registered Player Cloud, choose Edit, replace the name with the expanded spelling, and save. That change retains the profile and automatically remembers the old name.
- When registering someone already in the Cloud, use the existing profile suggestion instead of creating a new entry.
- No new user-entered Cloud ID is required for name matching. The application retains its existing internal row reference for editing/check-in plumbing; duplicate detection is based on the current name and saved previous names.

### Validation
- `node --check` passed for `server.js`, `script.js`, `dashboard.js`, `registration-app.js`, `panel.js`, and `queueing-app-loader.js`.
- Regression tests passed for rename-to-expanded-name, matching by both old and current names, case/whitespace/invisible-character normalization, not merging an unrelated same-first-name profile, CSV alias round-trip, and ranking deduplication using explicit alias links.
- The live Render database and real browser/device workflow were not directly exercised from the supplied archive; deploy the package and verify the actual hosted records on desktop/tablet/mobile.
