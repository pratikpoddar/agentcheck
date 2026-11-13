// AgentCheck starter page: generate a conforming open agentic website, check it with
// AgentCheck's own checker as it will be served, and download it as a zip.

import { generate, previewFetch, RUNTIME_FILES } from "./lib/starter.js";
import { checkSite } from "./lib/checker.js";
import { makeZip } from "./lib/zip.js";

const $ = (s) => document.querySelector(s);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const EXAMPLE = {
  siteName: "Sunrise Bakery",
  siteUrl: "https://sunrise-bakery.example/",
  purpose: "Answers questions about our breads, cakes, opening hours and custom orders.",
  facts: "Open 7am to 7pm every day, closed on Diwali.\nSourdough loaf Rs 180, multigrain loaf Rs 150, butter croissant Rs 90.\nEggless cakes available in chocolate and vanilla, from Rs 650 for 500 g.\nCustom cakes need 48 hours' notice; order on the contact page.\nWe deliver within 5 km of C-Scheme, Jaipur, for Rs 40.",
  host: "netlify",
  contact: "https://sunrise-bakery.example/contact",
  cannot: "take payments\nchange or cancel an order",
  samples: "Do you have eggless cakes?\nWhat time do you close?\nCan you order a birthday cake for Saturday?",
};

let current = null;

function answers() {
  return Object.fromEntries(new FormData($("#starter")).entries());
}

async function run() {
  const box = $("#result");
  const result = generate(answers());
  if (!result.ok) {
    box.replaceChildren(el("div", { class: "verdict v-fail" }, el("div", { class: "v-label", text: "A few answers needed" }),
      el("ul", {}, result.errors.map((e) => el("li", { text: e })))));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  current = result;
  box.replaceChildren(el("div", { class: "checking" }, el("span", { class: "spinner" }), "Checking the files the way a calling browser will read them…"));
  const report = await checkSite(result.networkUrl, { mode: "server", fetchImpl: previewFetch(result), checkPage: false });
  const s = report.summary;
  const ok = s.fail === 0;
  const all = [...report.findings, ...report.networks.flatMap((n) => n.findings)];
  const head = el("div", { class: `verdict ${ok ? "v-pass" : "v-fail"}` },
    el("div", { class: "v-label", text: ok ? "Ready to upload" : "Needs a change" }),
    el("div", { class: "v-head", text: ok ? `These files pass all ${s.pass} checks AgentCheck runs on a live site.` : report.summary.headline }),
    el("div", { class: "v-meta" }, el("span", { text: `${s.pass} passed` }), el("span", { text: `${s.fail} failed` }), el("span", { text: `${s.warn} tips` }), el("span", { text: report.spec.version })));
  const problems = all.filter((f) => f.status === "fail" || f.status === "warn");
  const download = el("button", { type: "button", class: "primary", text: "Download the folder (.zip)" });
  download.addEventListener("click", () => downloadZip(download));
  const filesList = el("div", { class: "files" });
  const names = Object.keys(result.files);
  const tabs = el("div", { class: "file-tabs", role: "tablist" });
  const pre = el("pre", { class: "file-view" }, el("code"));
  const show = (name) => {
    pre.firstChild.textContent = result.files[name];
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.name === name));
  };
  for (const name of names) {
    const b = el("button", { type: "button", class: "chip", role: "tab", "data-name": name, text: name });
    b.addEventListener("click", () => show(name));
    tabs.append(b);
  }
  tabs.append(el("span", { class: "chip ghosted", text: `runtime/ (${RUNTIME_FILES.length} files)` }));
  filesList.append(tabs, pre);
  show(names[1]);
  const encoded = encodeURIComponent(result.networkUrl);
  const steps = el("ol", { class: "next-steps" },
    el("li", {}, "Upload the folder's contents to ", el("code", { text: result.folderUrl }), "."),
    el("li", {}, "Link to ", el("code", { text: "assistant.html" }), " from your site, or paste its script and chat block into a page."),
    el("li", {}, "Check it live: ", el("a", { href: `./?url=${encoded}`, text: "check my site" }), " once it's up."),
    el("li", {}, "Show it: add the live badge to your README or footer."));
  const badgeMd = `[![AgentCheck](https://agentcheck.netlify.app/badge?url=${encoded})](https://agentcheck.netlify.app/?url=${encoded})`;
  box.replaceChildren(...[head,
    problems.length ? el("ul", {}, problems.map((f) => el("li", { text: `${f.title}: ${f.detail}` }))) : null,
    el("p", {}, "Network URL other sites will call: ", el("code", { text: result.networkUrl })),
    el("div", { class: "report-actions" }, download),
    el("h3", { text: "Next" }), steps,
    el("pre", {}, el("code", { text: badgeMd })),
    el("h3", { text: "The files" }), filesList].filter(Boolean));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function downloadZip(button) {
  if (!current) return;
  button.disabled = true;
  button.textContent = "Packing the runtime…";
  try {
    const entries = Object.entries(current.files).map(([path, data]) => ({ path, data }));
    const runtime = await Promise.all(RUNTIME_FILES.map(async (f) => {
      const resp = await fetch(`./runtime/${f}`);
      if (!resp.ok) throw new Error(`runtime/${f} answered ${resp.status}`);
      return { path: `runtime/${f}`, data: new Uint8Array(await resp.arrayBuffer()) };
    }));
    const zip = await makeZip([...entries, ...runtime]);
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const a = el("a", { href: url, download: `${current.input.network}-agentic-site.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = `Download failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function init() {
  $("#starter").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  $("#fill-example").addEventListener("click", () => {
    const f = $("#starter");
    for (const [k, v] of Object.entries(EXAMPLE)) if (f.elements[k]) f.elements[k].value = v;
    $(".more").open = true;
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
