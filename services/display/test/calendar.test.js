import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  SESSION_TYPES, attendance, buildSessionsPath, calendarLayout, fetchBookingSessions,
  remainingToday, sessionPrice, sessionTime, startOfDay
} from "../src/calendar-model.js";
import { momenceUrl, proxySessions } from "../src/momence.js";
import { advanceRotation, reconcileRotation } from "../src/rotation-model.js";

const now = new Date("2026-09-12T10:00:00Z");
const session = (id, startsAt = "2026-09-12T12:00:00Z") => ({ id, startsAt });

test("Momence query matches Sessions host, types, midnight, size and page", () => {
  const local = new URL(buildSessionsPath(2, now), "http://display.local");
  assert.equal(local.searchParams.get("hostId"), "47026");
  assert.equal(local.searchParams.get("fromDate"), "2026-09-11T23:00:00.000Z");
  assert.equal(local.searchParams.get("pageSize"), "250");
  assert.equal(local.searchParams.get("page"), "2");
  assert.deepEqual(local.searchParams.getAll("sessionTypes[]"), SESSION_TYPES);
  const upstream = momenceUrl(local.searchParams);
  assert.equal(upstream.origin + upstream.pathname, "https://readonly-api.momence.com/host-plugins/host/47026/host-schedule/sessions");
  assert.equal(upstream.searchParams.get("fromDate"), local.searchParams.get("fromDate"));
  assert.deepEqual(upstream.searchParams.getAll("sessionTypes[]"), SESSION_TYPES);
  assert.equal(upstream.searchParams.get("pageSize"), "250");
  assert.equal(upstream.searchParams.get("page"), "2");
});

test("midnight uses display timezone through UK summer/winter and DST changes", () => {
  for (const [date, expected] of [
    ["2026-01-10T12:00:00Z", "2026-01-10T00:00:00.000Z"],
    ["2026-03-29T12:00:00Z", "2026-03-29T00:00:00.000Z"],
    ["2026-10-25T12:00:00Z", "2026-10-24T23:00:00.000Z"],
    ["2026-09-12T23:30:00Z", "2026-09-12T23:00:00.000Z"]
  ]) assert.equal(startOfDay(new Date(date)).toISOString(), expected);
});

test("remainder of today excludes started sessions and tomorrow but preserves cancellations", () => {
  const result = remainingToday([
    session("later", "2026-09-12T22:30:00Z"),
    session("tomorrow", "2026-09-12T23:00:00Z"),
    session("past", "2026-09-12T09:59:59Z"),
    { ...session("cancelled"), isCancelled: true },
    session("now", now.toISOString()),
    session("invalid", "bad")
  ], now);
  assert.deepEqual(result.map((item) => item.id), ["now", "cancelled", "later"]);
  assert.deepEqual(remainingToday(result, new Date("2026-09-13T00:00:00Z")), []);
});

test("pagination continues past 250 results and stops at reference range boundary", async () => {
  const calls = [];
  const result = await fetchBookingSessions({ now, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const page = calls.length - 1;
    return Response.json({ payload: page === 0
      ? Array.from({ length: 250 }, (_, i) => session(i))
      : [session("today-page-two"), session("outside", "2026-09-28T10:00:00Z")] });
  } });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url, "http://local").searchParams.get("page"), "1");
  assert.equal(calls[0].options.headers.accept, "application/json");
  assert.equal(result.length, 251);
  assert.equal(result.at(-1).id, "today-page-two");
});

