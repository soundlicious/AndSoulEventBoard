import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDisplayHtml } from "./display-page.js";

const displayPort = Number(process.env.DISPLAY_PORT || 3000);
const apiUrl = process.env.PUBLIC_API_URL || "http://localhost:8080";
const serverApiUrl = process.env.DISPLAY_API_SERVER_URL || "http://api:8080";
const interval = Number(process.env.CAROUSEL_INTERVAL_MS || 8000);
const mediaBaseUrl = process.env.PUBLIC_MEDIA_URL || apiUrl;
const maxDaysAhead = Number(process.env.DISPLAY_MAX_DAYS_AHEAD || 30);
const displayEnableDebug = String(process.env.DISPLAY_ENABLE_DEBUG || "true") === "true";
const displayMockWhatsappUi = String(process.env.DISPLAY_MOCK_WHATSAPP_UI || "false") === "true";
const displayMockSenderJid = process.env.DISPLAY_MOCK_SENDER_JID || "staging-admin@s.whatsapp.net";
const displayMockGuestSenderJid = process.env.DISPLAY_MOCK_GUEST_SENDER_JID || "staging-guest@s.whatsapp.net";
const internalApiToken = process.env.INTERNAL_API_TOKEN || "";
const proxyMaxBodyBytes = Number(process.env.DISPLAY_PROXY_MAX_BODY_BYTES || 8 * 1024 * 1024);
const proxyMaxMediaBytes = Number(process.env.DISPLAY_PROXY_MAX_MEDIA_BYTES || 5 * 1024 * 1024);
const displayTimezone = process.env.DISPLAY_TIMEZONE || process.env.TZ || "Europe/London";
const hereDir = path.dirname(fileURLToPath(import.meta.url));
const adminJs = fs.readFileSync(path.join(hereDir, "admin.js"), "utf8");
const createEventJs = fs.readFileSync(path.join(hereDir, "create-event.js"), "utf8");
const displayJs = fs.readFileSync(path.join(hereDir, "display.js"), "utf8");
const displayModelJs = fs.readFileSync(path.join(hereDir, "display-model.js"), "utf8");
const displayCss = fs.readFileSync(path.join(hereDir, "display.css"), "utf8");

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

const html = buildDisplayHtml({
  apiUrl,
  mediaBaseUrl,
  interval,
  maxDaysAhead,
  enableDebug: displayEnableDebug,
  timezone: displayTimezone
});

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
    .mock {
      background: #ede9fe;
      border-color: #c4b5fd;
      color: #4c1d95;
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
    .mock-preview {
      margin: 14px 0;
      padding: 12px;
      border: 1px solid #d7e3f3;
      background: #fff;
      border-radius: 10px;
      display: grid;
      gap: 10px;
    }
    .mock-preview pre {
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
      padding: 10px;
      border-radius: 8px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.85rem;
    }
    .mock-links {
      display: grid;
      gap: 6px;
      font-size: 0.9rem;
    }
    .mock-links button {
      text-align: left;
      white-space: normal;
      word-break: break-word;
    }
    .mock-compose {
      display: grid;
      gap: 8px;
    }
    .mock-compose textarea {
      min-height: 88px;
      resize: vertical;
      border: 1px solid #c8d6ea;
      border-radius: 8px;
      padding: 8px;
      font: inherit;
    }
    #mock-command-result {
      color: #0f4c81;
      font-size: 0.9rem;
    }
    #mock-command-result.error {
      color: #991b1b;
    }
    #mock-command-response {
      margin: 0;
      background: #0b1220;
      color: #dbeafe;
      padding: 10px;
      border-radius: 8px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.82rem;
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
    <section id="mock-preview" class="mock-preview" hidden>
      <strong>Mock WhatsApp Preview</strong>
      <div id="mock-event-id"></div>
      <pre id="mock-text"></pre>
      <div class="mock-links" id="mock-links"></div>
      <div class="mock-compose">
        <label for="mock-sender-role">Send as</label>
        <select id="mock-sender-role">
          <option value="creator">Event creator</option>
          <option value="guest">Guest</option>
        </select>
        <div id="mock-sender-jid"></div>
        <label for="mock-command-input">Command to send (mock DM)</label>
        <textarea id="mock-command-input" placeholder="/update-event evt_xxxxx ..."></textarea>
        <div class="editor-actions">
          <button id="mock-command-send" class="mock" type="button">Send command</button>
        </div>
        <div id="mock-command-result"></div>
        <pre id="mock-command-response"></pre>
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
      apiUrl: ${JSON.stringify(apiUrl)},
      mockWhatsappUi: ${displayMockWhatsappUi ? "true" : "false"},
      mockSenderJid: ${JSON.stringify(displayMockSenderJid)},
      mockGuestSenderJid: ${JSON.stringify(displayMockGuestSenderJid)}
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

  if (req.method === "POST" && req.url === "/api/ingest/dm") {
    readRequestBody(req)
      .then(async (body) => {
        const headers = {
          "content-type": "application/json"
        };
        if (internalApiToken) {
          headers["x-internal-token"] = internalApiToken;
        }
        const upstream = await fetch(`${serverApiUrl}/ingest/dm`, {
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

  if (req.method === "POST" && req.url.startsWith("/api/mock-whatsapp/preview/")) {
    const eventId = req.url.split("/")[4] || "";
    readRequestBody(req)
      .then(async (body) => {
        const headers = {
          "content-type": "application/json"
        };
        if (internalApiToken) {
          headers["x-internal-token"] = internalApiToken;
        }
        const upstream = await fetch(`${serverApiUrl}/mock-whatsapp/preview/${eventId}`, {
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
        displayTimezone
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
