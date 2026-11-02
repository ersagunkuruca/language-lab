// Generated programs on every engine (C101, REVIEW-2026-11-02c §3): small
// random typed definitions over Float64, Int, Bool and List Int, built from
// the palette's own parts (arithmetic, comparisons, if, let, a match on a
// list, map with a closure, the prelude's list jobs), each shown as text.
// The evaluator's text is the meaning; compiled JavaScript, WebAssembly
// and C must give the same. The examples (examples-agree.test.ts, I111)
// only check what some example does; these reach the corners none does.
//
// Every definition goes into one program, so each engine builds once: a
// few seconds in all. SEED=n runs another set (the failing seed is in the
// message); FUZZ=n makes n definitions instead of 40.
//
// Prior art: Csmith (Yang, Chen, Eide and Regehr, "Finding and
// understanding bugs in C compilers", PLDI 2011), differential testing of
// one program across compilers; QuickCheck's generators of typed values
// (Claessen and Hughes, 2000).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, toList, type Value } from "../../ters/src/lang/run.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { CONS, NIL } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { compile } from "../src/compile.ts";
import { isData, lowerScalar, type LType } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate, toInt } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";
import { program } from "./fuzz-programs.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { checkOptions } from "../../ters/src/lang/load.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const SEED = Number(process.env.SEED ?? 1), COUNT = Number(process.env.FUZZ ?? 40);

// The inputs every definition is called with.
// The last: Ints past 64 bits and a Float64 near the top (C115).
const INPUTS: [number, bigint, bigint[]][] = [[0, 0n, []], [2.5, 3n, [1n, 2n, 3n]], [-1, -2n, [5n, -4n]], [1e300, 2n ** 64n + 1n, [2n ** 62n, -(2n ** 63n), 7n]]];

test(`generated programs: the evaluator, compiled JavaScript, WebAssembly and C give the same text (C101, seed ${SEED})`, async () => {
  const p = program(SEED, COUNT, INPUTS.map(([, , xs]) => xs));
  assert.deepEqual(p.info.errors.map((e) => e.message), [], `seed ${SEED}`);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const args = (x: number, n: bigint, xs: bigint[]): Value[] => [x, norm(n), toList(xs.map(norm))];
  const said = (i: number, inp: unknown[]) => `seed ${SEED}, g${i}(${inp.map(String).join(", ")})`;
  // A stop (an overflow) is "stop" on every engine; its words may differ.
  const stopped = (f: () => unknown): unknown => { try { return f(); } catch { return "stop"; } };
  const want = p.defs.map(({ def }) => INPUTS.map(([x, n, xs]) => stopped(() => {
    for (const v of r.call(r.value(def), ...args(x, n, xs))) return v as unknown as string;
    return "no answer";
  })));

  // Every difference, by engine, so one run shows them all.
  const differ: string[] = [];
  // An overflow nobody uses may not be reported (FLOAT-VALUES-2026-11-01
  // §2): where the evaluator stops, a compiled engine that checked later
  // may give an answer. The other way round is a difference.
  const check = (got: unknown, i: number, j: number, engine: string) => { if (got !== want[i][j] && want[i][j] !== "stop") differ.push(`${said(i, INPUTS[j])} in ${engine}: ${String(got)}, the evaluator ${String(want[i][j])}`); };

  // Each engine on a program: the one generated, or the one with the
  // representations the chooser picks (C118).
  // `entry`: call e(x, n, j), whose list the program holds (C120), so a
  // list stored another way never comes in from outside.
  type Built = { code: typeof p.code; info: typeof p.info; names: typeof p.names };
  const engines = async (q: Built, tag: string, js = true, native = true, entry = false) => {
    const roots = entry ? p.entries : p.defs.map((d) => d.def), name = (i: number) => `${entry ? "e" : "g"}${i}`;
    if (js) {
    const path = join(mkdtempSync(join(tmpdir(), "fuzz-")), "out.mjs");
    writeFileSync(path, compile(q.code, q.info, q.names, { runtime, exports: p.defs.map((_, i) => name(i)) }));
    const js = (await import(pathToFileURL(path).href)).defs as Record<string, (...a: Value[]) => string>;
    p.defs.forEach((_, i) => INPUTS.forEach(([x, n, xs], j) => check(stopped(() => js[name(i)](...(entry ? [x, norm(n), norm(BigInt(j))] : args(x, n, xs)))), i, j, `JavaScript${tag}`)));
    }
    if (!native) return;

    const lowered = lowerScalar(q.code, q.info, q.names, roots, { data: true });
    assert.deepEqual([...lowered.refused.entries()].map(([d, why]) => `${q.names[d]}: ${why}`), [], `seed ${SEED}${tag}`);
    const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...a: unknown[]) => unknown>;
    // A List Int made by the module's own makers, from the end.
    const list = (xs: bigint[], t: LType): unknown => {
      if (!isData(t)) throw new Error("not a list");
      const maker = (v: Id) => { const c = t.cases.find((x) => x.variant === v)!; return (w[`${t.name}.${c.name}(${t.key})`] ?? w[`${t.name}.${c.name}`]) as (...a: unknown[]) => unknown; };
      return xs.reduceRight<unknown>((l, x) => maker(CONS)(toInt(w, x), l), maker(NIL)());
    };
    const fns = roots.map((def) => lowered.funcs.findIndex((g) => g.def === def && !g.inner));
    fns.forEach((fi, i) => {
      const f = lowered.funcs[fi];
      INPUTS.forEach(([x, n, xs], j) => {
        check(stopped(() => fromText(w, w[f.name](x, toInt(w, n), entry ? toInt(w, BigInt(j)) : list(xs, f.params[2])) as never)), i, j, `WebAssembly${tag}`);
      });
    });

    if (!skip) {
    const calls = fns.flatMap((fi) => INPUTS.map(([x, n, xs], j): [number, Value[]] => [fi, entry ? [x, norm(n), norm(BigInt(j))] : args(x, n, xs)]));
    const got = build(lowered)(calls);
    calls.forEach(([fi], c) => {
      const [i, j] = [Math.floor(c / INPUTS.length), c % INPUTS.length];
      const v = got[c].value as unknown;
      check(v && typeof v === "object" && "aborted" in v ? "stop" : v, i, j, `C${tag}`);
      if (got[c].live !== 0) differ.push(`${said(i, INPUTS[j])} in C${tag}: ${got[c].live} cells left (${lowered.funcs[fi].name})`);
    });
    }
  };
  await engines(p, "");
  // Through the chooser (C118): Map and Set as trees everywhere, as hash
  // tables where the host has a Map (the evaluator and compiled
  // JavaScript); WebAssembly and C take what they would.
  for (const hostMaps of [true, false]) {
    const c = withLibraryRepresentations(p.code, p.info, p.names, p.main, p.own, [], { hostMaps });
    if (!c.chosen.length) continue;
    const info = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
    assert.deepEqual(info.errors.map((e) => e.message), [], `seed ${SEED}, ${c.chosen.join(", ")}`);
    const tag = ` (${c.chosen.join(", ")})`;
    if (hostMaps) {
      const rc = makeRunner(c.code, info, { print: () => {}, names: c.names });
      p.entries.forEach((e, i) => INPUTS.forEach(([x, n], j) => check(stopped(() => { for (const v of rc.call(rc.value(e), x, norm(n), norm(BigInt(j)))) return v as unknown as string; return "no answer"; }), i, j, `the evaluator${tag}`)));
    }
    await engines({ code: c.code, info, names: c.names }, tag, hostMaps, !hostMaps, true);
  }
  assert.deepEqual(differ, []);
});