test("pagination caps at four pages and rejects errors without a partial schedule", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ payload: Array.from({ length: 250 }, (_, i) => session(`${calls}-${i}`)) });
  };
  assert.equal((await fetchBookingSessions({ now, fetchImpl })).length, 1000);
  assert.equal(calls, 4);
  await assert.rejects(fetchBookingSessions({ now, fetchImpl: async () => new Response("error", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchBookingSessions({ now, fetchImpl: async () => Response.json({}) }), /Invalid sessions/);
});

test("attendance keeps exact counts including full/oversold and unknown capacity", () => {
  const partial = attendance({ ticketsSold: 8, capacity: 12 });
  assert.equal(partial.label, "8/12 attending");
  assert.equal(partial.spots, 4);
  assert.ok(Math.abs(partial.percentage - 66.6666666667) < 0.000001);
  assert.equal(attendance({ ticketsSold: 14, capacity: 12 }).label, "14/12 attending");
  assert.equal(attendance({ ticketsSold: 14, capacity: 12 }).percentage, 100);
  assert.equal(attendance({ ticketsSold: 0, capacity: 12 }).label, "0/12 attending");
  assert.equal(attendance({}).label, "Attendance unavailable");
  assert.equal(sessionTime({ startsAt: "2026-09-12T12:00:00Z", endsAt: "2026-09-12T13:00:00Z" }), "13:00 – 14:00");
  assert.equal(sessionPrice({ freeEvent: true }), "Free");
  assert.equal(sessionPrice({ fixedTicketPrice: 28, ticketPriceType: "fixed-price" }), "£28");
});

test("layout allocates a visible cell for every session across densities and orientations", () => {
  for (const [width, height] of [[1920, 850], [1280, 520], [1080, 1660], [700, 350], [360, 580]]) {
    for (const count of [1, 2, 6, 12, 24, 40, 80, 250]) {
      const layout = calendarLayout(count, width, height);
      assert.ok(layout.rows * layout.columns >= count);
      assert.ok(layout.scale > 0);
      assert.ok(layout.gap * (layout.rows - 1) < height);
      assert.ok(layout.gap * (layout.columns - 1) < width);
    }
  }
});

test("cycle inserts a calendar after every event, including wrap and a single event", () => {
  for (const events of [[{ id: "one" }], [{ id: "one" }, { id: "two" }, { id: "three" }]]) {
    let cursor = { kind: "event", index: 0 };
    const actual = [];
    for (let i = 0; i < events.length * 4; i += 1) {
      actual.push(cursor.kind === "event" ? events[cursor.index].id : "calendar");
      cursor = advanceRotation(cursor, events);
    }
    assert.deepEqual(actual, [...events, ...events].flatMap((event) => [event.id, "calendar"]));
  }
  assert.deepEqual(advanceRotation({ kind: "event", index: 0 }, []), { kind: "calendar", index: -1 });
});

test("refresh preserves current identity and inserts calendar when visible event is removed", () => {
  const events = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const inserted = [{ id: "new" }, ...events];
  assert.deepEqual(reconcileRotation({ kind: "event", index: 1 }, events, inserted), { kind: "event", index: 2 });
  const remaining = events.slice(1);
  const reconciled = reconcileRotation({ kind: "event", index: 0 }, events, remaining);
  assert.deepEqual(reconciled, { kind: "calendar", index: -1 });
  assert.deepEqual(advanceRotation(reconciled, remaining), { kind: "event", index: 0 });
  assert.deepEqual(reconcileRotation({ kind: "calendar", index: -1 }, [], events), { kind: "calendar", index: -1 });
});

test("HTTP proxy preserves upstream body/status/cache headers and handles network failures", async (t) => {
  let fail = false;
  let request;
  const server = http.createServer((req, res) => {
    void proxySessions(new URL(req.url, "http://local").searchParams, res, async (url, options) => {
      request = { url, options };
      if (fail) throw new Error("offline");
      return Response.json({ payload: [session("one")] }, { status: 200 });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + buildSessionsPath(0, now));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).payload, [session("one")]);
  assert.equal(request.options.headers["user-agent"], "cheshire-schedule-proxy");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, s-maxage=300, stale-while-revalidate=1800");
  fail = true;
  assert.equal((await fetch(base + buildSessionsPath(0, now))).status, 502);
  assert.equal((await fetch(`${base}/api/sessions?hostId=bad/path`)).status, 400);
});
