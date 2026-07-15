import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataPath = process.env.EVENTS_FILE_PATH || "/app/data/events.json";

function eventTimestampMs(event) {
  if (!event?.date || !event?.time) {
    return Number.POSITIVE_INFINITY;
  }
  const date = new Date(`${event.date}T${event.time}:00`);
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

export function listEvents() {
  const db = withPrunedDb();
  return db.events.sort((a, b) => {
    const aKey = `${a.date || "9999-12-31"}T${a.time || "23:59"}`;
    const bKey = `${b.date || "9999-12-31"}T${b.time || "23:59"}`;
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
    ...payload
  };

  if (!event.createdBy) {
    event.createdBy = event?.source?.senderJid || null;
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

export function listEventMediaPaths() {
  const db = withPrunedDb();
  return db.events
    .map((event) => event.image)
    .filter((image) => typeof image === "string" && image.startsWith("/media/"));
}
