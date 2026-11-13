// AgentCheck rule catalogue.
//
// Each rule maps to a section of the Minimum Viable Specification for a Worldwide
// Agentic Web (MVP Profile 0.2, 6 November 2026):
// https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md
//
// level: "must" rules decide conformance. "should" rules are best practice that the spec
// recommends or that the reference runtime needs to work well. "info" rules report facts.

export const SPEC_VERSION = "MVP Profile 0.2 (6 Nov 2026)";
export const SPEC_URL = "https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md";

export const RULES = {
  // --- Publication: the manifest (spec 3.2, 3.3) ---
  "manifest.found": {
    level: "must", section: "3.3",
    title: "Publishes agent-manifest.json",
    why: "Callers locate a network by fetching agent-manifest.json from the site base, with no central registry.",
    fix: "Publish agent-manifest.json in the folder that holds your network, and pass AgentCheck that folder or the network URL (folder + network name).",
  },
  "manifest.json": {
    level: "must", section: "3.3",
    title: "Manifest is a JSON object",
    why: "Browser runtimes parse the manifest with JSON.parse.",
    fix: "Make agent-manifest.json a single JSON object. Validate it with any JSON linter.",
  },
  "manifest.cors": {
    level: "must", section: "3.3, 3.4",
    title: "Manifest is readable from other origins (CORS)",
    why: "Other agent sites fetch your manifest from their visitor's browser. Without Access-Control-Allow-Origin the browser blocks it with \"Failed to fetch\".",
    fix: "Serve agent-manifest.json with the header Access-Control-Allow-Origin: * (Netlify _headers, Vercel headers, an .htaccess Header set line, or your CDN's response headers).",
  },
  "manifest.https": {
    level: "must", section: "3.2, 3.3",
    title: "Served over HTTPS",
    why: "HTTPS is required for production agent sites; plain http is only allowed on localhost.",
    fix: "Serve the site over HTTPS. Every static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) gives you a certificate for free.",
  },
  "manifest.networks": {
    level: "must", section: "3.3",
    title: "Lists at least one network with name, front_man and hocon",
    why: "Each network entry tells a caller the network's exact name, its public entry agent and where its definition lives.",
    fix: "Add a networks array whose entries each have \"name\", \"front_man\" and \"hocon\" (path to the resolved .network.json).",
  },
  "manifest.network_match": {
    level: "must", section: "3.2",
    title: "Network name in the URL matches a manifest entry exactly",
    why: "A runtime must fail rather than pick another network when the requested name is not listed.",
    fix: "Use the network URL <site base>/<network name>, where the name is exactly the \"name\" of a manifest entry.",
  },
  "manifest.router": {
    level: "must", section: "3.3, 4",
    title: "Declares top-site LLM router metadata",
    why: "The manifest publishes the site's default router (and BYOK router) so the runtime knows where model calls go.",
    fix: "Add \"llm_router\": {\"base_url\": \"https://api.otari.ai/api/v1\", \"byok_router\": \"https://api.otari.ai/api/v1\", \"mock\": false} (or your provider).",
  },
  "manifest.router_https": {
    level: "should", section: "4",
    title: "Router URL uses HTTPS and is not a mock",
    why: "Visitors' keys are attached to router requests, so the router must be HTTPS; a mock router means the site cannot really run.",
    fix: "Point llm_router.base_url and byok_router at an HTTPS OpenAI-compatible router that allows browser CORS, and set \"mock\": false.",
  },
  "manifest.peer_policy": {
    level: "must", section: "3.3",
    title: "Declares a peer policy",
    why: "Peer-policy metadata states which peer origins may be contacted. The reference runtime refuses all peers unless they are allowed.",
    fix: "Add \"peer_policy\": {\"mode\": \"closed\"} plus \"allowed_peers\": [\"https://partner.example\"], or \"mode\": \"open\" if any public agent site may be called (each call still asks the visitor).",
  },
  "manifest.deployment": {
    level: "should", section: "3.3",
    title: "Declares static deployment metadata",
    why: "Deployment metadata tells callers the site runs fully in the browser with no server-side agent runtime.",
    fix: "Add \"deployment\": {\"mode\": \"static\", \"self_contained_runtime\": true, \"direct_byok\": true}.",
  },
  "manifest.secrets": {
    level: "must", section: "2.2, 4",
    title: "No credentials in published files",
    why: "Everything you publish is public. A key in a manifest or network is leaked to every visitor and crawler.",
    fix: "Remove the key, rotate it at the provider, and let visitors bring their own key (BYOK) or proxy calls through a server you control.",
  },

  // --- The network definition (spec 2.1, 2.2, 3.1) ---
  "network.fetch": {
    level: "must", section: "3.3",
    title: "Network definition is published and loads",
    why: "The manifest's hocon value must resolve to a public network definition a browser can GET.",
    fix: "Make sure the manifest's \"hocon\" path is correct relative to the manifest and the file is deployed.",
  },
  "network.cors": {
    level: "must", section: "3.3, 3.4",
    title: "Network definition is readable from other origins (CORS)",
    why: "Callers fetch the network definition from their visitor's browser after reading your manifest.",
    fix: "Serve the .network.json with Access-Control-Allow-Origin: *.",
  },
  "network.parse": {
    level: "must", section: "2, 3.1",
    title: "Network definition parses as JSON/HOCON",
    why: "The runtime must reject malformed networks before any model call.",
    fix: "Publish the resolved network as JSON (for example with build_network.mjs from the agentify-website skill).",
  },
  "network.json": {
    level: "should", section: "3.3",
    title: "Network definition is serialized as JSON",
    why: "The spec says the browser-loaded definition is the resolved document serialized as JSON. HOCON-only syntax may not load in other runtimes.",
    fix: "Publish <network>.network.json generated from your .hocon source, and point the manifest's \"hocon\" field at it.",
  },
  "network.data_only": {
    level: "must", section: "2, 2.2",
    title: "Data-only: no includes, substitutions or local paths",
    why: "The published form must not depend on local includes, environment substitutions or publisher-only file paths.",
    fix: "Resolve include directives and ${...} substitutions at build time and remove file:// or absolute local paths.",
  },
  "network.validates": {
    level: "must", section: "3.1",
    title: "Passes the reference runtime's validator",
    why: "Runtimes reject duplicate or missing agent references and an invalid front agent before any model call.",
    fix: "Fix each validator message. Every name in a tools list must be an agent in the network, a full peer-network URL, an MCP descriptor, or a declared link slot.",
  },
  "network.front_agent": {
    level: "must", section: "2.1, 3.3",
    title: "Front agent exists and matches the manifest",
    why: "The manifest's front_man is the network's public entry point.",
    fix: "Set the manifest's \"front_man\" to the name of the agent that no other agent calls (the entry agent) in the network.",
  },
  "network.description": {
    level: "must", section: "2.1",
    title: "Network has a short description",
    why: "Identity and metadata: a stable name, a short description and the front agent.",
    fix: "Add \"metadata\": {\"description\": \"One sentence on what this network does.\"} to the network.",
  },
  "network.agents": {
    level: "must", section: "2.1",
    title: "Every agent has a name, a function description, instructions and a tools list",
    why: "Callers decide when to use an agent from its function description; LLM agents need instructions.",
    fix: "Give each agent \"function\": {\"description\": ...}, \"instructions\" (for LLM agents) and a \"tools\" array (empty if it calls nothing).",
  },
  "network.schemas": {
    level: "should", section: "2.1",
    title: "Callable agents expose JSON Schema inputs",
    why: "Callable agents and tools expose JSON Schema-compatible inputs, so other networks can call them correctly.",
    fix: "Add \"function\": {\"parameters\": {\"type\": \"object\", \"properties\": {\"request\": {\"type\": \"string\"}}, \"required\": [\"request\"]}} to each agent.",
  },
  "network.model_hint": {
    level: "should", section: "2.1",
    title: "Declares a model hint",
    why: "Without a model, the reference runtime sends its placeholder model to the visitor's provider and the call fails.",
    fix: "Add \"llm_config\": {\"model_name\": \"alibaba/qwen-3.5-35b-a3b\"} (or a model your default router serves) at the top of the network.",
  },
  "network.multi_agent": {
    level: "should", section: "6",
    title: "Has at least two agents",
    why: "The interoperability checks start with publishing a two-agent network.",
    fix: "Split a distinct job (a specialist) out of the front agent and delegate to it.",
  },
  "network.limits": {
    level: "should", section: "3.1",
    title: "Declares finite execution limits",
    why: "Runtimes enforce finite limits; limits should be configurable per network.",
    fix: "Add \"max_steps\": 12 (and optionally \"max_execution_seconds\") at the top of the network.",
  },
  "network.peer_rule": {
    level: "should", section: "3.2",
    title: "Front agent knows how to answer other sites",
    why: "When another site runs your network it has none of your website_* tools. Without a peer rule, the agent may only report a missing integration.",
    fix: "Add a peer rule to the front agent's instructions, such as the {peer_rules} text in the agentify-website template: \"When you have no website_* tools, another site's assistant is asking...\".",
  },
  "network.private_context": {
    level: "info", section: "2.1, 5",
    title: "Private context (sly_data) rules",
    why: "Private data is deny-by-default across sites; any field that passes must be named explicitly.",
    fix: "Only add allow rules for sly_data fields that truly must cross to a tool or peer.",
  },

  // --- External capabilities and peers (spec 2.1, 3.2, 5) ---
  "peers.https": {
    level: "must", section: "3.2",
    title: "Peer networks and MCP servers use HTTPS",
    why: "Peer network URLs must be HTTPS except during local development.",
    fix: "Replace http:// and localhost peer URLs with the partner's public HTTPS network URL before you deploy.",
  },
  "peers.allowed": {
    level: "must", section: "3.2, 5",
    title: "Every peer origin the network calls is allowed by the peer policy",
    why: "With a closed policy, the runtime refuses any origin not in allowed_peers, so the call fails at runtime.",
    fix: "Add each partner's origin to allowed_peers in agent-manifest.json.",
  },
  "peers.url_form": {
    level: "must", section: "3.2",
    title: "Peer references are network URLs (site base + network name)",
    why: "A peer network is identified by a URL whose last path component is its network name.",
    fix: "Reference the partner as https://partner.example/<folder>/<network_name>, not the manifest or .json file.",
  },
  "links.valid": {
    level: "should", section: "3.3",
    title: "links.json is valid when published",
    why: "links.json maps symbolic peer names to concrete network URLs; the runtime ignores a broken file.",
    fix: "Publish {\"version\": 1, \"networks\": {\"<network>\": {\"<slot>\": \"https://peer.example/<network>\"}}} with CORS enabled.",
  },

  // --- Being callable by other sites (reference runtime) ---
  "bridge.ok": {
    level: "should", section: "3.2 (reference runtime)",
    title: "Action bridge loads for callers",
    why: "When the manifest declares actions, the reference runtime loads actions.bridge in a hidden frame before running your network for another site. A missing or unframeable bridge stalls every caller.",
    fix: "Publish the bridge/ folder written by build_network.mjs, serve it without X-Frame-Options, and keep frame-ancestors open.",
  },
  "coded.bundle": {
    level: "must", section: "3.3, 5",
    title: "Coded-tool bundle is declared, reachable and self-contained",
    why: "Optional coded tools must be declared in the manifest and run only in an isolated worker; an SRI digest is recommended.",
    fix: "Declare coded_tools.bundle, serve it with CORS, keep it free of imports, and add coded_tools.integrity (sha384-...).",
  },

  // --- The page (spec What / 3, 4) ---
  "page.runtime": {
    level: "info", section: "3",
    title: "Page loads a browser runtime and chat interface",
    why: "An open agentic website has a runtime that runs the network in the browser and an interface for users.",
    fix: "Load the runtime (for example runtime/index.js boot()) on a page and mount the chat.",
  },
  "discovery.wellknown": {
    level: "info", section: "3.3",
    title: "Optional .well-known discovery metadata",
    why: "Optional .well-known/nsdeploy files help tools discover exported networks. Not required.",
    fix: "build_network.mjs writes .well-known/nsdeploy.json and nsdeploy-agent.json for you.",
  },
};

export function rule(id) {
  return RULES[id] || { level: "info", section: "", title: id, why: "", fix: "" };
}
