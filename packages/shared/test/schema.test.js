import test from "node:test";
import assert from "node:assert/strict";
import { computeConfidence, validateEventPayload } from "../src/index.js";

test("validateEventPayload detects missing required fields", () => {
  const result = validateEventPayload({ title: "" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length > 0, true);
});

test("validateEventPayload accepts valid payload", () => {
  const result = validateEventPayload({
    title: "Community Dinner",
    description: "Bring a dish",
    startDate: "2026-07-20",
    time: "19:30",
    endDate: "2026-07-20",
    endTime: "21:30",
    organisers: ["pablo"],
    image: {
      mimeType: "image/jpeg",
      dataBase64: "ZmFrZS1pbWFnZQ=="
    }
  });
  assert.equal(result.valid, true);
});

test("computeConfidence increases with optional fields", () => {
  const base = computeConfidence({
    title: "Event",
    description: "Desc",
    startDate: "2026-07-20",
    time: "19:30"
  });
  const boosted = computeConfidence({
    title: "Event",
    description: "Desc",
    startDate: "2026-07-20",
    time: "19:30",
    endDate: "2026-07-20",
    endTime: "21:30",
    organisers: ["pablo"],
    image: "https://example.com/flyer.jpg"
  });
  assert.equal(boosted > base, true);
});
