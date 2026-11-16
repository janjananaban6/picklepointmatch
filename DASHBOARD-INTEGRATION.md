# HUSAY DINKERS Management Dashboard Integration

## Single dashboard route

`/manage` is the only organizer management dashboard and is served internally by `dashboard.html`, with `dashboard.css` and `dashboard.js`. `/dashboard`, `/dashboard.html`, and the legacy `/husay-manager.html` URL redirect to `/manage` so saved bookmarks and old links continue to work. The existing organizer login still sends the organizer to `/manage`.

The legacy `/api/organizer-dashboard` API remains in place because the new management screen uses it as its data source. Only the old dashboard page files were retired; backend endpoints were not removed.

## Source-of-truth mapping

| Management view | Existing source in Pickle Point Match |
|---|---|
| Dashboard overview | `/api/organizer-dashboard` organizer payload |
| Players | `records.players` (Registered Player Cloud / registered-player CSV) |
| Open Play Sessions | `records.sessions` plus current live session from `appState` |
| Attendance | `records.attendanceBySession` plus archived participants / current queue roster |
| Match Records | archived `records.logs` plus current live `appState.logs` |
| Player Rankings | player profile statistics, match winner data and saved attendance |
| Courts & Locations | current `appState.courts` and saved session `duprLocation`; historical courts inferred from match logs |
| Live updates | `/api/shared-events` (`app-state` and `cloud-records` events) |
| Workspace settings | existing `/api/organizer-settings` GET/PATCH endpoints |

## Mutation routes reused

- `PATCH /api/organizer-dashboard/sessions/:sessionId` — update archived session name and end date/time; the backend also adjusts associated start and match timestamps.
- `DELETE /api/organizer-dashboard/sessions/:sessionId` — delete an archived session and related saved match rows.
- `PATCH /api/organizer-dashboard/sessions/:sessionId/participants/:index` — edit saved attendance.
- `DELETE /api/organizer-dashboard/sessions/:sessionId/participants/:index` — remove a saved attendance snapshot only.
- `PATCH /api/organizer-dashboard/sessions/:sessionId/matches/:matchId` — edit an eligible saved score.
- `DELETE /api/organizer-dashboard/sessions/:sessionId/matches/:matchId` — remove a match row.
- `GET/PATCH /api/organizer-settings` — load/save organizer display name, DUPR ID, leaderboard visibility, logo and optional password change.

DUPR CSV export and per-session podiums are calculated from the same raw session/match and Registered Player Cloud records. No new server storage is introduced.

## Existing queueing pages remain

The original `/session`, `/queueing`, `/live`, `/registration` and `/panel` pages remain available. Session creation/end, queue order, live player check-in/registration, court assignment and match creation continue to use their original pages and endpoints. Their data is read by `/manage`.

## Refresh and layout safeguards

- Data refreshes compare normalized response signatures before re-rendering.
- Unchanged poll responses do not replace page HTML.
- Changed data preserves main and nested table/list scroll positions.
- Text editing is not interrupted by background refresh.
- Dashboard cards use explicit desktop/tablet/mobile grid placement; no details are hidden at tablet widths.

## Access rules

- `/manage` serves `dashboard.html` only to an authenticated organizer.
- `/dashboard` and `/dashboard.html` redirect to `/manage`, where the same organizer authentication applies.
- `/api/organizer-dashboard`, mutation routes and `/api/organizer-settings` require the existing organizer session.
- Organizer-scoped records continue to be filtered by the existing server account ID.
