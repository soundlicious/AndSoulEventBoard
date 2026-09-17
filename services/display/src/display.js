import {
  dayLabel,
  formatDateTime,
  getLogicalIndex,
  isEventLive,
  isNeighbor,
  normalizeEvents,
  organisersForDisplay,
  resolveImageUrl,
  slideDurationMs
} from "./display-model.js";
import { createCalendar } from "./calendar.js";
import { advanceRotation, reconcileRotation } from "./rotation-model.js";
import { createUpdateCheck } from "./update-check.js";

const config = window.__DISPLAY_CONFIG__ || {};
const API_URL = String(config.apiUrl || "http://localhost:8080");
const MEDIA_BASE_URL = String(config.mediaBaseUrl || API_URL);
const DISPLAY_TIMEZONE = String(config.timezone || "Europe/London");
const INTERVAL_MS = Number(config.intervalMs || 8000);
const MAX_DAYS_AHEAD = Number(config.maxDaysAhead || 30);
const ENABLE_DEBUG = Boolean(config.enableDebug);
const CALENDAR_INTERVAL_MS = Math.max(1000, Number(config.calendarIntervalMs || 12000));
const CALENDAR_ONLY = Boolean(config.calendarOnly);

const BUFFER = 6;
const MIN_LOOP_EVENTS = BUFFER * 2 + 1;
const THUMB_WIDTH = 110;
const THUMB_GAP = 24;
const TRANSITION_MS = 800;

const mainSlide = document.getElementById("mainSlide");
const previewTrack = document.getElementById("previewTrack");
const debugPanel = document.getElementById("debugPanel");
const offlineBadge = document.getElementById("offline");
const kioskShell = document.querySelector(".kiosk-shell");
const calendar = createCalendar({
  element: document.getElementById("calendar"),
  timezone: DISPLAY_TIMEZONE,
  refreshMs: Number(config.calendarRefreshMs || 60000)
});

const state = {
  events: [],
  currentIndex: 0,
  slideKind: "event",
  eventsSinceCalendar: 0,
  connected: true,
  lastRefreshAt: null,
  lastError: null,
  debugVisible: false,
  isTransitioning: false,
  allThumbs: [],
  previewBuffer: BUFFER,
  previewLoopEnabled: true,
  lastRenderedEventId: "",
  lastRenderedSignature: "",
  previewSignature: ""
};

function eventId(item) {
  if (!item) {
    return "";
  }
  return String(item.id || `${item.title || ""}|${item.date || ""}|${item.startTime || ""}`);
}

function rsvpCount(item) {
  if (Number.isFinite(item?.rsvpCount)) {
    return item.rsvpCount;
  }
  if (Array.isArray(item?.rsvps)) {
    return item.rsvps.length;
  }
  return 0;
}

function slideSignature(item, index) {
  if (!item) {
    return "";
  }
  return [
    eventId(item),
    String(index),
    String(item.title || ""),
    String(item.description || ""),
    String(item.date || ""),
    String(item.startTime || ""),
    String(item.endTime || ""),
    String(item.location || ""),
    String(item.image || ""),
    String(item.googleCalendarQrImage || ""),
    String(rsvpCount(item)),
    String(isEventLive(item))
  ].join("|");
}

