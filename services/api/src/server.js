import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  computeConfidence,
  hashString,
  validateEventPayload
} from "@coliving/shared";
import {
  addEventRsvp,
  cleanupPastEvents,
  createEvent,
  deleteEvent,
  deleteEventsByIds,
  getEvent,
  insertParseLog,
  listEventMediaPaths,
  listEvents,
  markPublished,
  metrics,
  removeEventRsvp,
  updateEvent
} from "./store.js";
import {
  markCancelledInGoogleCalendar,
  syncCreateToGoogleCalendar
} from "./google-calendar.js";
import {
  calendarQrTargetLink,
  createCalendarQrImage
} from "./calendar-qr.js";

const apiPort = Number(process.env.API_PORT || 8080);
const autoPublishThreshold = Number(process.env.CONFIDENCE_AUTO_PUBLISH || 0.85);
const confirmThreshold = Number(process.env.CONFIDENCE_CONFIRM || 0.6);
const mediaDir = process.env.MEDIA_DIR || "/app/data/media";
const maxMediaBytes = Number(process.env.MAX_MEDIA_BYTES || 5 * 1024 * 1024);
const maxBodyBytes = Number(process.env.API_MAX_BODY_BYTES || 8 * 1024 * 1024);
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);
const rateLimitMaxPerSender = Number(process.env.RATE_LIMIT_MAX_PER_SENDER || 10);
const rateLimitMaxGlobal = Number(process.env.RATE_LIMIT_MAX_GLOBAL || 200);

const perSenderRate = new Map();
const globalRate = [];

function normalizeIdentity(jid) {
  return String(jid || "").trim().toLowerCase().split("@")[0] || "";
}

function isSameActor(a, b) {
  if (!a || !b) {
    return false;
  }
  const aRaw = String(a).trim().toLowerCase();
  const bRaw = String(b).trim().toLowerCase();
  if (aRaw === bRaw) {
    return true;
  }
  return normalizeIdentity(aRaw) === normalizeIdentity(bRaw);
}

function isFutureEvent(date, startTime) {
  if (!date || !startTime) {
    return false;
  }
  const candidate = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(candidate.getTime())) {
    return false;
  }
  return candidate.getTime() > Date.now();
}

function renderGroupMessage(event) {
  const mentionLine = Array.isArray(event.organisers) && event.organisers.length > 0
    ? `Organisers: ${event.organisers.map((name) => `@${name}`).join(" ")}`
    : "Organisers: TBD";
  const imageLine = typeof event.image === "string"
    ? `Image: ${event.image}`
    : event.image
      ? "Image: attached"
      : "";

  return [
    `*${event.title}*`,
    event.description,
    `Date: ${event.date}`,
    `Start: ${event.startTime}`,
    `End: ${event.endTime || "23:59"}`,
    mentionLine,
    imageLine
  ].filter(Boolean).join("\n");
}

function parseNewCommand(rawText) {
  if (!rawText.trim().toLowerCase().startsWith("/event ")) {
    return null;
  }

  const pairs = {};
  const matcher = /(title|date|starttime|endtime|desc|description|organisers)="([^"]*)"/gi;
  let match = matcher.exec(rawText);
  while (match) {
    pairs[match[1].toLowerCase()] = match[2].trim();
    match = matcher.exec(rawText);
  }

  const organisersText = pairs.organisers || "";
  const organisers = [...organisersText.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]);

  if (!pairs.title && !pairs.date && !pairs.starttime && !pairs.desc && !pairs.description) {
    return null;
  }

  return {
    title: pairs.title || "Community Event",
    description: pairs.desc || pairs.description || "",
    date: pairs.date || new Date().toISOString().slice(0, 10),
    startTime: pairs.starttime || "19:00",
    endTime: pairs.endtime || "23:59",
    organisers,
    image: null,
    parserErrors: []
  };
}

function parseCancelCommand(rawText) {
  const match = rawText.trim().match(/^\/cancel-event\s+(evt_[a-zA-Z0-9-]+)/i);
  if (!match) {
    return null;
  }
  return { eventId: match[1] };
}

