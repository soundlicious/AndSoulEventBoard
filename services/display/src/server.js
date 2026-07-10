import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const displayPort = Number(process.env.DISPLAY_PORT || 3000);
const apiUrl = process.env.PUBLIC_API_URL || "http://localhost:8080";
const serverApiUrl = process.env.DISPLAY_API_SERVER_URL || "http://api:8080";
const interval = Number(process.env.CAROUSEL_INTERVAL_MS || 8000);
const mediaBaseUrl = process.env.PUBLIC_MEDIA_URL || apiUrl;
const maxDaysAhead = Number(process.env.DISPLAY_MAX_DAYS_AHEAD || 30);
const displayEnableDebug = String(process.env.DISPLAY_ENABLE_DEBUG || "true") === "true";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const proxyMaxBodyBytes = Number(process.env.DISPLAY_PROXY_MAX_BODY_BYTES || 8 * 1024 * 1024);
const proxyMaxMediaBytes = Number(process.env.DISPLAY_PROXY_MAX_MEDIA_BYTES || 5 * 1024 * 1024);
const hereDir = path.dirname(fileURLToPath(import.meta.url));
const adminJs = fs.readFileSync(path.join(hereDir, "admin.js"), "utf8");
const createEventJs = fs.readFileSync(path.join(hereDir, "create-event.js"), "utf8");

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Event Carousel</title>
  <style>
    :root {
      --bg: #08111d;
      --panel: #0f1d31;
      --ink: #e8f0ff;
      --muted: #a6b8d8;
      --accent: #22d3ee;
      --good: #34d399;
      --bad: #fda4af;
    }
    body {
      margin: 0;
      font-family: "Sora", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 32%),
        radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.18), transparent 32%),
        var(--bg);
      overflow: hidden;
      user-select: none;
      cursor: none;
    }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
    .card {
      width: min(1180px, 96vw);
      min-height: min(86vh, 860px);
      background: linear-gradient(160deg, #0b1629, #12243d);
      border: 1px solid #2e4667;
      border-radius: 24px;
      padding: 34px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 24px;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 450ms ease, transform 450ms ease;
    }
    .card.show {
      opacity: 1;
      transform: translateY(0);
    }
    .left {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
    }
    .badgeRow {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #355782;
      padding: 4px 12px;
      font-size: 0.85rem;
      color: #d6e9ff;
      background: rgba(17, 34, 56, 0.6);
    }
    h1 { margin: 0; font-size: clamp(2rem, 4.2vw, 3.6rem); line-height: 1.1; }
    .time { color: var(--accent); font-size: clamp(1.35rem, 2.6vw, 2rem); margin-top: 10px; }
    .desc {
      color: #d3def5;
      font-size: clamp(1.05rem, 1.8vw, 1.5rem);
      line-height: 1.35;
      margin-top: 14px;
      max-width: 50ch;
    }
    .meta { color: var(--muted); font-size: clamp(1rem, 1.4vw, 1.2rem); }
    .statusGood { color: var(--good); }
    .statusBad { color: var(--bad); }
    .right {
      display: grid;
      place-items: center;
      border: 1px solid #2a425f;
      border-radius: 16px;
      background: rgba(10, 20, 35, 0.55);
      overflow: hidden;
      min-height: 320px;
    }
    .image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .noImage {
      color: #7f97be;
      font-size: 1.1rem;
      padding: 20px;
      text-align: center;
    }
    .topBar {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      color: #a8bfdf;
      pointer-events: none;
    }
    .offline {
      border-radius: 999px;
      border: 1px solid #7f1d1d;
      background: rgba(127, 29, 29, 0.28);
      color: #fecaca;
      padding: 4px 10px;
      display: none;
    }
    .offline.show { display: inline-block; }
    .debugPanel {
      position: fixed;
      bottom: 12px;
      right: 12px;
      width: min(520px, calc(100vw - 24px));
      max-height: 42vh;
      overflow: auto;
      border-radius: 12px;
      border: 1px solid #355782;
      background: rgba(8, 17, 29, 0.86);
      color: #d6e9ff;
      padding: 10px 12px;
      font-size: 0.82rem;
      line-height: 1.35;
      display: none;
      cursor: auto;
      user-select: text;
    }
    .debugPanel.show { display: block; }
    .debugTitle { font-weight: 700; margin-bottom: 6px; color: #a5d8ff; }
    .debugLine { margin-bottom: 4px; }
    .empty { color: var(--muted); font-size: 1.2rem; }
    .badge {
      margin-top: 12px;
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #2c4358;
      padding: 4px 10px;
      color: #b8d7ff;
      font-size: 0.8rem;
    }
    @media (max-width: 960px) {
      .card {
        grid-template-columns: 1fr;
        min-height: auto;
        padding: 24px;
      }
      .right {
        min-height: 220px;
      }
    }
  </style>
</head>
<body>
  <div class="topBar">
    <div id="clock">--:--</div>
    <div id="offline" class="offline">Offline: waiting for API</div>
  </div>
  <main class="wrap">
    <section class="card show" id="card">
      <p class="empty">Loading events...</p>
    </section>
  </main>
  <aside id="debugPanel" class="debugPanel"></aside>

  <script>
    const API_URL = ${JSON.stringify(apiUrl)};
    const MEDIA_BASE_URL = ${JSON.stringify(mediaBaseUrl)};
    const INTERVAL = ${Number.isFinite(interval) ? interval : 8000};
    const MAX_DAYS = ${Number.isFinite(maxDaysAhead) ? maxDaysAhead : 30};
    const ENABLE_DEBUG = ${displayEnableDebug ? "true" : "false"};
    let events = [];
    let idx = 0;
    let connected = true;
    let lastRefreshAt = null;
    let lastError = null;
    let debugVisible = false;

    function fmtDate(date, time) {
      if (!date) {
        return "Unknown date";
      }
      return time ? (date + " " + time) : date;
    }

    function dayLabel(dateValue) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateValue + 'T00:00:00');
      const ms = target.getTime() - today.getTime();
      const days = Math.round(ms / (24 * 60 * 60 * 1000));
      if (days === 0) return 'Today';
      if (days === 1) return 'Tomorrow';
      if (days > 1) return 'In ' + days + ' days';
      return 'Past due';
    }

    function shouldKeep(event) {
      if (!event.date) {
        return true;
      }
      const now = new Date();
      const limit = new Date(now.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
      const target = new Date(event.date + 'T' + (event.time || '23:59') + ':00');
      return target.getTime() <= limit.getTime();
    }

    function slideDurationMs(item) {
      if (item.image) {
        return Math.max(INTERVAL, 10000);
      }
      if ((item.description || '').length > 160) {
        return Math.max(INTERVAL, 9000);
      }
      return INTERVAL;
    }

    function updateConnection(isOk) {
      connected = isOk;
      const offline = document.getElementById('offline');
      if (!offline) return;
      offline.classList.toggle('show', !isOk);
      updateDebugPanel();
    }

    function tickClock() {
      const clock = document.getElementById('clock');
      if (!clock) return;
      clock.textContent = new Date().toLocaleString();
    }

    function updateDebugPanel() {
      const panel = document.getElementById('debugPanel');
      if (!panel || !ENABLE_DEBUG) {
        return;
      }
      const current = events.length ? events[(idx - 1 + events.length) % events.length] : null;
      panel.innerHTML = [
        '<div class="debugTitle">Display Debug (press D to toggle)</div>',
        '<div class="debugLine">connected: ' + connected + '</div>',
        '<div class="debugLine">events: ' + events.length + '</div>',
        '<div class="debugLine">slideIndex: ' + idx + '</div>',
        '<div class="debugLine">currentTitle: ' + (current?.title || '-') + '</div>',
        '<div class="debugLine">lastRefreshAt: ' + (lastRefreshAt || '-') + '</div>',
        '<div class="debugLine">lastError: ' + (lastError || '-') + '</div>',
        '<div class="debugLine">apiUrl: ' + API_URL + '</div>',
        '<div class="debugLine">mediaBaseUrl: ' + MEDIA_BASE_URL + '</div>',
        '<div class="debugLine">intervalMs: ' + INTERVAL + '</div>',
        '<div class="debugLine">maxDaysAhead: ' + MAX_DAYS + '</div>'
      ].join('');
      panel.classList.toggle('show', debugVisible);
    }

    function render() {
      const card = document.getElementById("card");
      card.classList.remove('show');
      if (!events.length) {
        card.innerHTML = '<p class="empty">No upcoming events yet</p><span class="badge">Waiting for DM submissions</span>';
        requestAnimationFrame(() => card.classList.add('show'));
        return;
      }
      const item = events[idx % events.length];
      idx += 1;
      const organisers = Array.isArray(item.organisers) && item.organisers.length
        ? item.organisers.map((name) => '@' + name).join(' ')
        : 'TBD';
      const label = dayLabel(item.date);
      const statusClass = label === 'Past due' ? 'statusBad' : 'statusGood';
      const imageUrl = item.image
        ? (item.image.startsWith('/media/') ? (MEDIA_BASE_URL + item.image) : item.image)
        : null;
      const imageHtml = imageUrl
        ? '<img class="image" src="' + imageUrl + '" alt="event" />'
        : '<div class="noImage">No image attached</div>';
      card.innerHTML = [
        '<div class="left">',
        '  <div>',
        '    <div class="badgeRow">',
        '      <span class="pill">Upcoming Event</span>',
        '      <span class="pill ' + statusClass + '">' + label + '</span>',
        '    </div>',
        '    <h1>' + (item.title || 'Untitled Event') + '</h1>',
        '    <div class="time">' + fmtDate(item.date, item.time) + '</div>',
        '    <div class="desc">' + (item.description || 'No description') + '</div>',
        '  </div>',
        '  <div>',
        '    <div class="meta">Organisers: ' + organisers + '</div>',
        '    <span class="badge">Status: ' + (item.status || 'unknown') + '</span>',
        '  </div>',
        '</div>',
        '<div class="right">' + imageHtml + '</div>'
      ].join('');
      requestAnimationFrame(() => card.classList.add('show'));
      updateDebugPanel();
    }

    async function refresh() {
      try {
        const response = await fetch(API_URL + '/events');
        const data = await response.json();
        events = Array.isArray(data.items) ? data.items.filter(shouldKeep) : [];
        lastRefreshAt = new Date().toISOString();
        lastError = null;
        updateConnection(true);
      } catch {
        lastError = 'Failed to fetch events';
        updateConnection(false);
      }
      render();
    }

    function loopSlides() {
      render();
      if (!events.length) {
        setTimeout(loopSlides, INTERVAL);
        return;
      }
      const item = events[(idx - 1 + events.length) % events.length];
      setTimeout(loopSlides, slideDurationMs(item));
    }

    tickClock();
    setInterval(tickClock, 1000);
    if (ENABLE_DEBUG) {
      window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'd') {
          debugVisible = !debugVisible;
          updateDebugPanel();
        }
      });
    }
    refresh();
    setInterval(refresh, INTERVAL);
    setTimeout(loopSlides, Math.max(3000, Math.floor(INTERVAL / 2)));
  </script>
