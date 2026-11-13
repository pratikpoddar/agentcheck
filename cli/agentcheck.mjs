#!/usr/bin/env node
// AgentCheck CLI: check an open agentic website against the Worldwide Agentic Web MVP spec.
//
//   npx agentcheck <url> [--origin https://your-site.example] [--json] [--strict] [--peers]
//
// Exit codes: 0 conforming, 1 a MUST rule fails (or any warning with --strict), 2 bad usage.

import { checkSite, compact, VERSION } from "../site/lib/checker.js";

const USAGE = `AgentCheck ${VERSION}
Usage: agentcheck <site, network, or manifest URL> [options]
       agentcheck init [folder]   Generate a conforming open agentic website folder

Options:
  --origin <url>   Check CORS as seen from this caller origin (default: any site)
  --json           Print the full report as JSON
  --compact        Print the compact report as JSON (what agents and MCP get)
  --strict         Exit 1 on warnings too
  --peers          Also check that each peer network's manifest is reachable
  --quiet          Print only the headline
`;

function parse(argv) {
  const o = { url: null, origin: undefined, json: false, compact: false, strict: false, peers: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--origin") o.origin = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--compact") o.compact = true;
    else if (a === "--strict") o.strict = true;
    else if (a === "--peers") o.peers = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "-h" || a === "--help") return { help: true };
    else if (a === "-v" || a === "--version") return { version: true };
    else if (!o.url) o.url = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!o.url) throw new Error("Give a URL to check.");
  return o;
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ICON = { pass: paint(32, "PASS"), fail: paint(31, "FAIL"), warn: paint(33, "WARN"), info: paint(36, "INFO") };

function printFinding(f) {
  console.log(`  ${ICON[f.status]}  ${f.title}  ${paint(2, `[${f.id} · spec ${f.section}]`)}`);
  if (f.detail) console.log(`        ${f.detail}`);
  if (f.status === "fail" || f.status === "warn") console.log(`        ${paint(1, "Fix:")} ${f.fix}`);
}

async function main() {
  if (process.argv[2] === "init") {
    const { init } = await import("./init.mjs");
    return init(process.argv.slice(3));
  }
  let o;
  try {
    o = parse(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) { console.log(USAGE); return 0; }
  if (o.version) { console.log(VERSION); return 0; }
  const report = await checkSite(o.url, { mode: "server", origin: o.origin, followPeers: o.peers });
  if (o.json) console.log(JSON.stringify(report, null, 2));
  else if (o.compact) console.log(JSON.stringify(compact(report), null, 2));
  else if (o.quiet) console.log(report.summary.headline);
  else {
    console.log(paint(1, `AgentCheck ${VERSION}`) + paint(2, ` · ${report.spec.version}`));
    console.log(`Checked: ${o.url}`);
    if (report.manifestUrl) console.log(`Manifest: ${report.manifestUrl}`);
    console.log("");
    console.log(paint(1, "Site"));
    report.findings.forEach(printFinding);
    for (const n of report.networks) {
      console.log("");
      console.log(paint(1, `Network ${n.name}`) + paint(2, `  ${n.url}`));
      n.findings.forEach(printFinding);
    }
    console.log("");
    const s = report.summary;
    console.log(`${s.pass} passed, ${s.fail} failed, ${s.warn} warnings, ${s.info} notes · ${report.requests} requests in ${report.elapsedMs} ms`);
    console.log(paint(1, report.summary.headline));
  }
  if (report.summary.verdict === "not-found" || report.summary.fail) return 1;
  if (o.strict && report.summary.warn) return 1;
  return 0;
}

process.exitCode = await main();
