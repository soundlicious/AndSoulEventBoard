const API_URL = window.__DISPLAY_CONFIG__.apiUrl;

let events = [];
let selected = new Set();

function internalToken() {
  const value = localStorage.getItem("admin_internal_token") || "";
  return value.trim();
}

function apiHeaders() {
  const headers = { "content-type": "application/json" };
  const token = internalToken();
  if (token) {
    headers["x-internal-token"] = token;
  }
  return headers;
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function fmtDate(item) {
  return `${item.date || "-"} ${item.time || "-"}`;
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
  const res = await fetch(`${API_URL}/events/${id}`, {
    method: "DELETE",
    headers: apiHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed (${res.status})`);
  }
}

async function deleteBatch(ids) {
  const res = await fetch(`${API_URL}/events/batch-delete`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ ids })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Batch delete failed (${res.status})`);
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

  document.getElementById("save-token").addEventListener("click", () => {
    const value = document.getElementById("token").value.trim();
    localStorage.setItem("admin_internal_token", value);
    setStatus("Token saved in browser storage");
  });
}

async function init() {
  const tokenInput = document.getElementById("token");
  tokenInput.value = internalToken();
  bind();
  try {
    await loadEvents();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