</body>
</html>`;

const adminHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Event Admin</title>
  <style>
    body {
      margin: 0;
      font-family: "Sora", "Segoe UI", sans-serif;
      color: #102132;
      background: #f4f8ff;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { margin: 0 0 12px; }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    input, button {
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid #c8d6ea;
      font: inherit;
    }
    button { cursor: pointer; }
    .danger {
      background: #fee2e2;
      border-color: #fca5a5;
      color: #7f1d1d;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #d7e3f3;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid #e6edf8;
      padding: 8px;
      font-size: 0.92rem;
    }
    code { font-size: 0.8rem; }
    #status {
      margin: 10px 0;
      color: #0f4c81;
      font-size: 0.9rem;
    }
    #status.error { color: #991b1b; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Event Admin</h1>
    <div class="toolbar">
      <input id="token" type="password" placeholder="INTERNAL_API_TOKEN" style="min-width:300px" />
      <button id="save-token">Save token</button>
      <button id="refresh">Refresh</button>
      <button id="select-all">Select all</button>
      <button id="clear-selection">Clear selection</button>
      <button id="delete-selected" class="danger">Delete selected</button>
    </div>
    <div id="status">Loading...</div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th>Title</th>
          <th>Date/Time</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </main>
  <script>
    window.__DISPLAY_CONFIG__ = {
      apiUrl: ${JSON.stringify(apiUrl)}
    };
  </script>
  <script src="/admin.js"></script>
</body>
</html>`;

const createEventHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Create Event</title>
  <style>
    body {
      margin: 0;
      font-family: "Sora", "Segoe UI", sans-serif;
      background: #f4f8ff;
      color: #102132;
    }
    .wrap {
      max-width: 760px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { margin: 0 0 12px; }
    .card {
      background: #fff;
      border: 1px solid #d8e5f7;
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 8px 20px rgba(16, 33, 50, 0.08);
    }
    .row {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
    }
    .grid2 {
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 700px) {
      .grid2 { grid-template-columns: 1fr; }
    }
    label {
      font-size: 0.9rem;
      color: #334155;
    }
    input, textarea, button {
      font: inherit;
      padding: 9px 10px;
      border-radius: 8px;
      border: 1px solid #c8d6ea;
    }
    textarea { min-height: 96px; resize: vertical; }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .primary {
      background: #0f766e;
      border-color: #0f766e;
      color: #fff;
      cursor: pointer;
    }
    #status { margin-top: 10px; color: #0f4c81; }
    #status.error { color: #991b1b; }
    .help { color: #52667d; font-size: 0.9rem; margin-bottom: 10px; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Create Event</h1>
    <p class="help">Use this form if you prefer not to use WhatsApp. Required fields: title, description, date, time.</p>
    <div class="toolbar">
      <input id="token" type="password" placeholder="INTERNAL_API_TOKEN" style="min-width:280px" />
      <button id="save-token">Save token</button>
      <a href="/admin">Go to admin</a>
    </div>
    <form id="event-form" class="card">
      <div class="row">
        <label for="title">Title *</label>
        <input id="title" name="title" required />
      </div>
      <div class="row">
        <label for="description">Description *</label>
        <textarea id="description" name="description" required></textarea>
      </div>
      <div class="grid2">
        <div class="row">
          <label for="date">Date *</label>
          <input id="date" name="date" type="date" required />
        </div>
        <div class="row">
          <label for="time">Time *</label>
          <input id="time" name="time" type="time" required />
        </div>
      </div>
      <div class="row">
        <label for="organisers">Organisers (optional, space-separated)</label>
        <input id="organisers" name="organisers" placeholder="@pablo @maria" />
      </div>
      <div class="row">
        <label for="image">Image (optional)</label>
        <input id="image" name="image" type="file" accept="image/*" />
      </div>
      <button class="primary" type="submit">Create Event</button>
      <div id="status">Ready</div>
    </form>
  </main>
  <script>
    window.__DISPLAY_CONFIG__ = {
      apiUrl: ${JSON.stringify(apiUrl)},
      maxImageBytes: ${Number.isFinite(proxyMaxMediaBytes) ? proxyMaxMediaBytes : 5 * 1024 * 1024}
    };
  </script>
  <script src="/create-event.js"></script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "display" }));
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && req.url === "/admin") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(adminHtml);
    return;
  }

  if (req.method === "GET" && req.url === "/create-event") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(createEventHtml);
    return;
  }

  if (req.method === "GET" && req.url === "/admin.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(adminJs);
    return;
  }

  if (req.method === "GET" && req.url === "/create-event.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(createEventJs);
    return;
  }

  if (req.method === "POST" && req.url === "/api/events") {
    readRequestBody(req)
      .then(async (body) => {
        const bodyBytes = Buffer.byteLength(body || "");
        if (bodyBytes > proxyMaxBodyBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({
            error: `Request body too large. Max ${proxyMaxBodyBytes} bytes.`
          }));
          return;
        }

        try {
          const parsed = JSON.parse(body || "{}");
          const base64 = parsed?.image?.dataBase64;
          if (typeof base64 === "string") {
            const estimatedBytes = Math.floor((base64.length * 3) / 4);
            if (estimatedBytes > proxyMaxMediaBytes) {
              res.writeHead(413, { "content-type": "application/json" });
              res.end(JSON.stringify({
                error: `Image too large. Max ${proxyMaxMediaBytes} bytes.`
              }));
              return;
            }
          }
        } catch {
          // Keep proxy behavior; API will validate JSON format.
        }

        const headers = {
          "content-type": "application/json"
        };
        if (internalApiToken) {
          headers["x-internal-token"] = internalApiToken;
        }

        const upstream = await fetch(`${serverApiUrl}/events`, {
          method: "POST",
          headers,
          body
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json"
        });
        res.end(text);
      })
      .catch((error) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message || "Proxy error" }));
      });
    return;
  }

  if (req.method === "GET" && req.url === "/debug") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "display",
      now: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      config: {
        displayPort,
        apiUrl,
        serverApiUrl,
        mediaBaseUrl,
        interval,
        maxDaysAhead,
        displayEnableDebug
      }
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(displayPort, () => {
  process.stdout.write(`Display listening on ${displayPort}\n`);
});
