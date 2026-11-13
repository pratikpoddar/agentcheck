// GET /api/check?url=<site, network or manifest URL>[&origin=<caller origin>][&full=1]
// Server-side probe: reads the response headers a browser hides, so AgentCheck can tell
// a CORS block from a missing file.
import { CORS, json, runCheck } from "./_shared.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  if (!url) return json({ ok: false, reason: "Add ?url=<site, network or manifest URL>." }, 400);
  try {
    const result = await runCheck(url, { origin: params.get("origin"), full: params.get("full") === "1" });
    return json(result, result.ok === false ? 400 : 200);
  } catch (error) {
    return json({ ok: false, reason: `The check stopped: ${error.message}` }, 500);
  }
};

export const config = { path: "/api/check" };
