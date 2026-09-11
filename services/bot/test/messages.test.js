import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAckMessage,
  buildNativeEventEnrichmentExpired,
  buildNativeEventMissingFieldsWarning,
  buildNativeEventEnrichmentPrompt,
  buildNativeEventEnrichmentReminder,
  buildRsvpReply,
  buildRsvpsListReply
} from "../src/messages.js";

test("buildAckMessage returns success text", () => {
  const text = buildAckMessage({
    valid: true,
    needsConfirmation: false,
    event: {
      id: "evt_123",
      title: "Dinner",
      googleCalendarPublicAddLink: "https://calendar.google.com/calendar/r/eventedit/abc"
    }
  }, {
    cancelEventLink: "https://wa.me/34600000000?text=%2Fcancel-event%20evt_123",
    rsvpsListLink: "https://wa.me/34600000000?text=%2FRSVPS-EVENT%20evt_123",
    updateEventLink: "https://wa.me/34600000000?text=%2Fupdate-event%20evt_123%20title%3D%22%22",
    groupNames: ["Shoreditch &Soul Villa Events"]
  });
  assert.equal(text.includes("*Your event is live!*"), true);
  assert.equal(text.includes("*When:*"), true);
  assert.equal(text.includes("Published in *Shoreditch &Soul Villa Events*"), true);
  assert.equal(text.includes("*If you want to see the event on your calendar:*"), true);
  assert.equal(text.includes("*If you want to see who joined:*"), true);
  assert.equal(text.includes("*If you want to update this event:*"), true);
  assert.equal(text.includes("*If you want to delete this event:*"), true);
});

test("buildAckMessage shows multi-day date range", () => {
  const text = buildAckMessage({
    valid: true,
    needsConfirmation: false,
    event: {
      id: "evt_321",
      title: "Overnight Jam",
      date: "2026-09-11",
      startTime: "23:00",
      endDate: "2026-09-12",
      endTime: "01:30"
    }
  });
  assert.equal(text.includes("*When:* 2026-09-11 23:00 -> 2026-09-12 01:30"), true);
});

test("buildAckMessage includes missing field details", () => {
  const text = buildAckMessage({
    valid: false,
    errors: [
      "Missing required field: date",
      "Missing required field: startTime",
      "Invalid startTime format, expected HH:mm"
    ]
  });
  assert.equal(text.includes("Missing fields: date, startTime"), true);
  assert.equal(text.includes("Formatting issues:"), true);
  assert.equal(text.includes("/event title="), true);
});

test("buildAckMessage handles empty result", () => {
  const text = buildAckMessage(null);
  assert.equal(text.includes("could not process"), true);
});

test("buildRsvpReply returns RSVP confirmation and cancel link", () => {
  const text = buildRsvpReply(
    {
      action: "rsvp",
      ok: true,
      eventId: "evt_123",
      count: 4,
      message: "RSVP confirmed"
    },
    {
      cancelRsvpLink: "https://wa.me/34600000000?text=%2FCANCEL-RSVP-EVENT%20evt_123"
    }
  );
  assert.equal(text.includes("RSVP confirmed"), true);
  assert.equal(text.includes("RSVP Count: 4"), true);
  assert.equal(text.includes("Cancel RSVP:"), true);
});

test("buildRsvpsListReply renders creator list", () => {
  const text = buildRsvpsListReply({
    ok: true,
    eventId: "evt_123",
    rsvps: [
      { senderJid: "34600111111@s.whatsapp.net", pushName: "Pablo" },
      { senderJid: "34600222222@s.whatsapp.net", pushName: "" }
    ]
  });
  assert.equal(text.includes("RSVP list for evt_123"), true);
  assert.equal(text.includes("1. Pablo"), true);
  assert.equal(text.includes("2. 34600222222@s.whatsapp.net"), true);
});

test("buildNativeEventEnrichmentPrompt explains organisers and image requirements", () => {
  const text = buildNativeEventEnrichmentPrompt({
    tempId: "tmp_ab12cd34",
    title: "Native Event",
    date: "2026-08-10",
    startTime: "19:00",
    endTime: "23:59",
    organisersCommandLink: "https://wa.me/34600000000?text=%2Forganisers%20tempId%3D%22tmp_ab12cd34%22"
  });
  assert.equal(text.includes("To finish creating your event:"), true);
  assert.equal(text.includes("tempId%3D%22tmp_ab12cd34%22"), true);
  assert.equal(text.includes("1) Edit organiser names"), true);
  assert.equal(text.includes("Do not remove tempId or quotes."), true);
  assert.equal(text.includes("Click here to continue:"), true);
  assert.equal(text.includes("https://wa.me/"), true);
});

test("buildNativeEventEnrichmentReminder explains missing fields", () => {
  const text = buildNativeEventEnrichmentReminder({
    needOrganisers: true,
    needImage: true,
    tempId: "tmp_ab12cd34"
  });
  assert.equal(text.includes("Missing:"), true);
  assert.equal(text.includes("organisers=\"@name @name\""), true);
  assert.equal(text.includes("attached image"), true);
});

test("buildNativeEventEnrichmentReminder handles wrong temp id", () => {
  const text = buildNativeEventEnrichmentReminder({
    wrongTempId: true,
    tempId: "tmp_ab12cd34"
  });
  assert.equal(text.includes("tempId does not match"), true);
});

test("buildNativeEventEnrichmentExpired explains timeout", () => {
  const text = buildNativeEventEnrichmentExpired();
  assert.equal(text.includes("expired"), true);
});

test("buildNativeEventMissingFieldsWarning explains required fields", () => {
  const text = buildNativeEventMissingFieldsWarning(["description", "location"]);
  assert.equal(text.includes("Missing required fields: description, location."), true);
  assert.equal(text.includes("No draft was created."), true);
});
