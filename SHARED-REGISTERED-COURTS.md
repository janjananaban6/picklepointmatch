# Shared Registered Court Directory

Registered Court entries are stored in the shared `registered-courts-directory` record. When `DATABASE_URL` is configured, this record is persisted in the same PostgreSQL storage table used by the application. Local development uses `data/registered-courts-directory.json`.

## How it works

- All authenticated, approved organizer accounts can view every registered court in the directory.
- The Courts & Locations list and Philippines 3D Court Map use the shared directory.
- Each entry retains its original organizer owner ID. Only that organizer can edit or delete the entry; the server enforces this on PATCH and DELETE requests.
- Existing `registeredCourts` saved inside organizer accounts are imported into the directory automatically when the server starts. The original account records are retained for compatibility.
- New, edited, and deleted court listings are broadcast to connected organizer dashboards so their list and map refresh immediately. A normal dashboard refresh also retrieves the directory.

## Deployment

No manual SQL migration is required. Deploy the updated project with the existing persistent PostgreSQL `DATABASE_URL` configured. On startup, the server creates the shared directory record from existing organizer court data when needed.

For local testing without PostgreSQL, stop the server before copying or restoring the `data` folder, and make sure `registered-courts-directory.json` is included with the other app data files.