function parseRsvpCommand(rawText) {
  const match = rawText.trim().match(/^\/rsvp-event\s+(evt_[a-zA-Z0-9-]+)/i);
  if (!match) {
    return null;
  }
  return { eventId: match[1] };
}

function parseCancelRsvpCommand(rawText) {
  const match = rawText.trim().match(/^\/cancel-rsvp-event\s+(evt_[a-zA-Z0-9-]+)/i);
  if (!match) {
    return null;
  }
  return { eventId: match[1] };
}

function parseRsvpsListCommand(rawText) {
  const match = rawText.trim().match(/^\/rsvps-event\s+(evt_[a-zA-Z0-9-]+)/i);
  if (!match) {
    return null;
  }
  return { eventId: match[1] };
}

function json(res, statusCode, payload, reqId) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "x-correlation-id": reqId
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let hasErrored = false;
    let byteCount = 0;
    req.on("data", (chunk) => {
      if (hasErrored) {
        return;
      }
      byteCount += Buffer.byteLength(chunk);
      if (byteCount > maxBodyBytes) {
        hasErrored = true;
        reject({ statusCode: 413, message: `Request body too large, max ${maxBodyBytes} bytes` });
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (hasErrored) {
        return;
      }
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extensionFromMime(mimeType) {
  if (!mimeType) {
    return "bin";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("png")) {
    return "png";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  return "bin";
}

function persistImageIfNeeded(image) {
  if (!image) {
    return null;
  }
  if (typeof image === "string") {
    return image;
  }
  if (typeof image !== "object" || !image.dataBase64 || !image.mimeType) {
    return image;
  }

  const ext = extensionFromMime(image.mimeType);
  const fileName = `${randomUUID()}.${ext}`;
  const bytes = Buffer.from(image.dataBase64, "base64");
  if (bytes.length > maxMediaBytes) {
    throw { statusCode: 413, message: `Image too large, max ${maxMediaBytes} bytes` };
  }
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, fileName), bytes);
  return `/media/${fileName}`;
}

function handleRouteError(res, reqId, error) {
  if (error?.statusCode) {
    json(res, error.statusCode, { error: error.message }, reqId);
    return;
  }
  const message = typeof error?.message === "string" && error.message.trim().length > 0
    ? error.message
    : "Unexpected server error";
  json(res, 500, { error: message }, reqId);
}

function isProtectedRoute(method, pathname) {
  if (method === "POST" && pathname === "/events") {
    return true;
  }
  if (method === "POST" && pathname === "/ingest/dm") {
    return true;
  }
  if (method === "POST" && pathname.startsWith("/events/") && pathname.endsWith("/publish")) {
    return true;
  }
  if (method === "POST" && pathname === "/experiments/parses") {
    return true;
  }
  if (method === "DELETE" && pathname.startsWith("/events/")) {
    return true;
  }
  if (method === "POST" && pathname === "/events/batch-delete") {
    return true;
  }
  return false;
}

function ensureInternalAuth(req, res, reqId, pathname) {
  if (!internalApiToken || !isProtectedRoute(req.method, pathname)) {
    return true;
  }
  const provided = req.headers["x-internal-token"];
  if (provided === internalApiToken) {
    return true;
  }
  json(res, 401, { error: "Unauthorized" }, reqId);
  return false;
}

function cleanupTimestamps(list, now, windowMs) {
  while (list.length > 0 && now - list[0] > windowMs) {
    list.shift();
  }
}

function checkIngestRateLimit(senderJid) {
  const now = Date.now();
  cleanupTimestamps(globalRate, now, rateLimitWindowMs);

  if (globalRate.length >= rateLimitMaxGlobal) {
    return {
      allowed: false,
      error: `Rate limit exceeded globally. Retry later (${rateLimitWindowMs}ms window).`
    };
  }

  const key = senderJid || "unknown@s.whatsapp.net";
  const senderList = perSenderRate.get(key) || [];
  cleanupTimestamps(senderList, now, rateLimitWindowMs);

  if (senderList.length >= rateLimitMaxPerSender) {
    perSenderRate.set(key, senderList);
    return {
      allowed: false,
      error: `Rate limit exceeded for sender. Retry later (${rateLimitWindowMs}ms window).`
    };
  }

  senderList.push(now);
  globalRate.push(now);
  perSenderRate.set(key, senderList);
  return { allowed: true };
}

function mediaContentType(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  if (ext === "png") {
    return "image/png";
  }
  if (ext === "webp") {
    return "image/webp";
  }
  if (ext === "gif") {
    return "image/gif";
  }
  return "application/octet-stream";
}

function cleanupOrphanMediaFiles() {
  fs.mkdirSync(mediaDir, { recursive: true });
  const referenced = new Set(
    listEventMediaPaths().map((mediaPath) => mediaPath.replace("/media/", ""))
  );
  const files = fs.readdirSync(mediaDir, { withFileTypes: true });
  let removed = 0;
  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }
    if (!referenced.has(file.name)) {
      fs.unlinkSync(path.join(mediaDir, file.name));
      removed += 1;
    }
  }
  return removed;
}

