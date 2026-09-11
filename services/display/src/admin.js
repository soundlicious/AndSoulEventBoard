const API_URL = "/api";

let events = [];
let selected = new Set();
let editingId = "";
let lastFocusedId = "";
const mockUiEnabled = Boolean(window.__DISPLAY_CONFIG__?.mockWhatsappUi);
const mockSenderJid = String(window.__DISPLAY_CONFIG__?.mockSenderJid || "staging-admin@s.whatsapp.net");
const mockGuestSenderJid = String(window.__DISPLAY_CONFIG__?.mockGuestSenderJid || "staging-guest@s.whatsapp.net");
let previewedEvent = null;

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function fmtDate(item) {
  const startDate = item.date || "-";
  const endDate = item.endDate && item.endDate !== item.date ? ` -> ${item.endDate}` : "";
  return `${startDate}${endDate} ${item.startTime || "-"}${item.endTime ? `-${item.endTime}` : ""}`;
}

function row(item) {
  const checked = selected.has(item.id) ? "checked" : "";
  return `
    <tr>
      <td><input type="checkbox" data-id="${item.id}" class="pick" ${checked} /></td>
      <td><code>${item.id}</code></td>
      <td>${item.title || "Untitled"}</td>
      <td>${fmtDate(item)}</td>
      <td>${item.status || "-"}</td>
      <td>
        ${mockUiEnabled ? `<button class="mock single-preview-mock" data-id="${item.id}">Preview</button>` : ""}
        <button class="secondary single-edit" data-id="${item.id}">Edit</button>
        <button class="danger single-del" data-id="${item.id}">Delete</button>
      </td>
    </tr>
  `;
}

function render() {
  const tbody = document.getElementById("rows");
  if (events.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No events</td></tr>`;
    return;
  }
  tbody.innerHTML = events.map(row).join("");
}

function focusEvent(id) {
  if (!id) {
    return;
  }
  lastFocusedId = id;
}

async function loadEvents() {
  const res = await fetch(`${API_URL}/events`);
  const json = await res.json();
  events = Array.isArray(json.items) ? json.items : [];
  selected = new Set([...selected].filter((id) => events.some((e) => e.id === id)));
  render();
}

async function deleteOne(id) {
  const res = await fetch(`${API_URL}/events/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed (${res.status})`);
  }
}

async function deleteBatch(ids) {
  const res = await fetch(`${API_URL}/events/batch-delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Batch delete failed (${res.status})`);
  }
}

function findEvent(id) {
  return events.find((item) => item.id === id) || null;
}

function parseOrganisers(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().replace(/^@+/, ""))
    .filter((item) => item.length > 0);
}

function openEditor(item) {
  editingId = item.id;
  focusEvent(item.id);
  document.getElementById("edit-id").textContent = item.id;
  document.getElementById("edit-title").value = item.title || "";
  document.getElementById("edit-description").value = item.description || "";
  document.getElementById("edit-date").value = item.date || "";
  document.getElementById("edit-startTime").value = item.startTime || "";
  document.getElementById("edit-endDate").value = item.endDate || "";
  document.getElementById("edit-endTime").value = item.endTime || "";
  document.getElementById("edit-organisers").value = Array.isArray(item.organisers)
    ? item.organisers.map((name) => `@${name}`).join(" ")
    : "";
  document.getElementById("editor").hidden = false;
}

function renderMockPreview(payload) {
  const wrap = document.getElementById("mock-preview");
  const textEl = document.getElementById("mock-text");
  const idEl = document.getElementById("mock-event-id");
  const linksEl = document.getElementById("mock-links");
  if (!wrap || !textEl || !idEl || !linksEl) {
    return;
  }
  idEl.textContent = `Event: ${payload?.eventId || "-"} (${payload?.updated ? "update" : "create"})`;
  textEl.textContent = payload?.mockWhatsapp?.text || "No preview text";
  const links = payload?.mockWhatsapp?.links || {};
  const entries = Object.entries(links).filter(([, value]) => String(value || "").trim().length > 0);
  linksEl.innerHTML = entries.length > 0
    ? entries.map(([key, value]) => `<button type="button" class="secondary mock-link-btn" data-link="${encodeURIComponent(String(value))}">${key}: ${value}</button>`).join("")
    : "No links";
  wrap.hidden = false;
  previewedEvent = findEvent(payload?.eventId || "") || null;
  const roleSelect = document.getElementById("mock-sender-role");
  if (roleSelect && roleSelect.value !== "creator" && roleSelect.value !== "guest") {
    roleSelect.value = "creator";
  }
  renderMockSenderInfo();
}

function selectedSenderRole() {
  const roleSelect = document.getElementById("mock-sender-role");
  return String(roleSelect?.value || "creator");
}

function selectedSenderJid() {
  const role = selectedSenderRole();
  if (role === "guest") {
    return mockGuestSenderJid;
  }
  const creator = String(previewedEvent?.createdBy || previewedEvent?.source?.senderJid || "").trim();
  return creator || mockSenderJid;
}

function selectedMessageId() {
  const eventId = editingId || lastFocusedId || "";
  const item = eventId ? findEvent(eventId) : null;
  return String(item?.source?.messageId || `mock_${Date.now()}`);
}

function renderMockSenderInfo() {
  const el = document.getElementById("mock-sender-jid");
  if (!el) {
    return;
  }
  const role = selectedSenderRole();
  const jid = selectedSenderJid();
  const messageId = selectedMessageId();
  el.textContent = `Using ${role}: ${jid} | messageId: ${messageId}`;
}

function commandFromClickToChat(link) {
  try {
    const url = new URL(String(link || ""));
    const text = url.searchParams.get("text") || "";
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

function setMockCommandResult(message, isError = false) {
  const el = document.getElementById("mock-command-result");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
}

function setMockCommandResponse(payload) {
  const el = document.getElementById("mock-command-response");
  if (!el) {
    return;
  }
  const safePayload = payload == null ? {} : payload;
  el.textContent = JSON.stringify(safePayload, null, 2);
}

async function sendMockCommand() {
  const input = document.getElementById("mock-command-input");
  const rawText = String(input?.value || "").trim();
  if (!rawText) {
    throw new Error("Command is empty");
  }
  const res = await fetch(`${API_URL}/ingest/dm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      senderJid: selectedSenderJid(),
      senderPushName: "Staging Admin",
      messageId: selectedMessageId(),
      rawText
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Mock send failed (${res.status})`);
  }
  console.log("admin mock send", {
    action: json.action || "event_create",
    ok: json.ok ?? json.valid ?? true
  });
  return json;
}

async function previewMockWhatsapp(forcedId = "") {
  const id = forcedId || editingId || lastFocusedId || [...selected][0] || events[0]?.id || "";
  if (!id) {
    throw new Error("No event available to preview");
  }
  const res = await fetch(`${API_URL}/mock-whatsapp/preview/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ updated: true })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Preview failed (${res.status})`);
  }
  renderMockPreview(json);
}

function closeEditor() {
  editingId = "";
  document.getElementById("editor").hidden = true;
}

async function saveEditor() {
  if (!editingId) {
    return;
  }
  const payload = {
    title: document.getElementById("edit-title").value.trim(),
    description: document.getElementById("edit-description").value.trim(),
    date: document.getElementById("edit-date").value,
    startTime: document.getElementById("edit-startTime").value,
    endDate: document.getElementById("edit-endDate").value || undefined,
    endTime: document.getElementById("edit-endTime").value || undefined,
    organisers: parseOrganisers(document.getElementById("edit-organisers").value)
  };

  const res = await fetch(`${API_URL}/events/${editingId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(json.errors) ? json.errors.join("; ") : (json.error || `Update failed (${res.status})`);
    throw new Error(details);
  }
}

