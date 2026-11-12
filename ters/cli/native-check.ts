// What a native page can't show, said at build time (C205, NATIVE-APPS.md
// route A): `ters build-native-app` mounts a page on boxes, texts, text
// fields and pictures laid out by c-layout.ts, which reads a subset of CSS.
// An element whose meaning a box can't give (an image, a video, a menu to
// pick from, a checkbox) is a refusal naming it, since the page would mean
// something else; CSS outside the subset (a :hover rule, a transition, a
// sibling combinator) is listed as left out, since the page still means the
// same with it gone, only plainer.
//
// Read from the program, not from one run of it: every element written
// with its tag as a literal in what main reaches, and every literal text
// under a style element or in a style attribute. A tag or a style worked
// out when it runs isn't seen (a refusal at run time would be later than
// the build, which is the point).

import type { Code, Id, NodeOf } from "../src/model.ts";
import { dependencies, isCall, subtree } from "../src/model.ts";
import { HTML_V } from "../src/lang/std.ts";

// Elements with a meaning a box, a text field or a picture doesn't have.
const REFUSED: Record<string, string> = {
  img: "an image", picture: "an image", video: "a video", audio: "a sound player", canvas: "a canvas", iframe: "another page",
  object: "an embedded object", embed: "an embedded object", select: "a menu to pick from", option: "a menu's choice", datalist: "a list of suggestions",
  // Inside an svg the picture draws g, a, path, circle, ellipse, rect, line, polyline, polygon and text.
  image: "an image in a picture", use: "a shape used again in a picture", foreignObject: "a page inside a picture",
  textPath: "a text along a path", tspan: "a part of a text in a picture",
};
// An input is a text field; these kinds of input are something else.
const INPUT_REFUSED = new Set(["checkbox", "radio", "range", "color", "date", "datetime-local", "month", "week", "time", "file", "image"]);

// Properties c-layout.ts reads (tl_decl), and custom properties.
const READ = new Set(["animation", "animation-delay", "animation-duration", "animation-name", "aspect-ratio", "background", "background-color", "border", "border-bottom",
  "border-color", "border-left", "border-radius", "border-right", "border-top", "box-sizing", "color", "column-gap", "display", "fill", "fill-opacity", "flex-direction",
  "flex-wrap", "font", "font-size", "font-weight", "gap", "grid-template-columns", "height", "left", "line-height", "margin", "margin-bottom", "margin-top", "max-height",
  "max-width", "min-height", "overflow", "padding", "padding-bottom", "padding-top", "pointer-events", "position", "row-gap", "stroke", "stroke-dasharray",
  "stroke-linejoin", "stroke-opacity", "stroke-width", "text-align", "top", "width"]);
// Properties that change nothing a phone's screen shows: the platform's
// own font and pointer stand in.
const MOOT = new Set(["font-family", "cursor", "user-select", "-webkit-user-select", "touch-action", "-webkit-tap-highlight-color", "outline", "font-variant-numeric", "color-scheme"]);

export interface NativeReport { refused: string[]; leftOut: string[] }

