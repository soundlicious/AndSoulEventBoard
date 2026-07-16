import {
  dayLabel,
  formatDateTime,
  getLogicalIndex,
  isNeighbor,
  normalizeEvents,
  organisersForDisplay,
  resolveImageUrl,
  slideDurationMs
} from "./display-model.js";

const config = window.__DISPLAY_CONFIG__ || {};
const API_URL = String(config.apiUrl || "http://localhost:8080");
const MEDIA_BASE_URL = String(config.mediaBaseUrl || API_URL);
const INTERVAL_MS = Number(config.intervalMs || 8000);
const MAX_DAYS_AHEAD = Number(config.maxDaysAhead || 30);
const ENABLE_DEBUG = Boolean(config.enableDebug);

const BUFFER = 6;
const THUMB_WIDTH = 110;
const THUMB_GAP = 24;
const TRANSITION_MS = 800;

const mainSlide = document.getElementById("mainSlide");
const previewTrack = document.getElementById("previewTrack");
const debugPanel = document.getElementById("debugPanel");
const offlineBadge = document.getElementById("offline");

const state = {
  events: [],
  currentIndex: 0,
  connected: true,
  lastRefreshAt: null,
  lastError: null,
  debugVisible: false,
  isTransitioning: false,
  allThumbs: []
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmptyState() {
  mainSlide.innerHTML = `<div class="empty-state">No upcoming events yet</div>`;
  previewTrack.innerHTML = "";
}

function renderMainSlide(item, index, total) {
  const organisers = organisersForDisplay(item.organisers);
  const label = dayLabel(item.date);
  const location = item.location || "CoLiving space";
  const titlePrefix = String(index + 1).padStart(2, "0");
  const imageUrl = resolveImageUrl(item.image, MEDIA_BASE_URL);
  const qrImageUrl = resolveImageUrl(item.googleCalendarQrImage, MEDIA_BASE_URL);

  const imageHtml = imageUrl
    ? [
      `<div class="event-image-frame">`,
      `  <img class="event-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title || "Event image")}" />`,
      qrImageUrl
        ? `  <img class="event-qr" src="${escapeHtml(qrImageUrl)}" alt="Calendar QR code" />`
        : "",
      `</div>`
    ].join("")
    : `<div class="no-image">No image attached</div>`;

  mainSlide.innerHTML = [
    `<div class="event-details">`,
    `  <div class="event-meta">`,
    `    <span class="meta-item">${escapeHtml(label)} • ${escapeHtml(item.time || "--:--")}</span>`,
    `    <span class="meta-separator">•</span>`,
    `    <span class="event-location">${escapeHtml(location)}</span>`,
    `  </div>`,
    `  <h1 class="event-title"><span>${titlePrefix}. ${escapeHtml(item.title || "Untitled Event")}</span>${escapeHtml(formatDateTime(item.date, item.time))}</h1>`,
    `  <p class="event-description">${escapeHtml(item.description || "No description")}</p>`,
    `  <div class="event-meta"><span class="meta-item">RSVP ${Number.isFinite(item.rsvpCount) ? item.rsvpCount : (Array.isArray(item.rsvps) ? item.rsvps.length : 0)}</span></div>`,
    `  <div class="organisers-section">`,
    `    <div class="organisers-title">Hosted by</div>`,
    `    <ul class="organisers-list">${organisers.map((name) => `<li class="organiser-tag">${escapeHtml(name)}</li>`).join("")}</ul>`,
    `  </div>`,
    `</div>`,
    `<div class="event-image-container">${imageHtml}</div>`
  ].join("");

  const slideEl = mainSlide;
  slideEl.classList.remove("active");
  requestAnimationFrame(() => slideEl.classList.add("active"));

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
  const fragment = document.createDocumentFragment();

  for (let i = total - BUFFER; i < total; i += 1) {
    const clone = originals[i].cloneNode(true);
    clone.classList.add("clone");
    fragment.appendChild(clone);
  }

  for (const thumb of originals) {
    fragment.appendChild(thumb);
  }

  for (let i = 0; i < BUFFER; i += 1) {
    const clone = originals[i].cloneNode(true);
    clone.classList.add("clone");
    fragment.appendChild(clone);
  }

  previewTrack.appendChild(fragment);
  state.allThumbs = Array.from(previewTrack.querySelectorAll(".thumbnail"));
}

function updatePreviewPosition({ useTransition = true } = {}) {
  const totalOriginals = state.events.length;
  if (!totalOriginals) {
    return;
  }

  const physicalIndex = state.currentIndex + BUFFER;
  const viewport = previewTrack.parentElement;
  const viewportWidth = viewport ? viewport.offsetWidth : window.innerWidth;
  const spacing = THUMB_WIDTH + THUMB_GAP;
  const centerOffset = viewportWidth / 2 - THUMB_WIDTH / 2;
  const targetX = centerOffset - physicalIndex * spacing;

  for (let i = 0; i < state.allThumbs.length; i += 1) {
    const thumb = state.allThumbs[i];
    const logicalIndex = getLogicalIndex(i, BUFFER, totalOriginals);
    thumb.classList.toggle("active", logicalIndex === state.currentIndex);
    thumb.classList.toggle("neighbor", isNeighbor(logicalIndex, state.currentIndex, totalOriginals));
  }

  previewTrack.style.transition = useTransition
    ? `transform ${TRANSITION_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`
    : "none";
  previewTrack.style.transform = `translateX(${targetX}px)`;
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
    const response = await fetch(`${API_URL}/events`);
    const payload = await response.json();
    state.events = normalizeEvents(payload.items, { maxDaysAhead: MAX_DAYS_AHEAD });
    state.lastRefreshAt = new Date().toISOString();
    state.lastError = null;
    updateConnection(true);

    if (state.currentIndex >= state.events.length) {
      state.currentIndex = 0;
    }

    rebuildPreviewTrack(state.events);

    if (!state.events.length) {
      renderEmptyState();
      return;
    }

    renderMainSlide(state.events[state.currentIndex], state.currentIndex, state.events.length);
    updatePreviewPosition({ useTransition: false });
  } catch {
    state.lastError = "Failed to fetch events";
    updateConnection(false);
    if (!state.events.length) {
      renderEmptyState();
    }
  }
}

