import { google } from "googleapis";

const enabled = String(process.env.GOOGLE_CALENDAR_ENABLED || "false") === "true";
const calendarId = process.env.GOOGLE_CALENDAR_ID || "";
const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || "";
const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
const timezone = process.env.GOOGLE_CALENDAR_TIMEZONE || process.env.DEFAULT_TIMEZONE || "UTC";
const shareBaseUrl = process.env.GOOGLE_CALENDAR_SHARE_BASE_URL || "https://calendar.google.com/calendar/r/eventedit";

function normalizeCalendarId(raw) {
  return String(raw || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function isLikelyCalendarId(id) {
  return id.includes("@") && (id.includes("calendar.google.com") || id.endsWith(".com"));
}

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
  const normalizedCalendarId = normalizeCalendarId(calendarId);
  if (!enabled || !normalizedCalendarId || !serviceEmail || !privateKey) {
    return null;
  }
  if (!isLikelyCalendarId(normalizedCalendarId)) {
    throw new Error(`GOOGLE_CALENDAR_ID looks invalid: '${normalizedCalendarId}'`);
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

  let response;
  try {
    response = await client.events.insert({
      calendarId: normalizeCalendarId(calendarId),
      requestBody: payload
    });
  } catch (error) {
    const code = Number(error?.code || error?.response?.status || 0);
    const details = error?.response?.data?.error?.message || error?.message || "unknown error";
    throw new Error(`Google Calendar insert failed status=${code || "n/a"} calendarId=${normalizeCalendarId(calendarId)}: ${details}`);
  }

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

  try {
    await client.events.patch({
      calendarId: normalizeCalendarId(calendarId),
      eventId: googleEventId,
      requestBody: {
        summary
      }
    });
  } catch (error) {
    const code = Number(error?.code || error?.response?.status || 0);
    if (code === 404) {
      return { ok: false, skipped: true, reason: "google_event_not_found" };
    }
    throw error;
  }

  return { ok: true };
}
