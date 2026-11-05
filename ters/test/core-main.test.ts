// Run main from what an earlier lowering printed (E245c, editor/coreMain.ts):
// the run worker sends back main as printed from the core IR, which is
// plain data, and a run given it back (kept by Run for the same code, or
// built with the site, prebuild.ts) prints the same with no lowering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Code } from "../src/model.ts";
import { merge } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { onTodaysIds } from "../src/lang/std.ts";
import { exampleTables, type Manifest } from "../../editor/examplesPlugin.ts";
import type { CoreMain } from "../../editor/coreMain.ts";

const manifest = JSON.parse(readFileSync(new URL("../../editor/examples.json", import.meta.url), "utf8")) as Manifest;
function example(program: string) {
  const m = manifest.programs.find((p) => p.program === program)!;
  const fs = (m.folders ?? []).map((f) => onTodaysIds(exampleTables(manifest, f) as { code: Code; names: Record<string, string> }));
  const code = merge(LIBRARY.code, fs.map((f) => f.code).reduce((a, b) => merge(a, b)));
  const names = { ...LIBRARY.names, ...Object.assign({}, ...fs.map((f) => f.names ?? {})) };
  // The folders' pins (signatures.json), as the editor opens the example.
  const pins = Object.assign({}, ...fs.map((f) => (f as { signatures?: object }).signatures ?? {}));
  const files = (m.run?.files ?? []).map((f) => [`lab:${program}:${f}`, readFileSync(new URL(`../../${m.folders![0]}/${f}`, import.meta.url), "utf8")]);
  return { code, names, pins, files, def: code.defs.find((d) => !LIBRARY.code.nodes[d] && names[d] === "main")!, run: m.run };
}

// The worker's code (editor/runWorker.ts) answering one ask, in Node.
async function inWorker(ask: unknown): Promise<Record<string, unknown>[]> {
  const said: Record<string, unknown>[] = [];
  const self = globalThis as unknown as { self?: unknown; onmessage?: (e: { data: unknown }) => void; postMessage?: (m: unknown) => void };
  self.self ??= globalThis;
  self.postMessage = (m) => said.push(m as Record<string, unknown>);
  await import("../../editor/runWorker.ts");
  self.onmessage!({ data: ask });
  return said;
}
const printedLines = (said: Record<string, unknown>[]) => said.flatMap((m) => (m.lines as string[] | undefined) ?? []);

test("Run main again from what its first run printed, with no lowering, prints the same", async () => {
  for (const program of ["sort", "queens"]) {
    const { code, names, def, run } = example(program);
    const ask = { code, names, pins: {}, def, title: program, files: [], args: run?.args };
    const first = await inWorker(ask), end = first.at(-1)!;
    assert.equal(end.core, true, `${program}: ${JSON.stringify(end).slice(0, 200)}`);
    assert.ok(printedLines(first).length, `${program} printed nothing`);
    const kept = JSON.parse(JSON.stringify(end.printed)) as CoreMain;
    const t = performance.now();
    const again = await inWorker({ ...ask, code: { nodes: {}, defs: [] }, core: kept });
    const ms = performance.now() - t;
    assert.deepEqual(printedLines(again), printedLines(first), program);
    assert.equal(again.at(-1)!.shown, end.shown, program);
    assert.ok(ms < 500, `${program}: the kept main took ${ms | 0} ms`);
  }
});

// Where compiled main stopped goes back with the run's end (C143f), for
// Run's "Show where it stopped": the node the stop was lowered from and
// its definition.
test("a compiled main that stops says the node and definition it stopped at (C143f)", async () => {
  const { Lang } = await import("../src/lang/dsl.ts");
  const { base, baseNames } = await import("../src/lang/load.ts");
  const { S } = await import("../src/lang/std.ts");
  const { B } = await import("../src/prelude.ts");
  const k = new Lang();
  const grow = k.def("grow"), main = k.def("main");
  let shown = "";
  k.define(grow, k.fn(["x"], (x) => (shown = k.call(S.show, k.call(B.mul, k.call(B.mul, x, k.lit(1e300)), k.lit(1e300))))));
  k.define(main, k.fn([], () => k.call(S.print, k.call(grow, k.lit(1e10)))));
  const said = await inWorker({ code: base(k.code), names: { ...baseNames(), ...k.names }, pins: {}, def: main, title: "grow", files: [] });
  const end = said.at(-1)!;
  assert.equal(end.core, true, JSON.stringify(end).slice(0, 300));
  assert.match(String(end.error), /overflow/);
  assert.deepEqual(end.at, { node: shown, def: grow });
});

// I171: machine's pins are in its folder's signatures.json (L173c); without
// them its fields mapped has no type where it's used, and Run main stopped
// at once.
test("machine's Run main, opened as the editor opens it, prints its programs' results", async () => {
  const { code, names, pins, files, def, run } = example("machine");
  assert.ok(Object.keys(pins).length, "machine's pins read");
  const said = await inWorker({ code, names, pins, def, title: "machine", files, args: run?.args });
  const end = said.at(-1)!;
  assert.equal(end.error, undefined, String(end.error));
  assert.ok(printedLines(said).includes("== primes.asm"), printedLines(said).join("\n"));
});
