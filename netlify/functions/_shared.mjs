// Shared helpers for AgentCheck's server-side probe and MCP endpoint.
import { checkSite, compact } from "../../site/lib/checker.js";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Refuse URLs a public probe must not fetch (loopback, private ranges, other schemes). */
export function publicUrl(input) {
  let url;
  try { url = new URL(String(input || "").trim()); } catch {
    try { url = new URL(`https://${String(input || "").trim()}`); } catch { return { error: "That is not a URL." }; }
  }
  if (!["http:", "https:"].includes(url.protocol)) return { error: "Only http and https URLs can be checked." };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")
    || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || PRIVATE.some((re) => re.test(host))
    || /^\d+$/.test(host)) {
    return { error: "The public probe only checks public sites. Use the CLI (npx github:pratikpoddar/agentcheck) for localhost." };
  }
  return { url: url.href };
}

export async function runCheck(input, { origin, full = false } = {}) {
  const safe = publicUrl(input);
  if (safe.error) return { ok: false, reason: safe.error };
  const guardedFetch = async (u, init) => {
    const g = publicUrl(u);
    if (g.error) throw new Error(g.error);
    return fetch(u, init);
  };
  const report = await checkSite(safe.url, { mode: "server", origin: origin || undefined, fetchImpl: guardedFetch, checkPage: true });
  return full ? report : compact(report);
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });
}
