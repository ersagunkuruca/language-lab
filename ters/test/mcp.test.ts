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

test("a match's cases are written through the MCP: a split by a type named, a case's field by its name (I184)", async () => {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "events");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), '{"nodes":{},"defs":[]}');
  text("open", { path: dir });
  text("define", { name: "Event", kind: "type", first: "meets(time: Float64, first: Int, second: Int)" });
  text("add_case", { at: "Event", case: "drops(time: Float64, ball: Int)" });
  text("add_case", { at: "Event", case: "never" });
  const hole = /□#(\w+)/.exec(text("define", { name: "when", kind: "function", params: ["e"] }))![1];
  // Nothing fixes e's type yet: the split is told it.
  assert.equal(call("split", { at: hole, on: "e" }).text, "that variable's type has no cases");
  const holes = [...text("split", { at: hole, on: "e", as: "Event" }).matchAll(/→ □#(\w+)/g)].map((m) => m[1]);
  assert.equal(holes.length, 3);
  // Each arm's `time` is its own.
  text("replace", { at: holes[0], text: "time" });
  text("replace", { at: holes[1], text: "time" });
  text("replace", { at: holes[2], text: "1000000" });
  assert.equal(text("eval", { text: "when(drops(2.5, 3))" }), "= 2.5 : Float64");
  assert.equal(text("eval", { text: "when(meets(1.5, 1, 2))" }), "= 1.5 : Float64");
});

test("a saved folder opens as ters reads it: older shapes brought up to today's (I185)", () => {
  // crew was saved when a pair was std.pair; ters check finds nothing wrong.
  text("open", { path: "../compiler/gaps/crew" });
  assert.equal(text("check"), "ok");
});

test("a relation's solve is written as the view prints it, its ports by name (L231)", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "break");
  cpSync("../compiler/gaps/break", dir, { recursive: true });
  text("open", { path: dir });
  // break's touch time solves gap at for t; read the other way it is first touch.
  text("replace", { at: "touch time", find: "‹gap at›(obstacle = o, ball = b, gap = 0)", text: "first touch(o, b, 0)" });
  assert.match(text("replace", { at: "touch time", find: "‹first touch›(o, b, 0)", text: "gap at(obstacle = o, ball = b, gap = 0)" }), /^\+ .*first\(‹gap at›\(obstacle = o, ball = b, gap = 0\), else never\)$/m);
  assert.equal(call("replace", { at: "touch time", find: "‹gap at›(obstacle = o, ball = b, gap = 0)", text: "gap at(thing = o, ball = b, gap = 0)" }).text, "gap at has no port thing: its ports are obstacle, ball, t, gap");
  assert.equal(text("check"), "ok\n= `cushion rests` is the same as `pocket rests` (yours)\n= `pocket rests` is the same as `cushion rests` (yours)");
});

test("eval runs what may not end, within its steps, and says a type as the view does (I188)", () => {
  text("open", { path: "../compiler/gaps/break" });
  assert.equal(text("eval", { text: "played(break table(6, 0.01)).events" }), "= 47 : Int");
  assert.equal(text("eval", { text: "[1, 2]" }), "= [1, 2] : List a where a is a Number");
});

test("sharing through the MCP: publish, fetch, upgrade and downgrade, as ters does them (I186)", async () => {
  const { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "ters-mcp-"));
  // The signing key goes in a home of the test's own.
  const home = process.env.HOME;
  process.env.HOME = root;
  try {
    cpSync("../compiler/gaps/break", join(root, "break"), { recursive: true });
    text("open", { path: join(root, "break") });
    assert.equal(text("publish", { names: ["shifted", "apart"] }).split("\n").map((l) => l.replace(/, @\w+$/, "")).join("\n"), "Vec: version 1\nshifted: version 1\napart: version 1");
    assert.ok(existsSync(join(root, "break.module.json")) && existsSync(join(root, "break.module.log.json")));
    assert.equal(text("publish", { names: ["apart"] }), "nothing changed since the last publish");
    mkdirSync(join(root, "user"));
    writeFileSync(join(root, "user", "code.json"), '{"nodes":{},"defs":[]}');
    text("open", { path: join(root, "user") });
    assert.match(text("fetch", { from: join(root, "break.module.json") }), /^fetched break: 3 definitions checked by hash, Vec at version 1, shifted at version 1, apart at version 1, its log signed by its author/);
    assert.equal(text("upgrade"), "nothing to upgrade");
    assert.equal(call("downgrade", { name: "apart" }).text, "user uses nothing named apart that its store has versions of");
  } finally { process.env.HOME = home; }
});

test("a field two types have, on a value nothing types yet, is refused until `as` says whose (I187)", async () => {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "pockets");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), '{"nodes":{},"defs":[]}');
  text("open", { path: dir });
  text("define", { name: "Ball", kind: "type", first: "ball(place: Float64, speed: Float64)" });
  text("define", { name: "Pocket", kind: "type", first: "pocket(place: Float64, size: Float64)" });
  text("define", { name: "pocket gap", kind: "function", params: ["p", "x"] });
  assert.match(call("replace", { at: "pocket gap", find: "□", text: "p.place - x" }).text, /reads as a Ball or as a Pocket/);
  assert.match(text("replace", { at: "pocket gap", find: "□", text: "p.place - x", as: "Pocket" }), /\(Pocket, Float64\) -> Float64/);
});

