import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

export function calendarQrTargetLink(syncResult) {
  if (!syncResult || syncResult.ok !== true) {
    return "";
  }
  return String(syncResult.googlePublicAddLink || syncResult.googleHtmlLink || "").trim();
}

export async function createCalendarQrImage({ eventId, targetUrl, mediaDir }) {
  if (!eventId || !targetUrl || !mediaDir) {
    return null;
  }

  fs.mkdirSync(mediaDir, { recursive: true });
  const fileName = `qr-${String(eventId).replace(/[^a-zA-Z0-9_-]/g, "")}.png`;
  const filePath = path.join(mediaDir, fileName);

  await QRCode.toFile(filePath, targetUrl, {
    type: "png",
    width: 240,
    margin: 1
  });

  return `/media/${fileName}`;
}

export function deleteMediaPath(mediaPath, mediaDir) {
  if (!mediaPath || typeof mediaPath !== "string" || !mediaPath.startsWith("/media/") || !mediaDir) {
    return false;
  }
  const fileName = mediaPath.replace("/media/", "");
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return false;
  }
  const filePath = path.join(mediaDir, fileName);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}
