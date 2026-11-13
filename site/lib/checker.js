// AgentCheck conformance checker.
//
// Runs the same way in a browser (the AgentCheck site), in Node (the CLI and the GitHub
// Action) and in a serverless function (the AgentCheck MCP endpoint). It only reads a
// site's public files, the way a calling browser does, and reports each finding against
// the Worldwide Agentic Web MVP specification with a plain-English fix.
//
// It reuses the reference browser runtime's own HOCON parser and network validator
// (../runtime, copied unchanged from cognizant-ai-labs/agentic-web), so a network that
// passes here is one the reference runtime will load.

import { parseHocon } from "../runtime/hocon.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { RULES, SPEC_URL, SPEC_VERSION, rule } from "./rules.js";

export const VERSION = "0.1.0";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_NETWORKS = 5;
const MAX_REDIRECTS = 5;
const PEER_RULE = "When you have no website_* tools";
const TIMEOUT_MS = 12000;

const SECRET_PATTERNS = [
  { name: "an OpenAI-style secret key", re: /\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "a GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "an AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a bearer token", re: /Bearer\s+[A-Za-z0-9._~+/-]{24,}/ },
  { name: "an api_key value", re: /"(?:api_?key|apiKey|secret|access_token|password)"\s*:\s*"(?!demo"|"|<|\$\{|YOUR|your|TODO)[^"\s]{12,}"/ },
];

/**
 * Build a finding object from a rule id.
 */
function finding(id, status, detail, extra = {}) {
  const r = rule(id);
  return { id, status, level: r.level, section: r.section, title: r.title, detail, why: r.why, fix: r.fix, ...extra };
}

/**
 * The status a failed rule gets: "fail" for a MUST rule, "warn" otherwise.
 */
function failStatus(id) {
  return rule(id).level === "must" ? "fail" : "warn";
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function isLoopback(url) {
  try { return LOOPBACK.has(new URL(url).hostname); } catch { return false; }
}

function resolve(base, path) {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
}

/**
 * Wraps fetch so the checker sees what a calling browser would.
 *
 * mode "browser": a real browser enforces CORS, so a blocked read throws. AgentCheck
 * cannot tell a CORS block from a network failure there, and reports it as such.
 * mode "server": Node and serverless fetch ignore CORS, so every request sends an Origin
 * header and the checker reads Access-Control-Allow-Origin itself.
 */
export class Prober {
  constructor({ fetchImpl, mode = "server", origin = "https://agentcheck-caller.example" } = {}) {
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.mode = mode;
    this.origin = origin;
    this.log = [];
  }

  async get(url) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
      let response;
      try {
        const init = { signal: controller?.signal, credentials: "omit", cache: "no-store" };
        if (this.mode === "server") {
          init.headers = { Origin: this.origin, "User-Agent": `AgentCheck/${VERSION} (+https://github.com/pratikpoddar/agentcheck)` };
          init.redirect = "manual";
        }
        response = await this.fetch(current, init);
      } catch (error) {
        if (timer) clearTimeout(timer);
        const timedOut = error?.name === "AbortError";
        this.log.push({ url: current, error: timedOut ? "timeout" : String(error?.message || error) });
        return {
          ok: false, url: current, status: 0, networkError: true, timedOut,
          // In a browser, a CORS block and an unreachable host look the same.
          maybeCors: this.mode === "browser" && !timedOut,
          error: timedOut ? `no answer within ${TIMEOUT_MS / 1000} s` : String(error?.message || error),
        };
      }
      if (timer) clearTimeout(timer);
      const location = response.headers.get("location");
      if (this.mode === "server" && response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).href;
        this.log.push({ url: current, status: response.status, redirect: next });
        if (originOf(next) !== originOf(current)) {
          return { ok: false, url: current, status: response.status, crossOriginRedirect: next };
        }
        current = next;
        continue;
      }
      let text = "";
      try { text = await response.text(); } catch { text = ""; }
      const headers = {
        acao: response.headers.get("access-control-allow-origin"),
        contentType: response.headers.get("content-type") || "",
        xfo: response.headers.get("x-frame-options"),
        csp: response.headers.get("content-security-policy"),
      };
      this.log.push({ url: current, status: response.status });
      return { ok: response.status === 200, url: response.url || current, status: response.status, text, headers };
    }
    return { ok: false, url, status: 0, tooManyRedirects: true };
  }

  /**
   * Whether a cross-origin browser caller could read this file.
   * Returns { ok: true|false|null, detail }. null means unknown.
   */
  cors(file) {
    if (this.mode === "browser") {
      // The browser let this page read the file, so its CORS policy allows this origin.
      const sameOrigin = typeof location !== "undefined" && originOf(file.url) === location.origin;
      if (sameOrigin) return { ok: null, detail: "Same origin as AgentCheck, so CORS was not exercised." };
      return { ok: true, detail: "Your browser read it from another origin, so CORS allows cross-origin callers." };
    }
    const allowed = file.headers?.acao;
    if (allowed === null || allowed === undefined) {
      return { ok: false, detail: "No Access-Control-Allow-Origin header, so a browser on another site gets \"Failed to fetch\"." };
    }
    if (allowed.trim() === "*" ) return { ok: true, detail: "Access-Control-Allow-Origin: *" };
    if (allowed.trim() === this.origin) return { ok: true, detail: `Access-Control-Allow-Origin: ${allowed} (allows the checking origin only)` };
    return { ok: false, detail: `Access-Control-Allow-Origin is "${allowed}", which does not allow other sites.` };
  }
}

