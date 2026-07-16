import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStagingSeedEvents,
  seedStagingEventsIfEnabled
} from "../src/staging-seed.js";

test("buildStagingSeedEvents generates future-dated events", () => {
  const now = new Date("2026-07-15T10:00:00Z");
  const items = buildStagingSeedEvents({ now, count: 12 });
  assert.equal(items.length, 12);

  const liveEvents = items.filter((item) => item.date === "2026-07-15" && item.startTime === "00:00" && item.endTime === "23:59");
  assert.equal(liveEvents.length >= 1, true);

  for (const item of items.slice(1)) {
    const eventDate = new Date(`${item.date}T${item.startTime}:00Z`);
    assert.equal(eventDate.getTime() > now.getTime(), true);
  }
});

test("seedStagingEventsIfEnabled returns no-op when disabled", () => {
  const result = seedStagingEventsIfEnabled({ enabled: false });
  assert.deepEqual(result, { seeded: 0, enabled: false });
});