async function attachGoogleCalendarData(event) {
  try {
    const sync = await syncCreateToGoogleCalendar(event);
    if (!sync.ok) {
      return event;
    }

    const qrTargetUrl = calendarQrTargetLink(sync);
    let qrImagePath = null;
    if (qrTargetUrl) {
      try {
        qrImagePath = await createCalendarQrImage({
          eventId: event.id,
          targetUrl: qrTargetUrl,
          mediaDir
        });
      } catch {
        qrImagePath = null;
      }
    }

    const patched = updateEvent(event.id, {
      googleCalendarEventId: sync.googleEventId,
      googleCalendarHtmlLink: sync.googleHtmlLink,
      googleCalendarPublicAddLink: sync.googlePublicAddLink,
      googleCalendarQrImage: qrImagePath || null
    });

    return patched || event;
  } catch (error) {
    process.stderr.write(`API calendar sync warning eventId=${event.id}: ${error.message || "unknown"}\n`);
    return event;
  }
}

function simpleParser(rawText) {
  const titleMatch = rawText.match(/title\s*:\s*([^\n]+)/i);
  const descriptionMatch = rawText.match(/description\s*:\s*([^\n]+)/i);
  const dateMatch = rawText.match(/(\d{4}-\d{2}-\d{2})/);
  const timeMatch = rawText.match(/(\d{2}:\d{2})/);
  const imageMatch = rawText.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp|gif)/i);
  const organiserMentions = [...rawText.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]);
  const title = titleMatch ? titleMatch[1].trim() : "Community Event";
  const description = descriptionMatch ? descriptionMatch[1].trim() : rawText.trim();
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
  const startTime = timeMatch ? timeMatch[1] : "19:00";

  return {
    title,
    description,
    date,
    startTime,
    endTime: "23:59",
    organisers: organiserMentions,
    image: imageMatch ? imageMatch[0] : null,
    parserErrors: []
  };
}

async function llmParser(rawText) {
  const startedAt = Date.now();
  const fallback = simpleParser(rawText);
  const apiKey = process.env.LLM_API_KEY;
  const endpoint = process.env.LLM_API_URL;
  const model = process.env.LLM_MODEL || "gpt-4.1-mini";

  if (!apiKey || !endpoint) {
    return {
      event: fallback,
      latencyMs: Date.now() - startedAt,
      tokenInput: 0,
      tokenOutput: 0,
      estimatedCostUsd: 0,
      usedFallback: true
    };
  }

  const prompt = [
    "Extract event fields from the message.",
    "Return ONLY valid JSON with keys:",
    "title, description, date(YYYY-MM-DD), startTime(HH:mm), endTime(HH:mm optional), organisers(string[]), image(string|null).",
    `Message: ${rawText}`
  ].join("\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: prompt
      })
    });

    if (!response.ok) {
      return {
        event: fallback,
        latencyMs: Date.now() - startedAt,
        tokenInput: 0,
        tokenOutput: 0,
        estimatedCostUsd: 0,
        usedFallback: true
      };
    }

    const payload = await response.json();
    const outputText = payload.output_text
      || payload?.output?.[0]?.content?.[0]?.text
      || payload?.choices?.[0]?.message?.content
      || "";
    const parsed = JSON.parse(outputText);

    return {
      event: {
        title: parsed.title || fallback.title,
        description: parsed.description || fallback.description,
        date: parsed.date || fallback.date,
        startTime: parsed.startTime || fallback.startTime,
        endTime: parsed.endTime || fallback.endTime,
        organisers: Array.isArray(parsed.organisers) ? parsed.organisers : fallback.organisers,
        image: parsed.image || fallback.image,
        parserErrors: []
      },
      latencyMs: Date.now() - startedAt,
      tokenInput: payload?.usage?.input_tokens || 0,
      tokenOutput: payload?.usage?.output_tokens || 0,
      estimatedCostUsd: 0,
      usedFallback: false
    };
  } catch {
    return {
      event: fallback,
      latencyMs: Date.now() - startedAt,
      tokenInput: 0,
      tokenOutput: 0,
      estimatedCostUsd: 0,
      usedFallback: true
    };
  }
}

