# DUPR CSV Export — Pickle Point Match

## Organizer Dashboard — Match History

The Matches tab combines recorded matches from the organizer's archived sessions and current live session. Use the **From** and **To** date fields or the **Today**, **7 Days**, **30 Days**, and **All Time** shortcuts to filter the list. **Refresh** reloads the latest match records. The Matches Played total below search reflects the selected date range; the search field only narrows the visible cards.

**Export DUPR CSV (count)** downloads one CSV containing the DUPR-ready matches in the selected date range. The search field does not reduce the export set. The count is the number of rows that can be exported. The export skips records that are not marked as DUPR matches, do not have a numeric non-tied score, have incomplete Singles/Doubles player details, or are missing a DUPR ID for any player. The event column is filled from the saved session name.

Each CSV row contains one completed Singles or Doubles match. Only Game 1 is populated because Pickle Point Match currently stores one game score per result. External player IDs are left blank. The dashboard export location is prefilled from the session's saved DUPR location and can be edited before downloading. Older archived sessions created before location was saved with the session may need the location entered manually.

## Before exporting

- Mark the session as a **DUPR Match** when creating it.
- Make sure every participant has the correct DUPR ID in Registered Player Cloud or the queue/court DUPR editor.
- Enable score recording and submit a numeric score for every match. Win/Loss-only records cannot be exported as a scored DUPR result.
- Review the downloaded CSV before uploading it to DUPR.

## Export steps

1. Open the organizer **Dashboard** and select **Matches**.
2. Choose a date range and optionally search for a player, nickname, or OPG ID.
3. Check the number beside **Export DUPR CSV** and click it to download the matching DUPR-ready rows.
4. Open the downloaded `.csv` file in Excel or Google Sheets and verify event, date, player IDs, score, and scoring type.
5. In the desktop DUPR website, open **Clubs → My Clubs → select your club → Matches → Add Matches → Import Matches via CSV**.
6. Compare the file with the current official DUPR template / Column Reference before uploading, then verify the imported matches in the club's Matches tab.

Official DUPR guidance: https://dupr.zendesk.com/hc/en-us/articles/45778582901140-Adding-Matches-via-CSV

## Queueing end-session export

The existing CSV download in the Queueing **End Session** confirmation remains unchanged. It retains its own pre-export validation and event/location details flow.

## Important note

CSV export does not submit matches automatically. It only downloads a file for the club organizer to review and upload to DUPR.
