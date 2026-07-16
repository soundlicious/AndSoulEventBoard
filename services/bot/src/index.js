import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode-terminal";
import { buildAckMessage, buildRsvpReply, buildRsvpsListReply } from "./messages.js";

const botName = process.env.BOT_NAME || "event-bot";
const apiBaseUrl = process.env.API_BASE_URL || "http://api:8080";
const authPath = process.env.BAILEYS_AUTH_PATH || "/app/auth/session.json";
const groupsConfigPath = process.env.GROUPS_CONFIG_PATH || "/app/config/groups.json";
const enableBaileys = String(process.env.ENABLE_BAILEYS || "false") === "true";
const authDir = process.env.BAILEYS_AUTH_DIR || "/app/auth/state";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const allowFromMe = String(process.env.BOT_ALLOW_FROM_ME || "false") === "true";
const commandPrefix = "/event ";
const ignoreOldMessages = String(process.env.BOT_IGNORE_OLD_MESSAGES || "true") === "true";
const startupCutoffMs = Date.now();
const dmObserveMode = process.env.BOT_DM_OBSERVE_MODE || "all";
const rsvpPhoneNumber = String(process.env.BOT_RSVP_PHONE_NUMBER || "").trim();

function apiHeaders() {
  const headers = { "content-type": "application/json" };
  if (internalApiToken) {
    headers["x-internal-token"] = internalApiToken;
  }
  return headers;
}

function normalizeSenderJid(remoteJid, msg) {
  if (remoteJid && remoteJid.endsWith("@s.whatsapp.net")) {
    return remoteJid;
  }
  const participant = msg?.key?.participant;
  if (participant && participant.endsWith("@s.whatsapp.net")) {
    return participant;
  }
  return remoteJid || "unknown@s.whatsapp.net";
}

function messageTimestampMs(msg) {
  const raw = msg?.messageTimestamp;
  if (raw == null) {
    return null;
  }
  if (typeof raw === "number") {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      return n > 1e12 ? n : n * 1000;
    }
  }
  if (typeof raw === "object" && typeof raw.toString === "function") {
    const n = Number(raw.toString());
    if (!Number.isNaN(n)) {
      return n > 1e12 ? n : n * 1000;
    }
  }
  return null;
}

function shouldObserveDmMessage(msg, remoteJid) {
  const text = extractMessageText(msg.message);
  const normalizedText = (text || "").trim().toLowerCase();

  if (dmObserveMode === "self_only") {
    if (!msg.key.fromMe) {
      return false;
    }
    if (!remoteJid.endsWith("@lid") && !remoteJid.endsWith("@s.whatsapp.net")) {
      return false;
    }
    return normalizedText.startsWith(commandPrefix)
      || normalizedText.startsWith("/rsvp-event ")
      || normalizedText.startsWith("/cancel-rsvp-event ")
      || normalizedText.startsWith("/cancel-event ");
  }

  if (msg.key.fromMe && !allowFromMe) {
    return false;
  }
  return true;
}

function persistFakeSession() {
  const dir = path.dirname(authPath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(authPath)) {
    fs.writeFileSync(authPath, JSON.stringify({ initializedAt: new Date().toISOString() }, null, 2));
  }
}

async function sendIngest(senderJid, messageId, rawText) {
  const imagePayload = {
    mimeType: "image/jpeg",
    dataBase64: Buffer.from("simulated-image").toString("base64")
  };
  const res = await fetch(`${apiBaseUrl}/ingest/dm`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ senderJid, messageId, rawText, image: imagePayload })
  });
  const json = await res.json();
  process.stdout.write(
    `[${botName}] ingest status=${res.status} variant=${json.variant ?? "n/a"} valid=${json.valid ?? "n/a"}\n`
  );
  if (!res.ok) {
    process.stderr.write(`[${botName}] ingest rejected: ${json.error || "unknown error"}\n`);
    return;
  }
  if (json.event?.id && !json.needsConfirmation) {
    await publishToConfiguredGroups(json.event.id);
  }
}

