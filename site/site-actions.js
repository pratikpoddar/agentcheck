// Registers AgentCheck's operations with the agent runtime. agent-manifest.json loads
// this module through "actions.module". Only names in "actions.agentTools" become
// website_<name> tools. Every action here only reads: none changes anything.

import { App } from "./app.js";

class SiteActions {
  static registerActions(actions) {
    actions.register({
      name: "check_site",
      description: "Check a website against the Worldwide Agentic Web MVP spec. Reads its public agent-manifest.json, network definition and links.json the way a calling browser does, and shows the report on the page. Accepts a site URL, a network URL (site base + network name), or a manifest URL. Returns the verdict, each problem with its spec section and fix, and live_test details.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 4, maxLength: 500, description: "The URL the visitor gave, exactly." },
        },
      },
      execute: (args) => App.page.check(args.url),
    });
    actions.register({
      name: "get_page_state",
      description: "Read the report currently shown on the page (the last check the visitor or you ran), and recent checks.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    });
    actions.register({
      name: "explain_rule",
      description: "Get the exact text of one AgentCheck rule: its spec section, MUST/SHOULD level, why it matters, and the standard fix.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["rule_id"],
        properties: { rule_id: { type: "string", enum: App.ruleIds, description: "A rule id from a report, such as manifest.cors." } },
      },
      execute: (args) => App.page.explainRule(args.rule_id),
    });
    actions.register({
      name: "list_rules",
      description: "List every rule AgentCheck checks, with its spec section and level.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.listRules(),
    });
    actions.register({
      name: "cors_fix",
      description: "Get the exact config to paste so other agent sites can read a site's agent files (CORS), for one hosting provider.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["host"],
        properties: {
          host: { type: "string", enum: App.hosts, description: "Where the site is hosted." },
          folder: { type: "string", maxLength: 200, description: "The folder that holds agent-manifest.json, such as / or /agents/. Default /." },
        },
      },
      execute: (args) => App.page.corsFix(args.host, args.folder),
    });
    actions.register({
      name: "list_directory",
      description: "List the open agentic websites in AgentCheck's directory with their last verdict.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.listDirectory(),
    });
  }
}

export const registerActions = SiteActions.registerActions;
