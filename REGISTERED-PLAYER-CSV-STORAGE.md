# Registered Player CSV Storage

Registered Player Cloud player profiles are stored by the server in `data/registered-players.csv`. The CSV includes each registered profile field (including DUPR ID, nickname, gender, skill category, self rating, and match/win/loss counters). Additional player properties are kept as additional CSV columns so profile details are not silently discarded. Legacy OPG ID fields are ignored and excluded from new storage and exports. Fields containing commas, quotes, or newlines are CSV-escaped; nested values are serialized as JSON within the cell.

The `/api/cloud-records` interface remains unchanged for the existing pages. It reconstructs `records.players` from the CSV on the server and still synchronizes real-time updates to connected clients. Match logs and session history remain in the existing cloud-record envelope; their structure is not converted to CSV.

For local development, the CSV file is the server's persistent player store under the selected `PICKLE_DATA_DIR` (or `data/` by default). For a hosted deployment with `DATABASE_URL`, the server also stores the CSV text as a durable PostgreSQL payload and regenerates the physical CSV file on startup; this avoids relying on an ephemeral hosting filesystem as the only copy. The old `registered-player-cloud.json` file is retained for metadata/history and migration compatibility, but it no longer stores player profile details after migration.

The registration page now accepts a DUPR ID only when it contains exactly six letters or numbers, such as `1A2B3C`. The server validates this too, so bypassing browser checks will not save an invalid ID.

## Panel player directory and export

The administrator Panel includes a **Registered Player Cloud** section. **View players** opens a searchable, paginated modal populated from the canonical registered-player CSV storage. **Download CSV** exports the latest player records from the server-backed store, including additional profile columns. The export endpoint (`/api/panel/registered-players.csv`) requires an authenticated panel administrator session; it does not download the sample CSV bundled with the source ZIP.
