// WebAssembly for the scalar profile (scalar.ts): Number is f64, Bool is
// i32, a let is a local, `if` is `if … else … end`, and a call in tail
// position is `return_call`, so recursion as deep as you like runs in
// constant stack. Functions the host has and WebAssembly doesn't (sin,
// pow, …) are imported from `Math`, so the results are bit-for-bit the
// evaluator's.
//
// A budget (scalar.ts) is a mutable f64 global, what's left of it: a
// function the checker couldn't see end takes one on each call, and
// returns 0 at once when it's below 0; the budget then gives its fallback.
//
// A record (lowered with `records`) is a WasmGC struct with immutable
// fields, one struct type per record type, and a value of it is a
// reference to one: built by `struct.new`, read by `struct.get`
// (projectional/WASM.md, stage W1).
//
// Data with several cases (lowered with `data`: lists, expression trees)
// is a base struct holding the case's number as an i32, and one subtype
// of it per case, which adds the case's fields. A match puts the value in
// a local and jumps on the number with `br_table`; reading a field casts
// to the case first. Since such types may contain themselves, all the
// structs are written as one recursion group.
//
// No dependencies: the binary format is small enough to write directly
// (https://webassembly.github.io/spec/core/binary/), and a text version is
// printed alongside it for reading.

import { S, STD_IMPL } from "../../projectional/src/lang/std.ts";
import { assemble, runtime, textBytes, type RtFn, type VT } from "./wasm-rt.ts";
import { fails, isData, isFn, kids, OPS, type DType, type FType, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc, type SType } from "./scalar.ts";

const VAL: Record<SType | "i64", number> = { f64: 0x7c, i32: 0x7f, i64: 0x7e };
// The evaluator's show of a Number, which the runtime asks the host for
// outside the plain decimals it writes itself (wasm-rt.ts number.show).
const SHOW = STD_IMPL[S.show] as (x: number) => string;
const LIST_TEXT = "std.list<type.string<>>";
const HOST: Partial<Record<Op, { name: string; params: number }>> = {
  sin: { name: "sin", params: 1 }, cos: { name: "cos", params: 1 }, tan: { name: "tan", params: 1 },
  exp: { name: "exp", params: 1 }, log: { name: "log", params: 1 }, pow: { name: "pow", params: 2 }, atan2: { name: "atan2", params: 2 },
  mod: { name: "mod", params: 2 },
};
// The evaluator's own mod (std.ts), imported like Math's, so WASM agrees with it.
const MOD = STD_IMPL[S.mod] as (a: number, b: number) => number;
// float32: to f32 and back, which rounds to the nearest binary32 value.
const INSTR: Partial<Record<Op, [number | number[], string]>> = {
  add: [0xa0, "f64.add"], sub: [0xa1, "f64.sub"], mul: [0xa2, "f64.mul"], div: [0xa3, "f64.div"],
  neg: [0x9a, "f64.neg"], abs: [0x99, "f64.abs"], sqrt: [0x9f, "f64.sqrt"], floor: [0x9c, "f64.floor"],
  float32: [[0xb6, 0xbb], "f32.demote_f64 f64.promote_f32"],
  less: [0x63, "f64.lt"], equal: [0x61, "f64.eq"], beq: [0x46, "i32.eq"], and: [0x71, "i32.and"], or: [0x72, "i32.or"], not: [0x45, "i32.eqz"],
};

export interface Module { bytes: Uint8Array; wat: string; exports: string[] }

