# Pickle Point Match — Security Review and Source Package Notes

**Review date:** 28 November 2026  
**Package type:** Source-only deployment package

## What was reviewed

- Registration page and registration client script (`Registration.html`, `registration-app.js`).
- Public Live View page and renderer (`live.html`, `live-view.js`).
- Login page/client and server-side authentication routes (`index.html`, `login.js`, `server.js`).
- Static file allowlist, security response headers, health endpoint, and storage startup guard.
- Included runtime JSON/CSV files for obvious script/iframe/JavaScript-URL indicators.

## Findings and changes in this package

1. The uploaded ZIP contained `node_modules/` and populated `data/` files despite the repository `.gitignore` excluding both. The `data/` directory contained private organizer account records, player information, registration exports, and match/session-related records. This package now includes only `data/.gitkeep` and excludes `node_modules/`.
2. `.gitignore` now also excludes generated ZIP archives to reduce the chance of accidentally committing a deployment or backup archive.
3. The README's expected `/api/health` build identifier was stale. It now matches the current `APP_BUILD_VERSION` in `server.js`: `ppm-player-edit-actions-20261128-v1`.
4. No obvious `eval`, `new Function`, obfuscated JavaScript, unexpected remote script include, or injected iframe was found in the inspected application files. The Registration and Live View renderers escape or use text-only DOM APIs for the user-provided text paths reviewed.
5. The application source, routes, registration workflow, queue logic, player data model, and live rendering code were not otherwise changed. This avoids altering working application behavior without evidence that a particular function caused the browser warning.

## Important limitations

- A static source review cannot prove that the currently deployed Render service is uncompromised or that Google Safe Browsing has classified it incorrectly.
- The uploaded ZIP alone cannot show whether the current Render service is using PostgreSQL, whether its deployed code matches this archive, or which exact URL Google flagged.
- The Google warning in the supplied screenshot is a Google Safe Browsing phishing/social-engineering warning, not simply an SSL certificate error. Removing private files from this source archive does not itself clear a Safe Browsing warning.
- After the actual cause is corrected, the owner must review **Google Search Console → Security & Manual Actions → Security Issues** and request a review when Google offers that option.

## Deploy safely — do not skip these checks

1. Keep the original uploaded ZIP private as a backup; do not publish its `data/` folder or the populated JSON/CSV files in a public GitHub repository.
2. Back up the existing Render PostgreSQL database before deployment.
3. Check the currently deployed service's `/api/health`. It must report `"storage":"postgresql"`. Do not deploy this source-only package if it reports `json-file`, or if you cannot verify the database state.
4. Deploy to the **existing Render web service and existing repository/branch**, preserving `DATABASE_URL` and `SESSION_SECRET`. Do not create a new database or replace the existing one as part of this package update.
5. After deployment, verify organizer login, registration, queueing, Live View, the Panel, and the main dashboard. Then check `/api/health` again.
6. If any private data files were ever committed to a public repository, treat the data as exposed and rotate affected credentials/secrets. `.gitignore` does not erase files from Git history.

## Validation

The source files in this package are subject to JavaScript syntax checks and local asset-reference checks. The review environment uses Node.js 22, while the project declares Node.js 24–26; the application was not started here and no live PostgreSQL, mobile-browser, Render deployment, or Google Safe Browsing review was performed.