function assignmentForSender(senderJid, mode) {
  if (process.env.AB_FORCE_VARIANT === "A" || process.env.AB_FORCE_VARIANT === "B") {
    return process.env.AB_FORCE_VARIANT;
  }
  if (mode === "random_50_50") {
    return Math.random() < 0.5 ? "A" : "B";
  }
  const hashed = hashString(senderJid);
  return Number(hashed.replace("h", "")) % 2 === 0 ? "A" : "B";
}

export function createServer() {
  perSenderRate.clear();
  globalRate.length = 0;

  return http.createServer(async (req, res) => {
    const reqId = randomUUID();
    const url = new URL(req.url, `http://${req.headers.host}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-internal-token");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!ensureInternalAuth(req, res, reqId, url.pathname)) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "api" }, reqId);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      cleanupOrphanMediaFiles();
      json(res, 200, { items: listEvents() }, reqId);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      const fileName = url.pathname.replace("/media/", "");
      if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
        json(res, 400, { error: "Invalid media file name" }, reqId);
        return;
      }
      const filePath = path.join(mediaDir, fileName);
      if (!fs.existsSync(filePath)) {
        json(res, 404, { error: "Media not found" }, reqId);
        return;
      }
      res.writeHead(200, {
        "content-type": mediaContentType(fileName),
        "cache-control": "public, max-age=86400"
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/events/")) {
      cleanupOrphanMediaFiles();
      const id = url.pathname.split("/")[2];
      const event = getEvent(id);
      if (!event) {
        json(res, 404, { error: "Event not found" }, reqId);
        return;
      }
      json(res, 200, event, reqId);
      return;
    }

    if (req.method === "POST" && url.pathname === "/events") {
      try {
        const body = await parseBody(req);
        const normalized = {
          ...body,
          image: persistImageIfNeeded(body.image)
        };
        const result = validateEventPayload(normalized);
        if (result.valid && !isFutureEvent(normalized.date, normalized.startTime)) {
          result.valid = false;
          result.errors.push("Event date+startTime must be in the future");
        }
        if (!result.valid) {
          json(res, 400, { errors: result.errors }, reqId);
          return;
        }
        const event = createEvent(normalized);
        const withCalendar = await attachGoogleCalendarData(event);
        cleanupOrphanMediaFiles();
        json(res, 201, withCalendar, reqId);
      } catch (error) {
        handleRouteError(res, reqId, error);
      }
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/events/") && url.pathname.endsWith("/publish")) {
      const id = url.pathname.split("/")[2];
      let groupJid = "";
      try {
        const publishBody = await parseBody(req);
        groupJid = publishBody.groupJid || "";
      } catch {
        groupJid = "";
      }
      const existing = getEvent(id);
      if (!existing) {
        json(res, 404, { error: "Event not found" }, reqId);
        return;
      }
      const updated = markPublished(id, groupJid);
      cleanupOrphanMediaFiles();
      json(res, 200, updated, reqId);
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/events/")) {
      const id = url.pathname.split("/")[2];
      const target = getEvent(id);
      if (!target) {
        json(res, 404, { error: "Event not found" }, reqId);
        return;
      }
      const calendarResult = await markCancelledInGoogleCalendar(
        target.googleCalendarEventId,
        target.title
      );
      const result = deleteEvent(id);
      cleanupOrphanMediaFiles();
      if (!result.deleted) {
        json(res, 404, { error: "Event not found" }, reqId);
        return;
      }
      json(res, 200, { deleted: true, id, calendarResult }, reqId);
      return;
    }

    if (req.method === "POST" && url.pathname === "/events/batch-delete") {
      try {
        const body = await parseBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
        if (ids.length === 0) {
          json(res, 400, { error: "ids must be a non-empty string array" }, reqId);
          return;
        }
        for (const id of ids) {
          const target = getEvent(id);
          if (target) {
            await markCancelledInGoogleCalendar(target.googleCalendarEventId, target.title);
          }
        }
        const result = deleteEventsByIds(ids);
        cleanupOrphanMediaFiles();
        json(res, 200, { deletedCount: result.deletedCount }, reqId);
      } catch (error) {
        handleRouteError(res, reqId, error);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/ingest/dm") {
      try {
        const body = await parseBody(req);
        const senderJid = body.senderJid || "unknown@s.whatsapp.net";
        const senderPushName = typeof body.senderPushName === "string" ? body.senderPushName.trim() : "";
        const rate = checkIngestRateLimit(senderJid);
        if (!rate.allowed) {
          json(res, 429, { error: rate.error }, reqId);
          return;
        }
        const rawText = body.rawText || "";

        const rsvp = parseRsvpCommand(rawText);
        if (rsvp) {
          const target = getEvent(rsvp.eventId);
          if (!target) {
            json(res, 200, {
              action: "rsvp",
              ok: false,
              message: "Event not found",
              eventId: rsvp.eventId
            }, reqId);
            return;
          }
          const result = addEventRsvp(rsvp.eventId, senderJid, senderPushName);
          const event = getEvent(rsvp.eventId);
          json(res, 200, {
            action: "rsvp",
            ok: true,
            added: result.added,
            eventId: rsvp.eventId,
            count: result.count,
            event,
            message: result.added
              ? `RSVP confirmed for ${rsvp.eventId}`
              : `RSVP already exists for ${rsvp.eventId}`
          }, reqId);
          return;
        }

        const cancelRsvp = parseCancelRsvpCommand(rawText);
        if (cancelRsvp) {
          const target = getEvent(cancelRsvp.eventId);
          if (!target) {
            json(res, 200, {
              action: "cancel_rsvp",
              ok: false,
              message: "Event not found",
              eventId: cancelRsvp.eventId
            }, reqId);
            return;
          }
          const result = removeEventRsvp(cancelRsvp.eventId, senderJid);
          const event = getEvent(cancelRsvp.eventId);
          json(res, 200, {
            action: "cancel_rsvp",
            ok: true,
            removed: result.removed,
            eventId: cancelRsvp.eventId,
            count: result.count,
            event,
            message: result.removed
              ? `RSVP cancelled for ${cancelRsvp.eventId}`
              : `No RSVP found for ${cancelRsvp.eventId}`
          }, reqId);
          return;
        }

        const rsvpsList = parseRsvpsListCommand(rawText);
        if (rsvpsList) {
          const target = getEvent(rsvpsList.eventId);
          if (!target) {
            json(res, 200, {
              action: "rsvps_list",
              ok: false,
              message: "Event not found",
              eventId: rsvpsList.eventId
            }, reqId);
            return;
          }
          if (!isSameActor(target.createdBy, senderJid)) {
            json(res, 200, {
              action: "rsvps_list",
              ok: false,
              message: "Only the creator can view RSVP list",
              eventId: rsvpsList.eventId
            }, reqId);
            return;
          }

          const rsvps = Array.isArray(target.rsvps) ? target.rsvps : [];
          json(res, 200, {
            action: "rsvps_list",
            ok: true,
            eventId: rsvpsList.eventId,
            count: rsvps.length,
            rsvps,
            message: `RSVP list for ${rsvpsList.eventId}`
          }, reqId);
          return;
        }

        const cancel = parseCancelCommand(rawText);
        if (cancel) {
          const target = getEvent(cancel.eventId);
          if (!target) {
            json(res, 200, {
              action: "cancel",
              ok: false,
              message: "Event not found"
            }, reqId);
            return;
          }
          if (!isSameActor(target.createdBy, senderJid)) {
            json(res, 200, {
              action: "cancel",
              ok: false,
              message: "Only the creator can cancel this event"
            }, reqId);
            return;
          }
          const result = deleteEvent(cancel.eventId);
          if (result.deleted) {
            await markCancelledInGoogleCalendar(target.googleCalendarEventId, target.title);
          }
          cleanupOrphanMediaFiles();
          json(res, 200, {
            action: "cancel",
            ok: result.deleted,
            message: result.deleted ? `Event ${cancel.eventId} deleted` : "Delete failed",
            eventId: cancel.eventId
          }, reqId);
          return;
        }

        const assignmentMode = process.env.AB_ASSIGNMENT_MODE || "sender_sticky";
        const variant = assignmentForSender(senderJid, assignmentMode);

        let parsed;
        let latencyMs = 20;
        let tokenInput = 0;
        let tokenOutput = 0;
        let estimatedCostUsd = 0;

        if (variant === "A") {
          parsed = parseNewCommand(rawText) || simpleParser(rawText);
        } else {
          const llm = await llmParser(rawText);
          parsed = parseNewCommand(rawText) || llm.event;
          latencyMs = llm.latencyMs;
          tokenInput = llm.tokenInput;
          tokenOutput = llm.tokenOutput;
          estimatedCostUsd = llm.estimatedCostUsd;
        }

        if (body.image) {
          parsed.image = persistImageIfNeeded(body.image);
        }

        const confidence = computeConfidence(parsed);
        const validation = validateEventPayload(parsed);
        if (validation.valid && !isFutureEvent(parsed.date, parsed.startTime)) {
          validation.valid = false;
          validation.errors.push("Event date+startTime must be in the future");
        }
        const needsConfirmation = confidence < autoPublishThreshold && confidence >= confirmThreshold;
        const valid = validation.valid;

        let event = null;
        if (valid) {
          event = createEvent({
            ...parsed,
            source: {
              channel: "whatsapp_dm",
              senderJid,
              messageId: body.messageId || `sim_${Date.now()}`,
              rawText
            },
            parse: {
              variant,
              confidence,
              needsConfirmation
            },
            status: needsConfirmation ? "draft" : "confirmed"
          });
          event = await attachGoogleCalendarData(event);
          cleanupOrphanMediaFiles();
        }

        const parseLog = insertParseLog({
          assignmentMode,
          variant,
          senderJidHash: hashString(senderJid),
          messageLength: rawText.length,
          llmModel: variant === "B" ? process.env.LLM_MODEL || "unknown" : null,
          latencyMs,
          tokenInput,
          tokenOutput,
          estimatedCostUsd,
          valid,
          confidence,
          requiredFieldsPresent: ["title", "description", "date", "startTime"].filter((f) => parsed[f]),
          correctionRequested: needsConfirmation,
          eventId: event?.id || null
        });

        json(
          res,
          200,
          {
            variant,
            confidence,
            valid,
            errors: validation.errors,
            needsConfirmation,
            event,
            groupMessage: event ? renderGroupMessage(event) : null,
            parseLog
          },
          reqId
        );
      } catch (error) {
        handleRouteError(res, reqId, error);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/experiments/parses") {
      try {
        const body = await parseBody(req);
        const inserted = insertParseLog(body);
        json(res, 201, inserted, reqId);
      } catch (error) {
        handleRouteError(res, reqId, error);
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/experiments/metrics") {
      json(res, 200, metrics(), reqId);
      return;
    }

    json(res, 404, { error: "Not found" }, reqId);
  });
}

if (process.env.NODE_ENV !== "test") {
  const cleanupIntervalMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    const removed = cleanupPastEvents();
    const removedMedia = cleanupOrphanMediaFiles();
    if (removed > 0) {
      process.stdout.write(`API cleanup removed ${removed} past event(s)\n`);
    }
    if (removedMedia > 0) {
      process.stdout.write(`API cleanup removed ${removedMedia} orphan media file(s)\n`);
    }
  }, cleanupIntervalMs);

  const server = createServer();
  server.listen(apiPort, () => {
    process.stdout.write(`API listening on ${apiPort}\n`);
  });
}