export function emitWasm(lowered: Lowered): Module {
  const { funcs } = lowered;
  // Host functions used, in a fixed order: they take the first indices.
  const hosts = (Object.keys(HOST) as Op[]).filter((op) => funcs.some((f) => uses(f.body, op)));
  const hostIndex = new Map(hosts.map((op, i) => [op, i]));
  // The runtime functions used, with the ones they use; `host.show` is an import.
  const rtNames: string[] = [];
  const need = (name: string) => {
    if (rtNames.includes(name)) return;
    rtNames.push(name);
    if (name !== "host.show") runtime(name).uses.forEach(need);
  };
  const rtCalls = (e: SExpr): void => { if (e.k === "rt") need(e.fn); kids(e).forEach(rtCalls); };
  funcs.forEach((f) => rtCalls(f.body));
  const texty = rtNames.length > 0 || funcs.some((f) => [...f.locals, f.result].includes("text") || mentionsText(f.body));
  // The host makes and reads texts through these.
  if (texty) ["text.new", "text.put", "text.size", "text.byte"].forEach(need);
  const hostShow = rtNames.includes("host.show");
  const rts: RtFn[] = rtNames.filter((n) => n !== "host.show").map(runtime);
  const imports = hosts.length + (hostShow ? 1 : 0);
  const fnIndex = (i: number) => imports + i;
  // A generic definition lowered at several types (plus on Vec and on
  // Colour) is exported under its name once, then with the types it's at.
  const exportName = (f: SFunc) => {
    const i = funcs.indexOf(f);
    if (funcs.findIndex((g) => g.name === f.name) === i) return f.name;
    return `${f.name}(${f.params.map((t) => (t === "f64" ? "Number" : t === "i32" ? "Bool" : t === "i64" ? "Int" : t === "text" ? "Text" : isFn(t) ? "Function" : t.name)).join(", ")})`;
  };

  // ---- binary
  const u = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
  const s = (n: number): number[] => {
    const out: number[] = [];
    for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) { out.push(b); return out; } out.push(b | 0x80); }
  };
  const str = (x: string) => { const b = [...new TextEncoder().encode(x)]; return [...u(b.length), ...b]; };
  const vec = (items: number[][]) => [...u(items.length), ...items.flat()];
  const section = (id: number, body: number[]) => [id, ...u(body.length), ...body];
  const f64 = (v: number) => [...new Uint8Array(new Float64Array([v]).buffer)];
  const sBig = (n: bigint): number[] => {
    const out: number[] = [];
    for (;;) { const b = Number(n & 0x7fn); n >>= 7n; if ((n === 0n && !(b & 0x40)) || (n === -1n && b & 0x40)) { out.push(b); return out; } out.push(b | 0x80); }
  };

  // Types: the structs first, as one recursion group: each record's, and
  // for each data type its base and then its cases'. Then one function
  // type per distinct signature. A value of either is a nullable
  // reference, so a local of one starts as null and `ref.null` is its zero.
  const recs = lowered.records, datas = lowered.data;
  // A type in the group: a struct, or (`func`) a closure's code's type.
  // A field with `code` holds a closure's code, a (ref $code) of that index.
  // `bytes`: Text's array.
  const structs: { name: string; fields: { name: string; t: LType; code?: number }[]; sup?: number; final: boolean; func?: FType; bytes?: true }[] = [];
  if (texty) structs.push({ name: "bytes", fields: [], final: true, bytes: true });
  const bytesIndex = 0;
  const recIndex = new Map<string, number>(), baseIndex = new Map<string, number>();
  const ident = (x: string) => x.replace(/[^\w]+/g, "_");
  for (const r of recs) { recIndex.set(r.key, structs.length); structs.push({ name: `${ident(r.name)}${structs.length}`, fields: r.fields, final: true }); }
  const CASE = { name: "case", t: "i32" as const };
  for (const d of datas) {
    const b = structs.length, name = `${ident(d.name)}${b}`;
    baseIndex.set(d.key, b);
    structs.push({ name, fields: [CASE], final: false });
    for (const c of d.cases) structs.push({ name: `${name}.${ident(c.name)}`, fields: [CASE, ...c.fields], sup: b, final: true });
  }
  // A function type: its closure's struct, holding the code, then the
  // code's type, taking the closure and the inputs; each closure's own
  // struct (a shape) adds what it captured.
  const cloIndex = new Map<string, number>();
  for (const t of lowered.fns) {
    const c = structs.length;
    cloIndex.set(t.key, c);
    structs.push({ name: `fn${c}`, fields: [{ name: "code", t: "i32", code: c + 1 }], final: false });
    structs.push({ name: `fn${c}.code`, fields: [], final: true, func: t });
  }
  const shapeIndex = lowered.shapes.map((sh, i) => {
    const c = cloIndex.get(sh.t.key)!;
    structs.push({ name: `fn${c}.closure${i}`, fields: [{ name: "code", t: "i32", code: c + 1 }, ...sh.caps.map((t, j) => ({ name: `c${j}`, t }))], sup: c, final: true });
    return structs.length - 1;
  });
  const caseIndex = (d: DType, c: number) => baseIndex.get(d.key)! + 1 + c;
  const isRec = (t: LType): t is RType | DType | FType => typeof t !== "string";
  // The runtime's names for types and functions.
  // `list` in a runtime function is the list type it names (List Text if none).
  const listOf = (f?: RtFn) => {
    const key = f?.list ?? LIST_TEXT, d = datas.find((x) => x.key === key);
    if (!d) throw new Error(`the runtime's ${key} isn't one of the module's types`);
    return d;
  };
  const resolver = (f?: RtFn) => ({
    type: (n: string) => (n === "bytes" ? bytesIndex : n === "list" ? baseIndex.get(listOf(f).key)! : caseIndex(listOf(f), n === "list.nil" ? 0 : 1)),
    func: (n: string) => (n === "host.show" ? hosts.length : rtIndex(n)),
    valtype: (t: VT) => {
      if (t === "list") return { bytes: typeOf(listOf(f)), text: `(ref null $${structs[baseIndex.get(listOf(f).key)!].name})` };
      return { bytes: typeOf(t), text: t === "text" ? "(ref null $bytes)" : t };
    },
  });
  const resolve = resolver();
  const rtIndex = (n: string) => fnIndex(funcs.length + helpers.length + rts.findIndex((f) => f.name === n));
  const refIndex = (t: RType | DType | FType) => (isData(t) ? baseIndex.get(t.key)! : isFn(t) ? cloIndex.get(t.key)! : recIndex.get(t.key)!);
  const typeOf = (t: LType): number[] => (t === "text" ? [0x63, ...s(bytesIndex)] : isRec(t) ? [0x63, ...s(refIndex(t))] : [VAL[t]]);
  const keyOf = (t: LType) => (isRec(t) ? t.key : t);
  // A partial function (one answer or none) gives a status after its
  // answer: 0 for an answer, 1 for none.
  const sigs: { key: string; params: LType[]; result: LType; partial?: boolean }[] = [];
  const sig = (params: LType[], result: LType, partial?: boolean) => {
    const key = `${params.map(keyOf).join(",")}>${keyOf(result)}${partial ? "!" : ""}`;
    if (!sigs.some((x) => x.key === key)) sigs.push({ key, params, result, partial });
    return structs.length + sigs.findIndex((x) => x.key === key);
  };
  const hostSig = hosts.map((op) => sig(Array(HOST[op]!.params).fill("f64"), "f64"));
  const showSig = hostShow ? sig(["f64"], "text") : 0;
  // A closure's code has its function type's code type, so call_ref takes it.
  const codeOf = new Map<number, FType>();
  const closures = (e: SExpr): void => { if (e.k === "closure") codeOf.set(e.fn, e.t); kids(e).forEach(closures); };
  funcs.forEach((f) => closures(f.body));
  const funcSig = funcs.map((f, i) => (codeOf.has(i) ? cloIndex.get(codeOf.get(i)!.key)! + 1 : sig(f.params, f.result, f.partial)));
  // For the host, which can't look inside a struct: a reader for each
  // field of each record, exported as `Colour.red`; for each data type
  // `List.case`, the number of a value's case, and for each case a maker
  // (`List.cons`) and its fields' readers (`List.cons.head`).
  const helpers: { name: string; key: string; params: LType[]; result: LType; code: number[]; wat: string[] }[] = [];
  for (const r of recs) {
    const k = recIndex.get(r.key)!;
    helpers.push({ name: `${r.name}.${r.case ?? "make"}`, key: r.key, params: r.fields.map((x) => x.t), result: r, code: [...r.fields.flatMap((_, j) => [0x20, ...u(j)]), 0xfb, 0x00, ...u(k)], wat: [...r.fields.map((_, j) => `local.get ${j}`), `struct.new $${structs[k].name}`] });
  }
  for (const r of recs) r.fields.forEach((x, j) => helpers.push({ name: `${r.name}.${x.name}`, key: r.key, params: [r], result: x.t, code: [0x20, 0x00, 0xfb, 0x02, ...u(recIndex.get(r.key)!), ...u(j)], wat: ["local.get 0", `struct.get $${structs[recIndex.get(r.key)!].name} ${j}`] }));
  for (const d of datas) {
    if (d.inner) continue;
    const b = baseIndex.get(d.key)!;
    helpers.push({ name: `${d.name}.case`, key: d.key, params: [d], result: "i32", code: [0x20, 0x00, 0xfb, 0x02, ...u(b), 0x00], wat: ["local.get 0", `struct.get $${structs[b].name} 0`] });
    d.cases.forEach((c, ci) => {
      const k = caseIndex(d, ci), sn = `$${structs[k].name}`;
      helpers.push({
        name: `${d.name}.${c.name}`, key: d.key, params: c.fields.map((x) => x.t), result: d,
        code: [0x41, ...s(ci), ...c.fields.flatMap((_, j) => [0x20, ...u(j)]), 0xfb, 0x00, ...u(k)],
        wat: [`i32.const ${ci}`, ...c.fields.map((_, j) => `local.get ${j}`), `struct.new ${sn}`],
      });
      c.fields.forEach((x, j) => helpers.push({
        name: `${d.name}.${c.name}.${x.name}`, key: d.key, params: [d], result: x.t,
        code: [0x20, 0x00, 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(j + 1)],
        wat: ["local.get 0", `ref.cast (ref ${sn})`, `struct.get ${sn} ${j + 1}`],
      }));
    });
  }
  helpers.forEach((x, k) => { if (helpers.findIndex((y) => y.name === x.name) !== k) x.name = `${x.name}(${x.key})`; });
  const helperSig = helpers.map((x) => sig(x.params, x.result));
  const rtType = (f: RtFn, t: VT): LType => (t === "list" ? listOf(f) : t);
  const rtSig = rts.map((f) => sig(f.params.map(([, t]) => rtType(f, t)), rtType(f, f.result), f.partial));
  const rtCode = rts.map((f) => assemble(f, resolver(f)));
  const struct = (x: (typeof structs)[number]) => {
    if (x.bytes) return [0x5e, 0x78, 0x01];
    if (x.func) return [0x60, ...vec([x.func, ...x.func.params].map(typeOf)), ...vec([typeOf(x.func.result)])];
    const body = [0x5f, ...vec(x.fields.map((y) => [...(y.code !== undefined ? [0x64, ...s(y.code)] : typeOf(y.t)), 0x00]))];
    return x.final && x.sup === undefined ? body : [x.final ? 0x4f : 0x50, ...vec(x.sup === undefined ? [] : [u(x.sup)]), ...body];
  };
  const typeSec = vec([
    ...(structs.length ? [[0x4e, ...vec(structs.map(struct))]] : []),
    ...sigs.map((x) => [0x60, ...vec(x.params.map(typeOf)), ...vec([typeOf(x.result), ...(x.partial ? [[0x7f]] : [])])]),
  ]);
  const importSec = vec([
    ...hosts.map((op, i) => [...str("Math"), ...str(HOST[op]!.name), 0x00, ...u(hostSig[i])]),
    ...(hostShow ? [[...str("host"), ...str("show"), 0x00, ...u(showSig)]] : []),
  ]);
  const funcSec = vec([...funcSig, ...helperSig, ...rtSig].map((t) => u(t)));
  // The runtime functions the host uses, by these names.
  const RT_EXPORTS: Record<string, string> = { "text.new": "Text.new", "text.put": "Text.put", "text.size": "Text.size", "text.byte": "Text.byte" };
  const rtExports = rts.filter((f) => RT_EXPORTS[f.name]);
  // Only what can be called from outside a budget is exported.
  const entries = funcs.map((f, i) => [f, i] as const).filter(([f]) => !f.budgeted && !f.inner);
  const exportSec = vec([
    ...entries.map(([f, i]) => [...str(exportName(f)), 0x00, ...u(fnIndex(i))]),
    ...helpers.map((x, k) => [...str(x.name), 0x00, ...u(fnIndex(funcs.length + k))]),
    ...rtExports.map((f) => [...str(RT_EXPORTS[f.name]), 0x00, ...u(rtIndex(f.name))]),
  ]);
  const fuel = funcs.some((f) => f.spends || budgets(f.body));
  // global 0: the fuel left, an f64. Outside any budget it's infinite, so
  // what the checker couldn't see end just runs (only `data` calls it there).
  const globalSec = vec([[0x7c, 0x01, 0x44, ...f64(Infinity), 0x0b]]);
  const zero = (t: LType) => (t === "text" ? [0xd0, ...s(bytesIndex)] : isRec(t) ? [0xd0, ...s(refIndex(t))] : t === "f64" ? [0x44, ...f64(0)] : t === "i64" ? [0x42, 0x00] : [0x41, 0x00]);
  // fuel = fuel - 1; if fuel < 0, return zero (a partial function: and
  // no answer, which the nearest handler sees)
  const spend = (f: SFunc) => (f.spends ? [0x23, 0x00, 0x44, ...f64(1), 0xa1, 0x24, 0x00, 0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, 0x40, ...zero(f.result), ...(f.partial ? [0x41, 0x01] : []), 0x0f, 0x0b] : []);
  // Whether f needs a local for a status: it's partial, or has no answer
  // somewhere, or tries something that may have none.
  const failing = (e: SExpr): boolean => e.k === "fail" || e.k === "attempt" || (e.k === "call" && !!funcs[e.fn].partial) || (e.k === "rt" && !!runtime(e.fn).partial) || kids(e).some(failing);
  const statusOf = (f: SFunc) => (f.partial || failing(f.body) ? f.locals.length : -1);

  // f's code. `d` is how many blocks are open around e, and `fl` the
  // block a status goes to when there's no answer (counted from the
  // outside; -1: none). A partial call's status is checked there: on to fl
  // if it isn't 0. With nowhere to go (a function of no Choice, called
  // through a closure under a budget that ran out) it's a trap, a runtime
  // error rather than a wrong answer.
  function coder(f: SFunc) {
    const st = statusOf(f);
    const to = (d: number, fl: number) => { if (fl < 0) throw new Error(`${f.name}: no answer, and nowhere to say so`); return u(d - 1 - fl); };
    const check = (d: number, fl: number) => (fl < 0 ? [0x04, 0x40, 0x00, 0x0b] : [0x22, ...u(st), 0x20, ...u(st), 0x0d, ...to(d, fl), 0x1a]);
    return function code(e: SExpr, d: number, fl: number): number[] {
    const code1 = (x: SExpr) => code(x, d, fl);
    switch (e.k) {
      case "num": return [0x44, ...f64(e.v)];
      case "int": return [0x42, ...sBig(e.v)];
      case "text": { const b = textBytes(e.v); return [...b.flatMap((x) => [0x41, ...s(x)]), 0xfb, 0x08, ...u(bytesIndex), ...u(b.length)]; }
      case "rt": return [...e.args.flatMap(code1), 0x10, ...u(resolve.func(e.fn)), ...(runtime(e.fn).partial ? check(d, fl) : [])];
      case "bool": return [0x41, ...s(e.v ? 1 : 0)];
      case "local": return [0x20, ...u(e.i)];
      case "let": return [...code1(e.value), 0x21, ...u(e.i), ...code1(e.body)];
      case "if": return [...code1(e.cond), 0x04, ...typeOf(e.t), ...code(e.then, d + 1, fl), 0x05, ...code(e.else, d + 1, fl), 0x0b];
      case "call": {
        // A tail call only to a function that gives what this one gives.
        const g = funcs[e.fn], tail = e.tail && !!g.partial === !!f.partial;
        return [...e.args.flatMap(code1), tail ? 0x12 : 0x10, ...u(fnIndex(e.fn)), ...(g.partial && !tail ? check(d, fl) : [])];
      }
      case "make": return [...e.args.flatMap(code1), 0xfb, 0x00, ...u(recIndex.get(e.t.key)!)];
      case "get": return [...code1(e.rec), 0xfb, 0x02, ...u(recIndex.get(e.t.key)!), ...u(e.i)];
      case "new": return [0x41, ...s(e.c), ...e.args.flatMap(code1), 0xfb, 0x00, ...u(caseIndex(e.t, e.c))];
      // ref.cast to the case, then its field (after the case's number).
      case "field": { const k = caseIndex(e.t, e.c); return [...code1(e.rec), 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(e.i + 1)]; }
      case "tag": return [...code1(e.rec), 0xfb, 0x02, ...u(baseIndex.get(e.t.key)!), 0x00];
      case "closure": return [0xd2, ...u(fnIndex(e.fn)), ...e.caps.flatMap(code1), 0xfb, 0x00, ...u(shapeIndex[e.shape])];
      // What a closure captured: the closure is the code's first input.
      case "cap": return [0x20, 0x00, 0xfb, 0x16, ...s(shapeIndex[e.shape]), 0xfb, 0x02, ...u(shapeIndex[e.shape]), ...u(e.i + 1)];
      case "apply": {
        const c = cloIndex.get(e.t.key)!;
        return [...code1(e.fn), 0x21, ...u(e.tmp), 0x20, ...u(e.tmp), ...e.args.flatMap(code1), 0x20, ...u(e.tmp), 0xfb, 0x02, ...u(c), 0x00, e.tail && !f.partial ? 0x15 : 0x14, ...u(c + 1)];
      }
      case "case": {
        // block $done; n blocks, innermost first jumped to by br_table on the
        // case's number; after the end of block j, arm j, then br $done.
        const n = e.arms.length, b = baseIndex.get(e.t.key)!;
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const out = [...(there ? [] : [...code1(e.scrut), 0x21, ...u(e.s)]), 0x02, ...typeOf(e.result)];
        for (let j = 0; j < n; j++) out.push(0x02, 0x40);
        out.push(0x20, ...u(e.s), 0xfb, 0x02, ...u(b), 0x00, 0x0e, ...vec(e.arms.map((_, j) => u(j))), ...u(n - 1));
        e.arms.forEach((a, j) => out.push(0x0b, ...(a ? code(a, d + n - j, fl) : [0x00]), ...(j < n - 1 ? [0x0c, ...u(n - 1 - j)] : [])));
        return [...out, 0x0b];
      }
      case "budget": {
        // With `data`, running out is no answer (the functions that spend
        // are partial), so a budget is an attempt that sets the fuel:
        // save = fuel; fuel = n; block $done (block $none body; fuel = save; br $done) fuel = save; otherwise
        if (failing(e.body)) return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00,
          0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), 0x20, ...u(e.save), 0x24, 0x00, 0x0c, 0x01, 0x0b,
          0x1a, 0x20, ...u(e.save), 0x24, 0x00, ...code(e.otherwise, d + 1, fl), 0x0b,
        ];
        // Otherwise: res = body; (if fuel < 0 then otherwise else res); fuel = save
        return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00, ...code1(e.body), 0x21, ...u(e.res),
          0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, ...typeOf(e.t), ...code(e.otherwise, d + 1, fl), 0x05, 0x20, ...u(e.res), 0x0b,
          0x20, ...u(e.save), 0x24, 0x00,
        ];
      }
      case "fail": return [0x41, 0x01, 0x0c, ...to(d, fl)];
      case "attempt": {
        // block $done (block $none (result i32) body; res = it; ok; br $done) drop; otherwise
        return [0x02, ...typeOf(e.t), 0x02, 0x7f, ...code(e.body, d + 2, d + 1), 0x21, ...u(e.res), ...code(e.ok, d + 2, fl), 0x0c, 0x01, 0x0b, 0x1a, ...code(e.otherwise, d + 1, fl), 0x0b];
      }
      case "op": {
        const args = e.args.flatMap(code1);
        if (hostIndex.has(e.op)) return [...args, 0x10, ...u(hostIndex.get(e.op)!)];
        return [...args, ...[INSTR[e.op]![0]].flat()];
      }
    }
    };
  }
  const helperCode = helpers.map((x) => { const body = [0x00, ...x.code, 0x0b]; return [...u(body.length), ...body]; });
  const codeSec = vec([...funcs.map((f) => {
    // Locals past the parameters, grouped by runs of the same type.
    const extra = [...f.locals.slice(f.params.length), ...(statusOf(f) >= 0 ? ["i32" as const] : [])];
    const groups: number[][] = [];
    for (let i = 0; i < extra.length;) {
      let j = i;
      while (j < extra.length && extra[j] === extra[i]) j++;
      groups.push([...u(j - i), ...typeOf(extra[i])]);
      i = j;
    }
    // A partial function's body is in a block a status goes to:
    // block $none (result i32) body; 0; return end; status = it; zero; status
    const st = statusOf(f), code = coder(f);
    const main = f.partial ? [0x02, 0x7f, ...code(f.body, 1, 0), 0x41, 0x00, 0x0f, 0x0b, 0x21, ...u(st), ...zero(f.result), 0x20, ...u(st)] : code(f.body, 0, -1);
    const body = [...vec(groups), ...spend(f), ...main, 0x0b];
    return [...u(body.length), ...body];
  }), ...helperCode, ...rtCode.map((c) => [...u(c.code.length), ...c.code])]);

  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, typeSec), ...(imports ? section(2, importSec) : []), ...section(3, funcSec),
    ...(fuel ? section(6, globalSec) : []), ...section(7, exportSec),
    // ref.func needs the functions declared: one declarative segment.
    ...(codeOf.size ? section(9, vec([[0x03, 0x00, ...vec([...codeOf.keys()].map((i) => u(fnIndex(i))))]])) : []),
    ...section(10, codeSec),
  ]);

  // ---- text, for reading
  const id = (f: SFunc) => `$${f.name.replace(/[^\w]+/g, "_")}${funcs.indexOf(f)}`;
  const local = (f: SFunc, i: number) => `$${i < f.params.length ? "p" : "l"}${i}`;
  const sname = (i: number) => `$${structs[i].name}`;
  const recName = (r: RType | DType | FType) => sname(refIndex(r));
  const ty = (t: LType) => (t === "text" ? "(ref null $bytes)" : isRec(t) ? `(ref null ${recName(t)})` : t);
  const zeroText = (t: LType) => (t === "text" ? "ref.null $bytes" : isRec(t) ? `ref.null ${recName(t)}` : `${t}.const 0`);
  // As code(): `ld` blocks open around e, a status for none goes to fl.
  function wat(e: SExpr, f: SFunc, d: string, ld: number, fl: number): string {
    const w = (x: SExpr) => wat(x, f, d, ld, fl);
    const st = local(f, statusOf(f));
    const to = (ld2: number) => ld2 - 1 - fl;
    const check = (ld2: number) => (fl < 0 ? [`${d}(if (then unreachable)) ;; no answer, nowhere to go`] : [`${d}local.tee ${st}`, `${d}local.get ${st}`, `${d}br_if ${to(ld2)} ;; no answer`, `${d}drop`]);
    switch (e.k) {
      case "num": return `${d}f64.const ${e.v}`;
      case "int": return `${d}i64.const ${e.v}`;
      case "text": { const b = textBytes(e.v); return `${d}(array.new_fixed $bytes ${b.length}${b.map((x) => ` (i32.const ${x})`).join("")}) ;; ${JSON.stringify(e.v)}`; }
      case "rt": return [...e.args.map(w), `${d}call $${e.fn}`, ...(runtime(e.fn).partial ? check(ld) : [])].join("\n");
      case "bool": return `${d}i32.const ${e.v ? 1 : 0}`;
      case "local": return `${d}local.get ${local(f, e.i)}`;
      case "let": return `${w(e.value)}\n${d}local.set ${local(f, e.i)}\n${w(e.body)}`;
      case "if": return `${w(e.cond)}\n${d}(if (result ${ty(e.t)})\n${d}  (then\n${wat(e.then, f, d + "    ", ld + 1, fl)})\n${d}  (else\n${wat(e.else, f, d + "    ", ld + 1, fl)}))`;
      case "call": {
        const g = funcs[e.fn], tail = e.tail && !!g.partial === !!f.partial;
        return [...e.args.map(w), `${d}${tail ? "return_call" : "call"} ${id(g)}`, ...(g.partial && !tail ? check(ld) : [])].join("\n");
      }
      case "make": return [...e.args.map(w), `${d}struct.new ${recName(e.t)}`].join("\n");
      case "get": return `${w(e.rec)}\n${d}struct.get ${recName(e.t)} ${e.i}`;
      case "new": return [`${d}i32.const ${e.c}`, ...e.args.map(w), `${d}struct.new ${sname(caseIndex(e.t, e.c))}`].join("\n");
      case "field": { const k = sname(caseIndex(e.t, e.c)); return `${w(e.rec)}\n${d}ref.cast (ref ${k})\n${d}struct.get ${k} ${e.i + 1}`; }
      case "tag": return `${w(e.rec)}\n${d}struct.get ${recName(e.t)} 0`;
      case "closure": return [`${d}ref.func ${id(funcs[e.fn])}`, ...e.caps.map(w), `${d}struct.new ${sname(shapeIndex[e.shape])}`].join("\n");
      case "cap": return [`${d}local.get ${local(f, 0)}`, `${d}ref.cast (ref ${sname(shapeIndex[e.shape])})`, `${d}struct.get ${sname(shapeIndex[e.shape])} ${e.i + 1}`].join("\n");
      case "apply": {
        const c = cloIndex.get(e.t.key)!, t = local(f, e.tmp);
        return [w(e.fn), `${d}local.set ${t}`, `${d}local.get ${t}`, ...e.args.map(w), `${d}local.get ${t}`, `${d}struct.get ${sname(c)} 0`, `${d}${e.tail && !f.partial ? "return_call_ref" : "call_ref"} ${sname(c + 1)}`].join("\n");
      }
      case "case": {
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const n = e.arms.length, lines = [...(there ? [] : [w(e.scrut), `${d}local.set ${local(f, e.s)}`]), `${d}(block (result ${ty(e.result)})`];
        for (let j = n - 1; j >= 0; j--) lines.push(`${d}${"  ".repeat(n - j)}(block ;; ${e.t.cases[j].name}`);
        const inner = d + "  ".repeat(n + 1);
        lines.push(`${inner}local.get ${local(f, e.s)}`, `${inner}struct.get ${recName(e.t)} 0`, `${inner}br_table ${e.arms.map((_, j) => j).join(" ")} ${n - 1})`);
        e.arms.forEach((a, j) => {
          const dd = d + "  ".repeat(n - j);
          lines.push(a ? wat(a, f, dd, ld + n - j, fl) : `${dd}unreachable`);
          lines.push(j < n - 1 ? `${dd}br ${n - 1 - j})` : `${dd.slice(2)})`);
        });
        return lines.join("\n");
      }
      case "budget": {
        const save = [`${d}global.get $fuel`, `${d}local.set ${local(f, e.save)}`, `${d}f64.const ${e.n}`, `${d}global.set $fuel`];
        if (failing(e.body)) return [
          ...save, `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; no answer, or ran out`, wat(e.body, f, d + "    ", ld + 2, ld + 1),
          `${d}    local.get ${local(f, e.save)}`, `${d}    global.set $fuel`, `${d}    br 1)`, `${d}  drop`, `${d}  local.get ${local(f, e.save)}`, `${d}  global.set $fuel`,
          wat(e.otherwise, f, d + "  ", ld + 1, fl) + ")",
        ].join("\n");
        return [
          ...save, w(e.body), `${d}local.set ${local(f, e.res)}`,
          `${d}global.get $fuel`, `${d}f64.const 0`, `${d}f64.lt`, `${d}(if (result ${ty(e.t)})`, `${d}  (then`, wat(e.otherwise, f, d + "    ", ld + 1, fl) + ")", `${d}  (else`, `${d}    local.get ${local(f, e.res)}))`,
          `${d}local.get ${local(f, e.save)}`, `${d}global.set $fuel`,
        ].join("\n");
      }
      case "fail": return `${d}i32.const 1\n${d}br ${to(ld)} ;; no answer`;
      case "attempt": return [
        `${d}(block (result ${ty(e.t)})`, `${d}  (block (result i32) ;; no answer`, wat(e.body, f, d + "    ", ld + 2, ld + 1), `${d}    local.set ${local(f, e.res)}`, wat(e.ok, f, d + "    ", ld + 2, fl), `${d}    br 1)`,
        `${d}  drop`,
        wat(e.otherwise, f, d + "  ", ld + 1, fl) + ")",
      ].join("\n");
      case "op": return [...e.args.map(w), `${d}${hostIndex.has(e.op) ? `call $Math.${e.op}` : INSTR[e.op]![1]}`].join("\n");
    }
  }
  const text = [
    "(module",
    ...(structs.length ? ["  (rec"] : []),
    ...structs.map((x) => {
      if (x.bytes) return "    (type $bytes (array (mut i8)))";
      if (x.func) return `    (type $${x.name} (func (param ${[x.func, ...x.func.params].map(ty).join(" ")}) (result ${ty(x.func.result)})))`;
      const body = `(struct${x.fields.map((y) => ` (field $${ident(y.name)} ${y.code !== undefined ? `(ref ${sname(y.code)})` : ty(y.t)})`).join("")})`;
      return `    (type $${x.name} ${x.final && x.sup === undefined ? body : `(sub${x.final ? " final" : ""}${x.sup === undefined ? "" : ` ${sname(x.sup)}`} ${body})`})`;
    }),
    ...(structs.length ? ["  )"] : []),
    ...hosts.map((op) => `  (import "Math" "${HOST[op]!.name}" (func $Math.${op} (param${" f64".repeat(HOST[op]!.params)}) (result f64)))`),
    ...(hostShow ? [`  (import "host" "show" (func $host.show (param f64) (result (ref null $bytes))))`] : []),
    ...(fuel ? ["  (global $fuel (mut f64) (f64.const inf))"] : []),
    ...(codeOf.size ? [`  (elem declare func${[...codeOf.keys()].map((i) => ` ${id(funcs[i])}`).join("")})`] : []),
    ...funcs.map((f, i) => {
      const ps = f.params.map((t, i) => ` (param ${local(f, i)} ${ty(t)})`).join("");
      const st = statusOf(f);
      const ls = [...f.locals.slice(f.params.length), ...(st >= 0 ? ["i32" as const] : [])].map((t, j) => ` (local ${local(f, f.params.length + j)} ${ty(t)})`).join("");
      const none = zeroText(f.result) + (f.partial ? " i32.const 1" : "");
      const spends = f.spends ? `    global.get $fuel\n    f64.const 1\n    f64.sub\n    global.set $fuel\n    global.get $fuel\n    f64.const 0\n    f64.lt\n    (if (then ${none} return))\n` : "";
      const body = f.partial
        ? `    (block (result i32) ;; no answer\n${wat(f.body, f, "      ", 1, 0)}\n      i32.const 0\n      return)\n    local.set ${local(f, st)}\n    ${zeroText(f.result)}\n    local.get ${local(f, st)}`
        : wat(f.body, f, "    ", 0, -1);
      return `  ;; ${f.name}\n  (func ${id(f)}${f.budgeted || f.inner ? "" : ` (export "${exportName(f)}")`}${codeOf.has(i) ? ` (type ${sname(cloIndex.get(codeOf.get(i)!.key)! + 1)})` : ""}${ps} (result ${ty(f.result)}${f.partial ? " i32" : ""})${ls}\n${spends}${body})`;
    }),
    ...helpers.map((x) => `  (func (export "${x.name}")${x.params.map((t) => ` (param ${ty(t)})`).join("")} (result ${ty(x.result)})\n${x.wat.map((l) => `    ${l}`).join("\n")})`),
    ...rtCode.map((c, k) => c.wat.replace(`(func $${rts[k].name}`, `(func $${rts[k].name}${RT_EXPORTS[rts[k].name] ? ` (export "${RT_EXPORTS[rts[k].name]}")` : ""}`)),
    ")",
  ].join("\n");

  return { bytes, wat: text + "\n", exports: [...entries.map(([f]) => exportName(f)), ...helpers.map((x) => x.name), ...rtExports.map((f) => RT_EXPORTS[f.name])] };
}

