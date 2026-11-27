// Lists that can stay on the GPU between a page's ticks (G13a,
// gpu-resident.ts): rain-page's drops, read only by the slide's kernel and
// the frame's draw, and nothing in pages whose lists the CPU reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { represented, type Program } from "../../ters/cli/represented.ts";
import { lowerCore } from "../src/core-js.ts";
import { gpuMaps } from "../src/gpu-maps.ts";
import { keptOnGpu, residentLists } from "../src/gpu-resident.ts";

const root = fileURLToPath(new URL("../../ters/examples/", import.meta.url));
const resident = (name: string, held: ReadonlySet<string> = new Set()) => {
  const p = loadProgram(root + name), names = p.pres.names, main = p.own.defs.find((d) => names[d] === "main")!;
  const info = infer(p.code, names, undefined, p.options);
  const given: Program = { title: name, code: p.code, own: p.own.defs, names, info, reps: representationsIn(p.code, info, names, p.own.defs), options: p.options };
  const r = represented(given, main, true), ir = lowerCore(r.code, r.info, r.names, [main]);
  const kernels = gpuMaps(ir), out = residentLists(ir, kernels, held);
  return { ...out, kernels: Object.keys(kernels).map(Number), kept: keptOnGpu(ir, kernels, held), out: (s: number) => kernels[s].words?.out };
};

test("rain-page's drops stay on the GPU between ticks: only the slide's kernel and the draw read them (G13a)", () => {
  const r = resident("rain-page");
  assert.deepEqual(r.fields.map((f) => `${f.type}'s ${f.field}`), ["Pane's drops"]);
  // The slide's answers go back into the field, so its site keeps them.
  assert.deepEqual(r.sites, r.kernels);
  // Its draw takes the kernel's buffer as it is: every leaf of a drop, in
  // the kernel's order (G13b).
  assert.equal(r.draws.length, 1);
  assert.deepEqual(r.kept.resident.draws, r.draws);
  for (const d of r.draws) assert.deepEqual(r.kept.draws[d].instance, r.out(r.sites[0]));
  // Held on the CPU, by the field's node: none stays.
  const cpu = resident("rain-page", new Set([r.fields[0].at]));
  assert.deepEqual([cpu.fields, cpu.kept.resident.fields], [[], []]);
  // and its draw sends only the leaves the vertex reads.
  for (const d of r.draws) assert.ok(cpu.kept.draws[d].instance.length < r.kept.draws[d].instance.length);
});

// moths-page has a kernel too, but its lists are read on the CPU as
// well; the others have none.
for (const [name, kernels] of [["moths-page", 1], ["flock-page", 0], ["greenhouse-page", 0], ["dice", 0]] as const) {
  test(`${name}'s lists stay on the CPU (G13a)`, () => {
    const r = resident(name);
    assert.equal(r.kernels.length, kernels);
    assert.deepEqual(r.fields, []);
  });
}
