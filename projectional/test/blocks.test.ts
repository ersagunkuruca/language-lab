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
  // What it reads, without the types shown beside names.
  get text(): string { return this.kids.map((k) => (typeof k === "string" ? k : /\bty\b/.test(k.attrs.get("class") ?? "") ? "" : k.text)).join(""); }
  // Lines as the pane shows them: each .ln on its own line.
  lines(): string[] {
    const out: string[] = [];
    const walk = (e: El) => {
      if (/\bln\b/.test(e.attrs.get("class") ?? "")) { out.push(e.text); return; }
      for (const k of e.kids) if (typeof k !== "string") walk(k);
    };
    walk(this);
    return out;
  }
}
(globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new El(tag) };
const { renderTyped } = await import("../editor/typed.ts");

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
