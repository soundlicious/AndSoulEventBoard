import test from "node:test";
import assert from "node:assert/strict";

import {
  collectExpiredNativeSessions,
  consumeNativeEventIfReady,
  extractNativeEventDraft,
  nativeDraftMissingFields,
  openNativeEventSession
} from "../src/native-event-flow.js";

test("extractNativeEventDraft maps WhatsApp event payload", () => {
  process.env.DEFAULT_TIMEZONE = "Europe/London";
  const startEpochSec = Math.floor(new Date("2026-08-10T09:00:00Z").getTime() / 1000);
  const endEpochSec = Math.floor(new Date("2026-08-10T10:30:00Z").getTime() / 1000);

  const draft = extractNativeEventDraft({
    eventMessage: {
      name: "Yoga",
      description: "Morning flow",
      startTime: startEpochSec,
      endTime: endEpochSec
    }
  });
  assert.equal(draft.title, "Yoga");
  assert.equal(draft.date, "2026-08-10");
  assert.equal(draft.startTime, "10:00");
  assert.equal(draft.endTime, "11:30");
});

test("extractNativeEventDraft returns null when no event data exists", () => {
  const draft = extractNativeEventDraft({
    eventMessage: {}
  });
  assert.equal(draft, null);
});

test("extractNativeEventDraft maps location object", () => {
  const startEpochSec = Math.floor(new Date("2026-08-10T09:00:00Z").getTime() / 1000);

  const draft = extractNativeEventDraft({
    eventMessage: {
      name: "Brunch",
      description: "Late morning",
      startTime: startEpochSec,
      location: {
        name: "Soul Kitchen"
      }
    }
  });

  assert.equal(draft.location, "Soul Kitchen");
});

test("nativeDraftMissingFields reports required native-event fields", () => {
  const missing = nativeDraftMissingFields({
    title: "",
    description: "",
    location: "",
    startTime: ""
  });

  assert.deepEqual(missing, ["title", "description", "location", "startTime"]);
});

test("consumeNativeEventIfReady requires organisers and image", () => {
  openNativeEventSession("a@s.whatsapp.net", "a@s.whatsapp.net", {
    title: "Dinner",
    description: "desc",
    date: "2026-08-10",
    startTime: "19:00",
    endTime: "23:59"
  });

  const missing = consumeNativeEventIfReady("a@s.whatsapp.net", {
    text: "hello",
    image: null,
    remoteJid: "a@s.whatsapp.net"
  });
  assert.equal(missing.handled, true);
  assert.equal(missing.complete, false);
  assert.equal(missing.needCommand, true);
  assert.equal(missing.needImage, true);

  const badTemp = consumeNativeEventIfReady("a@s.whatsapp.net", {
    text: "/organisers tempId=\"tmp_wrong\", organisers=\"@pablo @maria\"",
    image: { mimeType: "image/jpeg", dataBase64: "abc" },
    remoteJid: "a@s.whatsapp.net"
  });
  assert.equal(badTemp.wrongTempId, true);

  const complete = consumeNativeEventIfReady("a@s.whatsapp.net", {
    text: `/organisers tempId="${missing.tempId}", organisers="organizer_name1,organizer_name2"`,
    image: { mimeType: "image/jpeg", dataBase64: "abc" },
    remoteJid: "a@s.whatsapp.net"
  });
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.payload.organisers, ["organizer_name1", "organizer_name2"]);
});

test("consumeNativeEventIfReady still accepts @mentions format", () => {
  openNativeEventSession("c@s.whatsapp.net", "c@s.whatsapp.net", {
    title: "Dinner",
    description: "desc",
    date: "2026-08-10",
    startTime: "19:00",
    endTime: "23:59"
  });

  const incomplete = consumeNativeEventIfReady("c@s.whatsapp.net", {
    text: "hello",
    image: null,
    remoteJid: "c@s.whatsapp.net"
  });

  const complete = consumeNativeEventIfReady("c@s.whatsapp.net", {
    text: `/organisers tempId="${incomplete.tempId}", organisers="@pablo @maria"`,
    image: { mimeType: "image/jpeg", dataBase64: "abc" },
    remoteJid: "c@s.whatsapp.net"
  });

  assert.equal(complete.complete, true);
  assert.deepEqual(complete.payload.organisers, ["pablo", "maria"]);
});

test("collectExpiredNativeSessions returns timed-out sessions", () => {
  openNativeEventSession("b@s.whatsapp.net", "b@s.whatsapp.net", {
    title: "Old",
    description: "desc",
    date: "2026-08-10",
    startTime: "19:00",
    endTime: "23:59"
  });
  const expired = collectExpiredNativeSessions(Date.now() + 20 * 60 * 1000);
  assert.equal(expired.length >= 1, true);
});

test("session key prefers remoteJid to avoid cross-user collisions", () => {
  openNativeEventSession("same@lid", "111111@lid", {
    title: "A",
    description: "desc",
    date: "2026-08-10",
    startTime: "19:00",
    endTime: "23:59",
    location: "Room A"
  });
  openNativeEventSession("same@lid", "222222@lid", {
    title: "B",
    description: "desc",
    date: "2026-08-10",
    startTime: "20:00",
    endTime: "23:59",
    location: "Room B"
  });

  const first = consumeNativeEventIfReady("same@lid", {
    text: "hello",
    image: null,
    remoteJid: "111111@lid"
  });
  const second = consumeNativeEventIfReady("same@lid", {
    text: "hello",
    image: null,
    remoteJid: "222222@lid"
  });

  assert.equal(first.handled, true);
  assert.equal(second.handled, true);
  assert.notEqual(first.tempId, second.tempId);
});
