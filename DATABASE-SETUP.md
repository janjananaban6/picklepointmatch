# PostgreSQL setup for Pickle Point Match

## What's included

- Uses Render PostgreSQL whenever `DATABASE_URL` is configured.
- Saves the shared application state, registered-player cloud records, Live View state, and Live View theme in PostgreSQL.
- Creates the `pickle_point_storage` table automatically at startup; no manual SQL is required.
- Keeps JSON-file storage for local testing when `DATABASE_URL` is not set.
- Attempts a one-time import of the legacy JSON files if they are present when the database-backed service starts.

## Deploy with a Render Blueprint

1. Commit and push the updated project to the GitHub repository connected to Render.
2. In Render, open the Blueprint that manages this web service and sync/apply the Blueprint changes. The `render.yaml` file defines a PostgreSQL database and wires its internal connection string into the web service as `DATABASE_URL`.
3. Wait for the database and web service to finish provisioning/deploying.
4. Open `https://YOUR-SERVICE.onrender.com/api/health`. The response should include `"storage":"postgresql"`.
5. Test registration and queueing, then reload the app and Live View to verify the saved data remains.

If the current web service is **not managed by a Render Blueprint**, create a PostgreSQL database in the Render Dashboard instead. Put it in the same region as the web service, open its Connect page, and add its **Internal Database URL** to the web service's `DATABASE_URL` environment variable. Save the variable and redeploy. Do not put database credentials in GitHub or commit them into this project.

## Important notes

- The supplied Blueprint uses Render's Free Postgres plan for low-cost testing. Render documents that Free Postgres databases expire 30 days after creation. Upgrade the database to a paid plan before that deadline if you need ongoing storage; Free Postgres also has no managed backups.
- The code can import legacy JSON data only if those JSON files are still available to the running service during its first PostgreSQL-backed startup. A ZIP/GitHub repository does not include runtime data files by default. Export or back up important existing registrations, match history, and sessions before deploying this change.
- This migration keeps the existing app data structures intact in JSONB rows, minimizing changes to the current frontend and APIs. It is a persistence layer, not a normalized relational redesign.
- If `DATABASE_URL` is configured but PostgreSQL cannot be reached, the server intentionally fails during startup instead of silently falling back to temporary file storage.


## Organizer Login

The site root (`/`) and `index.html` are now the organizer login page. The previous start/session screen is now `session.html`. Direct access to `session.html` and `queueing.html` redirects to login until an organizer signs in. Public player registration (`Registration.html`) and public Live View (`live.html`) remain available.

The organizer username defaults to `organizer`. Set the following variables on the Render web service:

- `ORGANIZER_USERNAME`: `organizer` (or your preferred username)
- `ORGANIZER_PASSWORD`: choose a strong password and keep it secret
- `SESSION_SECRET`: a long random secret used to sign login sessions

For a Render Blueprint deployment, `render.yaml` uses `generateValue: true` for the password and session secret, so Render can generate secret values instead of committing passwords to GitHub. On an existing Render service, open **Environment** and confirm that all three keys exist; if the Blueprint update has not applied them, add them manually. Save with **Save, rebuild, and deploy** (or **Save and deploy**) so the service receives them. Use the value shown by Render for `ORGANIZER_PASSWORD` to sign in. Never paste or share the password or `SESSION_SECRET` in chat or commit them to GitHub.

The Panel can show organizer passwords only after a password has been saved in the new encrypted-password field. Older accounts that contain only a one-way password hash need a one-time password reset (or a successful organizer sign-in, which migrates the entered password). Keep `SESSION_SECRET` stable: it signs sessions and protects the encrypted password copy. If you replace it, existing sessions expire and previously encrypted display copies may no longer decrypt; set a new organizer password to restore display access.

Successful sign-in uses an HTTP-only, same-site cookie that expires after 12 hours. Organizer state-write APIs require this cookie, while public registration and Live View read APIs remain available.
