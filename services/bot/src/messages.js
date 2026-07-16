export function buildAckMessage(result) {
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
      "/event title=\"...\" date=\"YYYY-MM-DD\" time=\"HH:mm\" desc=\"...\" organisers=\"@name @name\"",
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
    `Calendar: ${result.event?.googleCalendarPublicAddLink || result.event?.googleCalendarHtmlLink || "not configured"}`
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
