// C327c2 (ALLOCATIONS-2026-11-24.md): a loop on WebAssembly keeps the
// array views it walks as its buffer, start and length (wasm-views.ts),
// and makes one where a view leaves it. Here a sort (merge sort, its
// merge walking two arrays by `rest` and building its answer by pushes)
// and a map, on lists the compiler keeps as arrays (`sort with`: `sort`
// on an array is the target's own since C355): `ters wasi` prints what
// `ters run` prints, with views by value and without, and the views made
// (TERS_COUNT_VIEWS) are fewer than half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "../../ters/mcp/server.ts";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts");

function written(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "wasm-views-")), "views");
  mkdirSync(dir);
  writeFileSync(join(dir, "code.json"), JSON.stringify({ nodes: {}, defs: [] }) + "\n");
  writeFileSync(join(dir, "names.default.json"), "{}\n");
  const ask = (name: string, args: Record<string, unknown>) => { const r = call(name, args); assert.ok(!r.error, r.text); };
  ask("open", { path: dir });
  ask("define", { name: "main", kind: "function", params: ["arguments"] });
  ask("replace", { at: "main", find: "□", text: 'n = (length(append(["a"], arguments)) - 1) * 500; □' });
  ask("replace", { at: "main", find: "□", text: "xs = sort with(map(range(n), (i) => i * (n - i)), (a, b) => compare(a, b)); □" });
  ask("replace", { at: "main", find: "□", text: 'print(join all([show(length(xs)), show(item at(xs, 0, -1)), show(item at(xs, quotient(n, 2), -1)), show(item at(xs, n - 1, -1)), show(sum(map(xs, (x) => x * 2)))], " "))' });
  return dir;
}

// Run in a child, its memory read after: the count is at 120.
function views(wasm: string, args: string[]): { out: string; made: bigint } {
  const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", `
    import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
    const w = new WASI({ version: "preview1", args: ["views", ...${JSON.stringify(args)}], returnOnExit: true });
    const i = new WebAssembly.Instance(await WebAssembly.compile(readFileSync(${JSON.stringify(wasm)})), wasiImports(w));
    w.start(i);
    console.error("made " + new DataView(i.exports.memory.buffer).getBigInt64(120, true));`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out: r.stdout, made: BigInt(/made (\d+)/.exec(r.stderr)![1]) };
}

test("a loop's views by value on WebAssembly: the same answers, fewer than half the views", () => {
  const dir = written(), args = ["x", "y", "z"];
  const run = spawnSync(process.execPath, [lab, "run", dir, ...args], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^1500 0 421875 562500 1124999500\n$/);
  const made: bigint[] = [];
  for (const env of [{ NO_WASM_VIEWS: "1" }, {}]) {
    const wasm = join(mkdtempSync(join(tmpdir(), "wasm-views-w-")), "p.wasm");
    const b = spawnSync(process.execPath, [lab, "wasi", dir, "-o", wasm], { encoding: "utf8", env: { ...process.env, ...env, TERS_COUNT_VIEWS: "1" } });
    assert.equal(b.status, 0, b.stderr);
    const r = views(wasm, args);
    assert.equal(r.out, run.stdout, JSON.stringify(env));
    made.push(r.made);
  }
  assert.ok(made[1] * 2n < made[0], `views made: ${made[0]} as structs, ${made[1]} by value`);
});