function previewTrackSignature(items) {
  return items.map((item) => `${eventId(item)}:${item.image || ""}`).join(",");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmptyState() {
  showCalendar();
}

function showCalendar() {
  state.slideKind = "calendar";
  state.eventsSinceCalendar = 0;
  kioskShell.classList.add("is-calendar");
  calendar.show();
  updateDebugPanel();
}

function renderMainSlide(item, index, total, { animate = true } = {}) {
  state.slideKind = "event";
  kioskShell.classList.remove("is-calendar");
  calendar.hide();
  const organisers = organisersForDisplay(item.organisers);
  const isLive = isEventLive(item);
  const label = isLive ? "Live" : dayLabel(item.date);
  const location = item.location || "CoLiving space";
  const titlePrefix = String(index + 1).padStart(2, "0");
  const imageUrl = resolveImageUrl(item.image, MEDIA_BASE_URL);
  const qrImageUrl = resolveImageUrl(item.googleCalendarQrImage, MEDIA_BASE_URL);

  const imageHtml = imageUrl
    ? [
      `<div class="event-image-frame">`,
      `  <img class="event-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title || "Event image")}" />`,
      isLive ? `  <span class="live-tag">LIVE</span>` : "",
      qrImageUrl
        ? `  <img class="event-qr" src="${escapeHtml(qrImageUrl)}" alt="Calendar QR code" />`
        : "",
      `</div>`
    ].join("")
    : `<div class="no-image">No image attached</div>`;

  mainSlide.innerHTML = [
    `<div class="event-details">`,
    `  <div class="event-meta">`,
    `    <span class="meta-item">${escapeHtml(label)} • ${escapeHtml(item.startTime || "--:--")}</span>`,
    `    <span class="meta-separator">•</span>`,
    `    <span class="event-location">${escapeHtml(location)}</span>`,
    `  </div>`,
    `  <h1 class="event-title"><span>${titlePrefix}. ${escapeHtml(item.title || "Untitled Event")}</span>${escapeHtml(formatDateTime(item.date, item.startTime, item.endTime, item.endDate))}</h1>`,
    `  <p class="event-description">${escapeHtml(item.description || "No description")}</p>`,
    `  <div class="event-meta"><span class="meta-item">RSVP ${rsvpCount(item)}</span></div>`,
    `  <div class="organisers-section">`,
    `    <div class="organisers-title">Hosted by</div>`,
    `    <ul class="organisers-list">${organisers.map((name) => `<li class="organiser-tag">${escapeHtml(name)}</li>`).join("")}</ul>`,
    `  </div>`,
    `</div>`,
    `<div class="event-image-container">${imageHtml}</div>`
  ].join("");

  const slideEl = mainSlide;
  if (animate) {
    slideEl.classList.remove("active");
    requestAnimationFrame(() => slideEl.classList.add("active"));
  } else {
    slideEl.classList.add("active");
  }

  state.lastRenderedEventId = String(item.id || "");
  state.lastRenderedSignature = slideSignature(item, index);

  updateDebugPanel({ currentTitle: item.title || "-", total });
}

function buildThumbElement(item) {
  const thumb = document.createElement("div");
  thumb.className = "thumbnail";
  const imageUrl = resolveImageUrl(item.image, MEDIA_BASE_URL);
  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = item.title || "Event preview";
    thumb.appendChild(img);
  }
  return thumb;
}

function rebuildPreviewTrack(items) {
  previewTrack.innerHTML = "";
  if (!items.length) {
    state.allThumbs = [];
    return;
  }

  const originals = items.map((item) => buildThumbElement(item));
  const total = originals.length;
  const loopEnabled = total >= MIN_LOOP_EVENTS;
  const loopBuffer = loopEnabled ? Math.min(BUFFER, total) : 0;
  state.previewBuffer = loopBuffer;
  state.previewLoopEnabled = loopEnabled;
  const fragment = document.createDocumentFragment();

  if (loopEnabled) {
    for (let i = total - loopBuffer; i < total; i += 1) {
      const clone = originals[i].cloneNode(true);
      clone.classList.add("clone");
      fragment.appendChild(clone);
    }
  }

  for (const thumb of originals) {
    fragment.appendChild(thumb);
  }

  if (loopEnabled) {
    for (let i = 0; i < loopBuffer; i += 1) {
      const clone = originals[i].cloneNode(true);
      clone.classList.add("clone");
      fragment.appendChild(clone);
    }
  }

  previewTrack.appendChild(fragment);
  state.allThumbs = Array.from(previewTrack.querySelectorAll(".thumbnail"));
  previewTrack.classList.toggle("no-loop", !loopEnabled);
}

function updatePreviewPosition({ useTransition = true } = {}) {
  const totalOriginals = state.events.length;
  if (!totalOriginals) {
    return;
  }

  const loopBuffer = Math.min(state.previewBuffer, totalOriginals);
  const physicalIndex = state.currentIndex + loopBuffer;
  const viewport = previewTrack.parentElement;
  const viewportWidth = viewport ? viewport.offsetWidth : window.innerWidth;
  const spacing = THUMB_WIDTH + THUMB_GAP;
  const centerOffset = viewportWidth / 2 - THUMB_WIDTH / 2;
  const targetX = centerOffset - physicalIndex * spacing;

  for (let i = 0; i < state.allThumbs.length; i += 1) {
    const thumb = state.allThumbs[i];
    const logicalIndex = getLogicalIndex(i, loopBuffer, totalOriginals);
    thumb.classList.toggle("active", logicalIndex === state.currentIndex);
    thumb.classList.toggle("neighbor", isNeighbor(logicalIndex, state.currentIndex, totalOriginals));
  }

  previewTrack.style.transition = useTransition
    ? `transform ${TRANSITION_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`
    : "none";
  previewTrack.style.transform = `translate(${targetX}px, -50%)`;
}

function updateConnection(isConnected) {
  state.connected = isConnected;
  offlineBadge.classList.toggle("show", !isConnected);
  updateDebugPanel();
}