function bind() {
  document.getElementById("rows").addEventListener("change", (event) => {
    const target = event.target;
    if (!target.classList.contains("pick")) return;
    const id = target.dataset.id;
    if (!id) return;
    if (target.checked) selected.add(id);
    else selected.delete(id);
  });

  document.getElementById("rows").addEventListener("click", async (event) => {
    const target = event.target;
    if (!target.classList.contains("single-del")) return;
    const id = target.dataset.id;
    if (!id) return;
    focusEvent(id);
    if (!window.confirm(`Delete event ${id}?`)) return;
    try {
      await deleteOne(id);
      setStatus(`Deleted ${id}`);
      await loadEvents();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("rows").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.classList.contains("single-edit")) return;
    const id = target.dataset.id;
    if (!id) return;
    focusEvent(id);
    const item = findEvent(id);
    if (!item) return;
    openEditor(item);
  });

  document.getElementById("rows").addEventListener("click", async (event) => {
    const target = event.target;
    if (!target.classList.contains("single-preview-mock")) return;
    const id = target.dataset.id;
    if (!id) return;
    focusEvent(id);
    try {
      await previewMockWhatsapp(id);
      setStatus("Mock WhatsApp preview loaded");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("refresh").addEventListener("click", async () => {
    try {
      await loadEvents();
      setStatus("Refreshed");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("select-all").addEventListener("click", () => {
    events.forEach((event) => selected.add(event.id));
    render();
  });

  document.getElementById("clear-selection").addEventListener("click", () => {
    selected.clear();
    render();
  });

  document.getElementById("delete-selected").addEventListener("click", async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      setStatus("No selected events", true);
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected event(s)?`)) return;
    try {
      await deleteBatch(ids);
      selected.clear();
      setStatus(`Deleted ${ids.length} event(s)`);
      await loadEvents();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("save-edit").addEventListener("click", async () => {
    try {
      await saveEditor();
      await loadEvents();
      focusEvent(editingId);
      closeEditor();
      setStatus("Event updated");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("cancel-edit").addEventListener("click", () => {
    closeEditor();
  });

  document.getElementById("mock-links").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (!target.classList.contains("mock-link-btn")) {
      return;
    }
    const rawLink = decodeURIComponent(target.dataset.link || "");
    const command = commandFromClickToChat(rawLink);
    const input = document.getElementById("mock-command-input");
    if (input) {
      input.value = command;
      setMockCommandResult("Command populated from mock link");
    }
  });

  const sendBtn = document.getElementById("mock-command-send");
  if (sendBtn && mockUiEnabled) {
    sendBtn.addEventListener("click", async () => {
      try {
        const result = await sendMockCommand();
        const suffix = result?.event?.id ? ` (${result.event.id})` : "";
        setMockCommandResult(`Mock command sent successfully${suffix}`);
        setMockCommandResponse(result);
        await loadEvents();
      } catch (error) {
        setMockCommandResult(error.message, true);
        setMockCommandResponse({ error: error.message });
      }
    });
  }

  const roleSelect = document.getElementById("mock-sender-role");
  if (roleSelect && mockUiEnabled) {
    roleSelect.addEventListener("change", () => {
      renderMockSenderInfo();
    });
  }
}

async function init() {
  bind();
  try {
    await loadEvents();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
