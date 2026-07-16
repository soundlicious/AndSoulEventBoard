import { randomUUID } from "node:crypto";
import { createEvent, listEvents, replaceEvents } from "./store.js";

const SAMPLE_IMAGES = [
  "https://picsum.photos/id/10/1200/900",
  "https://picsum.photos/id/29/1200/900",
  "https://picsum.photos/id/43/1200/900",
  "https://picsum.photos/id/82/1200/900",
  "https://picsum.photos/id/128/1200/900",
  "https://picsum.photos/id/160/1200/900",
  "https://picsum.photos/id/191/1200/900",
  "https://picsum.photos/id/212/1200/900"
];

const SAMPLE_TEMPLATES = [
  { title: "Community Breakfast", description: "Fresh coffee, fruits, and shared plans for the day.", startTime: "08:30", endTime: "09:45", location: "Kitchen Hall" },
  { title: "Cowork Sprint", description: "Focused deep-work block with short accountability check-ins.", startTime: "10:00", endTime: "12:00", location: "Workspace" },
  { title: "Lunch Social", description: "Bring your plate and meet new housemates over lunch.", startTime: "13:00", endTime: "14:00", location: "Dining Area" },
  { title: "Yoga Flow", description: "Gentle mobility and breathing session for all levels.", startTime: "18:30", endTime: "19:30", location: "Studio" },
  { title: "Board Game Night", description: "Strategy and party games with snacks.", startTime: "20:00", endTime: "22:30", location: "Lounge" },
  { title: "Film Club", description: "Curated film screening followed by open discussion.", startTime: "21:00", endTime: "23:00", location: "Media Room" }
];

function dateStringFromNow(baseNow, daysAhead) {
  const next = new Date(baseNow);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + daysAhead);
  const yyyy = String(next.getFullYear());
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function buildStagingSeedEvents({ now = new Date(), count = 16 } = {}) {
  const total = Math.max(1, Number.isFinite(count) ? Math.floor(count) : 16);
  const events = [];

  for (let i = 0; i < total; i += 1) {
    const template = SAMPLE_TEMPLATES[i % SAMPLE_TEMPLATES.length];
    const dayOffset = 1 + Math.floor(i / 2);
    const image = SAMPLE_IMAGES[i % SAMPLE_IMAGES.length];

    events.push({
      id: `evt_stage_${randomUUID()}`,
      status: "confirmed",
      publishedGroupJids: [],
      rsvps: [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      title: `${template.title} #${i + 1}`,
      description: template.description,
      date: dateStringFromNow(now, dayOffset),
      startTime: template.startTime,
      endTime: template.endTime,
      organisers: ["staging", "community"],
      image,
      location: template.location,
      source: {
        channel: "staging_seed",
        senderJid: "staging@local",
        messageId: `seed_${i + 1}`,
        rawText: "auto-generated staging event"
      },
      parse: {
        variant: "seed",
        confidence: 1,
        needsConfirmation: false
      }
    });
  }

  if (events.length > 0) {
    const liveDate = dateStringFromNow(now, 0);
    events[0] = {
      ...events[0],
      title: "Live Now - Community Desk",
      description: "Drop by now for onboarding and announcements.",
      date: liveDate,
      startTime: "00:00",
      endTime: "23:59",
      location: "Welcome Lounge"
    };
  }

  return events;
}

export function seedStagingEventsIfEnabled({
  enabled = false,
  reset = true,
  count = 16,
  now = new Date()
} = {}) {
  if (!enabled) {
    return { seeded: 0, enabled: false };
  }

  const generated = buildStagingSeedEvents({ now, count });

  if (reset) {
    replaceEvents(generated);
    return { seeded: generated.length, enabled: true, reset: true };
  }

  const existingIds = new Set(listEvents().map((item) => `${item.title}|${item.date}|${item.startTime}`));
  let seeded = 0;
  for (const item of generated) {
    const key = `${item.title}|${item.date}|${item.startTime}`;
    if (existingIds.has(key)) {
      continue;
    }
    createEvent(item);
    existingIds.add(key);
    seeded += 1;
  }
  return { seeded, enabled: true, reset: false };
}
