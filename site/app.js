// AgentCheck page script. It owns the page state and every operation, and the page's own
// form and the assistant's website_* tools call the same methods (App.page).

import { checkSite, compact, RULES, SPEC_URL, SPEC_VERSION } from "./lib/checker.js";
import { corsFix, HOSTS } from "./lib/fixes.js";

const API_CHECK = "/api/check";

class Page {
  constructor() {
    this.state = { checking: false, report: null, compact: null, checkedUrl: null, history: [] };
    this.directory = [];
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.state); }

  /**
   * Run a full check of a site in this browser. When the browser cannot read the files
   * at all (CORS or unreachable), ask AgentCheck's server-side probe, which reads the
   * response headers, so the report can say which one it is.
   */
  async check(url) {
    const input = String(url || "").trim();
    if (!input) return { ok: false, reason: "Give a URL to check." };
    this.state.checking = true;
    this.state.checkedUrl = input;
    this.emit();
    let report;
    try {
      report = await checkSite(input, { mode: "browser", fetchImpl: (u, init) => fetch(u, init) });
      const browserBlocked = report.needsServerProbe || [...report.findings, ...report.networks.flatMap((n) => n.findings)]
        .some((f) => f.status === "fail" && /blocked by CORS/.test(f.detail || ""));
      if (browserBlocked) {
        const server = await this.serverProbe(input);
        if (server) {
          server.mode = "server (your browser was blocked)";
          server.browserBlocked = true;
          report = server;
        }
      }
    } catch (error) {
      this.state.checking = false;
      this.emit();
      throw error;
    }
    this.state.report = report;
    this.state.compact = compact(report);
    this.state.checking = false;
    this.state.history = [{ url: input, verdict: report.summary.verdict, at: report.checkedAt }, ...this.state.history.filter((h) => h.url !== input)].slice(0, 8);
    this.emit();
    const out = this.state.compact;
    const net = report.networks[0];
    if (net && report.summary.verdict !== "not-found") {
      out.live_test = {
        network_url: net.url,
        sample_queries: (net.sampleQueries || []).slice(0, 3),
        how: "Call site_under_test with one sample query to run this network in the visitor's browser. The visitor approves first.",
      };
    }
    return out;
  }

  async serverProbe(url) {
    try {
      const resp = await fetch(`${API_CHECK}?url=${encodeURIComponent(url)}&full=1`, { headers: { Accept: "application/json" } });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  getState() {
    return {
      checked_url: this.state.checkedUrl,
      checking: this.state.checking,
      last_report: this.state.compact,
      recent: this.state.history,
      spec: SPEC_VERSION,
    };
  }

  explainRule(id) {
    const r = RULES[id];
    if (!r) return { ok: false, reason: `No rule "${id}". Rules: ${Object.keys(RULES).join(", ")}.` };
    return { ok: true, rule: id, ...r, spec_url: SPEC_URL };
  }

  listRules() {
    return Object.entries(RULES).map(([id, r]) => ({ id, level: r.level, section: r.section, title: r.title }));
  }

  corsFix(host, folder) {
    const fix = corsFix(host, folder);
    if (fix.error) return { ok: false, reason: fix.error };
    return { ok: true, ...fix };
  }

  async loadDirectory() {
    try {
      const resp = await fetch("./directory.json", { cache: "no-store" });
      const doc = await resp.json();
      this.directory = Array.isArray(doc.sites) ? doc.sites : [];
      this.directoryMeta = { generated_at: doc.generated_at, spec: doc.spec };
    } catch {
      this.directory = [];
    }
    return this.directory;
  }

  listDirectory() {
    return {
      generated_at: this.directoryMeta?.generated_at || null,
      sites: this.directory.map((s) => ({ name: s.name, url: s.url, network_url: s.network_url, verdict: s.verdict, fails: s.fail, warnings: s.warn, description: s.description, checked_at: s.checked_at })),
    };
  }
}

export class App {
  static page = new Page();
  static hosts = HOSTS;
  static ruleIds = Object.keys(RULES);
}

// ---------------- Rendering ----------------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

const VERDICT = {
  "passes": { label: "Conforming", cls: "v-pass" },
  "passes-with-warnings": { label: "Conforming, with tips", cls: "v-pass" },
  "fails": { label: "Not conforming yet", cls: "v-fail" },
  "not-found": { label: "Not an agentic site yet", cls: "v-none" },
};
const STATUS_LABEL = { pass: "Pass", fail: "Fail", warn: "Tip", info: "Note" };

function findingRow(f) {
  const open = f.status === "fail" || f.status === "warn";
  const details = el("details", { class: `finding s-${f.status}`, open: open ? "" : null },
    el("summary", {},
      el("span", { class: `badge b-${f.status}`, text: STATUS_LABEL[f.status] }),
      el("span", { class: "f-title", text: f.title }),
      el("span", { class: "f-sec", text: `§${f.section}${f.level === "must" ? " · MUST" : f.level === "should" ? " · SHOULD" : ""}` })),
    el("p", { class: "f-detail", text: f.detail || "" }),
    open ? el("p", { class: "f-fix" }, el("strong", { text: "Fix: " }), f.fix) : null,
    el("p", { class: "f-why", text: f.why || "" }),
  );
  return details;
}

function renderReport(state) {
  const box = $("#report");
  if (!box) return;
  box.replaceChildren();
  if (state.checking) {
    box.append(el("div", { class: "checking" }, el("span", { class: "spinner" }), `Reading ${state.checkedUrl} the way a calling browser does…`));
    return;
  }
  const r = state.report;
  if (!r) return;
  const v = VERDICT[r.summary.verdict];
  const head = el("div", { class: `verdict ${v.cls}` },
    el("div", { class: "v-label", text: v.label }),
    el("div", { class: "v-head", text: r.summary.headline }),
    el("div", { class: "v-meta" },
      el("span", { text: `${r.summary.pass} passed` }),
      el("span", { text: `${r.summary.fail} failed` }),
      el("span", { text: `${r.summary.warn} tips` }),
      el("span", { text: `checked ${r.mode === "browser" ? "in your browser" : "by AgentCheck's server probe"}` }),
      el("span", { text: r.spec.version })));
  box.append(head);
  if (r.browserBlocked) {
    const corsOk = r.findings.some((f) => f.id === "manifest.cors" && f.status === "pass");
    box.append(el("p", { class: "note", text: corsOk
      ? "Your browser could not reach this site's files directly (a network, extension or privacy setting can do that), so AgentCheck's server probe read them. Its headers do allow other sites, so callers should be fine."
      : "Your browser could not read this site's agent files from another origin, so AgentCheck's server probe read the response headers directly. Other agent sites will hit the same wall." }));
  }
  if (r.manifestUrl) box.append(el("p", { class: "muted small" }, "Manifest: ", el("a", { href: r.manifestUrl, target: "_blank", rel: "noopener", text: r.manifestUrl })));
  const site = el("section", { class: "group" }, el("h3", { text: "Publication and policy" }), r.findings.map(findingRow));
  box.append(site);
  for (const n of r.networks) {
    const g = el("section", { class: "group" },
      el("h3", {}, "Network ", el("code", { text: n.name })),
      el("p", { class: "muted small" }, `Network URL other sites call: `, el("code", { text: n.url })),
      n.agents?.length ? el("p", { class: "muted small", text: `Agents: ${n.agents.map((a) => a.name).join(", ")}` }) : null,
      n.findings.map(findingRow));
    box.append(g);
  }
  const actions = el("div", { class: "report-actions" },
    el("button", { class: "ghost", type: "button", id: "copy-json", text: "Copy JSON report" }),
    el("a", { class: "ghost-link", href: `${location.pathname}?url=${encodeURIComponent(state.checkedUrl)}`, text: "Link to this report" }));
  box.append(actions);
  $("#copy-json").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(App.page.state.report, null, 2)); $("#copy-json").textContent = "Copied"; } catch { /* ignore */ }
  });
}

