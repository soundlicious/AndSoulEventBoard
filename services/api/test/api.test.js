import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coliving-api-test-"));
process.env.EVENTS_FILE_PATH = path.join(tempDir, "events.json");
process.env.AB_ASSIGNMENT_MODE = "sender_sticky";
process.env.MEDIA_DIR = path.join(tempDir, "media");
process.env.MAX_MEDIA_BYTES = "1024";
process.env.API_MAX_BODY_BYTES = "4096";
process.env.INTERNAL_API_TOKEN = "test-internal-token";
process.env.RATE_LIMIT_WINDOW_MS = "300000";
process.env.RATE_LIMIT_MAX_PER_SENDER = "3";
process.env.RATE_LIMIT_MAX_GLOBAL = "50";
process.env.GOOGLE_CALENDAR_ENABLED = "false";

const { createServer } = await import("../src/server.js");

function request(baseUrl, route, options = {}) {
  const { token, ...restOptions } = options;
  const resolvedToken = token === undefined ? process.env.INTERNAL_API_TOKEN : token;
  const headers = {
    "content-type": "application/json",
    ...(restOptions.headers || {})
  };
  if (resolvedToken) {
    headers["x-internal-token"] = resolvedToken;
  }
  return fetch(`${baseUrl}${route}`, {
    headers,
    ...restOptions
  });
}

function futureDateTime(minutesAhead = 120) {
  const date = new Date(Date.now() + minutesAhead * 60 * 1000);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

function pastDateTime(minutesAgo = 120) {
  return futureDateTime(-minutesAgo);
}

test("health endpoint returns ok", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const res = await request(baseUrl, "/health", { method: "GET" });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("POST /events validates required fields", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const res = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({ title: "" })
  });
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(Array.isArray(json.errors), true);
});

test("POST /ingest/dm returns validation errors for invalid command", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ingestRes = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600111222@s.whatsapp.net",
      messageId: "MSG-invalid",
      rawText: "/event title=\"Only title\""
    })
  });
  const ingestJson = await ingestRes.json();
  assert.equal(ingestRes.status, 200);
  assert.equal(ingestJson.valid, false);
  assert.equal(Array.isArray(ingestJson.errors), true);
  assert.equal(ingestJson.errors.some((e) => e.includes("Missing required field")), true);
});

test("POST /ingest/dm creates event and parse log", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const when = futureDateTime(120);

  const ingestRes = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600111222@s.whatsapp.net",
      messageId: "MSG-1",
      rawText: `/event title=\"Dinner\" date=\"${when.date}\" time=\"${when.time}\" desc=\"Shared meal\" organisers=\"@pablo @maria\"`,
      image: {
        mimeType: "image/jpeg",
        dataBase64: "ZmFrZS1pbWFnZQ=="
      }
    })
  });
  const ingestJson = await ingestRes.json();
  assert.equal(ingestRes.status, 200);
  assert.equal(ingestJson.valid, true);
  assert.equal(typeof ingestJson.variant, "string");
  assert.equal(Boolean(ingestJson.event?.id), true);
  assert.equal(Array.isArray(ingestJson.event?.organisers), true);

  const eventRes = await request(baseUrl, `/events/${ingestJson.event.id}`, { method: "GET" });
  const eventJson = await eventRes.json();
  assert.equal(eventRes.status, 200);
  assert.equal(eventJson.date, when.date);
  assert.equal(eventJson.time, when.time);
  assert.equal(typeof eventJson.image, "string");
  assert.equal(eventJson.image.startsWith("/media/"), true);

  const listRes = await request(baseUrl, "/events", { method: "GET" });
  const listJson = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.equal(listJson.items.length >= 1, true);

  const metricsRes = await request(baseUrl, "/experiments/metrics", { method: "GET" });
  const metricsJson = await metricsRes.json();
  assert.equal(metricsRes.status, 200);
  assert.equal(metricsJson.totalRuns >= 1, true);

  const mediaRes = await request(baseUrl, eventJson.image, { method: "GET" });
  assert.equal(mediaRes.status, 200);
});