const uses = (e: SExpr, op: Op): boolean => (e.k === "op" && e.op === op) || kids(e).some((k) => uses(k, op));
const mentionsText = (e: SExpr): boolean => e.k === "text" || kids(e).some(mentionsText);
const budgets = (e: SExpr): boolean => e.k === "budget" || kids(e).some(budgets);

// Instantiate with the host's Math. Bool results come back as 0 or 1.
// `host.show` builds its text through the module's own Text.new and Text.put.
export async function instantiate(m: Module): Promise<Record<string, (...xs: number[]) => number>> {
  let ex: Record<string, (...xs: unknown[]) => unknown> = {};
  const host = { show: (x: number) => toText(ex, SHOW(x)) };
  const { instance } = await WebAssembly.instantiate(m.bytes, { Math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2, mod: MOD }, host });
  ex = instance.exports as unknown as typeof ex;
  return instance.exports as unknown as Record<string, (...xs: number[]) => number>;
}

// Text across the boundary: a JS string into the module's UTF-8 array, and back.
export function toText(ex: Record<string, (...xs: never[]) => unknown>, v: string): unknown {
  const b = new TextEncoder().encode(v), t = (ex["Text.new"] as (n: number) => unknown)(b.length);
  const put = ex["Text.put"] as (t: unknown, i: number, x: number) => void;
  b.forEach((x, i) => put(t, i, x));
  return t;
}
export function fromText(ex: Record<string, (...xs: never[]) => unknown>, t: unknown): string {
  const n = (ex["Text.size"] as (t: unknown) => number)(t), byte = ex["Text.byte"] as (t: unknown, i: number) => number;
  return new TextDecoder().decode(Uint8Array.from({ length: n }, (_, i) => byte(t, i)));
}

export { OPS };
