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
