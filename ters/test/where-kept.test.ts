// Build targets kept (I316, editor/whereRuns.ts): a definition's answer
// follows from it and what it uses, so the editor keeps it by its hash and
// asks only about the definitions an edit reaches; the worker keeps its
// last check and checks an edit over it. Asked about some definitions, the
// answers are those asked about all of them at once, and the same after
// an edit checked over the last check as after a whole check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Code, Node } from "../src/model.ts";
import { merge, nodeIds, nodeValues, withNodes } from "../src/model.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { onTodaysIds } from "../src/lang/std.ts";
import { infer as wholeCheck } from "../src/lang/infer.ts";
import { exampleTables, type Manifest } from "../../editor/examplesPlugin.ts";
import { infer, programOptions, setDisplayNames, setProgramPins } from "../../editor/typed.ts";
import { sendCode } from "../../editor/runCode.ts";
import { receivedOnto, whereAnswers } from "../../editor/whereAnswers.ts";
import { whereKeys } from "../../editor/whereRuns.ts";

const manifest = JSON.parse(readFileSync(new URL("../../editor/examples.json", import.meta.url), "utf8")) as Manifest;
function example(program: string) {
  const m = manifest.programs.find((p) => p.program === program)!;
  const fs = (m.folders ?? []).map((f) => onTodaysIds(exampleTables(manifest, f) as { code: Code; names: Record<string, string> }));
  const code = merge(LIBRARY.code, fs.map((f) => f.code).reduce((a, b) => merge(a, b)));
  const names = { ...LIBRARY.names, ...Object.assign({}, ...fs.map((f) => f.names ?? {})) };
  return { code, names, own: code.defs.filter((d) => !LIBRARY.code.nodes[d]) };
}

test("asked about some definitions, each answer is what asking about all gives", () => {
  let both = 0;
  for (const program of ["mandelbrot", "tumble", "queens"]) {
    const { code, names, own } = example(program);
    setDisplayNames(names);
    setProgramPins({});
    const info = infer(code, names);
    const all = whereAnswers(code, info, names, own);
    if (all.some(([, gpu]) => gpu === null) && all.some(([, gpu]) => gpu !== null)) both++;
    const half = Math.ceil(own.length / 2);
    const parts = [...whereAnswers(code, info, names, own.slice(0, half)), ...whereAnswers(code, info, names, own.slice(half))];
    assert.deepEqual(parts, all, program);
  }
  assert.ok(both >= 1, "a program with some definitions on the GPU and some not");
});

test("sent again, a program's unchanged nodes are last time's, and an edit's answers are a whole check's", () => {
  const { code, names, own } = example("tumble");
  setDisplayNames(names);
  setProgramPins({});
  const first = receivedOnto(sendCode(code), null);
  assert.equal(receivedOnto(sendCode(first), first), first, "the same program is the same code");
  // An edit: a number in one definition changed.
  const lit = nodeValues(first.nodes).find((n): n is Node & { kind: "lit"; value: number } => n.kind === "lit" && typeof n.value === "number" && !LIBRARY.code.nodes[n.id] && n.value === 2)!;
  assert.ok(lit, "tumble has a 2");
  const edited: Code = { ...first, nodes: withNodes(first.nodes, { [lit.id]: { ...lit, value: 3 } }) };
  const second = receivedOnto(sendCode(edited), first);
  const same = nodeIds(second.nodes).filter((id) => second.nodes[id] === first.nodes[id]).length;
  assert.equal(same, nodeIds(second.nodes).length - 1, "only the edited node is new");
  infer(first, names);
  const over = infer(second, names);
  const whole = wholeCheck(second, names, undefined, programOptions());
  assert.deepEqual(whereAnswers(second, over, names, own), whereAnswers(second, whole, names, own));
  // The keys follow what changed: the edited definition's, and its users'.
  const k1 = whereKeys(first, names, {}), k2 = whereKeys(second, names, {});
  const changed = own.filter((d) => k1.get(d) !== k2.get(d));
  assert.ok(changed.length >= 1 && changed.length < own.length, `${changed.length} of ${own.length} keys changed`);
});
