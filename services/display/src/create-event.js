const API_URL = window.__DISPLAY_CONFIG__.apiUrl;
const MAX_IMAGE_BYTES = Number(window.__DISPLAY_CONFIG__.maxImageBytes || 5 * 1024 * 1024);

function tokenValue() {
  return (localStorage.getItem("admin_internal_token") || "").trim();
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function organisersToArray(text) {
  const parts = (text || "").trim().split(/\s+/).filter(Boolean);
  return parts.map((item) => item.replace(/^@/, ""));
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.title.value.trim();
  const description = form.description.value.trim();
  const date = form.date.value;
  const startTime = form.startTime.value;
  const endTime = form.endTime.value;
  const organisers = organisersToArray(form.organisers.value);
  const file = form.image.files[0];

  if (!title || !description || !date || !startTime) {
    setStatus("Please fill title, description, date, and start time.", true);
    return;
  }

  const payload = {
    title,
    description,
    date,
    startTime,
    organisers
  };

  if (endTime) {
    payload.endTime = endTime;
  }

  if (file) {
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus(`Image too large: ${(file.size / (1024 * 1024)).toFixed(2)}MB. Max ${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(2)}MB.`, true);
      return;
    }
    const dataBase64 = await toBase64(file);
    payload.image = {
      mimeType: file.type || "image/jpeg",
      dataBase64
    };
  }

  const headers = { "content-type": "application/json" };
  const token = tokenValue();
  if (token) {
    headers["x-internal-token"] = token;
  }

  const res = await fetch(`/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const details = Array.isArray(json.errors) ? json.errors.join("; ") : (json.error || `HTTP ${res.status}`);
    setStatus(`Create failed: ${details}`, true);
    return;
  }

  setStatus(`Event created: ${json.id}`);
  form.reset();
}

function init() {
  const tokenInput = document.getElementById("token");
  const existing = tokenValue();
  tokenInput.value = existing;
  if (!existing) {
    setStatus("Tip: save INTERNAL_API_TOKEN if direct API access is enabled.");
  }
  document.getElementById("save-token").addEventListener("click", () => {
    localStorage.setItem("admin_internal_token", tokenInput.value.trim());
    setStatus("Token saved.");
  });
  document.getElementById("event-form").addEventListener("submit", (event) => {
    submitForm(event).catch((error) => {
      setStatus(error.message || "Unexpected error", true);
    });
  });
}

init();
