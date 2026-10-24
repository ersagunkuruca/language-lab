// The editor's Blocks pane (editor/typed.ts renderTyped) reads as the blocks
// text does (src/lang/render.ts): field reads, values taken apart, actions
// by name and nested patterns. Drawn on a document small enough to print,
// one line per line of the pane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";

class El {
  kids: (El | string)[] = [];
  attrs = new Map<string, string>();
  title = "";
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  append(...ks: (El | string)[]) { this.kids.push(...ks); }
  get textContent(): string { return this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); }
  // What it reads, without what only the pane shows beside it (types).
  get text(): string { return this.kids.map((k) => (typeof k === "string" ? k : /\baside\b/.test(k.attrs.get("class") ?? "") ? "" : k.text)).join(""); }
  // Lines as the pane shows them: each .ln on its own line, indented as
  // far as the boxes around it are (22px is two spaces of the text).
  lines(): string[] {
    const out: string[] = [];
    const walk = (e: El, ind: string) => {
      const pad = /padding-left: (\d+)px/.exec(e.attrs.get("style") ?? "")?.[1];
      const more = pad ? " ".repeat(+pad / 11) : /\bind\b/.test(e.attrs.get("class") ?? "") ? "  " : "";
      if (/\bln\b/.test(e.attrs.get("class") ?? "")) { out.push(ind + more + e.text); return; }
      for (const k of e.kids) if (typeof k !== "string") walk(k, ind + more);
    };
    walk(this, "");
    return out;
  }
}
(globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new El(tag) };
const { renderTyped } = await import("../editor/typed.ts");
const { renderBlocks } = await import("../src/lang/render.ts");

const pane = (example: string, def: string) => {
  const p = loadProgram(join(root, "examples", example));
  return (renderTyped(p.code, p.pres, infer(p.code, p.pres.names), p.named(def), null) as unknown as El).lines().map((l) => l.trim());
};

test("the Blocks pane reads a field as p.x", () => {
  assert.ok(pane("ledger", "larger").some((l) => l.includes("b.cents < a.cents")), pane("ledger", "larger").join("\n"));
});

test("the Blocks pane reads a value taken apart as a step", () => {
  const results = pane("countdown", "results");
  assert.ok(results.includes("found(expr, value) = results(front)"), results.join("\n"));
});

test("the Blocks pane reads an action by name", () => {
  const main = pane("queens", "main");
  assert.ok(main.some((l) => l.includes("first(queens(8), else nil)")) && main.some((l) => l.includes("count(queens(8))")), main.join("\n"));
});

test("the Blocks pane reads nested matches as rows of patterns", () => {
  const parse = pane("ledger", "parse");
  assert.ok(parse.some((l) => l.startsWith("[date, account, cents, memo] → entry(")), parse.join("\n"));
  assert.ok(!parse.some((l) => l.startsWith("match ‹after") || l.startsWith("match after")), parse.join("\n"));
});

// (Cases that say the same thing still read once in the text and stay
// separate rows in the pane, each its own node to edit: PATTERNS.md step 4.)
test("the Blocks pane shows every definition line for line as the blocks text prints it", () => {
  for (const example of ["queens", "countdown", "sort", "dice", "physics", "effects", "relations"]) {
    const p = loadProgram(join(root, "examples", example));
    const info = infer(p.code, p.pres.names);
    for (const def of p.own.defs) {
      // A long text is clipped in the pane; what the text says is the same.
      const texts = (ls: string[]) => ls.map((l) => l.replace(/"(?:[^"\\]|\\.)*"(?: · \d+ lines)?/g, '"…"'));
      const text = texts(renderBlocks(p.code, p.pres, info, def).split("\n"));
      const shown = texts((renderTyped(p.code, p.pres, info, def, null) as unknown as El).lines());
      assert.deepEqual(shown, text, `${example} ${p.pres.names[def]}`);
    }
  }
});
