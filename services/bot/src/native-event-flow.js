import { randomUUID } from "node:crypto";

const SESSION_TIMEOUT_MS = Number(process.env.BOT_EVENT_ENRICH_TIMEOUT_MS || 10 * 60 * 1000);

const sessions = new Map();

function senderKey(senderJid) {
  return String(senderJid || "").trim().toLowerCase().split("@")[0] || "";
}

function remoteKey(remoteJid) {
  return String(remoteJid || "").trim().toLowerCase();
}

function sessionKey(senderJid, remoteJid) {
  return remoteKey(remoteJid) || senderKey(senderJid);
}

function eventTimezone() {
  return process.env.DEFAULT_TIMEZONE || process.env.TZ || "Europe/London";
}

function dateTimePartsFromEpoch(epochSec) {
  const date = new Date(Number(epochSec || 0) * 1000);
  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: eventTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const map = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : "",
    time: map.hour && map.minute ? `${map.hour}:${map.minute}` : ""
  };
}

export function hasOpenNativeEventSession(senderJid, remoteJid) {
  const key = sessionKey(senderJid, remoteJid);
  if (!key) {
    return false;
  }
  const session = sessions.get(key);
  if (!session) {
    return false;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(key);
    return false;
  }
  return true;
}

function parseDateFromText(text) {
  const m = String(text || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function parseTimeFromText(text) {
  const m = String(text || "").match(/(\d{1,2}:\d{2})/);
  if (!m) {
    return "";
  }
  const [hhRaw, mm] = m[1].split(":");
  const hh = String(Number(hhRaw)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseOrganisersFromText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }

  if (source.includes(",")) {
    return source
      .split(",")
      .map((item) => item.trim().replace(/^@+/, ""))
      .filter((item) => item.length > 0);
  }

  const mentions = [...source.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]);
  if (mentions.length > 0) {
    return mentions;
  }

  return source
    .split(/\s+/)
    .map((item) => item.trim().replace(/^@+/, ""))
    .filter((item) => item.length > 0);
}

function parseNativeEnrichmentCommand(text) {
  const source = String(text || "").trim();
  const match = source.match(
    /^\/(?:organisers|organizers)\s+tempid\s*=\s*"([^"]+)"\s*,?\s*(?:organisers|organizers)\s*=\s*"([^"]*)"/i
  );
  if (!match) {
    return null;
  }
  return {
    tempId: match[1].trim(),
    organisersText: match[2].trim()
  };
}

export function extractNativeEventDraft(msg) {
  const title = msg?.eventMessage?.name || msg?.eventMessage?.title || "";
  const description = msg?.eventMessage?.description || "";
  const startTimeMs = Number(msg?.eventMessage?.startTime || 0);
  const endTimeMs = Number(msg?.eventMessage?.endTime || 0);
  const rawLocation = msg?.eventMessage?.location
    || msg?.eventMessage?.address
    || msg?.eventMessage?.placeName
    || msg?.eventMessage?.locationName
    || msg?.eventMessage?.where
    || "";
  const location = typeof rawLocation === "string"
    ? rawLocation
    : (
      rawLocation?.name
      || rawLocation?.address
      || rawLocation?.title
      || rawLocation?.text
      || ""
    );

  const hasAnyEventSignal = Boolean(
    String(title || "").trim()
    || String(description || "").trim()
    || String(location || "").trim()
    || startTimeMs > 0
    || endTimeMs > 0
  );
  if (!hasAnyEventSignal) {
    return null;
  }

  const startDateTime = startTimeMs > 0
    ? dateTimePartsFromEpoch(startTimeMs)
    : { date: "", time: "" };
  const date = startDateTime.date;
  const startTime = startDateTime.time;

  let endTime = "";
  if (endTimeMs > 0) {
    endTime = dateTimePartsFromEpoch(endTimeMs).time;
  }

  return {
    title,
    description,
    date,
    startTime,
    endTime: endTime || "23:59",
    location: String(location || "")
  };
}

export function nativeDraftMissingFields(draft) {
  const missing = [];
  if (!String(draft?.title || "").trim()) {
    missing.push("title");
  }
  if (!String(draft?.description || "").trim()) {
    missing.push("description");
  }
  if (!String(draft?.location || "").trim()) {
    missing.push("location");
  }
  if (!String(draft?.startTime || "").trim()) {
    missing.push("startTime");
  }
  return missing;
}

export function openNativeEventSession(senderJid, remoteJid, draft) {
  const key = sessionKey(senderJid, remoteJid);
  const session = {
    senderJid,
    remoteJid,
    draft,
    tempId: `tmp_${randomUUID().slice(0, 8)}`,
    openedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TIMEOUT_MS
  };
  sessions.set(key, session);
  return session;
}

export function consumeNativeEventIfReady(senderJid, { text, image, remoteJid } = {}) {
  const key = sessionKey(senderJid, remoteJid);
  const session = sessions.get(key);
  if (!session) {
    return { handled: false };
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(key);
    return { handled: true, expired: true };
  }

  const parsed = parseNativeEnrichmentCommand(text);
  if (!parsed) {
    return {
      handled: true,
      complete: false,
      needCommand: true,
      needImage: !Boolean(image),
      tempId: session.tempId
    };
  }

  if (parsed.tempId !== session.tempId) {
    return {
      handled: true,
      complete: false,
      wrongTempId: true,
      needImage: !Boolean(image),
      tempId: session.tempId
    };
  }

  const organisers = parseOrganisersFromText(parsed.organisersText);
  const hasOrganisers = organisers.length > 0;
  const hasImage = Boolean(image);

  if (!hasOrganisers || !hasImage) {
    return {
      handled: true,
      complete: false,
      needCommand: false,
      needOrganisers: !hasOrganisers,
      needImage: !hasImage,
      tempId: session.tempId
    };
  }

  const maybeDate = parseDateFromText(text);
  const maybeStartTime = parseTimeFromText(text);

  const payload = {
    title: session.draft.title,
    description: session.draft.description || "",
    date: maybeDate || session.draft.date,
    startTime: maybeStartTime || session.draft.startTime,
    endTime: session.draft.endTime || "23:59",
    location: session.draft.location || undefined,
    organisers,
    image
  };

  sessions.delete(key);
  return { handled: true, complete: true, payload };
}

export function collectExpiredNativeSessions(nowMs = Date.now()) {
  const expired = [];
  for (const [senderJid, session] of sessions) {
    if (nowMs > session.expiresAt) {
      expired.push(session);
      sessions.delete(senderJid);
    }
  }
  return expired;
}
