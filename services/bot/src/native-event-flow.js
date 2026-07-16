import { randomUUID } from "node:crypto";

const SESSION_TIMEOUT_MS = Number(process.env.BOT_EVENT_ENRICH_TIMEOUT_MS || 10 * 60 * 1000);

const sessions = new Map();

function sessionKey(senderJid) {
  return String(senderJid || "").trim().toLowerCase().split("@")[0] || "";
}

export function hasOpenNativeEventSession(senderJid) {
  const key = sessionKey(senderJid);
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
  const source = String(text || "");
  return [...source.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]);
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

  if (!title || !startTimeMs) {
    return null;
  }

  const startDate = new Date(startTimeMs * 1000);
  const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  const startTime = `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;

  let endTime = "";
  if (endTimeMs > 0) {
    const endDate = new Date(endTimeMs * 1000);
    endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
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

export function openNativeEventSession(senderJid, remoteJid, draft) {
  const key = sessionKey(senderJid);
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

export function consumeNativeEventIfReady(senderJid, { text, image }) {
  const key = sessionKey(senderJid);
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
