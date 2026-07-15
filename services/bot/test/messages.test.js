import test from "node:test";
import assert from "node:assert/strict";
import { buildAckMessage } from "../src/messages.js";

test("buildAckMessage returns success text", () => {
  const text = buildAckMessage({
    valid: true,
    needsConfirmation: false,
    event: {
      id: "evt_123",
      title: "Dinner",
      googleCalendarPublicAddLink: "https://calendar.google.com/calendar/r/eventedit/abc"
    }
  });
  assert.equal(text.includes("Event created and published"), true);
  assert.equal(text.includes("evt_123"), true);
  assert.equal(text.includes("Title:"), true);
  assert.equal(text.includes("Calendar:"), true);
});

test("buildAckMessage includes missing field details", () => {
  const text = buildAckMessage({
    valid: false,
    errors: [
      "Missing required field: date",
      "Missing required field: time",
      "Invalid time format, expected HH:mm"
    ]
  });
  assert.equal(text.includes("Missing fields: date, time"), true);
  assert.equal(text.includes("Formatting issues:"), true);
  assert.equal(text.includes("/event title="), true);
});

test("buildAckMessage handles empty result", () => {
  const text = buildAckMessage(null);
  assert.equal(text.includes("could not process"), true);
});