function renderDirectory(sites) {
  const body = $("#directory-body");
  if (!body) return;
  body.replaceChildren();
  if (!sites.length) {
    body.append(el("tr", {}, el("td", { colspan: "4", class: "muted", text: "No sites yet." })));
    return;
  }
  for (const s of sites) {
    const v = VERDICT[s.verdict] || VERDICT["not-found"];
    const btn = el("button", { class: "linkish", type: "button", text: "Re-check" });
    btn.addEventListener("click", () => runCheck(s.network_url || s.url));
    body.append(el("tr", {},
      el("td", {}, el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.name }), el("div", { class: "muted small", text: s.description || "" })),
      el("td", {}, el("span", { class: `pill ${v.cls}`, text: v.label })),
      el("td", { class: "small", text: `${s.fail} fail · ${s.warn} tips` }),
      el("td", {}, btn)));
  }
  const meta = $("#directory-meta");
  if (meta && App.page.directoryMeta?.generated_at) meta.textContent = `Last checked ${new Date(App.page.directoryMeta.generated_at).toUTCString()} by the server probe.`;
}

async function runCheck(url) {
  $("#url").value = url;
  history.replaceState(null, "", `${location.pathname}?url=${encodeURIComponent(url)}`);
  $("#report").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    await App.page.check(url);
  } catch (error) {
    $("#report").replaceChildren(el("p", { class: "note", text: `The check stopped: ${error.message}` }));
  }
}

function init() {
  App.page.onChange(renderReport);
  $("#check-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runCheck($("#url").value);
  });
  for (const b of document.querySelectorAll("[data-example]")) {
    b.addEventListener("click", () => runCheck(b.dataset.example));
  }
  App.page.loadDirectory().then(renderDirectory);
  const pre = new URLSearchParams(location.search).get("url");
  if (pre) runCheck(pre);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