test("POST /ingest/dm supports cancel-event by creator only", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  const createIngest = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600111222@s.whatsapp.net",
      messageId: "MSG-create-cancel",
      rawText: `/event title=\"Cancelable\" date=\"${when.date}\" time=\"${when.time}\" desc=\"temp\"`
    })
  });
  const created = await createIngest.json();
  assert.equal(createIngest.status, 200);
  assert.equal(Boolean(created.event?.id), true);

  const unauthorizedCancel = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600999999@s.whatsapp.net",
      messageId: "MSG-cancel-nope",
      rawText: `/cancel-event ${created.event.id}`
    })
  });
  const unauthorizedJson = await unauthorizedCancel.json();
  assert.equal(unauthorizedCancel.status, 200);
  assert.equal(unauthorizedJson.ok, false);

  const authorizedCancel = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600111222@s.whatsapp.net",
      messageId: "MSG-cancel-yes",
      rawText: `/cancel-event ${created.event.id}`
    })
  });
  const authorizedJson = await authorizedCancel.json();
  assert.equal(authorizedCancel.status, 200);
  assert.equal(authorizedJson.ok, true);

  const checkDeleted = await request(baseUrl, `/events/${created.event.id}`, { method: "GET" });
  assert.equal(checkDeleted.status, 404);
});

test("POST /events/:id/publish appends published group jids", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const when = futureDateTime(120);

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Workshop",
      description: "Deep work sprint",
      date: when.date,
      time: when.time,
      organisers: ["pablo"]
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);

  const publishRes = await request(baseUrl, `/events/${created.id}/publish`, {
    method: "POST",
    body: JSON.stringify({ groupJid: "1203630AAAAAAAA@g.us" })
  });
  const published = await publishRes.json();
  assert.equal(publishRes.status, 200);
  assert.equal(Array.isArray(published.publishedGroupJids), true);
  assert.equal(published.publishedGroupJids.includes("1203630AAAAAAAA@g.us"), true);
});

test("DELETE /events/:id deletes single event", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Delete me",
      description: "Single delete",
      date: when.date,
      time: when.time
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);

  const delRes = await request(baseUrl, `/events/${created.id}`, {
    method: "DELETE"
  });
  const delJson = await delRes.json();
  assert.equal(delRes.status, 200);
  assert.equal(delJson.deleted, true);

  const getRes = await request(baseUrl, `/events/${created.id}`, { method: "GET" });
  assert.equal(getRes.status, 404);
});

test("DELETE /events/:id also removes orphaned calendar QR image", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Delete with QR",
      description: "Single delete",
      date: when.date,
      time: when.time,
      image: {
        mimeType: "image/jpeg",
        dataBase64: "ZmFrZS1pbWFnZQ=="
      }
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);

  const qrName = `qr-${created.id}.png`;
  const qrPath = path.join(process.env.MEDIA_DIR, qrName);
  fs.writeFileSync(qrPath, Buffer.from("fake-qr"));

  const dbPath = process.env.EVENTS_FILE_PATH;
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const idx = db.events.findIndex((item) => item.id === created.id);
  db.events[idx].googleCalendarQrImage = `/media/${qrName}`;
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");

  const qrBefore = await request(baseUrl, `/media/${qrName}`, { method: "GET" });
  assert.equal(qrBefore.status, 200);

  const delRes = await request(baseUrl, `/events/${created.id}`, {
    method: "DELETE"
  });
  assert.equal(delRes.status, 200);

  const qrAfter = await request(baseUrl, `/media/${qrName}`, { method: "GET" });
  assert.equal(qrAfter.status, 404);
});

test("POST /events/batch-delete deletes multiple events", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  const ids = [];
  for (let i = 0; i < 2; i += 1) {
    const createRes = await request(baseUrl, "/events", {
      method: "POST",
      body: JSON.stringify({
        title: `Batch ${i}`,
        description: "Batch delete",
        date: when.date,
        time: when.time
      })
    });
    const created = await createRes.json();
    ids.push(created.id);
  }

  const delRes = await request(baseUrl, "/events/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  const delJson = await delRes.json();
  assert.equal(delRes.status, 200);
  assert.equal(delJson.deletedCount, 2);

  const listRes = await request(baseUrl, "/events", { method: "GET" });
  const listed = await listRes.json();
  assert.equal(ids.every((id) => listed.items.every((e) => e.id !== id)), true);
});

test("POST /events rejects events not in future", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = pastDateTime(120);

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Past Event",
      description: "Should fail",
      date: when.date,
      time: when.time
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 400);
  assert.equal(Array.isArray(created.errors), true);
  assert.equal(created.errors.includes("Event date+time must be in the future"), true);
});

