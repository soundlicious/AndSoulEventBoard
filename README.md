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

5. Open:

- API health: `http://localhost:8080/health`
- Events API: `http://localhost:8080/events`
- Display carousel: `http://localhost:3000`

## Current Scope

- `api` provides event ingestion, event listing, publish endpoint, and parser experiment metrics.
- `bot` is currently a Baileys-ready scaffold that simulates inbound DM payloads.
- `display` is a kiosk-friendly carousel page that polls the API.

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

## DM Command Format

Preferred command syntax:

`/event title="..." date="YYYY-MM-DD" time="HH:mm" desc="..." organisers="@pablo @maria"`

Event cancellation syntax (creator only):

`/cancel-event evt_xxxxx`

Image is not a URL in your flow: send the image attached in the same DM message (with optional caption using `/event ...`).

Notes:

- Required fields: `title`, `date`, `time`, `desc`.
- `organisers` is optional.
- If an image is attached, it is downloaded by the bot and sent to API as structured image payload.
- Event `date + time` must be in the future, otherwise creation is rejected.
- Past events are automatically pruned from storage when events are accessed.
- Attached images are persisted to API media storage and exposed as `/media/<file>` URLs.
- Oversized media/request payloads are rejected (`MAX_MEDIA_BYTES`, `API_MAX_BODY_BYTES`).
- Internal write routes require `x-internal-token` when `INTERNAL_API_TOKEN` is configured.
- `/ingest/dm` is rate-limited (configurable via `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_PER_SENDER`, `RATE_LIMIT_MAX_GLOBAL`).

When an event is created, bot acknowledgment includes both `Event ID` and `Title` so the creator can later cancel it.

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
