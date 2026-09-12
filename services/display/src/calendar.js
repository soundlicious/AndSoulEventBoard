import {
  attendance, calendarLayout, dayKey, fetchBookingSessions, remainingToday,
  sessionDuration, sessionPrice, sessionTime
} from "./calendar-model.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function imageUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function cardHtml(session, timezone) {
  const seats = attendance(session);
  const image = imageUrl(session.image);
  const avatar = imageUrl(session.teacherPicture);
  const details = [session.teacher, session.location].filter(Boolean).join(" · ");
  const price = sessionPrice(session);
  const duration = sessionDuration(session.durationMinutes);
  const waitlist = session.waitlistFull ? "Waitlist full"
    : session.waitlistCapacity != null ? `Waitlist ${session.waitlistCapacity}` : session.allowWaitlist ? "Waitlist available" : "";
  return `<article class="calendar-card${session.isCancelled ? " is-cancelled" : ""}" data-session-id="${escapeHtml(session.id)}">
    <div class="calendar-image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(session.sessionName || "Session")}" decoding="async" />` : '<span class="calendar-image-placeholder" aria-label="No session image">&amp;soul</span>'}</div>
    <div class="calendar-card-body">
      <div class="calendar-when"><span>${escapeHtml(sessionTime(session, timezone))}</span>${session.isCancelled ? '<strong class="calendar-cancelled">Cancelled</strong>' : ""}</div>
      <h2 class="calendar-title">${escapeHtml(session.sessionName || "Untitled session")}</h2>
      <div class="calendar-teacher">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : ""}<span>${escapeHtml(details)}</span></div>
      <div class="calendar-extra">${[session.type, price, duration].filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
      <div class="calendar-attendance"><span>${escapeHtml(seats.label)}</span><div class="calendar-capacity-bar" aria-hidden="true"><i style="width:${seats.percentage}%"></i></div></div>
      <div class="calendar-footer">${seats.spots != null ? `<span>${seats.spots} spots left</span>` : ""}<span>${escapeHtml(waitlist)}</span></div>
    </div>
  </article>`;
}

export function createCalendar({ element, timezone = "Europe/London", refreshMs = 60000 }) {
  let sessions = [];
  let loaded = false;
  let failed = false;
  let refreshing = false;
  let lastUpdated = null;
  let lastDay = dayKey(new Date(), timezone);
  let signature = "";
  let frame = null;
  const grid = element.querySelector(".calendar-grid");
  const status = element.querySelector(".calendar-status");
  const date = element.querySelector(".calendar-date");
  const count = element.querySelector(".calendar-count");

  function fit() {
    if (element.hidden || !grid.children.length || grid.querySelector(".calendar-empty")) return;
    const { width, height } = grid.getBoundingClientRect();
    if (!width || !height) return;
    const layout = calendarLayout(grid.children.length, width, height);
    grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    grid.style.gap = `${layout.gap}px`;
    grid.dataset.layout = layout.mode;
    grid.style.setProperty("--calendar-scale", layout.scale);
    const cards = [...grid.children];
    // Hide secondary information before reducing the four essential fields.
    let density = layout.scale < 0.65 ? 2 : layout.mode === "compact" || layout.scale < 0.9 ? 1 : 0;
    grid.dataset.density = density;
    const bodies = cards.map((card) => card.querySelector(".calendar-card-body"));
    while (density < 2 && bodies.some((body) => body.scrollHeight > body.clientHeight + 1)) {
      grid.dataset.density = ++density;
    }
    for (const card of cards) {
      const title = card.querySelector(".calendar-title");
      title.style.fontSize = "";
      let size = parseFloat(getComputedStyle(title).fontSize);
      // Long names remain complete; no ellipsis, clipping or hidden sessions.
      while ((title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1) && size > 3) {
        size *= 0.94;
        title.style.fontSize = `${size}px`;
      }
    }
  }

  function scheduleFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  }

  function render() {
    const now = new Date();
    const items = remainingToday(sessions, now, timezone);
    date.textContent = now.toLocaleDateString("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" });
    count.textContent = `${items.length} ${items.length === 1 ? "session" : "sessions"} remaining`;
    status.textContent = failed
      ? loaded ? "Connection interrupted · showing last update" : "Schedule unavailable · retrying automatically"
      : !loaded ? "Loading today's sessions…"
        : `Updated ${lastUpdated.toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" })}`;
    status.classList.toggle("is-stale", failed);
    const nextSignature = JSON.stringify([items, loaded, failed && !loaded]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      grid.style.gridTemplateColumns = "";
      grid.style.gridTemplateRows = "";
      grid.innerHTML = items.length ? items.map((session) => cardHtml(session, timezone)).join("")
        : `<div class="calendar-empty"><span class="calendar-empty-mark">&amp;soul</span><h2>${!loaded ? failed ? "We'll be back shortly" : "Getting today ready" : "That's everything for today"}</h2><p>${!loaded ? failed ? "The schedule will return when the connection is restored." : "Loading the day's remaining sessions…" : "There are no more sessions starting today."}</p></div>`;
      grid.querySelectorAll("img").forEach((img) => {
        img.addEventListener("error", () => {
          img.hidden = true;
          if (img.parentElement.classList.contains("calendar-image")) {
            img.parentElement.insertAdjacentHTML("beforeend", '<span class="calendar-image-placeholder">&amp;soul</span>');
          }
        }, { once: true });
      });
      scheduleFit();
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      sessions = await fetchBookingSessions({ timezone });
      loaded = true;
      failed = false;
      lastUpdated = new Date();
    } catch {
      failed = true;
    } finally {
      refreshing = false;
      render();
    }
  }

  function show() {
    element.hidden = false;
    render();
    scheduleFit();
  }

  const observer = new ResizeObserver(scheduleFit);
  observer.observe(grid);
  document.fonts?.ready.then(scheduleFit);
  render();
  refresh();
  setInterval(refresh, Math.max(1000, refreshMs));
  // Expire sessions even during an outage, and roll over at local midnight.
  setInterval(() => {
    const today = dayKey(new Date(), timezone);
    if (today !== lastDay) {
      lastDay = today;
      refresh();
    }
    render();
  }, 1000);

  return { show, hide: () => { element.hidden = true; }, fit: scheduleFit };
}
