// Mounts AgentCheck's assistant in the page and binds the "site_under_test" link slot to
// the network of the last report, so the agent can test-drive that network in the
// visitor's browser after the visitor approves the consent card.

import { App } from "./app.js";

const SLOT = "site_under_test";

export class AssistantMount {
  static GREETING = "Paste any agentic website URL and I'll check it against the MVP spec, explain what fails and give you the exact fix. Ask me for a live test and I'll run that site's own agents here, with your approval.";

  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      const engine = booted.engine;
      AssistantMount.engine = engine;
      AssistantMount.forgetStoredSlot(engine);
      engine.onLinkRequired = AssistantMount.linkTarget;
      App.page.onChange(AssistantMount.bindSlot);
      const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
      status.textContent = needsKey
        ? "The checker above works without a key. To chat with AgentCheck's agents, add your AI provider key in AI model settings below. It stays in this browser."
        : "AgentCheck's agents are connected to this page.";
      if (!needsKey) AssistantMount.greet();
      return engine;
    } catch (error) {
      status.textContent = "The assistant could not load. The checker above still works.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /** The network URL of the current report, or null. */
  static currentNetworkUrl() {
    const r = App.page.state.report;
    if (!r || r.summary?.verdict === "not-found") return null;
    return r.networks?.[0]?.url || null;
  }

  /** Called by the runtime when the agent calls site_under_test before any binding. */
  static async linkTarget() {
    return AssistantMount.currentNetworkUrl();
  }

  /** After each check, point the slot at the checked network. Contact still needs consent. */
  static bindSlot() {
    const engine = AssistantMount.engine;
    const url = AssistantMount.currentNetworkUrl();
    if (!engine || !url) return;
    try {
      engine.top?.network?.setLink(SLOT, url);
      if (engine.top?.base) localStorage.setItem(engine._linkKey(engine.top.base, engine.top.network.name, SLOT), url);
    } catch (error) {
      console.warn("Could not bind the live-test slot", error);
    }
  }

  /** A link saved in an earlier visit would point at an old site, so drop it. */
  static forgetStoredSlot(engine) {
    try {
      if (engine.top?.base) localStorage.removeItem(engine._linkKey(engine.top.base, engine.top.network.name, SLOT));
    } catch { /* storage may be blocked */ }
  }

  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) first.textContent = AssistantMount.GREETING;
  }
}

if (typeof window !== "undefined") {
  await AssistantMount.start();
}
