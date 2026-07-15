import test from "node:test";
import assert from "node:assert/strict";

import {
  dayLabel,
  formatDateTime,
  getLogicalIndex,
  isNeighbor,
  normalizeEvents,
  organisersForDisplay,
  resolveImageUrl,
  shouldKeepEvent,
  slideDurationMs
} from "../src/display-model.js";

test("formatDateTime handles missing date", () => {
  assert.equal(formatDateTime("", "12:00"), "Unknown date");
  assert.equal(formatDateTime("2026-07-30", "09:30"), "2026-07-30 09:30");
});

test("dayLabel returns expected labels", () => {
  const now = new Date("2026-07-15T08:00:00Z");
  assert.equal(dayLabel("2026-07-15", now), "Today");
  assert.equal(dayLabel("2026-07-16", now), "Tomorrow");
  assert.equal(dayLabel("2026-07-19", now), "In 4 days");
  assert.equal(dayLabel("2026-07-14", now), "Past due");
});

test("shouldKeepEvent enforces max days ahead", () => {
  const now = new Date("2026-07-15T08:00:00Z");
  assert.equal(
    shouldKeepEvent({ date: "2026-07-20", time: "10:00" }, { now, maxDaysAhead: 7 }),
    true
  );
  assert.equal(
    shouldKeepEvent({ date: "2026-08-10", time: "10:00" }, { now, maxDaysAhead: 7 }),
    false
  );
});

test("normalizeEvents keeps only valid range", () => {
  const now = new Date("2026-07-15T08:00:00Z");
  const result = normalizeEvents(
    [
      { id: "a", date: "2026-07-16", time: "10:00" },
      { id: "b", date: "2026-09-16", time: "10:00" },
      { id: "c" }
    ],
    { now, maxDaysAhead: 10 }
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "c"]
  );
});

test("slideDurationMs adapts based on content", () => {
  assert.equal(slideDurationMs({ image: "/media/a.jpg" }, 6000), 10000);
  assert.equal(slideDurationMs({ description: "x".repeat(161) }, 6000), 9000);
  assert.equal(slideDurationMs({ description: "short" }, 6000), 6000);
});

test("resolveImageUrl resolves local media paths", () => {
  assert.equal(resolveImageUrl("/media/a.jpg", "http://localhost:8080"), "http://localhost:8080/media/a.jpg");
  assert.equal(resolveImageUrl("https://example.com/a.jpg", "http://localhost:8080"), "https://example.com/a.jpg");
});

test("organisersForDisplay normalizes handles", () => {
  assert.deepEqual(organisersForDisplay(["pablo", "@maria"]), ["@pablo", "@maria"]);
  assert.deepEqual(organisersForDisplay([]), ["TBD"]);
});

test("preview index helpers support circular behavior", () => {
  assert.equal(getLogicalIndex(0, 6, 20), 14);
  assert.equal(getLogicalIndex(6, 6, 20), 0);
  assert.equal(getLogicalIndex(25, 6, 20), 19);
  assert.equal(isNeighbor(19, 0, 20), true);
  assert.equal(isNeighbor(1, 0, 20), true);
  assert.equal(isNeighbor(3, 0, 20), false);
});
