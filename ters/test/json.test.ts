// JSON (L190, RFC 8259): a Json value printed as JSON text, written in the
// language. The evaluator and compiled JavaScript agree, and the host's
// JSON.parse reads back what was written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { JSON_V, PAIR_V, SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program(body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, body(k))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main };
}
const ran = (p: ReturnType<typeof program>) => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
async function both(body: (k: Lang) => Id) {
  const p = program(body);
  const v = ran(p);
  const path = join(mkdtempSync(join(tmpdir(), "json-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v;
}
test("json printed writes null, Bools, numbers, quoted text, lists and objects, as JSON.parse reads them", async () => {
  const value = { name: "a \"b\"\\\n\u0001é", n: -2.5, big: 1e21, ok: true, none: null, items: [1, [], {}] };
  const json = (k: Lang, v: unknown): Id => {
    if (v === null) return k.x(JSON_V.null);
    if (typeof v === "boolean") return k.call(JSON_V.bool, v ? k.true : k.false);
    if (typeof v === "number") return k.call(JSON_V.number, k.lit(v));
    if (typeof v === "string") return k.call(JSON_V.text, k.lit(v));
    if (Array.isArray(v)) return k.call(JSON_V.list, k.listOf(...v.map((x) => json(k, x))));
    return k.call(JSON_V.object, k.listOf(...Object.entries(v as object).map(([n, x]) => k.call(PAIR_V, k.lit(n), json(k, x)))));
  };
  const shown = await both((k) => k.call(lib("json printed"), json(k, value)));
  const printed = JSON.parse(shown as string) as string;
  assert.deepEqual(JSON.parse(printed), value);
  assert.equal(printed, JSON.stringify(value));
});
