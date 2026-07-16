export function buildAckMessage(result, { cancelEventLink = "", rsvpsListLink = "" } = {}) {
  if (!result) {
    return "I could not process your message. Please try again.";
  }
  if (!result.valid) {
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const missingFields = errors
      .filter((item) => item.startsWith("Missing required field:"))
      .map((item) => item.replace("Missing required field:", "").trim());
    const formatErrors = errors.filter((item) => !item.startsWith("Missing required field:"));

    const details = [];
    if (missingFields.length > 0) {
      details.push(`Missing fields: ${missingFields.join(", ")}`);
    }
    if (formatErrors.length > 0) {
      details.push(`Formatting issues: ${formatErrors.join("; ")}`);
    }

    return [
      "I could not create the event.",
      ...details,
      "Please use:",
      "/event title=\"...\" date=\"YYYY-MM-DD\" startTime=\"HH:mm\" endTime=\"HH:mm\" desc=\"...\" organisers=\"@name @name\"",
      "You can attach an image in the same message."
    ].join("\n");
  }
  if (result.needsConfirmation) {
    return "Event parsed but needs confirmation before publishing. I saved it as draft.";
  }
  return [
    "Event created and published.",
    `Event ID: ${result.event?.id || "unknown"}`,
    `Title: ${result.event?.title || "unknown"}`,
    `Calendar: ${result.event?.googleCalendarPublicAddLink || result.event?.googleCalendarHtmlLink || "not configured"}`,
    cancelEventLink ? `Delete Event: ${cancelEventLink}` : "",
    rsvpsListLink ? `View RSVPs: ${rsvpsListLink}` : ""
  ].join("\n");
}

export function buildRsvpReply(result, { rsvpLink = "", cancelRsvpLink = "" } = {}) {
  if (!result || result.ok === false) {
    return result?.message || "I could not process your RSVP request.";
  }

  if (result.action === "rsvp") {
    return [
      result.message || "RSVP confirmed.",
      `Event ID: ${result.eventId || "unknown"}`,
      `RSVP Count: ${Number.isFinite(result.count) ? result.count : 0}`,
      cancelRsvpLink ? `Cancel RSVP: ${cancelRsvpLink}` : ""
    ].filter(Boolean).join("\n");
  }

  if (result.action === "cancel_rsvp") {
    return [
      result.message || "RSVP cancelled.",
      `Event ID: ${result.eventId || "unknown"}`,
      `RSVP Count: ${Number.isFinite(result.count) ? result.count : 0}`,
      rsvpLink ? `RSVP Again: ${rsvpLink}` : ""
    ].filter(Boolean).join("\n");
  }

  return result.message || "Request processed.";
}

export function buildRsvpsListReply(result) {
  if (!result || result.ok === false) {
    return result?.message || "I could not fetch RSVP list.";
  }

  const list = Array.isArray(result.rsvps) ? result.rsvps : [];
  if (list.length === 0) {
    return [
      `RSVP list for ${result.eventId || "unknown"}`,
      "No RSVPs yet."
    ].join("\n");
  }

  const lines = list.map((item, idx) => {
    const label = item.pushName
      ? `${item.pushName} (${item.senderJid})`
      : `${item.senderJid}`;
    return `${idx + 1}. ${label}`;
  });

  return [
    `RSVP list for ${result.eventId || "unknown"}`,
    `Total: ${list.length}`,
    ...lines
  ].join("\n");
}

export function buildNativeEventEnrichmentPrompt(draft) {
  const tempId = draft.tempId || "tmp_missing";
  const organisersCommandLink = String(draft.organisersCommandLink || "").trim();
  return [
    "Great, I received your WhatsApp Event draft.",
    `Temp ID: ${tempId}`,
    `Title: ${draft.title || "Community Event"}`,
    `Date: ${draft.date || "unknown"}`,
    `Start: ${draft.startTime || "unknown"}`,
    `End: ${draft.endTime || "23:59"}`,
    "To publish it, reply using this command and attach the event image in the SAME message:",
    `/organisers tempId="${tempId}", organisers="@pablo @maria"`,
    organisersCommandLink ? `Quick reply: ${organisersCommandLink}` : "",
    "The image must be attached (not a URL)."
  ].filter(Boolean).join("\n");
}

export function buildNativeEventEnrichmentReminder({
  needOrganisers,
  needImage,
  needCommand,
  wrongTempId,
  tempId
}) {
  const safeTempId = String(tempId || "tmp_missing");
  const commandLine = `/organisers tempId="${safeTempId}", organisers="@pablo @maria"`;

  if (wrongTempId) {
    return [
      "The provided tempId does not match your pending event draft.",
      `Please use exactly: ${commandLine}`,
      "Attach the image in the same message."
    ].join("\n");
  }

  if (needCommand) {
    return [
      "I could not detect the organisers command format.",
      `Please use exactly: ${commandLine}`,
      "Attach the image in the same message."
    ].join("\n");
  }

  const parts = [];
  if (needOrganisers) {
    parts.push("organisers with syntax organisers=\"@name @name\"");
  }
  if (needImage) {
    parts.push("an attached image");
  }
  return [
    "I still need more details before publishing this event.",
    `Missing: ${parts.join(" and ") || "details"}.`,
    `Please use: ${commandLine}`,
    "Attach image in the same message."
  ].join("\n");
}

export function buildNativeEventEnrichmentExpired() {
  return [
    "Your pending event draft expired due to no reply.",
    "Please send the WhatsApp Event again so I can collect organisers and image."
  ].join("\n");
}
