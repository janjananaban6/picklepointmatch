# Pickle Point Match — Code Cleanup Report

**Date:** 26 November 2026  
**Package type:** Source-only cleanup package

## Changes made

- Removed **390 exact duplicate CSS declarations** across the active stylesheets. A declaration was removed only when the selector, media/support context, property, value, and `!important` priority matched exactly; the last occurrence was retained. Different responsive rules and intentional overrides were left in place.
- Removed two stylesheets with no page references and which are not in the server's static-file allowlist: `dashboard-shell.css` and `live-page-overrides.css`.
- Removed five unreferenced PNG assets: `dashboard-books-icon.png`, `dashboard-logout-icon.png`, `dashboard-settings-icon.png`, `leaderboard-filter-icon.png`, and `reclub-brand-logo.png`.
- Kept all active HTML pages, JavaScript files, active stylesheets, referenced images, server routes, and package manifests unchanged apart from the CSS duplicate cleanup.
- Excluded `node_modules/` from the ZIP. Render/local setup installs the locked dependency from `package-lock.json`.
- Excluded runtime files from `data/` and retained only `data/.gitkeep`. The uploaded archive included private organizer/player/session records; those belong in the private backup/database, not a source-code deployment package.

## Validation performed

- All **14 JavaScript files** passed `node --check`.
- All **11 inline JavaScript blocks** extracted from the HTML pages passed `node --check`.
- All **11 active CSS files** parsed successfully with PostCSS.
- All **7 HTML pages** parsed; each has a responsive viewport meta tag.
- All local script, stylesheet, and image references found in the HTML resolve to files in the package.
- `package.json` and `package-lock.json` package metadata and the `pg` dependency match.
- No exact duplicate declaration remains under the same selector and media/support context in the active CSS files.
- No duplicate top-level function declarations were found in the JavaScript files.
- No automated test script is defined in `package.json`.

## Important limits and deployment safety

- The app declares **Node.js 24 or newer (below 27)**. The available review environment had Node.js 22, so JavaScript syntax was checked, but the full application was not started under its supported Node runtime. A live PostgreSQL integration test and hands-on iOS Safari, Android Chrome, Windows Chrome/Edge, and tablet testing were not performed.
- The cleanup package does **not** deploy itself to Render or directly update devices. Deploy it to the **existing Render service**, keeping its existing `DATABASE_URL` and `SESSION_SECRET`; after deployment, all devices visiting the same hosted URL receive the updated site when they reload.
- **Do not deploy this source-only package to a new/empty database as a replacement for your records.** Before deploying, back up the existing PostgreSQL database and confirm the live app's `/api/health` reports PostgreSQL storage. Keep the original uploaded ZIP as a private backup until the hosted records are verified.
- Do not commit runtime `data/` records, credentials, player details, or local environment files to a public repository.

## Intentionally not merged

The page stylesheets remain separate because their order and page-specific selectors are part of the current layout. Combining them without a browser/device regression test could change the cascade and cause the very layout glitches this cleanup is intended to avoid.
