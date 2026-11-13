// Copy-paste fixes for the most common failure: public agent files without CORS.
// Each snippet allows any site to GET the public agent artifacts and nothing else.

export const HOSTS = ["netlify", "cloudflare-pages", "vercel", "github-pages", "firebase", "apache", "nginx", "wordpress", "s3", "express"];

const DEFAULT_PATHS = ["/agent-manifest.json", "/*.network.json", "/links.json", "/.well-known/*"];

/**
 * Return the exact config to add for a host, so the manifest, network files and
 * links.json can be read by other agent sites.
 *
 * @param {string} host One of HOSTS.
 * @param {string} folder The folder that holds agent-manifest.json, such as "/" or "/agents/".
 */
export function corsFix(host, folder = "/") {
  const base = (`/${String(folder || "/").replace(/^\/+|\/+$/g, "")}/`).replace(/\/+/g, "/");
  const paths = DEFAULT_PATHS.map((p) => (base + p.replace(/^\//, "")).replace(/\/+/g, "/"));
  switch (host) {
    case "netlify":
    case "cloudflare-pages":
      return {
        host, file: "_headers (in your publish folder)",
        snippet: paths.map((p) => `${p}\n  Access-Control-Allow-Origin: *`).join("\n"),
        note: "Redeploy after adding the file. Check with: curl -sI -H 'Origin: https://example.com' <manifest URL>.",
      };
    case "vercel":
      return {
        host, file: "vercel.json",
        snippet: JSON.stringify({ headers: [
          { source: `${base}agent-manifest.json`, headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
          { source: `${base}(.*)\\.network\\.json`, headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
          { source: `${base}links.json`, headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
        ] }, null, 2),
        note: "Merge into an existing vercel.json headers array if you have one.",
      };
    case "github-pages":
      return {
        host, file: "nothing to add",
        snippet: "GitHub Pages already sends Access-Control-Allow-Origin: * on every file.",
        note: "If a check still fails, make sure the files are committed to the published branch and folder, and that a custom domain is not proxied through a CDN that strips headers.",
      };
    case "firebase":
      return {
        host, file: "firebase.json (inside \"hosting\")",
        snippet: JSON.stringify({ headers: [{ source: "**/@(agent-manifest.json|*.network.json|links.json)", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }] }, null, 2),
        note: "Then run firebase deploy --only hosting.",
      };
    case "apache":
    case "wordpress":
      return {
        host, file: host === "wordpress" ? ".htaccess in the plugin or theme folder that serves agent-manifest.json" : ".htaccess in the folder that holds agent-manifest.json",
        snippet: `<IfModule mod_headers.c>\n  <FilesMatch "(agent-manifest\\.json|\\.network\\.json|links\\.json)$">\n    Header set Access-Control-Allow-Origin "*"\n  </FilesMatch>\n</IfModule>`,
        note: host === "wordpress"
          ? "Needs mod_headers. On Nginx-based WordPress hosts, or behind Cloudflare, add the header in the host's or CDN's rules instead (Cloudflare: Rules > Transform Rules > Modify Response Header)."
          : "Needs mod_headers (a2enmod headers).",
      };
    case "nginx":
      return {
        host, file: "your server block",
        snippet: `location ~* (agent-manifest\\.json|\\.network\\.json|links\\.json)$ {\n    add_header Access-Control-Allow-Origin "*" always;\n}`,
        note: "Reload nginx after the change (nginx -s reload).",
      };
    case "s3":
      return {
        host, file: "S3 bucket CORS configuration",
        snippet: JSON.stringify([{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], MaxAgeSeconds: 3600 }], null, 2),
        note: "Behind CloudFront, also add a response headers policy with CORS, or forward the Origin header.",
      };
    case "express":
      return {
        host, file: "your server",
        snippet: `app.use(["${base}agent-manifest.json", "${base}links.json", /\\.network\\.json$/], (req, res, next) => {\n  res.set("Access-Control-Allow-Origin", "*");\n  next();\n});`,
        note: "Put it before express.static.",
      };
    default:
      return { host, error: `Unknown host. Use one of: ${HOSTS.join(", ")}.` };
  }
}
