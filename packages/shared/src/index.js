export const requiredEventFields = ["title", "description", "date", "startTime"];

function resolvedStartDate(payload) {
  return payload?.date || payload?.startDate || "";
}

function resolvedStartTime(payload) {
  return payload?.startTime || payload?.time || "";
}

export function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

export function validateEventPayload(payload) {
  const errors = [];
  if (!payload?.title || String(payload.title).trim() === "") {
    errors.push("Missing required field: title");
  }
  if (!payload?.description || String(payload.description).trim() === "") {
    errors.push("Missing required field: description");
  }

  const startDate = resolvedStartDate(payload);
  if (!startDate || String(startDate).trim() === "") {
    errors.push("Missing required field: date");
  }

  const startTime = resolvedStartTime(payload);
  if (!startTime || String(startTime).trim() === "") {
    errors.push("Missing required field: startTime");
  }

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    errors.push("Invalid date format, expected YYYY-MM-DD");
  }

  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
    errors.push("Invalid startTime format, expected HH:mm");
  }

  if (payload.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(payload.endDate)) {
    errors.push("Invalid endDate format, expected YYYY-MM-DD");
  }

  if (payload.endTime && !/^\d{2}:\d{2}$/.test(payload.endTime)) {
    errors.push("Invalid endTime format, expected HH:mm");
  }

  if (startDate && payload.endDate && payload.endDate < startDate) {
    errors.push("endDate cannot be earlier than date");
  }

  if (payload.organisers && !Array.isArray(payload.organisers)) {
    errors.push("Invalid organisers format, expected array");
  }

  if (payload.image != null) {
    const isString = typeof payload.image === "string";
    const isObject =
      typeof payload.image === "object"
      && typeof payload.image.mimeType === "string"
      && typeof payload.image.dataBase64 === "string";
    if (!isString && !isObject) {
      errors.push("Invalid image format, expected string URL or object { mimeType, dataBase64 }");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function computeConfidence(event) {
  const required = requiredEventFields.length;
  const present = requiredEventFields.filter((field) => event[field]).length;
  let score = (present / required) * 0.85;
  if (event.organisers && event.organisers.length > 0) {
    score += 0.1;
  }
  if (event.image) {
    score += 0.05;
  }
  return Math.min(1, Number(score.toFixed(2)));
}
