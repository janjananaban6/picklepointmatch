# Pickle Point Match — Production Security & Data Migration Checklist

This build adds:
- Login-required server routes for Queueing, Dashboard, Panel, and Session.
- Signed HttpOnly role-cookie checks for Queueing, Dashboard, Panel, and Session. One browser profile shares its login across same-origin pages; separate devices or browser profiles must sign in independently.
- Login throttling, same-origin mutation checks, security headers, and bounded in-memory rate-limit storage.
- Cloudflare client-IP preference for Render rate limiting.
- Public registration QR responses limited to the fields needed for returning-player check-in; match logs, archived sessions, attendance, DUPR IDs, ratings, and player statistics are not sent to public QR visitors.
- A production startup guard: the app refuses to start in production without `DATABASE_URL`.
- A non-destructive one-time migration script for legacy private JSON/CSV data.

## Before deploying — do these in order

1. **Back up the current production database first.** Do not delete, recreate, or replace the existing Render PostgreSQL database. Keep the current `DATABASE_URL` and `SESSION_SECRET` unchanged.
2. Open `/api/health` on the current live service. It must report `"storage":"postgresql"`. If it reports `json-file`, or you cannot verify it, **do not deploy the source-only ZIP yet**.
3. The source ZIP intentionally excludes `data/` because it contains organizer account password hashes/encrypted password copies, player profiles, player CSV data, and match/session records. The original data archive must remain private and must never be committed to a public repository.
4. If the current PostgreSQL database does not already contain the records, use the supplied one-time migration script from a trusted local computer before deploying:
   - Extract the private backup so you have its `data/` folder.
   - Install project dependencies locally with `npm install`.
   - Set `DATA_DIR` to that extracted private `data/` folder and `DATABASE_URL` to the **External Database URL** from Render's PostgreSQL Connect panel.
   - Run `npm run import:legacy-data`.
   - The script inserts only missing storage keys and **never overwrites an existing database key**. Back up PostgreSQL before running it. Keep the database URL private and remove it from your shell after the import.
5. Confirm the imported organizer accounts, player directory, live state, and match/session history in the app. Only then deploy the source-only ZIP.
6. In Render, confirm `DATABASE_URL`, `SESSION_SECRET`, `PANEL_USERNAME`, and `PANEL_PASSWORD` exist. Keep the current `SESSION_SECRET` stable; changing it logs users out and can invalidate encrypted legacy account fields. Use unique strong admin and organizer passwords.
7. The project targets Node.js 24 LTS (`.node-version`). Keep Render on a supported Node.js LTS release.
8. Before deployment, run `npm audit --omit=dev` from a trusted local terminal after `npm install`; resolve any critical/high advisories before going live.
9. Deploy, then verify `/api/health` still reports PostgreSQL. Test organizer login, panel login, `/queueing`, `/dashboard`, `/panel`, a public `/<organizer-slug>/live` page, and a public registration QR. Test a protected link in another tab of the already signed-in browser: it should open without another login. Then test the same link in a separate browser profile or device: it must return to login.
10. If `data/` files were previously committed to Git, `.gitignore` alone does not remove them from Git history. After the database is backed up and migrated, remove them from the repository index with `git rm -r --cached data` and commit that change. If the repository was ever public, rotate credentials/secrets and treat exposed player data as disclosed.

## Render plan warning

The included `render.yaml` still uses Render Free plans to avoid silently opting the owner into paid billing. Render explicitly says Free services are not for production use; Free PostgreSQL expires 30 days after creation and has no managed backups. Upgrade the web service and database to suitable paid plans and configure backups/retention before using this for real club/player records long-term.

## Public and private access

- `/queueing`, `/dashboard`, and `/session` require a valid organizer HttpOnly cookie. `/panel` requires its own Panel Administrator HttpOnly cookie. Cookies are shared by same-origin pages in one browser profile, so normal navigation and new tabs do not require another login. A different device or browser profile has no cookie and must sign in independently. The browser cannot read the HttpOnly cookies through JavaScript.
- Public Live View and organizer-scoped registration QR pages remain public by design. Public registration endpoints expose only the limited player directory fields needed for returning-player check-in. They do not expose match logs, archived sessions, attendance, DUPR IDs, ratings, or player statistics.
- Login attempts, organizer applications, player registration attempts, and shared event-stream connections are rate-limited per server process. The built-in limiter is not shared between instances; for a multi-instance deployment or stronger abuse protection, add a managed edge/distributed rate limiter.

## Limitations

No code change can guarantee that a public service is completely safe. Keep dependencies updated, monitor Render logs, protect administrator credentials, maintain off-site database backups, and review access when an organizer account is deactivated or removed. Perform a security review before adding new API routes or public fields.