function readGroupConfig() {
  try {
    const raw = fs.readFileSync(groupsConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.groups)) {
      return { groups: [], organiserMentions: {} };
    }
    return {
      groups: parsed.groups.filter((group) => group.enabled !== false),
      organiserMentions: parsed.organiserMentions && typeof parsed.organiserMentions === "object"
        ? parsed.organiserMentions
        : {}
    };
  } catch (error) {
    process.stderr.write(`[${botName}] failed to load groups config: ${error.message}\n`);
    return { groups: [], organiserMentions: {} };
  }
}

function renderEventMessage(event, organiserMentions) {
  const organisers = Array.isArray(event.organisers) && event.organisers.length
    ? event.organisers.map((name) => `@${name}`).join(" ")
    : "TBD";

  const mentionJids = Array.isArray(event.organisers)
    ? event.organisers
      .map((name) => organiserMentions[name])
      .filter(Boolean)
    : [];

  const rsvpLink = buildClickToChatLink(`/RSVP-EVENT ${event.id}`);

  return {
    text: [
      `*${event.title}*`,
      event.description,
      `Date: ${event.date}`,
      `Time: ${event.time}`,
      `Organisers: ${organisers}`,
      event.googleCalendarPublicAddLink
        ? `Calendar: ${event.googleCalendarPublicAddLink}`
        : event.googleCalendarHtmlLink
          ? `Calendar: ${event.googleCalendarHtmlLink}`
          : "",
      rsvpLink ? `RSVP: ${rsvpLink}` : "",
      event.image ? `Image: ${event.image}` : ""
    ].filter(Boolean).join("\n"),
    mentionJids
  };
}