function updateDebugPanel(extra = {}) {
  if (!ENABLE_DEBUG) {
    return;
  }

  const current = state.events[state.currentIndex] || null;
  debugPanel.innerHTML = [
    `<div class="debug-title">Display Debug (press D to toggle)</div>`,
    `<div class="debug-line">connected: ${state.connected}</div>`,
    `<div class="debug-line">events: ${state.events.length}</div>`,
    `<div class="debug-line">slideIndex: ${state.currentIndex}</div>`,
    `<div class="debug-line">screen: ${state.slideKind}</div>`,
    `<div class="debug-line">currentTitle: ${escapeHtml(extra.currentTitle || current?.title || "-")}</div>`,
    `<div class="debug-line">lastRefreshAt: ${escapeHtml(state.lastRefreshAt || "-")}</div>`,
    `<div class="debug-line">lastError: ${escapeHtml(state.lastError || "-")}</div>`,
    `<div class="debug-line">apiUrl: ${escapeHtml(API_URL)}</div>`,
    `<div class="debug-line">mediaBaseUrl: ${escapeHtml(MEDIA_BASE_URL)}</div>`,
    `<div class="debug-line">intervalMs: ${INTERVAL_MS}</div>`,
    `<div class="debug-line">maxDaysAhead: ${MAX_DAYS_AHEAD}</div>`
  ].join("");
  debugPanel.classList.toggle("show", state.debugVisible);
}

async function refreshEvents() {
  try {
    const response = await fetch(`${API_URL}/events`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.items)) throw new Error("Invalid events response");
    const nextEvents = normalizeEvents(payload.items, { maxDaysAhead: MAX_DAYS_AHEAD });
    const cursor = reconcileRotation({ kind: state.slideKind, index: state.currentIndex }, state.events, nextEvents);
    state.events = nextEvents;
    state.currentIndex = cursor.index;
    state.slideKind = cursor.kind;
    state.lastRefreshAt = new Date().toISOString();
    state.lastError = null;
    updateConnection(true);

    const nextPreviewSignature = previewTrackSignature(state.events);
    if (state.previewSignature !== nextPreviewSignature) {
      rebuildPreviewTrack(state.events);
      state.previewSignature = nextPreviewSignature;
    }

    if (state.slideKind === "calendar") {
      showCalendar();
      return;
    }

    const current = state.events[state.currentIndex];
    const currentId = eventId(current);
    const shouldAnimate = state.lastRenderedEventId !== currentId;
    const needsRender = state.lastRenderedSignature !== slideSignature(current, state.currentIndex);
    if (needsRender) {
      renderMainSlide(current, state.currentIndex, state.events.length, { animate: shouldAnimate });
    }
    if (!state.isTransitioning) {
      updatePreviewPosition({ useTransition: false });
    }
  } catch {
    state.lastError = "Failed to fetch events";
    updateConnection(false);
    if (!state.events.length) {
      renderEmptyState();
    }
  }
}

function rotateNext() {
  if (state.slideKind === "event") state.eventsSinceCalendar += 1;
  const cursor = advanceRotation({ kind: state.slideKind, index: state.currentIndex }, state.events, {
    every: config.calendarEveryEvents,
    eventsShown: state.eventsSinceCalendar
  });
  state.slideKind = cursor.kind;
  state.currentIndex = cursor.index;
  if (state.slideKind === "calendar") {
    showCalendar();
    return;
  }
  renderMainSlide(state.events[state.currentIndex], state.currentIndex, state.events.length);
  updatePreviewPosition({ useTransition: false });
}

function scheduleRotation() {
  const current = state.events[state.currentIndex];
  const delay = state.slideKind === "calendar" || !current
    ? CALENDAR_INTERVAL_MS : slideDurationMs(current, INTERVAL_MS);
  setTimeout(() => {
    rotateNext();
    scheduleRotation();
  }, delay);
}

function tickClock() {
  const el = document.getElementById("clock");
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleString("en-GB", {
      timeZone: DISPLAY_TIMEZONE,
      hour12: false
    });
  }
}

function bindUi() {
  window.addEventListener("resize", () => {
    updatePreviewPosition({ useTransition: false });
  });

  if (ENABLE_DEBUG) {
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "d") {
        state.debugVisible = !state.debugVisible;
        updateDebugPanel();
      }
    });
  }
}

async function bootstrap() {
  setInterval(createUpdateCheck({ version: config.buildId }), 30000);
  bindUi();
  tickClock();
  setInterval(tickClock, 1000);
  if (CALENDAR_ONLY) {
    showCalendar();
    return;
  }
  await refreshEvents();
  setInterval(refreshEvents, INTERVAL_MS);
  scheduleRotation();
}

bootstrap();
