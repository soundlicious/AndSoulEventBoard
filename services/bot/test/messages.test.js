import test from "node:test";
import assert from "node:assert/strict";
import { buildAckMessage, buildRsvpReply, buildRsvpsListReply } from "../src/messages.js";

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
    rsvpsListLink: "https://wa.me/34600000000?text=%2FRSVPS-EVENT%20evt_123"
  });
  assert.equal(text.includes("Event created and published"), true);
  assert.equal(text.includes("evt_123"), true);
  assert.equal(text.includes("Title:"), true);
  assert.equal(text.includes("Calendar:"), true);
  assert.equal(text.includes("Delete Event:"), true);
  assert.equal(text.includes("View RSVPs:"), true);
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