function buildClickToChatLink(commandText) {
  if (!rsvpPhoneNumber) {
    return "";
  }
  const phone = rsvpPhoneNumber.replace(/[^0-9]/g, "");
  if (!phone) {
    return "";
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(commandText)}`;
}

function creatorActionLinks(eventId) {
  return {
    cancelEventLink: buildClickToChatLink(`/cancel-event ${eventId}`),
    rsvpsListLink: buildClickToChatLink(`/RSVPS-EVENT ${eventId}`)
  };
}

async function fetchEvent(eventId) {
  const res = await fetch(`${apiBaseUrl}/events/${eventId}`);
  if (!res.ok) {
    throw new Error(`event fetch failed status=${res.status}`);
  }
  return res.json();
}

async function markPublished(eventId, groupJid) {
  const publishRes = await fetch(`${apiBaseUrl}/events/${eventId}/publish`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ groupJid })
  });
  process.stdout.write(
    `[${botName}] publish status=${publishRes.status} eventId=${eventId} groupJid=${groupJid}\n`
  );
}

function extractMessageText(message) {
  if (!message) {
    return "";
  }
  const core = unwrapMessage(message);
  return core.conversation
    || core.extendedTextMessage?.text
    || core.imageMessage?.caption
    || core.videoMessage?.caption
    || "";
}

function unwrapMessage(message) {
  let current = message;
  let depth = 0;
  while (current && depth < 6) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      depth += 1;
      continue;
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      depth += 1;
      continue;
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      depth += 1;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      depth += 1;
      continue;
    }
    break;
  }
  return current || {};
}

function extractImagePayload(message) {
  const core = unwrapMessage(message);
  if (!core?.imageMessage) {
    return null;
  }
  return {
    present: true,
    mimeType: core.imageMessage.mimetype || "image/jpeg"
  };
}

async function downloadIncomingImage(sock, msg) {
  const coreMessage = unwrapMessage(msg?.message);
  if (!coreMessage?.imageMessage) {
    return null;
  }

  const baileys = await import("baileys");
  const { downloadMediaMessage } = baileys;
  const buffer = await downloadMediaMessage(
    msg,
    "buffer",
    {},
    {
      reuploadRequest: sock.updateMediaMessage
    }
  );

  return {
    mimeType: coreMessage.imageMessage.mimetype || "image/jpeg",
    dataBase64: Buffer.from(buffer).toString("base64")
  };
}

async function resolveGroupJidByName(sock, groupName) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupEntry = Object.values(groups).find((entry) => entry.subject === groupName);
    return groupEntry?.id || null;
  } catch (error) {
    process.stderr.write(`[${botName}] failed resolving group name '${groupName}': ${error.message}\n`);
    return null;
  }
}

async function publishViaBaileys(sock, eventId) {
  const { groups, organiserMentions } = readGroupConfig();
  if (groups.length === 0) {
    process.stdout.write(`[${botName}] no enabled groups configured, skipping publish\n`);
    return;
  }

  const event = await fetchEvent(eventId);
  const message = renderEventMessage(event, organiserMentions);

  for (const group of groups) {
    let groupJid = group.jid || "";
    if (!groupJid && group.name) {
      groupJid = await resolveGroupJidByName(sock, group.name);
    }

    if (!groupJid) {
      process.stderr.write(`[${botName}] group '${group.name || "unnamed"}' has no resolvable JID\n`);
      continue;
    }

    await sock.sendMessage(groupJid, {
      text: message.text,
      mentions: message.mentionJids
    });
    process.stdout.write(`[${botName}] baileys sent event=${eventId} groupJid=${groupJid}\n`);
    await markPublished(eventId, groupJid);
  }
}

async function publishViaApiOnly(eventId) {
  const { groups, organiserMentions } = readGroupConfig();
  if (groups.length === 0) {
    process.stdout.write(`[${botName}] no enabled groups configured, skipping publish\n`);
    return;
  }

  const event = await fetchEvent(eventId);
  const preview = renderEventMessage(event, organiserMentions).text.replace(/\n/g, " | ");
  process.stdout.write(`[${botName}] publish preview ${preview}\n`);

  for (const group of groups) {
    if (!group.jid) {
      process.stderr.write(`[${botName}] group '${group.name || "unnamed"}' missing jid, skipping\n`);
      continue;
    }
    await markPublished(eventId, group.jid);
  }
}

async function publishToConfiguredGroups(eventId) {
  if (!enableBaileys) {
    await publishViaApiOnly(eventId);
    return;
  }
}

async function startBaileysRuntime() {
  const baileys = await import("baileys");
  const makeWASocket = baileys.default;
  const useMultiFileAuthState = baileys.useMultiFileAuthState;

  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    browser: ["CoLivingEventBot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      process.stdout.write(`[${botName}] Scan this QR with WhatsApp Linked Devices\n`);
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      process.stdout.write(`[${botName}] Baileys connected\n`);
    }
    if (connection === "close") {
      process.stderr.write(
        `[${botName}] Baileys disconnected; reason=${lastDisconnect?.error?.message || "unknown"}\n`
      );
      setTimeout(() => {
        startBaileysRuntime().catch((error) => {
          process.stderr.write(`[${botName}] reconnect failed: ${error.message}\n`);
        });
      }, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") {
      return;
    }
    for (const msg of messages) {
      if (!msg.message) {
        continue;
      }
      const remoteJid = msg.key.remoteJid || "";
      if (!shouldObserveDmMessage(msg, remoteJid)) {
        continue;
      }
      const senderJid = normalizeSenderJid(remoteJid, msg);
      process.stdout.write(`[${botName}] incoming remoteJid=${remoteJid} senderJid=${senderJid} messageId=${msg.key.id || "unknown"}\n`);

      if (ignoreOldMessages) {
        const ts = messageTimestampMs(msg);
        if (ts && ts < startupCutoffMs) {
          process.stdout.write(
            `[${botName}] skipping old message messageId=${msg.key.id || "unknown"} ts=${new Date(ts).toISOString()}\n`
          );
          continue;
        }
      }

      const isGroup = remoteJid.endsWith("@g.us");
      if (isGroup) {
        continue;
      }
      const text = extractMessageText(msg.message);
      const imageMarker = extractImagePayload(msg.message);

      if (!text && !imageMarker) {
        await sock.sendMessage(remoteJid, {
          text: "I could not read your message. Please send text using /event ... (you can attach an image)."
        });
        continue;
      }

      try {
        let image = null;
        if (imageMarker) {
          image = await downloadIncomingImage(sock, msg);
        }

        const res = await fetch(`${apiBaseUrl}/ingest/dm`, {
          method: "POST",
          headers: apiHeaders(),
            body: JSON.stringify({
              senderJid,
              senderPushName: msg.pushName || "",
              messageId: msg.key.id,
              rawText: text,
              image
            })
        });
        const json = await res.json();
        process.stdout.write(
          `[${botName}] dm ingest status=${res.status} variant=${json.variant ?? "n/a"} valid=${json.valid ?? "n/a"}\n`
        );

        if (!res.ok) {
          await sock.sendMessage(remoteJid, {
            text: `Request failed: ${json.error || "unknown error"}`
          });
          continue;
        }

        if (json.action === "cancel") {
          await sock.sendMessage(remoteJid, {
            text: json.message || "Cancel request processed"
          });
          continue;
        }

        if (json.action === "rsvp" || json.action === "cancel_rsvp") {
          const eventId = json.eventId || json.event?.id || "";
          const rsvpLink = eventId ? buildClickToChatLink(`/RSVP-EVENT ${eventId}`) : "";
          const cancelRsvpLink = eventId ? buildClickToChatLink(`/CANCEL-RSVP-EVENT ${eventId}`) : "";
          await sock.sendMessage(remoteJid, {
            text: buildRsvpReply(json, { rsvpLink, cancelRsvpLink })
          });
          continue;
        }

        if (json.action === "rsvps_list") {
          await sock.sendMessage(remoteJid, {
            text: buildRsvpsListReply(json)
          });
          continue;
        }

        await sock.sendMessage(remoteJid, {
          text: buildAckMessage(json, creatorActionLinks(json.event?.id || ""))
        });

        if (json.event?.id && !json.needsConfirmation) {
          await publishViaBaileys(sock, json.event.id);
        }
      } catch (error) {
        process.stderr.write(`[${botName}] dm ingest failed: ${error.message}\n`);
      }
    }
  });
}

async function run() {
  persistFakeSession();
  process.stdout.write(`[${botName}] bot started\n`);
  process.stdout.write(`[${botName}] this scaffold simulates Baileys intake\n`);
  process.stdout.write(`[${botName}] group config path: ${groupsConfigPath}\n`);
  process.stdout.write(`[${botName}] expected group id format: 120...@g.us (JID)\n`);
  process.stdout.write(`[${botName}] allow fromMe messages: ${allowFromMe}\n`);
  process.stdout.write(`[${botName}] dm observe mode: ${dmObserveMode}\n`);
  process.stdout.write(`[${botName}] ignore old messages before startup: ${ignoreOldMessages}\n`);

  if (enableBaileys) {
    process.stdout.write(`[${botName}] starting real Baileys runtime\n`);
    await startBaileysRuntime();
    return;
  }

  if (String(process.env.SIMULATE_INCOMING || "true") === "true") {
    await sendIngest(
      "34600000001@s.whatsapp.net",
      `sim-${Date.now()}`,
      "/event title=\"Community Dinner\" date=\"2026-07-20\" time=\"19:30\" desc=\"Bring a dish to share\" organisers=\"@pablo @maria\""
    );
  }

  setInterval(() => {
    process.stdout.write(`[${botName}] heartbeat\n`);
  }, 20000);
}

run().catch((error) => {
  process.stderr.write(`[${botName}] fatal: ${error.message}\n`);
  process.exit(1);
});
