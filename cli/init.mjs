// agentcheck init: ask a few questions and write a conforming open agentic website folder,
// checked with AgentCheck before it is written.
import { createInterface } from "node:readline";
import { mkdir, writeFile, cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, previewFetch, HOSTS } from "../site/lib/starter.js";
import { checkSite } from "../site/lib/checker.js";

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "runtime");

export async function init(argv) {
  const outDir = path.resolve(argv.find((a) => !a.startsWith("-")) || "agentic-site");
  try { await access(path.join(outDir, "agent-manifest.json")); console.error(`${outDir} already has an agent-manifest.json. Pick another folder.`); return 2; } catch { /* free */ }
  const rl = createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
  rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()(""); });
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve("") : new Promise((r) => waiting.push(r)));
  const ask = async (q, def = "") => {
    process.stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
    const answer = (await next()).trim();
    if (!process.stdin.isTTY) process.stdout.write("\n");
    return answer || def;
  };
  console.log("AgentCheck starter: a few questions, then a conforming open agentic website folder.\n");
  const answers = {
    siteName: await ask("Site name"),
    siteUrl: await ask("Public https URL of the folder you'll upload to"),
    purpose: await ask("What does the assistant help visitors with (one sentence)"),
    facts: (await ask("Facts the assistant may use (use \\n for new lines)")).replace(/\\n/g, "\n"),
    host: await ask(`Host (${HOSTS.join(", ")})`, "netlify"),
    contact: await ask("Link or phone for everything else (optional)"),
  };
  rl.close();
  const result = generate(answers);
  if (!result.ok) { console.error(`\n${result.errors.map((e) => `- ${e}`).join("\n")}`); return 1; }
  const report = await checkSite(result.networkUrl, { mode: "server", fetchImpl: previewFetch(result), checkPage: false });
  console.log(`\nChecked before writing: ${report.summary.headline} (${report.summary.pass} passed, ${report.summary.fail} failed)`);
  for (const [rel, text] of Object.entries(result.files)) {
    const file = path.join(outDir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  await cp(RUNTIME, path.join(outDir, "runtime"), { recursive: true });
  console.log(`Wrote ${outDir}\nUpload its contents to ${result.folderUrl}, then run:\n  npx github:pratikpoddar/agentcheck ${result.networkUrl}`);
  return report.summary.fail ? 1 : 0;
}
