// The views and notations a program can be shown in (styles/*.json), as
// JSON imports so ters bundled into one file has them (I272).
import blocks from "../styles/blocks.json" with { type: "json" };
import graph from "../styles/graph.json" with { type: "json" };
import lisp from "../styles/lisp.json" with { type: "json" };
import math from "../styles/math.json" with { type: "json" };
import plain from "../styles/plain.json" with { type: "json" };
import type { Style } from "./presentation.ts";

export const STYLES: Record<string, Style> = { blocks, graph, lisp, math, plain } as unknown as Record<string, Style>;

export function styleNamed(name: string): Style {
  const s = STYLES[name];
  if (!s) throw new Error(`no style ${name} (${Object.keys(STYLES).join(", ")})`);
  return s;
}
