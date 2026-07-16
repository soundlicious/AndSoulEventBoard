import test from "node:test";
import assert from "node:assert/strict";

import {
  collectExpiredNativeSessions,
  consumeNativeEventIfReady,
  extractNativeEventDraft,
  openNativeEventSession
} from "../src/native-event-flow.js";

test("extractNativeEventDraft maps WhatsApp event payload", () => {
  const startEpochSec = Math.floor(new Date("2026-08-10T09:00:00Z").getTime() / 1000);
  const endEpochSec = Math.floor(new Date("2026-08-10T10:30:00Z").getTime() / 1000);
  const startLocal = new Date(startEpochSec * 1000);
  const expectedStartTime = `${String(startLocal.getHours()).padStart(2, "0")}:${String(startLocal.getMinutes()).padStart(2, "0")}`;

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
  assert.equal(draft.startTime, expectedStartTime);
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
    image: null
  });
  assert.equal(missing.handled, true);
  assert.equal(missing.complete, false);
  assert.equal(missing.needCommand, true);
  assert.equal(missing.needImage, true);

  const badTemp = consumeNativeEventIfReady("a@s.whatsapp.net", {
    text: "/organisers tempId=\"tmp_wrong\", organisers=\"@pablo @maria\"",
    image: { mimeType: "image/jpeg", dataBase64: "abc" }
  });
  assert.equal(badTemp.wrongTempId, true);

  const complete = consumeNativeEventIfReady("a@s.whatsapp.net", {
    text: `/organisers tempId="${missing.tempId}", organisers="@pablo @maria"`,
    image: { mimeType: "image/jpeg", dataBase64: "abc" }
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
