// GET /directory.json: AgentCheck's directory, each site re-checked by the server probe.
// Netlify's CDN caches the result for six hours, so each site is checked a few times a day.
import { SPEC_VERSION } from "../../site/lib/checker.js";
import { SEEDS } from "../../site/lib/seeds.js";
import { CORS, runCheck } from "./_shared.mjs";

export default async () => {
  const results = await Promise.all(SEEDS.map(async (s) => {
    try {
      const r = await runCheck(s.network_url || s.url);
      return { ...s, verdict: r.verdict || "not-found", fail: r.counts?.fail ?? 0, warn: r.counts?.warn ?? 0, pass: r.counts?.pass ?? 0,
        description: r.networks?.[0]?.description || "", problems: (r.problems || []).map((p) => p.rule), checked_at: r.checked_at };
    } catch (error) {
      return { ...s, verdict: "not-found", fail: 0, warn: 0, pass: 0, description: "", problems: [], error: error.message, checked_at: new Date().toISOString() };
    }
  }));
  const order = { passes: 0, "passes-with-warnings": 1, fails: 2, "not-found": 3 };
  results.sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9) || a.name.localeCompare(b.name));
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), spec: SPEC_VERSION, sites: results }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=21600, stale-while-revalidate=86400",
      ...CORS,
    },
  });
};

export const config = { path: "/directory.json" };
