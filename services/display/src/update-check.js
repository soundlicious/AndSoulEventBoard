// Only the unattended kiosk pages import this; never reload an admin/edit form.
export function createUpdateCheck({ version, fetchImpl = fetch, reload = () => location.reload() }) {
  let candidate = "";
  let busy = false;
  let reloading = false;
  return async () => {
    if (!version || busy || reloading) return;
    busy = true;
    try {
      const response = await fetchImpl("/version", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Version unavailable");
      const next = await response.json();
      if (!next.ready || typeof next.version !== "string" || !next.version || next.version === version) {
        candidate = "";
      } else if (candidate === next.version) {
        reloading = true;
        reload();
      } else {
        candidate = next.version;
      }
    } catch {
      // Keep the current screen during restarts/outages. Require two fresh checks.
      candidate = "";
    } finally {
      busy = false;
    }
  };
}
