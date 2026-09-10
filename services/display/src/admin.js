const API_URL = "/api";

let events = [];
let selected = new Set();
let editingId = "";

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
    const item = findEvent(id);
    if (!item) return;
    openEditor(item);
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
      closeEditor();
      setStatus("Event updated");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("cancel-edit").addEventListener("click", () => {
    closeEditor();
  });
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
