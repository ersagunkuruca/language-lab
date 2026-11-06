// The MCP server (mcp/): what an LLM reads and runs, through the protocol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, call } from "../mcp/server.ts";

const text = (name: string, args: Record<string, unknown> = {}) => {
  const r = call(name, args);
  assert.equal(r.error, false, `${name}: ${r.text}`);
  return r.text;
};

test("initialize and tools/list answer, briefly", () => {
  const init = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as { result: { instructions: string } };
  assert.ok(init.result.instructions.length < 500);
  const list = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as { result: { tools: { name: string; description: string }[] } };
  assert.ok(list.result.tools.some((t) => t.name === "view"));
  for (const t of list.result.tools) assert.ok(t.description.length < 160, t.name);
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("open lists definitions with short ids; view shows names with their ids", () => {
  const defs = text("open", { path: "examples/tumble" });
  assert.match(defs, /^[0-9a-v]{4,}  fall : \(Board\) -> Board$/m);
  const fall = text("view", { at: "fall" });
  assert.match(fall, /fall#[0-9a-v]{4,}\(board#[0-9a-v]{4,}\) =/);
  // A block's id in the gutter can be viewed on its own.
  const cascade = text("view", { at: "cascade", depth: 1 });
  const stub = /^([0-9a-v]{4,}) +…$/m.exec(cascade);
  assert.ok(stub, cascade);
  assert.ok(text("view", { at: stub[1] }).startsWith("in cascade:"));
});

test("an unknown id is an error, not a crash", () => {
  text("open", { path: "examples/tumble" });
  const r = call("view", { at: "no such thing" });
  assert.equal(r.error, true);
});

test("run returns what main prints, with standard input given", () => {
  text("open", { path: "examples/wc" });
  assert.match(text("run", { input: "hello world\nfoo\n" }), /2\s+3\s+16\nexit 0/);
});

test("edits: each is type-checked, saved, and answered with the changed lines", async () => {
  const { cpSync, mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "tumble");
  cpSync("examples/tumble", dir, { recursive: true });
  text("open", { path: dir });
  // A new function, its hole filled, taken apart, given a body.
  const hole = /□#(\w+)/.exec(text("define", { name: "holes left", kind: "function", params: ["board"] }))![1];
  assert.match(text("replace", { at: hole, text: "total(board)" }), /^\+ .*: \(Board\) -> Float64$/m);
  assert.match(text("split", { at: "holes left", find: "total(board)", on: "board" }), /board\(columns#\w+\) = board/);
  text("replace", { at: "holes left", find: "total(board)", text: "length(keep(flatten(columns), (x) => x < 0))" });
  assert.equal(text("eval", { text: "holes left(board([[-1, 1], [2, -1]]))" }), "= 2 : Int");
  // One that adds a type error is refused and changes nothing.
  const before = readFileSync(join(dir, "code.json"), "utf8");
  const bad = call("replace", { at: "holes left", find: "x < 0", text: "x ++ 1" });
  assert.equal(bad.error, true);
  assert.equal(readFileSync(join(dir, "code.json"), "utf8"), before);
  // A rename is a side-table change; uses follow.
  text("rename", { at: "holes left", name: "holes" });
  assert.match(readFileSync(join(dir, "names.default.json"), "utf8"), /"holes"/);
  assert.equal(text("eval", { text: "holes(board([[-1]]))" }), "= 1 : Int");
  text("undo");
  assert.equal(call("eval", { text: "holes(board([[-1]]))" }).error, true);
  // A step: name = value, before a part.
  assert.match(text("step", { at: "fall", name: "n", value: "total(board)" }), /^\+ .*n#\w+ = total\(board\)$/m);
});

test("a split's cases show folded as otherwise; case= changes one, otherwise changes the rest", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "tumble");
  cpSync("examples/tumble", dir, { recursive: true });
  text("open", { path: dir });
  const hole = /□#(\w+)/.exec(text("define", { name: "loud", kind: "function", params: ["m"] }))![1];
  text("replace", { at: hole, text: "moment name(m)" });
  const split = text("split", { at: "loud", find: "moment name(m)", on: "m" });
  const m = /^\+ (\w+)\s+match m$/m.exec(split)![1];
  assert.match(split, /otherwise is: swapped, swapped back, cleared, fell, filled/);
  text("replace", { at: m, case: "swapped", text: '"swap!"' });
  text("replace", { at: "loud", find: "moment name(m)", text: '"!"' });
  assert.equal(text("eval", { text: "map([swapped, fell, filled], loud)" }), '= ["swap!", "!", "!"] : List Text');
  assert.match(text("search", { text: "swap!" }), /^\w+ +loud: "swap!"$/m);
});

test("pin holds a definition's type, kept in the folder's signatures.json, so a body can rely on it (L173c)", async () => {
  const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { loadProgram } = await import("../src/lang/load.ts");
  const { infer } = await import("../src/lang/infer.ts");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "machine");
  cpSync("../compiler/gaps/machine", dir, { recursive: true });
  const errors = () => { const p = loadProgram(dir); return infer(p.code, p.pres.names, undefined, p.options).errors.map((e) => e.message); };
  // machine's args mapped is fields mapped of its input, which says
  // nothing of the input's type: its pin does.
  assert.deepEqual(errors(), []);
  text("open", { path: dir });
  const pins = readFileSync(join(dir, "signatures.json"), "utf8");
  const off = call("pin", { at: "args mapped", off: true });
  assert.equal(off.error, true);
  assert.match(off.text, /fields mapped needs the value's data type known here/);
  assert.equal(readFileSync(join(dir, "signatures.json"), "utf8"), pins);
  // An edit inside is checked at the pinned type.
  assert.match(text("replace", { at: "args mapped", find: "fields mapped(instruction, f)", text: "fields mapped(instruction, (a) => f(a))" }), /\(a#\w+\) => f\(a\)/);
  assert.match(text("view", { at: "args mapped", depth: 1 }), /: \(Instr, \(Arg\) -\[e\]-> Arg\) -\[e\]-> Instr/);
  // Without its pins the folder doesn't check; with them, from a pin made here, it does.
  rmSync(join(dir, "signatures.json"));
  assert.match(errors().join("; "), /fields mapped needs/);
  // A pin made here is written there again.
  text("open", { path: dir });
  assert.match(text("pin", { at: "zeros" }), /^ok: zeros : /);
  assert.ok(existsSync(join(dir, "signatures.json")));
});

test("types with fields and cases, an interface with ports, a way at a cost, and `by its ways` are written through the MCP (I183)", async () => {
  const { cpSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "ters-mcp-"));
  const dir = join(root, "seed");
  (await import("node:fs")).mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), '{"nodes":{},"defs":[]}');
  text("open", { path: dir });
  // break's seed (compiler/gaps/break), written as text.
  assert.match(text("define", { name: "Vec", kind: "type", first: "vec(x: Float64, y: Float64)" }), /\| vec\(x#\w+: Float64, y#\w+: Float64\)/);
  text("define", { name: "Ball", kind: "type", first: "ball(number: Int, place: Vec, velocity: Vec)" });
  assert.match(text("define", { name: "Table", kind: "type", first: "table(time: Float64, balls: List Ball, log: List Text)" }), /balls#\w+: List Ball, log#\w+: List Text/);
  text("define", { name: "Event", kind: "type", first: "meets(time: Float64, first: Int, second: Int)" });
  assert.match(text("add_case", { at: "Event", case: "drops(time: Float64, ball: Int)" }), /\| drops\(time#\w+: Float64, ball#\w+: Int\)/);
  assert.match(text("define", { name: "Toucher", kind: "interface", first: "gap at: (a, Ball, Float64) -> Float64" }), /‹gap at›#\w+ : \(a, Ball, Float64\) -> Float64/);
  assert.match(text("ports", { at: "gap at", ports: ["obstacle", "ball", "t", "gap"] }), /ports: obstacle, ball, t -> gap/);
  assert.match(text("add_field", { at: "Toucher", name: "first touch", type: "(a, Ball, Float64) -[Choice]-> Float64", ports: ["obstacle", "ball", "gap", "t"] }), /-\[Choice\]-> Float64[\s\S]*ports: obstacle, ball, gap -> t/);
  assert.match(text("add_way", { at: "first touch", name: "first touch by advancing", cost: 10 }), /a way of ‹first touch›, cost 10/);
  assert.equal(call("add_field", { at: "Ball", name: "spin", type: "Spin" }).text, "no type named Spin");
  assert.equal(call("ports", { at: "gap at", ports: ["x"] }).error, true);
  // An implementation's field left to its ways.
  const brk = join(root, "break");
  cpSync("../compiler/gaps/break", brk, { recursive: true });
  text("open", { path: brk });
  const hole = /□#(\w+)/.exec(text("replace", { at: "pocket toucher", find: "by its ways", text: "□" }))![1];
  assert.match(text("replace", { at: hole, text: "by its ways" }), /^\+ .*‹first touch›#\w+: ‹by its ways›$/m);
});