/**
 * Work out where the manifest might be from what the user pasted.
 *
 * Accepts a site URL, a network URL (site base + network name), a manifest URL or a
 * network-definition URL.
 */
export function candidates(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    try { url = new URL(`https://${input.trim()}`); } catch { return { error: "That is not a URL." }; }
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname;
  const last = path.split("/").filter(Boolean).pop() || "";
  const list = [];
  if (/agent-manifest\.json$/i.test(path)) {
    list.push({ manifest: url.href, networkName: null, networkFile: null });
  } else if (/\.json$/i.test(path)) {
    list.push({ manifest: new URL("./agent-manifest.json", url).href, networkName: null, networkFile: url.href });
  } else {
    if (last && !path.endsWith("/") && !last.includes(".")) {
      // A network URL: the folder before the last segment holds the manifest.
      list.push({ manifest: new URL("./agent-manifest.json", url).href, networkName: last, networkFile: null });
    }
    const asFolder = path.endsWith("/") ? url.href : `${url.href}/`;
    list.push({ manifest: new URL("agent-manifest.json", asFolder).href, networkName: null, networkFile: null });
    if (path !== "/") list.push({ manifest: `${url.origin}/agent-manifest.json`, networkName: null, networkFile: null });
  }
  // De-duplicate.
  const seen = new Set();
  return { url: url.href, list: list.filter((c) => (seen.has(c.manifest) ? false : seen.add(c.manifest))) };
}

function scanSecrets(text) {
  for (const p of SECRET_PATTERNS) {
    const m = text.match(p.re);
    if (m) return `${p.name} (starts "${m[0].slice(0, 8)}…")`;
  }
  return null;
}

