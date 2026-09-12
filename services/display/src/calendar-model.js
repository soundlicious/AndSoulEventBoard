// Keep the schedule request contract aligned with andsoul-headcount/app/page.tsx.
export const SESSION_TYPES = ["course-class", "fitness", "retreat", "special-event", "special-event-new"];
export const BOOKING_PAGE_SIZE = 250;
export const INITIAL_RANGE_DAYS = 14;

export function dayKey(value, timezone = "Europe/London") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function startOfDay(now, timezone = "Europe/London") {
  const target = Date.parse(`${dayKey(now, timezone)}T00:00:00Z`);
  let candidate = target;
  // Resolve local midnight without depending on the kiosk computer's timezone.
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const part = (type) => parts.find((item) => item.type === type).value;
    const wallTime = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
    candidate += target - wallTime;
  }
  return new Date(candidate);
}

export function buildSessionsPath(page, now = new Date(), timezone = "Europe/London") {
  const params = new URLSearchParams();
  SESSION_TYPES.forEach((type) => params.append("sessionTypes[]", type));
  params.set("hostId", "47026");
  params.set("fromDate", startOfDay(now, timezone).toISOString());
  params.set("pageSize", String(BOOKING_PAGE_SIZE));
  params.set("page", String(page));
  return `/api/sessions?${params}`;
}

export async function fetchBookingSessions({ fetchImpl = fetch, now = new Date(), timezone = "Europe/London" } = {}) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + INITIAL_RANGE_DAYS);
  const collected = [];
  // Same initial range, page size, four-page cap and stopping rules as Sessions.
  for (let page = 0; page < 4; page += 1) {
    const response = await fetchImpl(buildSessionsPath(page, now, timezone), {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.payload)) throw new Error("Invalid sessions response");
    const payload = data.payload;
    collected.push(...payload);
    if (payload.some((session) => new Date(session.startsAt) > cutoff)) break;
    if (payload.length < BOOKING_PAGE_SIZE) break;
  }
  return collected.filter((session) => {
    const start = new Date(session.startsAt);
    return start >= now && start <= cutoff;
  }).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function remainingToday(sessions, now = new Date(), timezone = "Europe/London") {
  const today = dayKey(now, timezone);
  return sessions.filter((session) => new Date(session.startsAt) >= now && dayKey(session.startsAt, timezone) === today)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function sessionTime(session, timezone = "Europe/London") {
  const time = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
  };
  return [time(session.startsAt), time(session.endsAt)].filter(Boolean).join(" – ");
}

export function sessionPrice(session) {
  if (session.freeEvent) return "Free";
  const money = (value) => new Intl.NumberFormat("en-GB", {
    style: "currency", currency: (session.currency || "gbp").toUpperCase(), maximumFractionDigits: 0
  }).format(value);
  try {
    if (session.ticketPriceType === "fixed-price" && session.fixedTicketPrice != null) return money(session.fixedTicketPrice);
    if (session.ticketPriceType === "dynamic" && session.dynamicTicketPriceMin != null) return `${money(session.dynamicTicketPriceMin)}+`;
  } catch { /* Unknown currencies do not prevent the schedule from rendering. */ }
  return session.priceInEventCredits ? `${session.priceInEventCredits} credits` : "";
}

export function sessionDuration(minutes) {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${minutes} min`;
}

export function attendance(session) {
  const known = session.capacity > 0 && session.ticketsSold != null;
  return {
    label: known ? `${session.ticketsSold}/${session.capacity} attending` : "Attendance unavailable",
    percentage: known ? Math.max(0, Math.min(100, session.ticketsSold / session.capacity * 100)) : 0,
    spots: known ? Math.max(0, session.capacity - session.ticketsSold) : null
  };
}

export function calendarLayout(count, width, height) {
  // Evaluate both portrait cards and compact landscape cards, keeping all
  // sessions in one viewport. Scale the cards' typography with their geometry.
  let best = null;
  let bestPortrait = null;
  for (const mode of ["portrait", "compact"]) {
    for (let columns = 1; columns <= Math.max(1, count); columns += 1) {
      const rows = Math.ceil(Math.max(1, count) / columns);
      const gap = Math.max(3, Math.min(18, width / (columns * 30), height / (rows * 30)));
      const cardWidth = (width - gap * (columns - 1)) / columns;
      const cardHeight = (height - gap * (rows - 1)) / rows;
      const scale = Math.min(cardWidth / (mode === "portrait" ? 300 : 440), cardHeight / (mode === "portrait" ? 440 : 175), 1.6);
      const occupancy = Math.max(1, count) / (columns * rows);
      const score = scale * (mode === "portrait" ? 1.12 : 1) * Math.pow(occupancy, 0.25);
      if (!best || score > best.score) best = { columns, rows, gap, scale, score, mode };
      if (mode === "portrait" && (!bestPortrait || score > bestPortrait.score)) bestPortrait = { columns, rows, gap, scale, score, mode };
    }
  }
  // When complete session cards are comfortably readable, keep their extra
  // details. Switch to landscape cards only when density calls for it.
  return bestPortrait.scale >= 0.9 ? bestPortrait : best;
}
