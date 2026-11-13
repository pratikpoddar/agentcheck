import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSite, compact, candidates } from "../site/lib/checker.js";
import { corsFix, HOSTS } from "../site/lib/fixes.js";

const BASE = "https://good.example";

function network(overrides = {}) {
  return {
    metadata: { description: "Answers questions about Good Example." },
    llm_config: { model_name: "alibaba/qwen-3.5-35b-a3b" },
    max_steps: 12,
    tools: [
      {
        name: "front",
        function: { description: "Front desk.", parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
        instructions: "Help visitors. When you have no website_* tools, another site's assistant is asking for its visitor.",
        tools: ["specialist"],
      },
      {
        name: "specialist",
        function: { description: "Specialist.", parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
        instructions: "Answer from facts.",
        tools: [],
      },
    ],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    brand: "Good",
    networks: [{ name: "good", front_man: "front", hocon: "./good.network.json" }],
    llm_router: { base_url: "https://api.otari.ai/api/v1", byok_router: "https://api.otari.ai/api/v1", mock: false },
    allowed_peers: [],
    peer_policy: { mode: "closed" },
    deployment: { mode: "static" },
    ...overrides,
  };
}

/** A fake fetch serving a map of url -> {status, body, headers}. */
function site(files, { cors = true } = {}) {
  return async (url) => {
    const f = files[url];
    const headers = new Headers(f?.headers || {});
    if (cors && f && !headers.has("access-control-allow-origin")) headers.set("access-control-allow-origin", "*");
    if (!f) return new Response("Not found", { status: 404, headers });
    const body = typeof f.body === "string" ? f.body : JSON.stringify(f.body);
    return new Response(body, { status: f.status || 200, headers });
  };
}

const ids = (report, status) => [...report.findings, ...report.networks.flatMap((n) => n.findings)].filter((f) => f.status === status).map((f) => f.id);

test("a conforming site passes every MUST rule", async () => {
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest() },
    [`${BASE}/good.network.json`]: { body: network() },
    [`${BASE}/links.json`]: { body: { version: 1, networks: { good: {} } } },
  });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  assert.equal(r.summary.fail, 0, JSON.stringify(ids(r, "fail")));
  assert.equal(r.summary.verdict, "passes");
  assert.equal(r.networks[0].frontAgent, "front");
});

test("missing CORS on the manifest and network fails", async () => {
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest() },
    [`${BASE}/good.network.json`]: { body: network() },
  }, { cors: false });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  assert.deepEqual(ids(r, "fail").sort(), ["manifest.cors", "network.cors"]);
  assert.equal(r.summary.verdict, "fails");
});

test("a reflected single-origin CORS header is a failure for other sites", async () => {
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest(), headers: { "access-control-allow-origin": "https://only-me.example" } },
    [`${BASE}/good.network.json`]: { body: network() },
  });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  assert.ok(ids(r, "fail").includes("manifest.cors"));
});

test("no manifest anywhere is not-found", async () => {
  const r = await checkSite("https://plain.example/", { fetchImpl: site({}), mode: "server", checkPage: false });
  assert.equal(r.summary.verdict, "not-found");
});

test("an SPA that answers HTML for every path is not mistaken for a manifest", async () => {
  const html = "<!doctype html><html><body>app</body></html>";
  const fetchImpl = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  const r = await checkSite("https://spa.example/", { fetchImpl, mode: "server", checkPage: false });
  assert.equal(r.summary.verdict, "not-found");
});

test("a URL naming an unlisted network fails exact-match resolution", async () => {
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest() },
    [`${BASE}/good.network.json`]: { body: network() },
  });
  const r = await checkSite(`${BASE}/other`, { fetchImpl, mode: "server", checkPage: false });
  assert.ok(ids(r, "fail").includes("manifest.network_match"));
});

test("a wrong front_man, a leaked key and an unallowed http peer all fail", async () => {
  const n = network();
  n.tools[0].tools.push("http://peer.example/tours");
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest({ networks: [{ name: "good", front_man: "nobody", hocon: "./good.network.json" }], api_key: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" }) },
    [`${BASE}/good.network.json`]: { body: n },
  });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  const fails = ids(r, "fail");
  for (const id of ["network.front_agent", "manifest.secrets", "peers.https", "peers.allowed"]) assert.ok(fails.includes(id), `${id} in ${fails}`);
});

test("includes and substitutions break the data-only rule", async () => {
  const text = 'include "common.hocon"\n{ "metadata": {"description": "x"}, "tools": [{"name": "front", "function": {"description": "d"}, "instructions": "${PROMPT}", "tools": []}] }';
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: manifest() },
    [`${BASE}/good.network.json`]: { body: text },
  });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  assert.ok(ids(r, "fail").includes("network.data_only"));
});

test("missing router and peer policy fail", async () => {
  const m = manifest();
  delete m.llm_router; delete m.peer_policy; delete m.allowed_peers;
  const fetchImpl = site({
    [`${BASE}/agent-manifest.json`]: { body: m },
    [`${BASE}/good.network.json`]: { body: network() },
  });
  const r = await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false });
  assert.ok(ids(r, "fail").includes("manifest.router"));
  assert.ok(ids(r, "fail").includes("manifest.peer_policy"));
});

test("candidates handles site, network, manifest and definition URLs", () => {
  assert.equal(candidates("https://a.example/agents/net").list[0].manifest, "https://a.example/agents/agent-manifest.json");
  assert.equal(candidates("https://a.example/agents/net").list[0].networkName, "net");
  assert.equal(candidates("https://a.example/").list[0].manifest, "https://a.example/agent-manifest.json");
  assert.equal(candidates("https://a.example/x/agent-manifest.json").list[0].manifest, "https://a.example/x/agent-manifest.json");
  assert.equal(candidates("https://a.example/x/n.network.json").list[0].networkFile, "https://a.example/x/n.network.json");
  assert.equal(candidates("a.example").list[0].manifest, "https://a.example/agent-manifest.json");
});

test("compact puts problems first with fixes", async () => {
  const fetchImpl = site({ [`${BASE}/agent-manifest.json`]: { body: manifest() }, [`${BASE}/good.network.json`]: { body: network() } }, { cors: false });
  const c = compact(await checkSite(`${BASE}/good`, { fetchImpl, mode: "server", checkPage: false }));
  assert.equal(c.verdict, "fails");
  assert.ok(c.problems[0].fix.length > 10);
});

test("every host has a CORS fix", () => {
  for (const h of HOSTS) assert.ok(corsFix(h).snippet, h);
  assert.ok(corsFix("nope").error);
});
