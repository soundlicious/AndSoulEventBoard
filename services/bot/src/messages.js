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
  return `Event created and published. Event ID: ${result.event?.id || "unknown"}`;
}
