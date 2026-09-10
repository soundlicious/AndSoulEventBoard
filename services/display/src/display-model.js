export function formatDateTime(date, startTime, endTime, endDate = "") {
  const safeDate = String(date || "").trim();
  const safeEndDate = String(endDate || safeDate).trim();
  if (!safeDate) {
    return "Unknown date";
  }
  if (!startTime && !endTime) {
    return safeDate === safeEndDate ? safeDate : `${safeDate} -> ${safeEndDate}`;
  }
  if (safeDate !== safeEndDate) {
    const startPart = startTime ? `${safeDate} ${startTime}` : safeDate;
    const endPart = endTime ? `${safeEndDate} ${endTime}` : safeEndDate;
    return `${startPart} -> ${endPart}`;
  }
  if (startTime && endTime) {
    return `${safeDate} ${startTime}-${endTime}`;
  }
  if (startTime) {
    return `${safeDate} ${startTime}`;
  }
  return `${safeDate} until ${endTime}`;
}

export function dayLabel(dateValue, now = new Date()) {
  if (!dateValue) {
    return "Unknown";
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);
  const ms = target.getTime() - today.getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  return "Past due";
}

export function shouldKeepEvent(event, { now = new Date(), maxDaysAhead = 30 } = {}) {
  if (!event?.date) {
    return true;
  }
  const limit = new Date(now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);
  const target = new Date(`${event.date}T${event.startTime || "23:59"}:00`);
  return target.getTime() <= limit.getTime();
}

export function isEventLive(event, now = new Date()) {
  if (!event?.date || !event?.startTime) {
    return false;
  }
  const start = new Date(`${event.date}T${event.startTime}:00`);
  const endDate = event.endDate || event.date;
  const end = new Date(`${endDate}T${event.endTime || "23:59"}:00`);
  const nowMs = now.getTime();
  return nowMs >= start.getTime() && nowMs <= end.getTime();
}

export function normalizeEvents(items, { now = new Date(), maxDaysAhead = 30 } = {}) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((item) => shouldKeepEvent(item, { now, maxDaysAhead }));
}

export function slideDurationMs(item, baseIntervalMs) {
  const interval = Number.isFinite(baseIntervalMs) ? baseIntervalMs : 8000;
  if (item?.image) {
    return Math.max(interval, 10000);
  }
  if (String(item?.description || "").length > 160) {
    return Math.max(interval, 9000);
  }
  return interval;
}

export function resolveImageUrl(image, mediaBaseUrl) {
  if (!image) {
    return "";
  }
  if (image.startsWith("/media/")) {
    return `${mediaBaseUrl}${image}`;
  }
  return image;
}

export function organisersForDisplay(organisers) {
  if (!Array.isArray(organisers) || organisers.length === 0) {
    return ["TBD"];
  }
  return organisers.map((name) => `@${String(name).replace(/^@/, "")}`);
}

export function getLogicalIndex(physicalIndex, buffer, totalOriginals) {
  if (physicalIndex < buffer) {
    return totalOriginals - buffer + physicalIndex;
  }
  if (physicalIndex >= buffer + totalOriginals) {
    return physicalIndex - (buffer + totalOriginals);
  }
  return physicalIndex - buffer;
}

export function isNeighbor(logicalIndex, currentIndex, totalOriginals) {
  return (
    Math.abs(logicalIndex - currentIndex) === 1 ||
    (currentIndex === 0 && logicalIndex === totalOriginals - 1) ||
    (currentIndex === totalOriginals - 1 && logicalIndex === 0)
  );
}
