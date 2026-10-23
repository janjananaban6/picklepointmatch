# Organizer Login — Setup Guide

## What changed

- The root URL (`/`) and `index.html` now open the Organizer Login page.
- The previous Start Screen is preserved as `session.html`.
- `queueing.html` can only be opened after organizer sign-in.
- A small **Log out** button appears on the session page. From the queueing workspace, use its existing back button to return to the session page before logging out.
- Public player registration (`Registration.html`) and Live View (`live.html`) remain public, so player registration and live viewing are not blocked.
- Organizer write APIs require a signed HTTP-only login cookie. Sessions expire after 12 hours.

## Render environment variables

The username is `organizer` by default. Keep the password and session secret out of GitHub.

1. Open the Render **web service** for Pickle Point Match.
2. Select **Environment**.
3. Confirm these keys exist:
   - `ORGANIZER_USERNAME` — value `organizer`
   - `ORGANIZER_PASSWORD` — use the generated secret value or choose a strong password
   - `SESSION_SECRET` — long random secret used to sign the login cookie
4. If you deployed through the Blueprint in `render.yaml`, sync the Blueprint changes so Render can generate the two secret values. If this service is not managed by a Blueprint, add the missing keys manually.
5. Save and deploy/restart so the server receives the values.
6. Sign in using username `organizer` and the value currently saved under `ORGANIZER_PASSWORD` in Render. Do not share screenshots that expose the password or `SESSION_SECRET`.

If any of the three variables are missing, the login page will show a configuration notice instead of allowing sign-in.
