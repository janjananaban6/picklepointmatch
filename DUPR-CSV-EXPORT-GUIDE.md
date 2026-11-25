# DUPR CSV Export — Pickle Point Match

## Organizer Dashboard — Match Records

The **Match Records** page includes **Export DUPR CSV**. Choose the session and score type in the export window, review the match rows, and download the CSV for the selected session and score type. The export follows DUPR's current 27-column match-import template and keeps its exact header names and order.

Each exported row represents one scored Singles or Doubles match. Pickle Point Match currently stores one game score per result, so Game 1 is populated and Game 2 through Game 5 remain blank. The file includes the match type (`S` for Singles or `D` for Doubles), event name, match date, player names, DUPR IDs, blank external-ID fields, score type (`Sideout` or `Rally`), and saved session location.

Matches marked Non-DUPR, win/loss-only matches, tied scores, and incomplete Singles/Doubles lineups are excluded. A match with a complete lineup but one or more missing DUPR IDs is shown in the review as **Missing DUPR**; its player-ID cells remain blank in the exported CSV. Fill those IDs before uploading, or update the player profile and export again. A player's numeric DUPR rating is never used as their DUPR ID.

## Before exporting

- Mark the session as a **DUPR Match** when creating it.
- Make sure every participant has the correct DUPR ID in Registered Player Cloud or the queue/court DUPR editor.
- Enable score recording and submit a numeric, non-tied score for every match. Win/Loss-only records cannot be exported as scored DUPR results.
- Review the downloaded CSV before uploading it to DUPR, especially rows marked Missing DUPR.

## Export steps

1. Open the organizer **Dashboard** and select **Match Records**.
2. Click **Export DUPR CSV**.
3. Choose the session and score type, then review the match records and export count.
4. Download the `.csv` file and verify the event, date, player names, DUPR IDs, score, score type, and location.
5. In the desktop DUPR website, open **Clubs → My Clubs → select your club → Matches → Add Matches → Import Matches via CSV**.
6. Compare the file with the current official DUPR template / Column Reference before uploading, then verify the imported matches in the club's Matches tab.

Official DUPR guidance: https://dupr.zendesk.com/hc/en-us/articles/45778582901140-Adding-Matches-via-CSV

## Queueing end-session export

The existing CSV download in the Queueing **End Session** confirmation is separate and remains unchanged.

## Important note

CSV export does not submit matches automatically. It only downloads a file for the club organizer to review and upload to DUPR.
