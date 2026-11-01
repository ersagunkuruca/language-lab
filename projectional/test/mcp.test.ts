// The MCP server (mcp/): what an LLM reads and runs, through the protocol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, call } from "../mcp/server.ts";

const text = (name: string, args: Record<string, unknown> = {}) => {
  const r = call(name, args);
  assert.equal(r.error, false, r.text);
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
