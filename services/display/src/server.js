import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDisplayHtml } from "./display-page.js";
import { proxySessions } from "./momence.js";

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
const displayTimezone = process.env.DISPLAY_TIMEZONE || process.env.TZ || "Europe/London";
const calendarInterval = Number(process.env.CALENDAR_INTERVAL_MS || 12000);
const calendarRefresh = Number(process.env.CALENDAR_REFRESH_MS || 60000);
const calendarEveryEvents = Number(process.env.DISPLAY_CALENDAR_EVERY_X_EVENTS || 1);
const buildId = process.env.DISPLAY_BUILD_ID || "";
const deploymentStateFile = process.env.DEPLOYMENT_STATE_FILE || "";
const hereDir = path.dirname(fileURLToPath(import.meta.url));
const adminJs = fs.readFileSync(path.join(hereDir, "admin.js"), "utf8");
const createEventJs = fs.readFileSync(path.join(hereDir, "create-event.js"), "utf8");
const displayJs = fs.readFileSync(path.join(hereDir, "display.js"), "utf8");
const displayModelJs = fs.readFileSync(path.join(hereDir, "display-model.js"), "utf8");
const displayCss = fs.readFileSync(path.join(hereDir, "display.css"), "utf8");
const calendarAssets = new Map(["calendar.js", "calendar-model.js", "rotation-model.js", "calendar.css", "update-check.js"].map((file) => [
  `/${file}`, fs.readFileSync(path.join(hereDir, file), "utf8")
]));

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

const displayOptions = {
  apiUrl,
  mediaBaseUrl,
  interval,
  maxDaysAhead,
  enableDebug: displayEnableDebug,
  timezone: displayTimezone,
  calendarInterval,
  calendarRefresh,
  calendarEveryEvents,
  buildId
};
const html = buildDisplayHtml(displayOptions);
const calendarHtml = buildDisplayHtml({ ...displayOptions, calendarOnly: true });

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
    .secondary {
      background: #e0f2fe;
      border-color: #7dd3fc;
      color: #075985;
    }
    .editor {
      margin: 14px 0;
      padding: 12px;
      border: 1px solid #d7e3f3;
      background: #fff;
      border-radius: 10px;
      display: grid;
      gap: 10px;
    }
    .editor-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    @media (max-width: 900px) {
      .editor-grid { grid-template-columns: 1fr; }
    }
    .editor .row {
      display: grid;
      gap: 6px;
    }
    .editor-actions {
      display: flex;
      gap: 8px;
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
      <button id="refresh">Refresh</button>
      <button id="select-all">Select all</button>
      <button id="clear-selection">Clear selection</button>
      <button id="delete-selected" class="danger">Delete selected</button>
    </div>
    <div id="status">Loading...</div>
    <section id="editor" class="editor" hidden>
      <strong>Editing event: <code id="edit-id"></code></strong>
      <div class="editor-grid">
        <div class="row">
          <label for="edit-title">Title</label>
          <input id="edit-title" />
        </div>
        <div class="row">
          <label for="edit-date">Start Date</label>
          <input id="edit-date" type="date" />
        </div>
        <div class="row">
          <label for="edit-startTime">Start Time</label>
          <input id="edit-startTime" type="time" />
        </div>
        <div class="row">
          <label for="edit-endDate">End Date</label>
          <input id="edit-endDate" type="date" />
        </div>
        <div class="row">
          <label for="edit-endTime">End Time</label>
          <input id="edit-endTime" type="time" />
        </div>
        <div class="row">
          <label for="edit-organisers">Organisers</label>
          <input id="edit-organisers" placeholder="@pablo @maria" />
        </div>
      </div>
      <div class="row">
        <label for="edit-description">Description</label>
        <textarea id="edit-description" rows="4"></textarea>
      </div>
      <div class="editor-actions">
        <button id="save-edit" class="secondary">Save changes</button>
        <button id="cancel-edit">Cancel</button>
      </div>
    </section>
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
    <p class="help">Use this form if you prefer not to use WhatsApp. Required fields: title, description, date, startTime. Use endDate/endTime for multi-day events.</p>
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
          <label for="startTime">Start Time *</label>
          <input id="startTime" name="startTime" type="time" required />
        </div>
        <div class="row">
          <label for="endTime">End Time (optional)</label>
          <input id="endTime" name="endTime" type="time" />
        </div>
        <div class="row">
          <label for="endDate">End Date (optional)</label>
          <input id="endDate" name="endDate" type="date" />
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
  // Kiosk reloads must fetch a coherent, current set of HTML and modules.
  res.setHeader("cache-control", "no-store");
  const url = new URL(req.url, "http://display.local");
  if (req.method === "GET" && url.pathname === "/version") {
    let ready = !deploymentStateFile;
    if (deploymentStateFile) {
      try { ready = JSON.parse(fs.readFileSync(deploymentStateFile, "utf8")).version === buildId; }
      catch { ready = false; }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: buildId, ready }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    void proxySessions(url.searchParams, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/calendar") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(calendarHtml);
    return;
  }

  if (req.method === "GET" && calendarAssets.has(url.pathname)) {
    res.writeHead(200, { "content-type": url.pathname.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8" });
    res.end(calendarAssets.get(url.pathname));
    return;
  }
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

  if (req.method === "GET" && req.url === "/display.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(displayJs);
    return;
  }

  if (req.method === "GET" && req.url === "/display-model.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(displayModelJs);
    return;
  }

  if (req.method === "GET" && req.url === "/display.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(displayCss);
    return;
  }

  if (req.method === "GET" && req.url === "/create-event.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(createEventJs);
    return;
  }

  if (req.method === "GET" && req.url === "/api/events") {
    fetch(`${serverApiUrl}/events`)
      .then(async (upstream) => {
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

  if (req.method === "DELETE" && req.url.startsWith("/api/events/")) {
    const id = req.url.split("/")[3] || "";
    const headers = {};
    if (internalApiToken) {
      headers["x-internal-token"] = internalApiToken;
    }
    fetch(`${serverApiUrl}/events/${id}`, {
      method: "DELETE",
      headers
    })
      .then(async (upstream) => {
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

  if (req.method === "PATCH" && req.url.startsWith("/api/events/")) {
    const id = req.url.split("/")[3] || "";
    readRequestBody(req)
      .then(async (body) => {
        const headers = {
          "content-type": "application/json"
        };
        if (internalApiToken) {
          headers["x-internal-token"] = internalApiToken;
        }
        const upstream = await fetch(`${serverApiUrl}/events/${id}`, {
          method: "PATCH",
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

  if (req.method === "POST" && req.url === "/api/events/batch-delete") {
    readRequestBody(req)
      .then(async (body) => {
        const headers = {
          "content-type": "application/json"
        };
        if (internalApiToken) {
          headers["x-internal-token"] = internalApiToken;
        }
        const upstream = await fetch(`${serverApiUrl}/events/batch-delete`, {
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
        displayEnableDebug,
        displayTimezone,
        calendarInterval,
        calendarRefresh,
        calendarEveryEvents
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
