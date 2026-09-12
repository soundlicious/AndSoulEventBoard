import { SESSION_TYPES } from "./calendar-model.js";

export function momenceUrl(input, now = new Date()) {
  const hostId = input.get("hostId") || "47026";
  if (!/^\d+$/.test(hostId)) throw new Error("Invalid hostId");
  const upstream = new URL(`https://readonly-api.momence.com/host-plugins/host/${hostId}/host-schedule/sessions`);
  const types = input.getAll("sessionTypes[]");
  (types.length ? types : SESSION_TYPES).forEach((type) => upstream.searchParams.append("sessionTypes[]", type));
  upstream.searchParams.set("fromDate", input.get("fromDate") || now.toISOString());
  upstream.searchParams.set("pageSize", input.get("pageSize") || "50");
  upstream.searchParams.set("page", input.get("page") || "0");
  return upstream;
}

export async function proxySessions(input, res, fetchImpl = fetch) {
  let upstream;
  try {
    upstream = momenceUrl(input);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_host" }));
    return;
  }
  try {
    const response = await fetchImpl(upstream, {
      headers: { accept: "application/json", "user-agent": "cheshire-schedule-proxy" },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=1800"
    });
    res.end(body);
  } catch {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_failed" }));
  }
}
