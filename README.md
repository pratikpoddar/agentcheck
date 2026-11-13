# AgentCheck

**Will other agents be able to call your site?** AgentCheck is an open agentic website that checks *other* open agentic websites against the [Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) (Profile 0.2), explains each failure in plain English, and gives the exact fix for your host.

Live: **https://agentcheck.netlify.app** · Network URL: `https://agentcheck.netlify.app/agentcheck` · MCP: `https://agentcheck.netlify.app/mcp`

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/). The challenge repo's Testing section still reads "TODO Run the validation script". AgentCheck is that script, plus a site, an agent network, an MCP server and a GitHub Action around it.

## What it checks

34 rules, each tied to a spec section and marked MUST, SHOULD or informational:

| Area | Rules |
| --- | --- |
| Publication (§3.2, §3.3) | `agent-manifest.json` found from a site, network or manifest URL; valid JSON; HTTPS; **CORS for callers**; networks with `name`, `front_man`, `hocon`; exact network-name match |
| Inference (§4) | `llm_router` metadata, HTTPS router, not a mock; **no credentials in published files** |
| Policy (§3.3, §5) | peer policy declared; every peer and MCP origin the network calls is allowed; HTTPS peers; network-URL form |
| Network (§2, §3.1) | definition loads with CORS; parses; JSON serialization; **data-only** (no includes, `${}` substitutions, local paths); passes the **reference runtime's own validator**; front agent matches; description; every agent described with instructions and tools; JSON Schema inputs; model hint; execution limits; a peer rule for callers; `sly_data` allow rules |
| Callability | `links.json`; the action bridge loads and can be framed; coded-tool bundle self-contained with SRI |

It reads only public files, the way a calling browser does, and reuses the reference browser runtime's HOCON parser and validator (copied from the challenge repo), so a network that passes here is one the reference runtime loads.

## Four ways to use it

**1. The site.** Paste a URL at https://agentcheck.netlify.app. The check runs in your browser with no key. If your browser cannot read the files at all, AgentCheck's server probe reads the headers and tells you whether it is CORS or a missing file.

**2. The agent network (BYOK).** AgentCheck is itself a conforming open agentic website. Its network has two agents:

- `agentcheck_desk`: calls the site's own `website_check_site`, `website_explain_rule`, `website_cors_fix` and `website_list_directory` actions, and the AgentCheck MCP tools.
- `fix_writer`: turns failures into a numbered, copy-paste fix plan for your host.

Ask for a **live test** and the desk loads the checked site's network as a peer (the `site_under_test` link slot) and runs one of its sample queries in your browser, on your key, after you approve the consent card. That is the spec's §6 interoperability check, done for you.

Other agent sites can call AgentCheck before they link a partner:

```json
"tools": ["https://agentcheck.netlify.app/agentcheck"]
```

and add `https://agentcheck.netlify.app` to `allowed_peers`. Run on another site, the network has no `website_*` tools, so it uses the MCP `check_site` tool on its own origin.

**3. MCP server.** Streamable HTTP, stateless, CORS open, no key.

```json
{ "url": "https://agentcheck.netlify.app/mcp", "tools": ["check_site", "explain_rule", "cors_fix"] }
```

```bash
curl -s https://agentcheck.netlify.app/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_site","arguments":{"url":"https://your-site.example/your_network"}}}'
```

**4. CLI and GitHub Action.** Node 22+, no dependencies.

```bash
npx github:pratikpoddar/agentcheck https://your-site.example/your_network
npx github:pratikpoddar/agentcheck http://localhost:8080/ --origin http://localhost:8081   # local dev
npx github:pratikpoddar/agentcheck https://your-site.example/ --json                      # full report
```

Exit code 0 when every MUST rule passes, 1 when one fails (or any warning with `--strict`).

```yaml
- uses: pratikpoddar/agentcheck@v0
  with:
    url: https://your-site.example/your_network
```

## Directory

`/directory.json` lists known open agentic websites with their live verdict, re-checked by the server probe every six hours. It is seeded from the challenge repo's `docs/agentic_websites.md`. [Open an issue](https://github.com/pratikpoddar/agentcheck/issues/new?template=add-site.yml) to add yours.

## Run it locally

```bash
npm test                 # unit tests for the checker
npm run build:network    # site/agentcheck.hocon -> site/agentcheck.network.json, with the skill's checks
npm run dev              # http://localhost:8787 with the API, MCP and directory functions
```

## Layout

| Path | What |
| --- | --- |
| `site/lib/checker.js` | The checker. Same code in the browser, CLI, MCP and API. |
| `site/lib/rules.js` | Rule catalogue: spec section, level, why, fix. |
| `site/lib/fixes.js` | CORS snippets for Netlify, Cloudflare Pages, Vercel, GitHub Pages, Firebase, Apache, WordPress, nginx, S3, Express. |
| `site/agentcheck.hocon` | The agent network source; `agentcheck.network.json` is generated. |
| `site/agent-manifest.json`, `links.json`, `bridge/`, `.well-known/` | Published agent files. |
| `site/app.js`, `site-actions.js`, `site.js` | Page, the `website_*` actions, and the runtime mount. |
| `site/runtime/` | Reference browser runtime, unchanged (see NOTICE). |
| `netlify/functions/` | `/api/check` server probe, `/mcp`, `/directory.json`. |
| `cli/agentcheck.mjs`, `action.yml` | CLI and GitHub Action. |

## Limits

- AgentCheck reports what published files and headers show. It is not a certification, and it does not judge whether an agent is good.
- In the browser, a CORS block and an unreachable host look the same; the server probe resolves it.
- The server probe refuses private and loopback addresses. Use the CLI for local sites.
- The live test runs the checked site's network on your key and model, within AgentCheck's step limit, after you approve. Its instructions are public and untrusted; AgentCheck treats its reply as data.

## License

Apache-2.0. Built by Tinkerer (Pratik Poddar).
