# Open Play Session Import Repair

**Build:** `ppm-session-import-merge-20261126-v1`

## Confirmed cause

The previous importer treated an existing Session ID as a duplicate and removed that row from the browser request. The server also attached incoming linked matches only to sessions newly created in the same request. Consequently, an existing session could not receive missing attendance or linked match records through a repeat import.

A malformed date or Participants/Matches JSON value in one CSV row also stopped the browser from parsing the entire CSV, preventing other valid rows from being reviewed.

## Changes

- Existing sessions owned by the signed-in organizer are now eligible for a non-destructive merge.
- New attendees and linked matches are added without replacing saved records.
- Manually removed attendees are not re-added by the import.
- Existing session/match fields are populated only when the stored value is missing.
- A repeated Session ID within one CSV is combined into one session.
- Repeated matches with an existing Session ID + Match ID are not duplicated. Empty fields on an existing match may be filled from the CSV.
- Missing match IDs receive a deterministic ID so repeating the same CSV does not create new copies.
- Invalid date/JSON data is isolated to its row; other valid CSV rows remain importable.
- Live sessions and sessions belonging to another organizer are rejected.
- Dashboard cache tokens and the `/api/health` build marker were updated together.

## Validation performed

- `node --check server.js` passed.
- `node --check dashboard.js` passed.
- Browser-import parser/preview regression test passed: existing row displayed as Merge, new row displayed as Ready, and malformed date displayed as Invalid while the other rows remained eligible.
- Server merge regression test passed: existing session remained single, new session was added, attendance and linked matches were merged, an existing match's missing score was filled, duplicate matches were not added, match counts were recalculated, and a manually removed participant stayed removed.

## Deployment safety

Deploy the contents of this project folder to the existing Render service and keep the same PostgreSQL database, `DATABASE_URL`, `SESSION_SECRET`, and organizer credentials. Back up the database first. This source-only archive excludes local private `data/` files and `node_modules/`; do not replace the existing database or publish private organizer files.

After deployment, `/api/health` should report build `ppm-session-import-merge-20261126-v1`, `capabilities.sessionImport: true`, `sessionImportEndpoint: /api/organizer-dashboard/sessions/import`, and PostgreSQL storage.
