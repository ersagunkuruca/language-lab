// What a native page can't show, said at build time (C205, cli/native-
// check.ts): an element a box doesn't mean is refused, CSS outside
// c-layout.ts's subset is listed as left out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { base, loadProgram } from "../src/lang/load.ts";
import { Lang } from "../src/lang/dsl.ts";
import { HTML_V } from "../src/lang/std.ts";
import { nativePageReport } from "../cli/native-check.ts";

const example = (name: string) => { const p = loadProgram(join(import.meta.dirname, "../examples", name)); return nativePageReport(p.code, p.named("main")!); };

test("dice's page: nothing refused, its hover rules and transitions left out", () => {
  const r = example("dice");
  assert.deepEqual(r.refused, []);
  for (const x of ["rules on the state :hover (button:hover)", "the property transition"]) assert.ok(r.leftOut.includes(x), x);
  // What c-layout.ts reads isn't listed.
  for (const x of ["the property display", "the property gap", "the property font-size"]) assert.ok(!r.leftOut.includes(x), x);
});

test("an image, a checkbox and a picture's text are refused; a text field isn't", () => {
  const k = new Lang();
  const el = (tag: string, attrs: string[][], ...kids: string[]) =>
    k.call(HTML_V.element, k.lit(tag), k.listOf(...attrs.map(([n, v]) => k.call(HTML_V.property, k.lit(n), k.thunk(() => k.lit(v))))), k.listOf(...kids));
  const main = k.def("main");
  k.define(main, k.fn([], () => el("div", [["style", "display: flex; box-shadow: 0 1px 2px #0003"]],
    el("img", [["src", "a.png"]]), el("input", [["type", "checkbox"]]), el("input", [["type", "text"]]), el("svg", [], el("text", [])))));
  const r = nativePageReport(base(k.code), main);
  assert.deepEqual(r.refused, ["<img> (an image)", '<input type="checkbox"> (not a text field)', "<text> (a text in a picture)"]);
  assert.deepEqual(r.leftOut, ["the property box-shadow"]);
});

test("ters build-native-app refuses spacetime's page, naming what it can't show", () => {
  const out = spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "build-native-app", join(import.meta.dirname, "../examples/spacetime"), "-o", join(mkdtempSync(join(tmpdir(), "native-")), "app")], { encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /<text> \(a text in a picture\)/);
});
