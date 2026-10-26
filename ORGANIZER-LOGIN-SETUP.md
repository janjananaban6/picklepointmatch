# Pickle Point Match — Organizer Accounts and Admin Panel

## How sign-in works

- The app's `/` and `/index.html` routes display one sign-in form with **Username** and **Password** only.
- The server determines the destination from the credentials: organizer accounts open the existing `session.html` / queueing workspace, while the panel administrator opens `panel.html`.
- **Become an Organizer** on the login page submits an organizer application for review. New applications remain pending and cannot sign in until a panel administrator approves them. The applicant sees a confirmation message after submitting. Once approved, the account receives a separate live queue and live view.
- **Registered Player Cloud remains global**. Players registered into the cloud are shared by all organizers; queue/session state is isolated by organizer account.
- The admin panel is for organizer-account management: reviewing and approving or rejecting applications, listing, creating, editing display names, resetting passwords, activating/deactivating, and deleting accounts. Approving a pending application activates the account. It does not replace the organizer queue workspace.

## Render environment variables

For a Render deployment, make sure the Web Service has these environment variables:

- `DATABASE_URL` — the PostgreSQL connection string created by the existing Blueprint.
- `SESSION_SECRET` — long random signing secret; keep it private.
- `PANEL_USERNAME` — administrator username, set to `admin` by the Blueprint unless changed.
- `PANEL_PASSWORD` — strong administrator password. The Blueprint generates a value automatically.
- `ORGANIZER_USERNAME` and `ORGANIZER_PASSWORD` — optional legacy starter organizer account. The Blueprint still generates these values, and the server imports this pair into the organizer account list if it does not exist yet.

After updating environment variables, save and deploy/restart the service. To sign in to the panel, enter the `PANEL_USERNAME` and `PANEL_PASSWORD` values into the same index login form. Organizer credentials take you directly to that organizer's queue. Do not share screenshots that expose passwords or `SESSION_SECRET`.

## Persistence and privacy

Organizer account records and their password hashes are stored in the same persistent PostgreSQL storage layer as the application. If `DATABASE_URL` is not configured, local development falls back to the `data/` JSON files. Passwords are hashed using Node.js `scrypt`; plaintext passwords are not stored or returned by the API.

Pending and rejected applications cannot sign in. If an approved organizer is deactivated, their session is rejected on the next server request. Deleting an account also deletes that organizer's server-side queue and live snapshot. The shared Registered Player Cloud is not deleted when an organizer account is removed.

## Existing data migration

On first startup after this update, the server imports the previous `ORGANIZER_USERNAME` / `ORGANIZER_PASSWORD` pair as an organizer account if it is not already present. If the old single queue/live snapshot exists, it is assigned to that legacy organizer account (or the first active organizer when there is no legacy environment account). Other newly registered organizers start with an independent queue.