function rotateNext() {
  if (!state.events.length || state.isTransitioning) {
    return;
  }

  state.isTransitioning = true;
  state.currentIndex += 1;

  if (state.currentIndex >= state.events.length) {
    updatePreviewPosition({ useTransition: true });
    setTimeout(() => {
      state.currentIndex = 0;
      renderMainSlide(state.events[state.currentIndex], state.currentIndex, state.events.length);
      updatePreviewPosition({ useTransition: false });
      state.isTransitioning = false;
    }, TRANSITION_MS);
    return;
  }

  renderMainSlide(state.events[state.currentIndex], state.currentIndex, state.events.length);
  updatePreviewPosition({ useTransition: true });

  setTimeout(() => {
    state.isTransitioning = false;
  }, TRANSITION_MS);
}

function scheduleRotation() {
  if (!state.events.length) {
    setTimeout(scheduleRotation, INTERVAL_MS);
    return;
  }
  const current = state.events[state.currentIndex];
  const delay = slideDurationMs(current, INTERVAL_MS);
  setTimeout(() => {
    rotateNext();
    scheduleRotation();
  }, delay);
}

function tickClock() {
  const el = document.getElementById("clock");
  if (el) {
    el.textContent = new Date().toLocaleString();
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

function bootstrap() {
  bindUi();
  tickClock();
  setInterval(tickClock, 1000);
  refreshEvents();
  setInterval(refreshEvents, INTERVAL_MS);
  scheduleRotation();
}

bootstrap();
