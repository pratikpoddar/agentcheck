// Local dev server: serves site/ and runs the Netlify functions at the same paths.
//   node scripts/dev.mjs [--port 8787]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import check from "../netlify/functions/check.mjs";
import mcp from "../netlify/functions/mcp.mjs";
import directory from "../netlify/functions/directory.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8787;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown; charset=utf-8" };
const ROUTES = { "/api/check": check, "/mcp": mcp, "/directory.json": directory };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const fn = ROUTES[url.pathname];
  if (fn) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await fn(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const data = await readFile(file);
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (/\.json$|\/runtime\/|\/bridge\//.test(file)) headers["Access-Control-Allow-Origin"] = "*";
    res.writeHead(200, headers).end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, () => console.log(`AgentCheck dev server on http://localhost:${port}`));