export function nativePageReport(code: Code, root: Id): NativeReport {
  const reach = [root, ...dependencies(code, root)].filter((d) => code.nodes[d]?.kind === "def");
  const lit = (x: Id | undefined) => { const n = x ? code.nodes[x] : undefined; return n?.kind === "lit" && typeof n.value === "string" ? n.value : undefined; };
  const isVariant = (n: { fn: Id }, v: string) => { const f = code.nodes[n.fn]; return f?.kind === "ref" && f.target === v; };
  // The texts written under a node, through the definitions it names (a
  // page's `styles`), each once.
  const textsUnder = (top: Id, seen = new Set<Id>()): string[] => {
    const out: string[] = [];
    for (const x of subtree(code, top)) {
      const n = code.nodes[x];
      if (n.kind === "lit" && typeof n.value === "string") out.push(n.value);
      else if (n.kind === "ref" && !seen.has(n.target) && code.nodes[n.target]?.kind === "def" && (code.nodes[n.target] as NodeOf<"def">).body) {
        seen.add(n.target);
        out.push(...textsUnder((code.nodes[n.target] as NodeOf<"def">).body!, seen));
      }
    }
    return out;
  };
  // The library's helpers (tag("h1", …), a style attribute's): a
  // definition that hands one of its inputs on as an element's tag or a
  // property's name is read as the element or property itself, with that
  // input its name. Worked out to a fixed point over what main reaches.
  const elements = new Map<Id, number>([[HTML_V.element, 0]]), properties = new Map<Id, number>([[HTML_V.property, 0]]);
  const callee = (n: { fn: Id }) => { const f = code.nodes[n.fn]; return f?.kind === "ref" ? f.target : undefined; };
  for (let grew = true; grew;) {
    grew = false;
    for (const d of reach) {
      const lam = code.nodes[(code.nodes[d] as NodeOf<"def">).body ?? ""];
      if (lam?.kind !== "lambda") continue;
      for (const x of subtree(code, lam.body)) {
        const n = code.nodes[x], t = isCall(n) && n.args ? callee(n) : undefined;
        if (!t || !isCall(n) || !n.args) continue;
        for (const m of [elements, properties]) {
          const at = m.get(t);
          const a = at === undefined ? undefined : code.nodes[n.args[at]];
          const i = a?.kind === "ref" ? lam.params.indexOf(a.target) : -1;
          if (i >= 0 && !m.has(d)) { m.set(d, i); grew = true; }
        }
      }
    }
  }
  // And a definition that makes a style element from what it's given (the
  // library's style sheet, given rule(selector, declarations)s): its
  // calls' texts are the sheet.
  const stylers = new Set<Id>();
  for (let grew = true; grew;) {
    grew = false;
    for (const d of reach) {
      const body = (code.nodes[d] as NodeOf<"def">).body;
      if (!body || stylers.has(d)) continue;
      const makes = subtree(code, body).some((x) => {
        const n = code.nodes[x], t = isCall(n) && n.args ? callee(n) : undefined;
        return !!t && (stylers.has(t) || (elements.has(t) && lit((n as { args: Id[] }).args[elements.get(t)!]) === "style"));
      });
      if (makes) { stylers.add(d); grew = true; }
    }
  }
  const refused = new Set<string>(), leftOut = new Set<string>(), sheets: string[] = [], inline: string[] = [];
  for (const d of reach) {
    const body = (code.nodes[d] as NodeOf<"def">).body;
    if (!body) continue;
    for (const x of subtree(code, body)) {
      const n = code.nodes[x], t = isCall(n) && n.args ? callee(n) : undefined;
      if (!t || !isCall(n) || !n.args) continue;
      const rest = n.args.filter((_, j) => j !== (elements.get(t) ?? properties.get(t)));
      if (stylers.has(t)) sheets.push(...n.args.flatMap((a) => textsUnder(a)));
      if (elements.has(t)) {
        const tag = lit(n.args[elements.get(t)!]);
        if (tag === undefined) continue;
        if (REFUSED[tag]) refused.add(`<${tag}> (${REFUSED[tag]})`);
        if (tag === "style") sheets.push(...rest.flatMap((a) => textsUnder(a)));
        if (tag === "input") for (const r of rest) for (const a of subtree(code, r)) {
          const c = code.nodes[a], ct = isCall(c) && c.args ? callee(c) : undefined;
          if (ct && isCall(c) && properties.has(ct) && lit(c.args![properties.get(ct)!]) === "type") {
            for (const v of c.args!.filter((_, j) => j !== properties.get(ct)).flatMap((v) => textsUnder(v))) if (INPUT_REFUSED.has(v)) refused.add(`<input type="${v}"> (not a text field)`);
          }
        }
      } else if (properties.has(t) && lit(n.args[properties.get(t)!]) === "style") inline.push(...rest.flatMap((a) => textsUnder(a)));
    }
  }
  const decls = (text: string) => {
    for (const part of text.split(";")) {
      const m = /^\s*([-a-zA-Z]+)\s*:/.exec(part);
      if (!m || m[1].startsWith("--")) continue;
      const k = m[1].toLowerCase();
      if (!READ.has(k) && !MOOT.has(k)) leftOut.add(`the property ${k}`);
    }
  };
  const selectors = (list: string) => {
    for (const sel of list.split(",").map((x) => x.trim()).filter(Boolean)) {
      const bare = sel.replace(/:where\((.*)\)/, "$1").replace(/:root\b/, "");
      const why = /::/.test(bare) ? "a pseudo-element" : /:[a-z-]+/.test(bare) ? `the state ${/:[a-z-]+/.exec(bare)![0]}` : /\[/.test(bare) ? "an attribute selector" : /[+~]/.test(bare) ? "a sibling combinator" : null;
      if (why) leftOut.add(`rules on ${why} (${sel})`);
    }
  };
  const media = (q: string) => { if (q.trim() && !/prefers-color-scheme/.test(q)) leftOut.add(`@media ${q.trim()}`); };
  for (const css of sheets) {
    const s = css.replace(/\/\*[\s\S]*?\*\//g, "");
    if (s.includes("{")) {
      // A sheet written whole: each rule's selectors and declarations
      // (a keyframe's from and to are declarations too).
      for (const m of s.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        if (!/^\s*(from|to|\d+%)\s*$/.test(m[1])) selectors(m[1]);
        decls(m[2]);
      }
      for (const m of s.matchAll(/@media\s*([^{]*)\{/g)) media(m[1]);
    } else if (/^\s*(@media|\()/.test(s)) media(s.replace(/^\s*@media/, ""));
    // Declarations, as the library's rule(selector, declarations) takes
    // them, and a selector on its own: a declaration has a space after
    // its colon, or several are joined by semicolons.
    else if (/^\s*-{0,2}[a-zA-Z][-a-zA-Z]*\s*:\s/.test(s) || /;/.test(s)) decls(s);
    else selectors(s);
  }
  inline.forEach(decls);
  return { refused: [...refused].sort(), leftOut: [...leftOut].sort() };
}
