import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataPath = process.env.EVENTS_FILE_PATH || "/app/data/events.json";

function eventTimestampMs(event) {
  if (!event?.date) {
    return Number.POSITIVE_INFINITY;
  }
  const endTime = event?.endTime || "23:59";
  const date = new Date(`${event.date}T${endTime}:00`);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return date.getTime();
}

function prunePastEvents(db) {
  const now = Date.now();
  const before = db.events.length;
  db.events = db.events.filter((event) => eventTimestampMs(event) > now);
  return before - db.events.length;
}

function withPrunedDb() {
  const db = readDb();
  const removed = prunePastEvents(db);
  if (removed > 0) {
    writeDb(db);
  }
  return db;
}

export function cleanupPastEvents() {
  const db = readDb();
  const removed = prunePastEvents(db);
  if (removed > 0) {
    writeDb(db);
  }
  return removed;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readDb() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { events: [], parses: [] };
  }
}

function writeDb(db) {
  ensureDir(dataPath);
  fs.writeFileSync(dataPath, JSON.stringify(db, null, 2), "utf8");
}

function senderIdentity(jid) {
  return String(jid || "").trim().toLowerCase().split("@")[0] || "";
}

function sameSender(a, b) {
  if (!a || !b) {
    return false;
  }
  const aNorm = String(a).trim().toLowerCase();
  const bNorm = String(b).trim().toLowerCase();
  if (aNorm === bNorm) {
    return true;
  }
  return senderIdentity(aNorm) === senderIdentity(bNorm);
}

export function listEvents() {
  const db = withPrunedDb();
  return db.events.sort((a, b) => {
    const aKey = `${a.date || "9999-12-31"}T${a.startTime || "23:59"}`;
    const bKey = `${b.date || "9999-12-31"}T${b.startTime || "23:59"}`;
    return aKey.localeCompare(bKey);
  });
}

export function createEvent(payload) {
  const db = withPrunedDb();
  const event = {
    id: `evt_${randomUUID()}`,
    status: "confirmed",
    publishedGroupJids: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rsvps: [],
    ...payload
  };

  if (!event.createdBy) {
    event.createdBy = event?.source?.senderJid || null;
  }

  if (!event.source || typeof event.source !== "object") {
    event.source = {};
  }
  if (!event.source.senderIdentity && event.source.senderJid) {
    event.source.senderIdentity = senderIdentity(event.source.senderJid);
  }

  const senderJid = event?.source?.senderJid;
  const messageId = event?.source?.messageId;
  if (senderJid && messageId) {
    const duplicate = db.events.find(
      (item) =>
        item?.source?.senderJid === senderJid
        && item?.source?.messageId === messageId
    );
    if (duplicate) {
      return duplicate;
    }
  }

  db.events.push(event);
  writeDb(db);
  return event;
}

function normalizedRsvps(event) {
  if (!Array.isArray(event?.rsvps)) {
    return [];
  }
  return event.rsvps
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      senderJid: typeof item.senderJid === "string" ? item.senderJid : "",
      pushName: typeof item.pushName === "string" ? item.pushName : "",
      rsvpAt: typeof item.rsvpAt === "string" ? item.rsvpAt : ""
    }))
    .filter((item) => item.senderJid.length > 0);
}

export function addEventRsvp(eventId, senderJid, pushName = "") {
  const db = withPrunedDb();
  const idx = db.events.findIndex((item) => item.id === eventId);
  if (idx === -1) {
    return { found: false, added: false, count: 0 };
  }

  const current = normalizedRsvps(db.events[idx]);
  const exists = current.find((item) => sameSender(item.senderJid, senderJid));
  if (exists) {
    if (pushName && exists.pushName !== pushName) {
      const next = current.map((item) => (sameSender(item.senderJid, senderJid)
        ? { ...item, pushName }
        : item));
      const updated = {
        ...db.events[idx],
        rsvps: next,
        updatedAt: new Date().toISOString()
      };
      db.events[idx] = updated;
      writeDb(db);
      return { found: true, added: false, count: updated.rsvps.length };
    }
    return { found: true, added: false, count: current.length };
  }

  const updated = {
    ...db.events[idx],
    rsvps: [...current, {
      senderJid,
      pushName,
      rsvpAt: new Date().toISOString()
    }],
    updatedAt: new Date().toISOString()
  };
  db.events[idx] = updated;
  writeDb(db);
  return { found: true, added: true, count: updated.rsvps.length };
}

