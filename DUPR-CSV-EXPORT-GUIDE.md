# DUPR CSV Export — Pickle Point Match

## What the button does

The `Download DUPR CSV` button is available in Match History. It is also shown in the End Live Queue Session confirmation when the session is marked as a DUPR Match, so you can export before ending the session clears the active match log.

Before the file downloads, a modal asks for the event name and location. Both fields are required and are inserted into the CSV `event` and `location` columns for every exported match. The event name is also used in the download filename.

The export contains completed matches from a DUPR-marked session only. Each exported row represents one completed Singles or Doubles match with a numeric, non-tied score. Player names and DUPR IDs are matched from the saved match record, the current queue/player data, and Registered Player Cloud.

## Before exporting

- Turn on **DUPR Match** in the session setup before starting the queue.
- Make sure each participant has the correct DUPR ID in the Registered Player Cloud or queue/court DUPR editor.
- Enable score recording and submit a numeric score for every match. Win/Loss-only records cannot be exported as a scored DUPR result.
- Review the downloaded CSV before uploading. Matches missing a score, player name, or DUPR ID are skipped and reported by the app.

## Export steps

1. Open **Match Log** and click **Download DUPR CSV**, or use the same button in the End Session confirmation before ending the session.
2. Open the downloaded `.csv` file in Excel or Google Sheets and verify event name, date, player IDs, score, and scoring type.
3. In the desktop DUPR website, open **Clubs → My Clubs → select your club → Matches → Add Matches → Import Matches via CSV**.
4. Compare the file's columns with the current official DUPR template / Column Reference before uploading. DUPR may update its importer fields over time.
5. Upload the file and verify the imported matches in the club's Matches tab.

Official DUPR guidance: https://dupr.zendesk.com/hc/en-us/articles/45778582901140-Adding-Matches-via-CSV

## Important notes

- CSV export does not submit matches automatically; it only downloads a file for the club organizer to review and upload.
- External player IDs are left blank because Pickle Point Match does not currently collect those fields. Location is entered in the DUPR CSV details modal before export.
- The scoring type is set to Rally when the saved match target is 21; otherwise it defaults to Sideout. Confirm this matches the scoring used at your event before uploading.
- Each Pickle Point Match result currently stores one game score, so only Game 1 is populated in the CSV row.
