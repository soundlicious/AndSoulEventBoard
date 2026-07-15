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

  for (const item of items) {
    const eventDate = new Date(`${item.date}T${item.time}:00Z`);
    assert.equal(eventDate.getTime() > now.getTime(), true);
  }
});

test("seedStagingEventsIfEnabled returns no-op when disabled", () => {
  const result = seedStagingEventsIfEnabled({ enabled: false });
  assert.deepEqual(result, { seeded: 0, enabled: false });
});
