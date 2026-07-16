import { google } from "googleapis";

const enabled = String(process.env.GOOGLE_CALENDAR_ENABLED || "false") === "true";
const calendarId = process.env.GOOGLE_CALENDAR_ID || "";
const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || "";
const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
const timezone = process.env.GOOGLE_CALENDAR_TIMEZONE || process.env.DEFAULT_TIMEZONE || "UTC";
const shareBaseUrl = process.env.GOOGLE_CALENDAR_SHARE_BASE_URL || "https://calendar.google.com/calendar/r/eventedit";

function eventDateTime(event) {
  const start = `${event.date}T${event.startTime}:00`;
  const end = `${event.date}T${event.endTime || "23:59"}:00`;
  return {
    start: {
      dateTime: start,
      timeZone: timezone
    },
    end: {
      dateTime: end,
      timeZone: timezone
    }
  };
}

function buildClient() {
  if (!enabled || !calendarId || !serviceEmail || !privateKey) {
    return null;
  }

  const jwt = new google.auth.JWT({
    email: serviceEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  return google.calendar({ version: "v3", auth: jwt });
}

function normalizeTitle(title) {
  return String(title || "Untitled Event").trim();
}

export async function syncCreateToGoogleCalendar(event) {
  const client = buildClient();
  if (!client) {
    return { ok: false, skipped: true, reason: "google_calendar_not_configured" };
  }

  const title = normalizeTitle(event.title);
  const payload = {
    summary: title,
    description: event.description || "",
    location: event.location || undefined,
    ...eventDateTime(event),
    extendedProperties: {
      private: {
        appEventId: event.id
      }
    }
  };

  const response = await client.events.insert({
    calendarId,
    requestBody: payload
  });

  return {
    ok: true,
    googleEventId: response.data.id || null,
    googleHtmlLink: response.data.htmlLink || null,
    googlePublicAddLink: response.data.id
      ? `${shareBaseUrl}/${encodeURIComponent(response.data.id)}`
      : null
  };
}

export async function markCancelledInGoogleCalendar(googleEventId, title) {
  const client = buildClient();
  if (!client) {
    return { ok: false, skipped: true, reason: "google_calendar_not_configured" };
  }
  if (!googleEventId) {
    return { ok: false, skipped: true, reason: "missing_google_event_id" };
  }

  const safeTitle = normalizeTitle(title);
  const summary = safeTitle.startsWith("[CANCELLED]")
    ? safeTitle
    : `[CANCELLED] ${safeTitle}`;

  await client.events.patch({
    calendarId,
    eventId: googleEventId,
    requestBody: {
      summary
    }
  });

  return { ok: true };
}
