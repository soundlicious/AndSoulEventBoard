import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  calendarQrTargetLink,
  createCalendarQrImage,
  deleteMediaPath
} from "../src/calendar-qr.js";

test("calendarQrTargetLink prefers public add link", () => {
  const target = calendarQrTargetLink({
    ok: true,
    googlePublicAddLink: "https://calendar.google.com/calendar/r/eventedit/abc",
    googleHtmlLink: "https://calendar.google.com/calendar/u/0/r/eventedit/abc"
  });
  assert.equal(target, "https://calendar.google.com/calendar/r/eventedit/abc");
});

test("createCalendarQrImage writes png under media path", async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "coliving-qr-test-"));
  const mediaPath = await createCalendarQrImage({
    eventId: "evt_abc",
    targetUrl: "https://calendar.google.com/calendar/r/eventedit/abc",
    mediaDir
  });

  assert.equal(mediaPath, "/media/qr-evt_abc.png");

  const fullPath = path.join(mediaDir, "qr-evt_abc.png");
  assert.equal(fs.existsSync(fullPath), true);
  const bytes = fs.readFileSync(fullPath);
  assert.equal(bytes.length > 100, true);
});

test("deleteMediaPath deletes media files safely", () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "coliving-qr-delete-test-"));
  const filePath = path.join(mediaDir, "qr-evt_delete.png");
  fs.writeFileSync(filePath, "fake", "utf8");

  const deleted = deleteMediaPath("/media/qr-evt_delete.png", mediaDir);
  assert.equal(deleted, true);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(deleteMediaPath("/media/../escape.txt", mediaDir), false);
});
