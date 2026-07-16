export function buildAckMessage(result, { cancelEventLink = "", rsvpsListLink = "", groupNames = [] } = {}) {
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
  const calendarLink = result.event?.googleCalendarPublicAddLink || result.event?.googleCalendarHtmlLink || "";
  const groupsLine = Array.isArray(groupNames) && groupNames.length > 0
    ? groupNames.join(", ")
    : "the configured WhatsApp group";
  return [
    "*Your event is live!*",
    `*Event:* ${result.event?.title || "Untitled event"}`,
    `Published in *${groupsLine}* and on the *Community Live Board*.`,
    "",
    "*If you want to see the event on your calendar:*",
    calendarLink || "Calendar link not available yet.",
    "",
    "*If you want to see who joined:*",
    rsvpsListLink || "RSVP list link not available.",
    "",
    "*If you want to delete this event:*",
    cancelEventLink || "Delete link not available."
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
  const commandLine = `/organisers tempId="${tempId}", organisers="@pablo @maria"`;
  if (organisersCommandLink) {
    return [
      "To finish creating your event:",
      "1) Edit organiser names in the prefilled message",
      "2) Attach one image to that same message",
      "3) Press Send",
      "",
      "Do not remove tempId or quotes.",
      "",
      `Click here to continue: ${organisersCommandLink}`
    ].join("\n");
  }

  return [
    "*To finish creating your event:*",
    "1) Copy and send this command",
    "2) Attach one image to that same message",
    "3) Press Send",
    "",
    "*Command:*",
    commandLine,
    "",
    "*Do not remove tempId or quotes.*"
  ].join("\n");
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

export function buildNativeEventMissingFieldsWarning(missingFields) {
  const list = Array.isArray(missingFields) ? missingFields : [];
  const fields = list.length > 0 ? list.join(", ") : "required fields";
  return [
    "I cannot create this event yet.",
    `Missing required fields: ${fields}.`,
    "Please edit your WhatsApp Event card and include all required fields: title, description, location, startTime.",
    "No draft was created."
  ].join("\n");
}
