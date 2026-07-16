# CoLiving Event Display

WhatsApp DM -> event parsing (A/B) -> group publish -> display carousel.

This repository now includes:

- Architecture and planning pages:
  - `roadmap.html`
  - `tickets.html`
  - `tickets-catalog.html`
  - `architecture.html`
- Runnable Docker Compose skeleton:
  - `docker-compose.yml`
  - `.env.example`
- Service skeletons:
  - `services/api`
  - `services/bot`
  - `services/display`
  - `packages/shared`

## Quick Start

1. Copy environment file:

```bash
cp .env.example .env
```

Important: rotate `INTERNAL_API_TOKEN` and `LLM_API_KEY` in `.env` before pushing code to any remote.

2. Install dependencies:

```bash
npm install
```

3. Run tests:

```bash
npm test
```

4. Start all services in Docker Compose:

```bash
docker compose up --build
```

Staging mode (seeded events + no WhatsApp dependency):

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging up --build
```

Helper scripts:

```bash
npm run staging:up
npm run staging:down
```

5. Open:

- API health: `http://localhost:8080/health`
- Events API: `http://localhost:8080/events`
- Display carousel: `http://localhost:3000`

## Current Scope

- `api` provides event ingestion, event listing, publish endpoint, and parser experiment metrics.
- `bot` is currently a Baileys-ready scaffold that simulates inbound DM payloads.
- `display` is a kiosk-friendly carousel page that polls the API.

## Staging Environment

- Use `.env.staging` with `docker-compose.staging.yml` overlay.
- Bot service is disabled in staging, so you can create events manually without WhatsApp connected.
- API seeds fresh sample events on every staging startup.
- All seeded events are always future-dated relative to current date.
- You can still add/edit/delete events through:
  - `http://localhost:3000/create-event`
  - `http://localhost:3000/admin`

Staging seed controls:

- `STAGING_SEED_EVENTS_ENABLED` (default `false`)
- `STAGING_SEED_RESET_ON_START` (default `true`)
- `STAGING_SEED_EVENTS_COUNT` (default `16`)

## Group Targets Configuration

Group targets are configured in `config/groups.json`.

- Use WhatsApp group JIDs (format like `120...@g.us`) as routing keys.
- Keep `name` only for readability.
- Toggle `enabled` per group to include/exclude it from publishing.

You can also define organiser mention mapping in the same file:

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

If `jid` is missing and only `name` is provided, the bot attempts group-name resolution via Baileys at runtime.

To list all group names and JIDs from your currently linked WhatsApp session:

```bash
npm run groups:list
```

Example output:

```text
Shoreditch &Soul Villa Events => 120363413386715014@g.us
```

Then set that JID in `config/groups.json`.

Bot reads this file through `GROUPS_CONFIG_PATH` (default `/app/config/groups.json`).

## Real Baileys Mode

Set `ENABLE_BAILEYS=true` to run with real WhatsApp linked device flow.

- QR is printed in terminal on first run.
- Auth state is stored in `BAILEYS_AUTH_DIR` (default `/app/auth/state`).
- DM messages are ingested and published to configured groups.

Testing note:

- By default, bot ignores messages sent by your own account (`fromMe`) to prevent loops.
- If you want to test by messaging yourself, set `BOT_ALLOW_FROM_ME=true`.
- Bot also ignores messages older than bot startup time by default (`BOT_IGNORE_OLD_MESSAGES=true`) to avoid backlog spam on reconnect.

DM observe modes:

- `BOT_DM_OBSERVE_MODE=all` (default): observe all incoming DMs (subject to `BOT_ALLOW_FROM_ME`).
- `BOT_DM_OBSERVE_MODE=self_only`: observe only your own self-DM command messages starting with `/event `.
  - Useful for POC where only your own messages-to-self should be processed.
- `BOT_RSVP_PHONE_NUMBER=<number-with-country-code-no-plus>`: phone number used to generate WhatsApp click-to-chat RSVP links.
- `BOT_PROCESSED_MESSAGE_TTL_MS` deduplicates repeated WhatsApp message IDs (default 5 minutes) to avoid duplicate processing.

## DM Command Format

Preferred command syntax:

`/event title="..." date="YYYY-MM-DD" startTime="HH:mm" endTime="HH:mm" desc="..." organisers="@pablo @maria"`

Event cancellation syntax (creator only):

`/cancel-event evt_xxxxx`

RSVP commands (via DM or click-to-chat):

- `/RSVP-EVENT evt_xxxxx`
- `/CANCEL-RSVP-EVENT evt_xxxxx`
- `/RSVPS-EVENT evt_xxxxx` (creator only)

