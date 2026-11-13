// GET /badge?url=<site, network or manifest URL>[&label=...]
// A live SVG badge with the site's AgentCheck verdict. Cached at the CDN for an hour.
import { CORS, runCheck } from "./_shared.mjs";
import { badgeState, badgeSvg } from "../../site/lib/badge.js";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  const label = (params.get("label") || "agentic web").slice(0, 30);
  let state;
  if (!url) state = { message: "add ?url=", color: "#6b7280" };
  else {
    try {
      const report = await Promise.race([
        runCheck(url),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "timeout" }), 9000)),
      ]);
      state = badgeState(report);
    } catch {
      state = badgeState(null);
    }
  }
  return new Response(badgeSvg({ label, ...state }), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};

export const config = { path: "/badge" };