export function removeEventRsvp(eventId, senderJid) {
  const db = withPrunedDb();
  const idx = db.events.findIndex((item) => item.id === eventId);
  if (idx === -1) {
    return { found: false, removed: false, count: 0 };
  }

  const current = normalizedRsvps(db.events[idx]);
  if (!current.find((item) => sameSender(item.senderJid, senderJid))) {
    return { found: true, removed: false, count: current.length };
  }

  const next = current.filter((item) => !sameSender(item.senderJid, senderJid));
  const updated = {
    ...db.events[idx],
    rsvps: next,
    updatedAt: new Date().toISOString()
  };
  db.events[idx] = updated;
  writeDb(db);
  return { found: true, removed: true, count: next.length };
}

export function getEvent(id) {
  const db = withPrunedDb();
  return db.events.find((item) => item.id === id);
}

export function markPublished(id, groupJid) {
  const db = withPrunedDb();
  const idx = db.events.findIndex((item) => item.id === id);
  if (idx === -1) {
    return null;
  }

  const previousGroups = Array.isArray(db.events[idx].publishedGroupJids)
    ? db.events[idx].publishedGroupJids
    : [];
  const nextGroups = groupJid && !previousGroups.includes(groupJid)
    ? [...previousGroups, groupJid]
    : previousGroups;

  const updated = {
    ...db.events[idx],
    status: "published",
    publishedGroupJids: nextGroups,
    updatedAt: new Date().toISOString()
  };
  db.events[idx] = updated;
  writeDb(db);
  return updated;
}

export function deleteEvent(id) {
  const db = withPrunedDb();
  const before = db.events.length;
  db.events = db.events.filter((item) => item.id !== id);
  if (db.events.length === before) {
    return { deleted: false };
  }
  writeDb(db);
  return { deleted: true };
}

export function deleteEventsByIds(ids) {
  const idSet = new Set(ids || []);
  const db = withPrunedDb();
  const before = db.events.length;
  db.events = db.events.filter((item) => !idSet.has(item.id));
  const deletedCount = before - db.events.length;
  if (deletedCount > 0) {
    writeDb(db);
  }
  return { deletedCount };
}

export function updateEvent(id, patch) {
  const db = withPrunedDb();
  const idx = db.events.findIndex((item) => item.id === id);
  if (idx === -1) {
    return null;
  }

  const updated = {
    ...db.events[idx],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  db.events[idx] = updated;
  writeDb(db);
  return updated;
}

export function insertParseLog(payload) {
  const db = readDb();
  const parseLog = {
    id: `exp_${randomUUID()}`,
    receivedAt: new Date().toISOString(),
    ...payload
  };
  db.parses.push(parseLog);
  writeDb(db);
  return parseLog;
}

export function metrics() {
  const db = readDb();
  const total = db.parses.length;
  if (total === 0) {
    return {
      totalRuns: 0,
      validRate: 0,
      avgLatencyMs: 0,
      byVariant: {}
    };
  }

  const validCount = db.parses.filter((item) => item.valid).length;
  const avgLatencyMs = Math.round(
    db.parses.reduce((acc, cur) => acc + (cur.latencyMs || 0), 0) / total
  );

  const byVariant = db.parses.reduce((acc, cur) => {
    const key = cur.variant || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    totalRuns: total,
    validRate: Number((validCount / total).toFixed(3)),
    avgLatencyMs,
    byVariant
  };
}

export function replaceEvents(events) {
  const db = withPrunedDb();
  db.events = Array.isArray(events) ? events : [];
  writeDb(db);
  return db.events.length;
}

export function listEventMediaPaths() {
  const db = withPrunedDb();
  return db.events
    .flatMap((event) => [event.image, event.googleCalendarQrImage])
    .filter((mediaPath) => typeof mediaPath === "string" && mediaPath.startsWith("/media/"));
}
