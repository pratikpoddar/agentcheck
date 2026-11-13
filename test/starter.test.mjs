import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { generate, previewFetch, RUNTIME_FILES, slug } from "../site/lib/starter.js";
import { checkSite } from "../site/lib/checker.js";
import { parseHocon } from "../site/runtime/hocon.js";
import { badgeState, badgeSvg } from "../site/lib/badge.js";
import { makeZip } from "../site/lib/zip.js";

const ANSWERS = {
  siteName: "Sunrise Bakery", siteUrl: "https://sunrise-bakery.example/shop/",
  purpose: "Answers questions about breads and cakes.",
  facts: 'Open 7am-7pm daily. Sourdough Rs 180. A """quoted""" line and C:\\path.',
  host: "vercel", partners: "https://agentcheck.netlify.app/agentcheck",
};

test("starter output passes every rule, with and without partners", async () => {
  for (const partners of ["", ANSWERS.partners]) {
    for (const host of ["netlify", "vercel", "github-pages", "apache"]) {
      const r = generate({ ...ANSWERS, partners, host });
      assert.ok(r.ok, JSON.stringify(r.errors));
      const rep = await checkSite(r.networkUrl, { mode: "server", fetchImpl: previewFetch(r), checkPage: false });
      assert.equal(rep.summary.fail, 0, rep.summary.headline);
      assert.equal(rep.summary.warn, 0, rep.summary.headline);
    }
  }
});

test("starter HOCON parses to exactly the published JSON", () => {
  const r = generate(ANSWERS);
  assert.deepEqual(parseHocon(r.files[`${r.input.network}.hocon`]), JSON.parse(r.files[`${r.input.network}.network.json`]));
});

test("starter rejects bad answers with reasons", () => {
  const r = generate({ siteName: "", siteUrl: "http://x.example", purpose: "", facts: "short", partners: "https://p.example/agent-manifest.json" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4);
  assert.equal(slug("123 Café!"), "site_123_cafe");
});

test("RUNTIME_FILES lists the runtime folder exactly", () => {
  const root = path.resolve("site/runtime");
  const walk = (d) => readdirSync(d).flatMap((f) => statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.relative(root, path.join(d, f))]);
  assert.deepEqual([...RUNTIME_FILES].sort(), walk(root).sort());
});

test("badge states and SVG", () => {
  assert.equal(badgeState({ verdict: "passes", counts: {} }).message, "conforming");
  assert.equal(badgeState({ verdict: "fails", counts: { fail: 2 } }).message, "2 MUST failing");
  assert.equal(badgeState(null).message, "check failed");
  const svg = badgeSvg({ message: "<x>", color: "#000" });
  assert.match(svg, /^<svg/);
  assert.ok(!svg.includes("<x>"));
});

test("zip has a valid end record", async () => {
  const z = await makeZip([{ path: "a.txt", data: "hello" }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50);
});
