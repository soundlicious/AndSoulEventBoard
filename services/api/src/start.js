import { seedStagingEventsIfEnabled } from "./staging-seed.js";

const stagingSeedEnabled = String(process.env.STAGING_SEED_EVENTS_ENABLED || "false") === "true";
const stagingSeedResetOnStart = String(process.env.STAGING_SEED_RESET_ON_START || "true") === "true";
const stagingSeedCount = Number(process.env.STAGING_SEED_EVENTS_COUNT || 16);

const seedResult = seedStagingEventsIfEnabled({
  enabled: stagingSeedEnabled,
  reset: stagingSeedResetOnStart,
  count: stagingSeedCount
});

if (seedResult.enabled) {
  process.stdout.write(`API staging seed loaded ${seedResult.seeded} event(s)\n`);
}

await import("./server.js");