test("a match is written as the view prints it, its cases on lines or after `;`s, one inside another (I212)", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "pond");
  cpSync("../compiler/gaps/pond", dir, { recursive: true });
  text("open", { path: dir });
  // pond's herons over (round 13 wrote it as a define, a split and a
  // replace per case), in one replace: the input's type from the cases.
  text("define", { name: "herons again", kind: "function", params: ["m", "ids"] });
  const herons = text("replace", { at: "herons again", find: "□", text: "match ids\n  nil → m\n  cons(head, tail) → herons again(put(m, head, start heron(head)), tail)" });
  assert.match(herons, /herons again›#\w+ : \(Map Int Heron, List Int\) -> Map Int Heron/);
  assert.match(herons, /cons\(head#\w+, tail#\w+\) → ‹herons again›\(put\(m, head, ‹start heron›\(head\)\), tail\)/);
  text("define", { name: "struck again", kind: "function", params: ["p", "ids"] });
  assert.match(text("replace", { at: "struck again", find: "□", text: "match ids; nil -> p; cons(h, t) -> struck again(struck(p, h), t)" }), /\(Pond, List Int\) -> Pond/);
  // The checker finds each the same as the one written case by case.
  assert.match(text("check"), /`herons over` is the same as `herons again`/);
  assert.match(text("check"), /`struck by` is the same as `struck again`/);
  // A case's body may be a match, on deeper lines.
  text("define", { name: "pairs", kind: "function", params: ["xs"] });
  assert.match(text("replace", { at: "pairs", find: "□", text: "match xs\n  nil → 0\n  cons(a, rest) →\n    match rest\n      nil → 0\n      cons(b, more) → 1 + pairs(more)" }), /\(List a\) -> b where b is a Number/);
  // Cases no type has together are refused.
  text("define", { name: "nothing", kind: "function", params: ["xs"] });
  assert.match(call("replace", { at: "nothing", find: "□", text: "match xs; nil -> 0; cons(h, t) -> 1; other -> 2" }).text, /no data type has the cases nil, cons, other/);
});

// Names that read as something else in round 14's rota (I218 M8, M9).
test("unit is the Unit value, and a case's field is itself, not a library case of its name (I218 M8 M9)", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "rota");
  cpSync("../compiler/gaps/rota", dir, { recursive: true });
  text("open", { path: dir });
  // M8: the view prints the Unit value `unit`, and reads it back so, not
  // as std's Choice `unit`, a function.
  text("define", { name: "checked", kind: "function", params: ["b"] });
  assert.match(text("replace", { at: "checked", find: "□", text: 'if b then unit else abort("no")' }), /checked›?#\w+ : \(Bool\) -\[Abort\]-> Unit/);
  // M9: `after` is the case's field, not Order's after.
  text("define", { name: "afters", kind: "function", params: ["xs"] });
  assert.match(text("replace", { at: "afters", find: "□", text: "match xs\n  nil → nil\n  cons(after, before) → [after, after]" }), /afters›?#\w+ : \(List a\) -> List a/);
});

// Round 14's rota driver wrote each of these round the MCP (I217).
test("steps on lines, a match on a value, and otherwise are read as the view prints them (I217 M3-M5)", async () => {
  const { cpSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "pond");
  cpSync("../compiler/gaps/pond", dir, { recursive: true });
  text("open", { path: dir });
  // M5: lets on lines of their own, the last line the value.
  text("define", { name: "stepped", kind: "function", params: ["n"] });
  const stepped = text("replace", { at: "stepped", find: "□", text: "c = n * 2\nk = c + 3\nk * k" });
  assert.match(stepped, /c#\w+ = n · 2/);
  assert.match(stepped, /k#\w+ = c \+ 3/);
  // M3: otherwise is every case not written.
  text("define", { name: "empty or not", kind: "function", params: ["xs"] });
  const either = text("replace", { at: "empty or not", find: "□", text: "match xs\n  nil → 0\n  otherwise → 1" });
  assert.match(either, /cons\(\w*#?\w*,? ?\w*#?\w*\) → 1|otherwise → 1/);
  assert.doesNotMatch(either, /^\+.*□/m);
  // M4: a match on a value that isn't a name, and on a name the step
  // before made.
  text("define", { name: "first of both", kind: "function", params: ["xs"] });
  const both = text("replace", { at: "first of both", find: "□", text: "match [xs, xs]\n  nil → xs\n  cons(h, t) → h" });
  assert.match(both, /it#\w+ = \[xs, xs\]/);
  assert.doesNotMatch(both, /^\+.*□/m);
  text("define", { name: "first of two", kind: "function", params: ["xs"] });
  const two = text("replace", { at: "first of two", find: "□", text: "ds = [xs, xs]\nmatch ds\n  nil → xs\n  cons(h, t) → h" });
  assert.match(two, /ds#\w+ = \[xs, xs\]/);
  assert.doesNotMatch(two, /^\+.*□/m);
});

// Round 14's rota wrote `Set (Tuple2 Text Int)` for the view's
// `Set (Text, Int)`, and `(Text)` for a word after an argument in
// parentheses (I217 M1).
test("a tuple type and a word after a type in parentheses are read as the view prints them (I217 M1)", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(mkdtempSync(join(tmpdir(), "ters-mcp-")), "rota");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), '{"nodes":{},"defs":[]}');
  text("open", { path: dir });
  assert.match(text("define", { name: "Plan", kind: "type", first: "plan(taken: Set (Text, Int), who: Map (Tuple2 Text Int) Text, pairs: List (Text, Int, Float64))" }),
    /taken#\w+: Set \(Tuple2 Text Int\), who#\w+: Map \(Tuple2 Text Int\) Text, pairs#\w+: List \(Tuple3 Text Int Float64\)/);
  assert.match(text("add_field", { at: "Plan", name: "pick", type: "((Text, Int)) -> (Int, Int)" }), /pick#\w+: \(Tuple2 Text Int\) -> Tuple2 Int Int/);
});