test("GET /events prunes outdated events", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const future = futureDateTime(120);
  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Future Event",
      description: "Should stay",
      date: future.date,
      time: future.time
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);

  const filePath = process.env.EVENTS_FILE_PATH;
  const db = JSON.parse(fs.readFileSync(filePath, "utf8"));
  db.events.push({
    id: "evt_old_manual",
    title: "Old",
    description: "Old",
    date: "2001-01-01",
    time: "09:00",
    status: "confirmed",
    publishedGroupJids: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(filePath, JSON.stringify(db, null, 2), "utf8");

  const listRes = await request(baseUrl, "/events", { method: "GET" });
  const listed = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.equal(listed.items.some((item) => item.id === "evt_old_manual"), false);
  assert.equal(listed.items.some((item) => item.id === created.id), true);
});

test("stale event media becomes inaccessible after pruning", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const future = futureDateTime(120);

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    body: JSON.stringify({
      title: "Future Media Event",
      description: "Has image",
      date: future.date,
      time: future.time,
      image: {
        mimeType: "image/jpeg",
        dataBase64: "ZmFrZS1pbWFnZQ=="
      }
    })
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);
  assert.equal(typeof created.image, "string");

  const mediaRes = await request(baseUrl, created.image, { method: "GET" });
  assert.equal(mediaRes.status, 200);

  const filePath = process.env.EVENTS_FILE_PATH;
  const db = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const idx = db.events.findIndex((item) => item.id === created.id);
  db.events[idx].date = "2001-01-01";
  db.events[idx].time = "00:01";
  fs.writeFileSync(filePath, JSON.stringify(db, null, 2), "utf8");

  await request(baseUrl, "/events", { method: "GET" });
  const mediaResAfter = await request(baseUrl, created.image, { method: "GET" });
  assert.equal(mediaResAfter.status, 404);
});

test("POST /ingest/dm rejects oversized image payload", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  const oversized = Buffer.alloc(1400, 65).toString("base64");
  const ingestRes = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600111222@s.whatsapp.net",
      messageId: "MSG-oversized",
      rawText: `/event title=\"Big Image\" date=\"${when.date}\" time=\"${when.time}\" desc=\"Too large\"`,
      image: {
        mimeType: "image/jpeg",
        dataBase64: oversized
      }
    })
  });
  const ingestJson = await ingestRes.json();
  assert.equal(ingestRes.status, 413);
  assert.equal(String(ingestJson.error).includes("Image too large"), true);
});

test("protected routes reject missing internal token", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createRes = await request(baseUrl, "/events", {
    method: "POST",
    token: "",
    body: JSON.stringify({
      title: "Should fail",
      description: "No token",
      date: "2099-01-01",
      time: "10:00"
    })
  });
  const createJson = await createRes.json();
  assert.equal(createRes.status, 401);
  assert.equal(createJson.error, "Unauthorized");
});

test("public routes remain accessible without internal token", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const healthRes = await request(baseUrl, "/health", {
    method: "GET",
    token: ""
  });
  assert.equal(healthRes.status, 200);

  const metricsRes = await request(baseUrl, "/experiments/metrics", {
    method: "GET",
    token: ""
  });
  assert.equal(metricsRes.status, 200);
});

test("POST /ingest/dm enforces per-sender rate limit", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const when = futureDateTime(120);

  for (let i = 0; i < 3; i += 1) {
    const res = await request(baseUrl, "/ingest/dm", {
      method: "POST",
      body: JSON.stringify({
        senderJid: "34600999999@s.whatsapp.net",
        messageId: `MSG-rate-${i}`,
        rawText: `/event title=\"Rate ${i}\" date=\"${when.date}\" time=\"${when.time}\" desc=\"ok\"`
      })
    });
    assert.equal(res.status, 200);
  }

  const blockedRes = await request(baseUrl, "/ingest/dm", {
    method: "POST",
    body: JSON.stringify({
      senderJid: "34600999999@s.whatsapp.net",
      messageId: "MSG-rate-block",
      rawText: `/event title=\"Rate block\" date=\"${when.date}\" time=\"${when.time}\" desc=\"blocked\"`
    })
  });
  const blockedJson = await blockedRes.json();
  assert.equal(blockedRes.status, 429);
  assert.equal(String(blockedJson.error).includes("Rate limit exceeded for sender"), true);
});
