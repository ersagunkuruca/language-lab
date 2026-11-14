// L255: what a view shows while what it asked for hasn't come. `while
// waiting(action, shown)` is the action's value if it has it now, else
// `shown`; on a page the view runs again with the reply when it lands, as
// Solid's and React's Suspense fallback. Where nothing waits (the command
// line blocks for the reply) it is the action's value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { showPage } from "../src/lang/page.ts";
import { runMain } from "../src/lang/run.ts";
import { ABORT_OP, HTML_V, IO, S } from "../src/lang/std.ts";
import { fakeDoc, FakeEl, FakeText } from "./fakedom.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null }; };
const texts = (n: FakeEl | FakeText): string[] => (n instanceof FakeText ? [n.textContent ?? ""] : n.kids.flatMap(texts));

// A view showing what /data.txt holds, "Loading…" till then, and why if it can't be had.
const fetched = (k: Lang) => k.call(S.whileWaiting, k.thunk(() => k.handle(k.call(IO.fetchText, k.lit("/data.txt")), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => why }])), k.lit("Loading…"));

test("a view shows while waiting's text till the reply lands, then the reply", async () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(k.call(HTML_V.text, k.thunk(() => fetched(k)))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  let land!: (s: string) => void;
  const page = showPage({ code, info, names, main, program: "t", doc: fakeDoc(), store: memory(), frame: () => {}, console: { log() {}, error() {} }, fetch: () => new Promise<string>((r) => (land = r)) });
  const root = page.root as FakeEl;
  assert.deepEqual(texts(root), ["Loading…"]);
  land("hello");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(texts(root), ["hello"]);
});

test("where nothing waits, while waiting is the action's value", () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, fetched(k))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names, world: { fetchText: () => "there" } as never });
  assert.deepEqual(out, ["there"]);
});

test("the compiled page shows while waiting's text till the reply lands, then the reply", async () => {
  const { lowerCore, corePageScript } = await import("../../compiler/src/core-js.ts");
  const core = await import("../../compiler/src/core-page-runtime.ts");
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(HTML_V.element, k.lit("div"), k.list(), k.list(k.call(HTML_V.text, k.thunk(() => fetched(k)))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  const ir = lowerCore(code, info, names, [main]);
  assert.equal(ir.refused.get(main), undefined);
  let given: unknown[] | null = null;
  new Function("$core", corePageScript(ir, names[main], "$core", ""))({ ...core, startCorePage: (...a: unknown[]) => { given = a; } });
  const [tables, worlds, defs, name, , nodes] = given! as never[];
  let land!: (s: string) => void;
  const was = globalThis.fetch;
  globalThis.fetch = (() => new Promise((r) => (land = (s: string) => r(new Response(s))))) as typeof fetch;
  try {
    const m = core.mountCorePage(tables, worlds, defs, name, "t", nodes, { doc: fakeDoc(), store: memory(), frame: () => {} });
    const root = m.root as FakeEl;
    assert.deepEqual(texts(root), ["Loading…"]);
    land("hello");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(texts(root), ["hello"]);
    m.stop();
  } finally { globalThis.fetch = was; }
});
