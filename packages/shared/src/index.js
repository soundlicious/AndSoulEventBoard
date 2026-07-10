export const requiredEventFields = ["title", "description", "date", "time"];

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
  for (const field of requiredEventFields) {
    if (!payload[field] || String(payload[field]).trim() === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (payload.date && !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    errors.push("Invalid date format, expected YYYY-MM-DD");
  }

  if (payload.time && !/^\d{2}:\d{2}$/.test(payload.time)) {
    errors.push("Invalid time format, expected HH:mm");
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