function dataOnlyProblems(text) {
  const problems = [];
  if (/^\s*include\s+(required\s*\()?\s*(file|url|classpath)?\s*\(?\s*"/m.test(text)) problems.push("an include directive");
  if (/\$\{\??[A-Za-z_][^}]*\}/.test(text)) problems.push("a ${...} substitution");
  if (/file:\/\//i.test(text)) problems.push("a file:// path");
  if (/"(\/(Users|home|var|etc|opt|tmp)\/[^"]+)"/.test(text) || /"[A-Za-z]:\\\\[^"]+"/.test(text)) problems.push("a local file path");
  return problems;
}

function manifestAllows(manifest, target) {
  const policy = manifest?.peer_policy || manifest?.web_policy;
  const origin = originOf(target);
  if (!origin) return false;
  if (policy?.mode === "open") {
    const denied = (policy.deny_origins || policy.denied_origins || []).map(originOf);
    return !denied.includes(origin);
  }
  return (manifest?.allowed_peers || []).map(originOf).includes(origin);
}

/**
 * Check one network listed in a manifest.
 */
async function checkNetwork(prober, manifest, entry, siteBase, opts) {
  const out = [];
  const name = entry.name;
  const networkUrl = `${siteBase.replace(/\/$/, "")}/${name}`;

  if (typeof entry.hocon !== "string" || !entry.hocon) {
    out.push(finding("network.fetch", "fail", `The manifest entry for "${name}" has no "hocon" path.`));
    return { name, url: networkUrl, findings: out };
  }
  const defUrl = resolve(siteBase, entry.hocon);
  const file = await prober.get(defUrl);
  if (!file.ok) {
    const why = file.networkError
      ? (file.maybeCors ? `Your browser could not read ${defUrl}: it is unreachable or blocked by CORS.` : `Could not reach ${defUrl}: ${file.error}.`)
      : file.crossOriginRedirect ? `${defUrl} redirects to another origin (${file.crossOriginRedirect}).`
      : `${defUrl} answered HTTP ${file.status}, not 200.`;
    out.push(finding(file.maybeCors ? "network.cors" : "network.fetch", "fail", why, { url: defUrl }));
    return { name, url: networkUrl, definitionUrl: defUrl, findings: out };
  }
  out.push(finding("network.fetch", "pass", `Loaded ${defUrl} (${file.text.length.toLocaleString("en-US")} bytes).`, { url: defUrl }));
  const cors = prober.cors(file);
  if (cors.ok === false) out.push(finding("network.cors", "fail", cors.detail, { url: defUrl }));
  else if (cors.ok === true) out.push(finding("network.cors", "pass", cors.detail, { url: defUrl }));

  // Data-only and secrets, on the raw text.
  const problems = dataOnlyProblems(file.text);
  out.push(problems.length
    ? finding("network.data_only", "fail", `The published definition contains ${problems.join(", ")}.`)
    : finding("network.data_only", "pass", "No includes, substitutions or local paths."));
  const secret = scanSecrets(file.text);
  if (secret) out.push(finding("manifest.secrets", "fail", `The network definition appears to contain ${secret}.`));

  let isJson = true;
  let config;
  try {
    config = JSON.parse(file.text);
  } catch {
    isJson = false;
    try {
      config = parseHocon(file.text);
    } catch (error) {
      out.push(finding("network.parse", "fail", `It does not parse: ${error.message}`));
      return { name, url: networkUrl, definitionUrl: defUrl, findings: out };
    }
  }
  if (!isObject(config)) {
    out.push(finding("network.parse", "fail", "The definition is not an object."));
    return { name, url: networkUrl, definitionUrl: defUrl, findings: out };
  }
  out.push(finding("network.parse", "pass", isJson ? "Valid JSON." : "Parsed as HOCON."));
  out.push(isJson
    ? finding("network.json", "pass", "Serialized as JSON for browser loading.")
    : finding("network.json", "warn", "Published as HOCON text rather than JSON. The reference runtime reads it, other runtimes may not."));

  let network;
  try {
    network = new AgentNetwork(config, name);
  } catch (error) {
    out.push(finding("network.validates", "fail", `The reference runtime cannot load it: ${error.message}`));
    return { name, url: networkUrl, definitionUrl: defUrl, findings: out };
  }
  let validation = { errors: [], externals: [], mcps: [] };
  try {
    validation = validateNetwork(network);
  } catch (error) {
    validation.errors = [error.message];
  }
  out.push(validation.errors.length
    ? finding("network.validates", "fail", validation.errors.slice(0, 6).join(" "), { messages: validation.errors })
    : finding("network.validates", "pass", "The reference runtime's validator accepts it."));

  const agents = (Array.isArray(network.config.tools) ? network.config.tools : []).filter(isObject);

  // Front agent.
  let derived = null;
  try { derived = network.findFrontMan(); } catch { derived = null; }
  const declared = entry.front_man;
  const declaredExists = agents.some((a) => a.name === declared);
  if (!declared) out.push(finding("network.front_agent", "fail", `The manifest entry for "${name}" has no front_man.`));
  else if (!declaredExists) out.push(finding("network.front_agent", "fail", `front_man "${declared}" is not an agent in the network.`));
  else if (derived && derived !== declared) out.push(finding("network.front_agent", "warn", `The manifest says "${declared}" but the runtime picks "${derived}" as the front agent.`));
  else out.push(finding("network.front_agent", "pass", `Front agent "${declared}".`));

  // Description.
  const desc = network.config.metadata?.description;
  out.push(typeof desc === "string" && desc.trim()
    ? finding("network.description", "pass", `"${desc.trim().slice(0, 140)}"`)
    : finding("network.description", "fail", "No metadata.description in the network."));

  // Agents.
  const llmAgents = agents.filter((a) => !a.class && !a.toolbox);
  const missing = [];
  const noTools = [];
  const noSchema = [];
  for (const a of agents) {
    const lacks = [];
    if (!a.function?.description) lacks.push("function.description");
    if (!a.class && !a.toolbox && !(typeof a.instructions === "string" && a.instructions.trim())) lacks.push("instructions");
    if (lacks.length) missing.push(`${a.name || "(unnamed)"}: ${lacks.join(", ")}`);
    if (!a.class && !a.toolbox && !Array.isArray(a.tools)) noTools.push(a.name);
    if (!isObject(a.function?.parameters)) noSchema.push(a.name);
  }
  if (missing.length) out.push(finding("network.agents", "fail", `Missing: ${missing.slice(0, 6).join("; ")}.`));
  else if (noTools.length) out.push(finding("network.agents", "warn", `No tools list on: ${noTools.slice(0, 6).join(", ")}. Use [] to declare none.`));
  else out.push(finding("network.agents", "pass", `${agents.length} agent${agents.length === 1 ? "" : "s"}, all described.`));
  out.push(noSchema.length
    ? finding("network.schemas", "warn", `No function.parameters schema on: ${noSchema.slice(0, 6).join(", ")}.`)
    : finding("network.schemas", "pass", "Every agent declares a JSON Schema for its inputs."));
  out.push(agents.length >= 2
    ? finding("network.multi_agent", "pass", `${agents.length} agents.`)
    : finding("network.multi_agent", "info", "One agent. The spec's interoperability demo uses a two-agent network; one front agent with site tools is also fine."));

  // Model hint and limits.
  const hasModel = Boolean(network.config.llm_config?.model_name) || llmAgents.every((a) => a.llm_config?.model_name);
  out.push(hasModel
    ? finding("network.model_hint", "pass", `Model hint: ${network.config.llm_config?.model_name || llmAgents.map((a) => a.llm_config?.model_name).filter(Boolean)[0]}.`)
    : finding("network.model_hint", "warn", "No llm_config.model_name."));
  const hasLimit = Number.isFinite(config.max_steps) || Number.isFinite(config.max_iterations) || Number.isFinite(config.max_execution_seconds)
    || agents.some((a) => Number.isFinite(a.max_steps) || Number.isFinite(a.max_iterations));
  out.push(hasLimit
    ? finding("network.limits", "pass", `max_steps ${config.max_steps ?? "set per agent"}.`)
    : finding("network.limits", "warn", "No max_steps, max_iterations or max_execution_seconds; the runtime falls back to its own default."));

  // Peer rule on the front agent.
  const front = agents.find((a) => a.name === (declaredExists ? declared : derived));
  if (front && typeof front.instructions === "string") {
    const hasRule = front.instructions.includes(PEER_RULE) || /another (site|agent site)'?s? (assistant|agent)/i.test(front.instructions);
    out.push(hasRule
      ? finding("network.peer_rule", "pass", "The front agent tells callers what it can do without site tools.")
      : finding("network.peer_rule", "warn", "No peer rule in the front agent's instructions."));
  }

  // Private context.
  const allows = agents.filter((a) => a.allow?.sly_data || a.allow?.to_downstream || a.allow?.from_upstream).map((a) => a.name);
  out.push(finding("network.private_context", "info", allows.length
    ? `Agents with explicit sly_data allow rules: ${allows.join(", ")}. Check each named field must really cross.`
    : "No sly_data allow rules, so private context stays deny-by-default."));

  // External capabilities.
  const peers = [];
  const mcps = [];
  const slots = [];
  for (const a of agents) {
    for (const ref of Array.isArray(a.tools) ? a.tools : []) {
      let kind = "agent";
      try { kind = network.classifyTool(ref).kind; } catch { kind = "unknown"; }
      if (kind === "remote") peers.push({ agent: a.name, url: String(ref) });
      else if (kind === "mcp") mcps.push({ agent: a.name, url: typeof ref === "string" ? ref : String(ref?.url || "") });
      else if (kind === "link") slots.push({ agent: a.name, slot: ref });
    }
  }
  const external = [...peers, ...mcps];
  if (external.length) {
    const insecure = external.filter((p) => p.url.startsWith("http://") && !isLoopback(p.url));
    const loop = external.filter((p) => isLoopback(p.url));
    if (insecure.length) out.push(finding("peers.https", "fail", `Uses http: ${insecure.map((p) => p.url).join(", ")}.`));
    else if (loop.length) out.push(finding("peers.https", isLoopback(siteBase) ? "warn" : "fail", `Points at a local development host: ${loop.map((p) => p.url).join(", ")}. ${isLoopback(siteBase) ? "Fine while testing; replace it before you deploy." : "It cannot work for visitors."}`));
    else out.push(finding("peers.https", "pass", "All peer and MCP URLs use HTTPS."));

    const refused = external.filter((p) => p.url.startsWith("http") && !manifestAllows(manifest, p.url) && originOf(p.url) !== originOf(siteBase));
    out.push(refused.length
      ? finding("peers.allowed", "fail", `The peer policy refuses: ${[...new Set(refused.map((p) => originOf(p.url)))].join(", ")}.`)
      : finding("peers.allowed", "pass", "Every external origin is allowed by the peer policy."));

    const badForm = peers.filter((p) => /\.json$/i.test(p.url) || p.url.endsWith("/"));
    out.push(badForm.length
      ? finding("peers.url_form", "fail", `Not a network URL: ${badForm.map((p) => p.url).join(", ")}.`)
      : finding("peers.url_form", "pass", peers.length ? `Calls peer networks: ${peers.map((p) => p.url).join(", ")}.` : "No peer networks; MCP only."));
  }

  // Optionally confirm each peer is itself reachable (one level, no recursion).
  const peerResults = [];
  if (opts.followPeers) {
    for (const p of peers.slice(0, 4)) {
      const c = candidates(p.url);
      const m = c.list?.[0] ? await prober.get(c.list[0].manifest) : null;
      peerResults.push({ url: p.url, manifestStatus: m?.status ?? 0, reachable: Boolean(m?.ok) });
    }
  }

  return {
    name, url: networkUrl, definitionUrl: defUrl, frontAgent: declared || derived,
    description: typeof desc === "string" ? desc : "",
    agents: agents.map((a) => ({ name: a.name, description: a.function?.description || "", tools: (Array.isArray(a.tools) ? a.tools : []).map((t) => (typeof t === "string" ? t : t?.url || "mcp")) })),
    peers, mcps, slots, peerResults,
    sampleQueries: entry.sample_queries || network.config.metadata?.sample_queries || [],
    findings: out,
  };
}

/**
 * Check a site. Returns a report object.
 *
 * @param {string} input Site URL, network URL, manifest URL or network-definition URL.
 * @param {object} opts { fetchImpl, mode: "browser"|"server", origin, followPeers, now }
 */
export async function checkSite(input, opts = {}) {
  const prober = new Prober(opts);
  const started = Date.now();
  const report = {
    tool: `AgentCheck ${VERSION}`,
    spec: { version: SPEC_VERSION, url: SPEC_URL },
    input,
    mode: prober.mode,
    checkedAt: new Date(opts.now || Date.now()).toISOString(),
    findings: [],
    networks: [],
  };
  const c = candidates(input);
  if (c.error) {
    report.findings.push(finding("manifest.found", "fail", c.error));
    return finish(report, prober, started);
  }

  // Find the manifest.
  let manifestFile = null;
  let chosen = null;
  let fallback = null;
  const tried = [];
  for (const cand of c.list) {
    const f = await prober.get(cand.manifest);
    tried.push({ url: cand.manifest, status: f.status, cors: f.maybeCors || false });
    if (f.ok) {
      let parsed = null;
      try { parsed = JSON.parse(f.text); } catch { parsed = null; }
      if (isObject(parsed)) { manifestFile = f; chosen = cand; break; }
      // A single-page app may answer 200 with its HTML for any path; skip HTML.
      if (!fallback && !/^\s*</.test(f.text)) fallback = { f, cand };
    }
  }
  if (!manifestFile && fallback) { manifestFile = fallback.f; chosen = fallback.cand; }
  report.tried = tried;
  if (!manifestFile) {
    const blocked = tried.some((t) => t.cors);
    const where = tried.map((t) => `${t.url} (${t.status || (t.cors ? "blocked or unreachable" : "unreachable")})`).join("; ");
    report.findings.push(finding(blocked ? "manifest.cors" : "manifest.found", "fail",
      blocked
        ? `Your browser could not read agent-manifest.json. Either it is not there or the site does not allow cross-origin reads (CORS). Tried: ${where}.`
        : `No agent-manifest.json found. Tried: ${where}.`,
      { tried }));
    report.needsServerProbe = blocked;
    return finish(report, prober, started);
  }

  const manifestUrl = manifestFile.url;
  const siteBase = new URL("./", manifestUrl).href;
  report.manifestUrl = manifestUrl;
  report.siteBase = siteBase;
  report.findings.push(finding("manifest.found", "pass", `Found ${manifestUrl}.`, { url: manifestUrl }));

  // HTTPS.
  report.findings.push(manifestUrl.startsWith("https://")
    ? finding("manifest.https", "pass", "HTTPS.")
    : finding("manifest.https", isLoopback(manifestUrl) ? "warn" : "fail", isLoopback(manifestUrl) ? "Local development host over http; fine for testing only." : "Served over plain http."));

  // CORS.
  const cors = prober.cors(manifestFile);
  if (cors.ok === false) report.findings.push(finding("manifest.cors", "fail", cors.detail, { url: manifestUrl }));
  else if (cors.ok === true) report.findings.push(finding("manifest.cors", "pass", cors.detail, { url: manifestUrl }));
  else report.findings.push(finding("manifest.cors", "info", cors.detail, { url: manifestUrl }));

  // JSON.
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.text);
  } catch (error) {
    report.findings.push(finding("manifest.json", "fail", `Not valid JSON: ${error.message}`));
    return finish(report, prober, started);
  }
  if (!isObject(manifest)) {
    report.findings.push(finding("manifest.json", "fail", "The manifest is not a JSON object."));
    return finish(report, prober, started);
  }
  report.findings.push(finding("manifest.json", "pass", "Valid JSON object."));
  report.brand = typeof manifest.brand === "string" ? manifest.brand : "";
  report.theme = manifest.theme?.primary || null;

  const secret = scanSecrets(manifestFile.text);
  report.findings.push(secret
    ? finding("manifest.secrets", "fail", `The manifest appears to contain ${secret}.`)
    : finding("manifest.secrets", "pass", "No credentials found in the manifest."));

  // Networks.
  const networks = Array.isArray(manifest.networks) ? manifest.networks.filter(isObject) : [];
  const complete = networks.filter((n) => n.name && n.front_man && n.hocon);
  if (!networks.length) report.findings.push(finding("manifest.networks", "fail", "No networks array, or it is empty."));
  else if (complete.length < networks.length) report.findings.push(finding("manifest.networks", "fail", `${networks.length - complete.length} of ${networks.length} network entries lack name, front_man or hocon.`));
  else report.findings.push(finding("manifest.networks", "pass", `${networks.length} network${networks.length === 1 ? "" : "s"}: ${networks.map((n) => n.name).join(", ")}.`));

  // Router.
  const router = manifest.llm_router;
  if (!isObject(router) || !(router.base_url || router.byok_router)) {
    report.findings.push(finding("manifest.router", "fail", "No llm_router with base_url or byok_router."));
  } else {
    report.findings.push(finding("manifest.router", "pass", `Default router ${router.base_url || "(none)"}; BYOK router ${router.byok_router || "(none)"}.`));
    const urls = [router.base_url, router.byok_router].filter(Boolean);
    const bad = urls.filter((u) => !String(u).startsWith("https://") && !String(u).startsWith("/") && !isLoopback(u));
    if (router.mock === true) report.findings.push(finding("manifest.router_https", "warn", "llm_router.mock is true, so the site only runs a mock model."));
    else if (bad.length) report.findings.push(finding("manifest.router_https", "warn", `Router is not HTTPS: ${bad.join(", ")}.`));
    else report.findings.push(finding("manifest.router_https", "pass", "HTTPS router, not a mock."));
  }

  // Peer policy.
  const policy = manifest.peer_policy || manifest.web_policy;
  if (!isObject(policy) && !Array.isArray(manifest.allowed_peers)) {
    report.findings.push(finding("manifest.peer_policy", "fail", "No peer_policy or allowed_peers."));
  } else {
    const mode = policy?.mode || "closed";
    report.findings.push(finding("manifest.peer_policy", "pass", mode === "open"
      ? "Open: any public agent site may be called, each after the visitor agrees."
      : `Closed, allowing ${(manifest.allowed_peers || []).length ? manifest.allowed_peers.join(", ") : "no other origins"}.`));
  }

  // Deployment.
  report.findings.push(manifest.deployment?.mode === "static"
    ? finding("manifest.deployment", "pass", "Static deployment, runtime in the browser.")
    : finding("manifest.deployment", "warn", manifest.deployment ? `deployment.mode is "${manifest.deployment.mode}".` : "No deployment metadata."));

  // Which networks to check.
  let selected = complete;
  if (chosen.networkName) {
    const exact = complete.filter((n) => n.name === chosen.networkName);
    if (!exact.length) {
      // The last URL segment may be a page, not a network; only fail if it is not a folder either.
      report.findings.push(finding("manifest.network_match", "fail", `The URL names "${chosen.networkName}", but the manifest lists ${complete.map((n) => n.name).join(", ") || "no networks"}. A runtime must refuse it.`));
    } else {
      report.findings.push(finding("manifest.network_match", "pass", `"${chosen.networkName}" is listed.`));
      selected = exact;
    }
  } else if (chosen.networkFile) {
    const byFile = complete.filter((n) => resolve(siteBase, n.hocon) === chosen.networkFile);
    if (byFile.length) selected = byFile;
  }

  for (const entry of selected.slice(0, MAX_NETWORKS)) {
    report.networks.push(await checkNetwork(prober, manifest, entry, siteBase, opts));
  }

  // links.json (optional).
  const links = await prober.get(resolve(siteBase, "links.json"));
  if (links.ok) {
    let valid = false;
    try { const doc = JSON.parse(links.text); valid = isObject(doc) && isObject(doc.networks); } catch { valid = false; }
    const lc = prober.cors(links);
    report.findings.push(!valid
      ? finding("links.valid", "warn", "links.json is not {\"version\":1,\"networks\":{...}}; the runtime ignores it.")
      : lc.ok === false ? finding("links.valid", "warn", `links.json: ${lc.detail}`)
      : finding("links.valid", "pass", "links.json is valid."));
  } else {
    report.findings.push(finding("links.valid", "info", "No links.json (optional)."));
  }

  // Action bridge, when the manifest declares actions.
  if (isObject(manifest.actions)) {
    report.findings.push(await checkBridge(prober, manifest.actions, siteBase));
  }

  // Coded tools.
  if (isObject(manifest.coded_tools) && manifest.coded_tools.bundle) {
    const url = resolve(siteBase, manifest.coded_tools.bundle);
    const b = await prober.get(url);
    if (!b.ok) report.findings.push(finding("coded.bundle", "fail", `Bundle ${url} answered ${b.status || "nothing"}.`));
    else if (/^\s*import\s|\bimport\s*\(/m.test(b.text)) report.findings.push(finding("coded.bundle", "fail", "The bundle imports other modules; the sandbox requires a self-contained bundle."));
    else report.findings.push(finding("coded.bundle", manifest.coded_tools.integrity ? "pass" : "warn",
      manifest.coded_tools.integrity ? "Self-contained bundle with an SRI digest." : "Self-contained bundle, but no coded_tools.integrity digest."));
  }

  // Optional discovery.
  const wk = await prober.get(`${new URL(siteBase).origin}/.well-known/nsdeploy.json`);
  const wkLocal = wk.ok ? wk : await prober.get(resolve(siteBase, ".well-known/nsdeploy.json"));
  report.findings.push(finding("discovery.wellknown", "info", wkLocal.ok ? `Found ${wkLocal.url}.` : "No .well-known/nsdeploy.json (optional)."));

  // The page itself, when the input was a page.
  if (opts.checkPage !== false) {
    const pageUrl = c.url;
    if (!/\.json$/i.test(new URL(pageUrl).pathname)) {
      const page = await prober.get(pageUrl);
      if (page.ok && /<html|<!doctype/i.test(page.text)) {
        const hasRuntime = /runtime\/index\.js|boot\(|nsdeploy|agent-app|agent-manifest/i.test(page.text);
        report.findings.push(finding("page.runtime", "info", hasRuntime
          ? "The page references a browser runtime or agent mount."
          : "The page HTML does not reference a runtime directly; it may load it from a script."));
      }
    }
  }

  return finish(report, prober, started);
}

async function checkBridge(prober, actions, siteBase) {
  if (actions.version !== 1) return finding("bridge.ok", "warn", `actions.version is ${JSON.stringify(actions.version)}; the reference runtime needs 1.`);
  if (!actions.bridge) return finding("bridge.ok", "warn", "The manifest declares actions but no actions.bridge, so callers wait 10 seconds and then fail.");
  const url = resolve(siteBase, actions.bridge);
  if (originOf(url) !== originOf(siteBase)) return finding("bridge.ok", "warn", "actions.bridge is on another origin; callers refuse it.");
  const page = await prober.get(url);
  if (!page.ok) return finding("bridge.ok", "warn", `The bridge page ${url} answered ${page.status || "nothing"}.`);
  if (page.headers?.xfo) return finding("bridge.ok", "warn", `The bridge page sends X-Frame-Options "${page.headers.xfo}", so other sites cannot frame it.`);
  if (page.headers?.csp && /frame-ancestors\s+('none'|'self')\s*(;|$)/i.test(page.headers.csp)) return finding("bridge.ok", "warn", "The bridge page's frame-ancestors policy blocks other sites.");
  if (!/<script[^>]*type\s*=\s*["']?module/i.test(page.text)) return finding("bridge.ok", "warn", "The bridge page loads no module script.");
  const bm = await prober.get(new URL("./agent-manifest.json", url).href);
  if (!bm.ok) return finding("bridge.ok", "warn", "The bridge's own agent-manifest.json is missing, so the bridge never answers.");
  return finding("bridge.ok", "pass", `Bridge ${url} loads and can be framed.`);
}

function finish(report, prober, started) {
  const all = [...report.findings, ...report.networks.flatMap((n) => n.findings)];
  const count = (s) => all.filter((f) => f.status === s).length;
  report.summary = {
    pass: count("pass"), fail: count("fail"), warn: count("warn"), info: count("info"),
    total: all.length,
  };
  const found = report.findings.some((f) => f.id === "manifest.found" && f.status === "pass");
  report.summary.verdict = !found ? "not-found" : report.summary.fail ? "fails" : report.summary.warn ? "passes-with-warnings" : "passes";
  report.summary.headline = headline(report);
  report.elapsedMs = Date.now() - started;
  report.requests = prober.log.length;
  return report;
}

function headline(report) {
  const s = report.summary;
  if (s.verdict === "not-found") return "No agent manifest found, so this is not an open agentic website yet.";
  if (s.verdict === "fails") return `Not conforming yet: ${s.fail} MUST rule${s.fail === 1 ? "" : "s"} fail${s.fail === 1 ? "s" : ""}${s.warn ? `, plus ${s.warn} warning${s.warn === 1 ? "" : "s"}` : ""}.`;
  if (s.verdict === "passes-with-warnings") return `Conforming. Every MUST rule passes, with ${s.warn} recommendation${s.warn === 1 ? "" : "s"}.`;
  return "Conforming. Every rule passes.";
}

/**
 * A compact form of a report for agents and MCP: findings that need attention first.
 */
export function compact(report) {
  const all = [...report.findings.map((f) => ({ ...f, network: null })), ...report.networks.flatMap((n) => n.findings.map((f) => ({ ...f, network: n.name })))];
  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  all.sort((a, b) => order[a.status] - order[b.status]);
  return {
    input: report.input,
    verdict: report.summary.verdict,
    headline: report.summary.headline,
    counts: { pass: report.summary.pass, fail: report.summary.fail, warn: report.summary.warn },
    manifest: report.manifestUrl || null,
    brand: report.brand || null,
    networks: report.networks.map((n) => ({ name: n.name, url: n.url, front_agent: n.frontAgent, agents: n.agents?.length || 0, description: n.description, peers: (n.peers || []).map((p) => p.url) })),
    problems: all.filter((f) => f.status === "fail" || f.status === "warn").map((f) => ({ rule: f.id, status: f.status, section: f.section, network: f.network, what: f.detail, fix: f.fix })),
    passed: all.filter((f) => f.status === "pass").map((f) => f.id),
    spec: report.spec.version,
    checked_at: report.checkedAt,
    mode: report.mode,
  };
}

export { RULES, SPEC_URL, SPEC_VERSION };
