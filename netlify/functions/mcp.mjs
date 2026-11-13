// AgentCheck MCP server (streamable HTTP, stateless, JSON responses, CORS open).
// Tools: check_site, explain_rule, cors_fix, agentify_starter. Any agent network can list
// {"url": "https://agentcheck.netlify.app/mcp", "tools": ["check_site"]} in its tools.
import { RULES, SPEC_URL, VERSION } from "../../site/lib/checker.js";
import { corsFix, HOSTS } from "../../site/lib/fixes.js";
import { CORS, json, runCheck } from "./_shared.mjs";
import { generate } from "../../site/lib/starter.js";

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "check_site",
    title: "Check an open agentic website",
    description: "Check a website against the Worldwide Agentic Web MVP spec. Reads its public agent-manifest.json, network definition, links.json and headers like a calling browser, and returns the verdict (passes, passes-with-warnings, fails, not-found) with each problem, its spec section and the fix. Use before linking a partner network.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Site URL, network URL (site base + network name) or manifest URL." },
        caller_origin: { type: "string", description: "Optional. Your site's origin, to check CORS for it specifically." },
      },
      required: ["url"],
    },
  },
  {
    name: "explain_rule",
    title: "Explain an AgentCheck rule",
    description: "Return one rule's spec section, MUST/SHOULD level, why it matters and the standard fix.",
    inputSchema: { type: "object", properties: { rule_id: { type: "string", enum: Object.keys(RULES) } }, required: ["rule_id"] },
  },
  {
    name: "cors_fix",
    title: "CORS fix for a host",
    description: "Return the exact config that lets other agent sites read a site's agent files, for one hosting provider.",
    inputSchema: { type: "object", properties: { host: { type: "string", enum: HOSTS }, folder: { type: "string", description: "Folder holding agent-manifest.json. Default /." } }, required: ["host"] },
  },
  {
    name: "agentify_starter",
    title: "Generate open agentic website files",
    description: "Generate the files that make a website an open agentic website under the MVP spec: agent-manifest.json, a two-agent network (front desk + facts agent) as JSON and HOCON, links.json, a CORS rule for the host and a chat page. The reference runtime folder is not included; copy it from https://agentcheck.netlify.app/start or the challenge repo.",
    inputSchema: {
      type: "object",
      properties: {
        site_name: { type: "string" },
        site_url: { type: "string", description: "Public https URL of the folder the files will be uploaded to." },
        purpose: { type: "string", description: "One sentence: what the assistant helps visitors with." },
        facts: { type: "string", description: "The facts the assistant may answer from (hours, prices, services, FAQs)." },
        host: { type: "string", enum: HOSTS },
        contact: { type: "string", description: "Optional link or phone for what the assistant cannot do." },
        sample_queries: { type: "array", items: { type: "string" } },
        partners: { type: "array", items: { type: "string" }, description: "Optional partner network URLs." },
      },
      required: ["site_name", "site_url", "purpose", "facts"],
    },
  },
];

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }
function text(obj, isError = false) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }], isError };
}

async function callTool(name, args = {}) {
  if (name === "check_site") {
    if (!args.url) return text("Give a url.", true);
    const r = await runCheck(args.url, { origin: args.caller_origin });
    return text(r, r.ok === false);
  }
  if (name === "explain_rule") {
    const r = RULES[args.rule_id];
    return r ? text({ rule: args.rule_id, ...r, spec_url: SPEC_URL }) : text(`No rule ${args.rule_id}.`, true);
  }
  if (name === "cors_fix") {
    const f = corsFix(args.host, args.folder);
    return text(f, Boolean(f.error));
  }
  if (name === "agentify_starter") {
    const r = generate({
      siteName: args.site_name, siteUrl: args.site_url, purpose: args.purpose, facts: args.facts, host: args.host,
      contact: args.contact, samples: (args.sample_queries || []).join("\n"), partners: (args.partners || []).join("\n"),
    });
    if (!r.ok) return text({ ok: false, errors: r.errors }, true);
    return text({ ok: true, network_url: r.networkUrl, upload_to: r.folderUrl, files: r.files, runtime: "Copy the runtime/ folder from the zip at https://agentcheck.netlify.app/start, then check the live site with check_site." });
  }
  return null;
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNotification = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: msg.params?.protocolVersion === "2025-03-26" ? "2025-03-26" : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "agentcheck", title: "AgentCheck", version: VERSION },
        instructions: "Check open agentic websites against the Worldwide Agentic Web MVP spec before you link them.",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS });
    case "tools/call": {
      try {
        const out = await callTool(msg.params?.name, msg.params?.arguments || {});
        if (!out) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
        return rpcResult(msg.id, out);
      } catch (error) {
        return rpcResult(msg.id, text(`The check stopped: ${error.message}`, true));
      }
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") {
    return json({ name: "AgentCheck MCP", transport: "streamable-http (POST JSON-RPC)", tools: TOOLS.map((t) => t.name), docs: "https://github.com/pratikpoddar/agentcheck#mcp" });
  }
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(rpcError(null, -32600, "Use POST"), 405);
  let body;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handle(body);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
};

export const config = { path: "/mcp" };