WhatsApp native Event flow:

- If a user sends a native WhatsApp Event card in DM, bot stores a temporary draft.
- Bot then asks user to reply with command syntax and attach the image in same message:
  - `/organisers tempId="tmp_xxxxxxxx", organisers="@name @name"`
- If user does not complete the flow before timeout (`BOT_EVENT_ENRICH_TIMEOUT_MS`, default 10 minutes), draft expires and bot asks to start over.

Image is not a URL in your flow: send the image attached in the same DM message (with optional caption using `/event ...`).

Notes:

- Required fields: `title`, `date`, `startTime`, `desc`.
- Optional field: `endTime` (defaults to `23:59` if omitted).
- `organisers` is optional.
- If an image is attached, it is downloaded by the bot and sent to API as structured image payload.
- Event `date + startTime` must be in the future, otherwise creation is rejected.
- Event stores RSVP attendees as objects (`senderJid`, `pushName`, `rsvpAt`) and exposes RSVP count for display.
- Past events are automatically pruned from storage when events are accessed.
- Attached images are persisted to API media storage and exposed as `/media/<file>` URLs.
- Oversized media/request payloads are rejected (`MAX_MEDIA_BYTES`, `API_MAX_BODY_BYTES`).
- Internal write routes require `x-internal-token` when `INTERNAL_API_TOKEN` is configured.
- `/ingest/dm` is rate-limited (configurable via `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_PER_SENDER`, `RATE_LIMIT_MAX_GLOBAL`).

When an event is created, bot acknowledgment includes both `Event ID` and `Title` so the creator can later cancel it.

## Google Calendar Sync

Events can be mirrored to Google Calendar from API when enabled.

Required `.env` keys:

- `GOOGLE_CALENDAR_ENABLED=true`
- `GOOGLE_CALENDAR_ID=<calendar-id>`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>`
- `GOOGLE_PRIVATE_KEY=<private-key-with-escaped-newlines>`
- `GOOGLE_CALENDAR_TIMEZONE=Europe/London`
- `GOOGLE_CALENDAR_SHARE_BASE_URL=https://calendar.google.com/calendar/r/eventedit`

Behavior:

- On event create: API inserts event in Google Calendar.
- On successful Google event creation: API generates a QR image (pointing to the calendar add/open link) and stores it as `googleCalendarQrImage`.
- On event cancel/delete: event is not removed; its Google Calendar title is patched to start with `[CANCELLED]`.
- On event delete/cancel: QR image is cleaned up with other orphan media.
- Bot creation confirmation includes Calendar link.
- Group announcement includes Calendar link so users can open and mark participation in Google Calendar.

## Carousel Display Notes

- Carousel is optimized for kiosk/TV readability with large type and image panel.
- Shows day labels (`Today`, `Tomorrow`, `In X days`) and status chip.
- Handles API outages with offline banner while keeping last data on screen.
- Slide duration adapts to content length and image presence.
- Optional filters:
  - `DISPLAY_MAX_DAYS_AHEAD` limits far-future events shown.
  - `PUBLIC_MEDIA_URL` controls media host when display/API are on different hosts.
  - `DISPLAY_API_SERVER_URL` is display container -> API internal URL (default `http://api:8080`).
  - `DISPLAY_PROXY_MAX_MEDIA_BYTES` and `DISPLAY_PROXY_MAX_BODY_BYTES` cap form upload payloads before proxying (defaults now set for 20MB media).
  - `DISPLAY_TIMEZONE` controls kiosk clock timezone (default `Europe/London`).
- If present, `googleCalendarQrImage` is rendered overlapping the event image bottom-right corner (half in / half out) for kiosk scanning.
- Debug tools:
  - Press `d` on display page to toggle a local debug overlay.
  - `GET /debug` on display service returns runtime/config diagnostics.

## Admin Panel

- Open `http://localhost:3000/admin`.
- Paste/save `INTERNAL_API_TOKEN` in the admin page to enable protected actions.
- Supports:
  - single event delete
  - batch delete of selected events

## Manual Event Form

- Open `http://localhost:3000/create-event`.
- Intended for users not comfortable with WhatsApp.
- Supports creating events with optional image upload.
- Uses same API validation rules.
- By default, page uses display-side proxy (`POST /api/events`) so end users do not need token in browser.
- Optional: still supports token entry if direct protected API calls are enabled.

## Next Implementation Step (Baileys)

Replace the simulation in `services/bot/src/index.js` with real Baileys handlers:

- Connect to WhatsApp
- Persist auth state in `/app/auth`
- Route inbound DM messages into `POST /ingest/dm`

See `docs/implementation-notes.md` for details.
