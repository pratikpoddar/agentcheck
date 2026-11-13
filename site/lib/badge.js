// AgentCheck badge: a small SVG with the live verdict for a site, for READMEs and footers.

const COLORS = { pass: "#1a7f4b", tips: "#2e7d32", fail: "#b42318", none: "#6b7280", error: "#9a6700" };

// Approximate Verdana 11px advance widths, enough to size a badge without a font engine.
function textWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    if ("ijlI.,:;|!'".includes(ch)) w += 3.6;
    else if ("ft()[] r".includes(ch)) w += 4.6;
    else if ("mwMW".includes(ch)) w += 10.2;
    else if (/[A-Z0-9]/.test(ch)) w += 7.6;
    else w += 6.6;
  }
  return Math.ceil(w * 0.9);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The badge message and colour for a compact report (or null for an error). */
export function badgeState(report) {
  if (!report || report.ok === false) return { message: "check failed", color: COLORS.error };
  const c = report.counts || {};
  switch (report.verdict) {
    case "passes": return { message: "conforming", color: COLORS.pass };
    case "passes-with-warnings": return { message: `conforming · ${c.warn} tip${c.warn === 1 ? "" : "s"}`, color: COLORS.tips };
    case "fails": return { message: `${c.fail} MUST failing`, color: COLORS.fail };
    default: return { message: "no agent manifest", color: COLORS.none };
  }
}

/** Render a flat badge. */
export function badgeSvg({ label = "agentic web", message, color }) {
  const lw = textWidth(label) + 26; // room for the check mark
  const mw = textWidth(message) + 14;
  const w = lw + mw;
  const title = `${label}: ${message}`;
  const id = `ac${[...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}`;
  const lt = lw - 22;
  const mt = mw - 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<linearGradient id="${id}s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="${id}r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#${id}r)"><rect width="${lw}" height="20" fill="#0f3d3e"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#${id}s)"/></g>
<path d="M7 10.2l2.6 2.6L14.6 7.4" fill="none" stroke="#b8f3d2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${(lw + 16) / 2}" y="15" fill="#010101" fill-opacity=".3" textLength="${lt}">${esc(label)}</text><text x="${(lw + 16) / 2}" y="14" textLength="${lt}">${esc(label)}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3" textLength="${mt}">${esc(message)}</text><text x="${lw + mw / 2}" y="14" textLength="${mt}">${esc(message)}</text>
</g></svg>`;
}
