# HUSAY DINKERS — Connected Pickle Point Match App

The HUSAY DINKERS management dashboard at `/manage` is the single organizer dashboard, served internally by `dashboard.html` with `dashboard.css` and `dashboard.js`. It reads and manages the same organizer-scoped player, session, attendance and match records as the original Pickle Point Match queueing system. There is no second dashboard database.

## Deploy into the existing app

If the original queueing system is already online on Render, deploy this project to the **same GitHub repository/branch and the same Render web service**. Keep the existing `DATABASE_URL`, `SESSION_SECRET`, organizer accounts and other environment variables. Do not create a new database or Blueprint for the dashboard.

## Session CSV import backend verification

The session CSV importer uses `POST /api/organizer-dashboard/sessions/import` in `server.js`.
The backend and dashboard assets are versioned together. Deploy the **complete project root**
to the same Render web service and branch. The ZIP is laid out with `server.js` and
`package.json` at its top level so the Render service Root Directory can point directly
at the extracted repository root.

After deploying, verify `/api/health` on the same Render domain: it must report build
`ppm-session-import-merge-20261126-v1` and `capabilities.sessionImport: true`. If not, the
existing Render service is still running an older backend or the wrong repository branch
or Root Directory was deployed. See `SESSION-IMPORT-DEPLOYMENT-FIX.txt`.

Existing Session IDs are now merged instead of skipped. The import adds missing
attendance and linked matches while preserving populated session/match fields and
respecting manually removed attendees. A malformed date or JSON value is isolated to
its own CSV row so other valid rows can still be imported.

## Main management dashboard

- `/manage` — only organizer management dashboard.
- `/dashboard` and `/dashboard.html` — legacy route aliases redirect to `/manage`; the older `/husay-manager.html` filename also redirects there.
- Organizer sign-in at `/` opens `/manage` by default.

## Existing queueing pages kept unchanged

| Page | URL | Purpose |
|---|---|---|
| Organizer login | `/` | Existing organizer sign-in |
| Management dashboard | `/manage` | Overview, sessions, players, attendance, matches, rankings, courts, reports and workspace settings |
| Session setup | `/session` | Start or end the real open-play session |
| Live queueing | `/queueing` | Manage players, queue, courts and match recording |
| Public live view | `/live` | Display current queue/session activity |
| Player registration | `/registration` | Existing registration workflow |
| Admin panel | `/panel` | Existing organizer account administration |

## Connected features

- Dashboard statistics and attendance trend from organizer records.
- Players from Registered Player Cloud.
- Live and archived open-play sessions, saved attendance and match logs.
- Attendance edit/removal and archived session edit/delete.
- Archived session end-time editing and session podium/tally.
- Match score edit/delete and DUPR-format CSV export. DUPR export includes only eligible scored matches with complete player DUPR IDs.
- Rankings, court status, saved venue display, schedule, CSV reports and JSON backup.
- Workspace profile editing, organizer DUPR ID, leaderboard visibility, logo and optional password change.
- Live refresh through `/api/shared-events`, with changed-data detection and scroll-preserving rendering to prevent periodic page jumps.

The original Queueing pages continue to own queue order, court assignment, live player registration/check-in, session start/end and match creation. Those existing workflows remain in place and their saved records appear in `/manage`.

## GitHub and Render deployment

1. Back up the current GitHub repository and verify that the existing Render PostgreSQL database is healthy.
2. Replace the repository contents with this project, or apply the cleanup patch into the repository root.
3. Preserve all existing Render environment variables, especially `DATABASE_URL`, `SESSION_SECRET`, `ORGANIZER_USERNAME` and `ORGANIZER_PASSWORD` if used by your deployment.
4. Push to the same deployment branch and allow the existing Render web service to deploy.
5. Sign in at `/`; the organizer dashboard now opens at `/manage`.
6. Confirm `/manage`, `/session`, `/queueing`, `/live`, `/registration`, and `/panel`. Confirm `/dashboard` redirects to `/manage`.

## Local development

Requirements: Node.js 24 (see `.node-version`).

```bash
npm install
npm start
```

Open `http://localhost:3000`. Configure the original system's existing organizer credentials and `SESSION_SECRET` as described in `ORGANIZER-LOGIN-SETUP.md`.

## Data safety

- No new dashboard database or duplicate player store was added.
- No private runtime data, organizer credentials or personal player records are included in this source package.
- Existing hosted records remain in the PostgreSQL database already used by the original app when deployed to the same Render service with its existing `DATABASE_URL`.
