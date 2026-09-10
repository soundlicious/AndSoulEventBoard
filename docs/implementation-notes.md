# Implementation Notes

## A/B Parsing Flow

1. Bot receives DM payload (`senderJid`, `messageId`, `rawText`).
2. API route `POST /ingest/dm` assigns parser variant:
   - `random_50_50`, or
   - `sender_sticky`.
3. Variant A uses a simple deterministic parser.
4. Variant B is currently scaffolded and should be wired to LLM API.
5. API computes confidence and validation result.
6. Event is created if valid and stored with parse metadata.
7. Parse log is persisted and aggregated in `GET /experiments/metrics`.

## API Endpoints

- `GET /health` service health.
- `GET /events` list events sorted by `startAt`.
- `GET /events/:id` fetch one event.
- `POST /events` create event directly.
- `POST /events/:id/publish` mark event as published.
- `POST /ingest/dm` DM ingestion and parser pipeline.
- `POST /experiments/parses` insert parse log manually.
- `GET /experiments/metrics` aggregate parse metrics.

Security behavior:

- If `INTERNAL_API_TOKEN` is set, write/internal endpoints require `x-internal-token` header.
- Protected routes: `POST /events`, `POST /ingest/dm`, `POST /events/:id/publish`, `POST /experiments/parses`.
- Public routes remain open for display/read use (`GET /health`, `GET /events`, `GET /events/:id`, `GET /media/:file`, `GET /experiments/metrics`).

Rate limiting behavior:

- `POST /ingest/dm` enforces in-memory limits.
- Controlled by:
  - `RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX_PER_SENDER`
  - `RATE_LIMIT_MAX_GLOBAL`
- Exceeded limits return HTTP `429`.

## Data Storage

To keep bootstrap simple, API uses JSON file storage:

- default path in container: `/app/data/events.json`
- override with `EVENTS_FILE_PATH`
- media path in container: `/app/data/media`
- override with `MEDIA_DIR`

For production, replace with PostgreSQL and proper migrations.

Media behavior in current scaffold:

- Bot can send attached image payload (`mimeType`, `dataBase64`) to API ingest.
- API persists binary image into `MEDIA_DIR`.
- Event stores a stable reference like `/media/<uuid>.<ext>`.
- `GET /media/:file` serves stored media.
- Orphan media files are cleaned when event cleanup/pruning runs (including the 24h periodic cleanup).
- Media ingestion is size-limited by `MAX_MEDIA_BYTES`.
- Full request body is size-limited by `API_MAX_BODY_BYTES`.

Retention behavior in current scaffold:

- Events are considered stale after their `date + time` has passed.
- Stale events are pruned from persisted storage automatically when event list/get/create/publish paths are used.
- A periodic cleanup task also runs every 24 hours.

## Replacing Bot Simulation with Baileys

Current bot is intentionally minimal. To wire Baileys:

1. Add Baileys dependency.
2. Initialize socket using multi-file auth state in `/app/auth`.
3. Subscribe to incoming message events.
4. Filter direct messages and optional allow-list.
5. Transform inbound message to API payload and call `POST /ingest/dm`.
6. For confirmed events, publish formatted message to group JID.

## Group Configuration File

Bot publishing targets are loaded from `config/groups.json` (mounted into `/app/config/groups.json` in Compose).

Example:

```json
{
  "organiserMentions": {
    "pablo": "34600000001@s.whatsapp.net"
  },
  "groups": [
    {
      "name": "CoLiving Main",
      "jid": "1203630XXXXXXXX@g.us",
      "enabled": true
    }
  ]
}
```

Baileys uses group JIDs (example: `120...@g.us`) to send messages. Names are for humans and can change, so IDs are the reliable key.

You can optionally configure a group by `name` only; bot attempts runtime name resolution using `groupFetchAllParticipating()`, but JID-first config is recommended.

When you wire real Baileys sending:

- resolve/display group names for logs,
- keep JIDs in config for actual delivery.

## Event Parsing Contract

Current parser pipeline targets these fields:

- `title` (required)
- `description` (required)
- `startDate` (or `date`) in `YYYY-MM-DD` (required)
- `startTime` (or `time`) in `HH:mm` (required)
- `endDate` in `YYYY-MM-DD` (optional)
- `endTime` in `HH:mm` (optional)
- `organisers` string array (optional but preferred)
- `image` optional payload as URL string or attached image object `{ mimeType, dataBase64 }`

Organisers are rendered as mentions in group message templates (`@name`).
If `organiserMentions` mapping is provided, bot includes WhatsApp mention JIDs in send payload.

## Preferred User Command

The bot supports and prioritizes this DM command:

`/event title="..." startDate="YYYY-MM-DD" startTime="HH:mm" endDate="YYYY-MM-DD" endTime="HH:mm" desc="..." organisers="@pablo @maria"`

If the message starts with `/event`, command parsing is applied before generic parser logic.

For images, user should attach image media directly in WhatsApp DM (instead of sharing a link). Bot downloads media and includes it in ingest payload.

## Time Validity Rule

- API rejects events where `startDate + startTime` is not strictly in the future.
- This rule applies to both direct `POST /events` and DM ingestion `POST /ingest/dm`.

## Raspberry Pi Porting Notes

- Keep node image on `node:20-alpine` unless native deps force Debian.
- Prefer ARM64 Pi OS for image compatibility.
- Run display in kiosk mode with Chromium autostart.
- Keep polling interval moderate (5-10s) to reduce load.
