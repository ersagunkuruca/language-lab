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
import { isData, isFn, OPS, type DType, type FType, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc, type SType } from "./scalar.ts";

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
  const sigs: { key: string; params: LType[]; result: LType }[] = [];
  const sig = (params: LType[], result: LType) => {
    const key = `${params.map(keyOf).join(",")}>${keyOf(result)}`;
    if (!sigs.some((x) => x.key === key)) sigs.push({ key, params, result });
    return structs.length + sigs.findIndex((x) => x.key === key);
  };
  const hostSig = hosts.map((op) => sig(Array(HOST[op]!.params).fill("f64"), "f64"));
  const showSig = hostShow ? sig(["f64"], "text") : 0;
  // A closure's code has its function type's code type, so call_ref takes it.
  const codeOf = new Map<number, FType>();
  const closures = (e: SExpr): void => { if (e.k === "closure") codeOf.set(e.fn, e.t); kids(e).forEach(closures); };
  funcs.forEach((f) => closures(f.body));
  const funcSig = funcs.map((f, i) => (codeOf.has(i) ? cloIndex.get(codeOf.get(i)!.key)! + 1 : sig(f.params, f.result)));
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
  const rtSig = rts.map((f) => sig(f.params.map(([, t]) => rtType(f, t)), rtType(f, f.result)));
  const rtCode = rts.map((f) => assemble(f, resolver(f)));
  const struct = (x: (typeof structs)[number]) => {
    if (x.bytes) return [0x5e, 0x78, 0x01];
    if (x.func) return [0x60, ...vec([x.func, ...x.func.params].map(typeOf)), ...vec([typeOf(x.func.result)])];
    const body = [0x5f, ...vec(x.fields.map((y) => [...(y.code !== undefined ? [0x64, ...s(y.code)] : typeOf(y.t)), 0x00]))];
    return x.final && x.sup === undefined ? body : [x.final ? 0x4f : 0x50, ...vec(x.sup === undefined ? [] : [u(x.sup)]), ...body];
  };
  const typeSec = vec([
    ...(structs.length ? [[0x4e, ...vec(structs.map(struct))]] : []),
    ...sigs.map((x) => [0x60, ...vec(x.params.map(typeOf)), ...vec([typeOf(x.result)])]),
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
  // fuel = fuel - 1; if fuel < 0, return zero
  const spend = (f: SFunc) => (f.spends ? [0x23, 0x00, 0x44, ...f64(1), 0xa1, 0x24, 0x00, 0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, 0x40, ...zero(f.result), 0x0f, 0x0b] : []);

  function code(e: SExpr): number[] {
    switch (e.k) {
      case "num": return [0x44, ...f64(e.v)];
      case "int": return [0x42, ...sBig(e.v)];
      case "text": { const b = textBytes(e.v); return [...b.flatMap((x) => [0x41, ...s(x)]), 0xfb, 0x08, ...u(bytesIndex), ...u(b.length)]; }
      case "rt": return [...e.args.flatMap(code), 0x10, ...u(resolve.func(e.fn))];
      case "bool": return [0x41, ...s(e.v ? 1 : 0)];
      case "local": return [0x20, ...u(e.i)];
      case "let": return [...code(e.value), 0x21, ...u(e.i), ...code(e.body)];
      case "if": return [...code(e.cond), 0x04, ...typeOf(e.t), ...code(e.then), 0x05, ...code(e.else), 0x0b];
      case "call": return [...e.args.flatMap(code), e.tail ? 0x12 : 0x10, ...u(fnIndex(e.fn))];
      case "make": return [...e.args.flatMap(code), 0xfb, 0x00, ...u(recIndex.get(e.t.key)!)];
      case "get": return [...code(e.rec), 0xfb, 0x02, ...u(recIndex.get(e.t.key)!), ...u(e.i)];
      case "new": return [0x41, ...s(e.c), ...e.args.flatMap(code), 0xfb, 0x00, ...u(caseIndex(e.t, e.c))];
      // ref.cast to the case, then its field (after the case's number).
      case "field": { const k = caseIndex(e.t, e.c); return [...code(e.rec), 0xfb, 0x16, ...s(k), 0xfb, 0x02, ...u(k), ...u(e.i + 1)]; }
      case "tag": return [...code(e.rec), 0xfb, 0x02, ...u(baseIndex.get(e.t.key)!), 0x00];
      case "closure": return [0xd2, ...u(fnIndex(e.fn)), ...e.caps.flatMap(code), 0xfb, 0x00, ...u(shapeIndex[e.shape])];
      // What a closure captured: the closure is the code's first input.
      case "cap": return [0x20, 0x00, 0xfb, 0x16, ...s(shapeIndex[e.shape]), 0xfb, 0x02, ...u(shapeIndex[e.shape]), ...u(e.i + 1)];
      case "apply": {
        const c = cloIndex.get(e.t.key)!;
        return [...code(e.fn), 0x21, ...u(e.tmp), 0x20, ...u(e.tmp), ...e.args.flatMap(code), 0x20, ...u(e.tmp), 0xfb, 0x02, ...u(c), 0x00, e.tail ? 0x15 : 0x14, ...u(c + 1)];
      }
      case "case": {
        // block $done; n blocks, innermost first jumped to by br_table on the
        // case's number; after the end of block j, arm j, then br $done.
        const n = e.arms.length, b = baseIndex.get(e.t.key)!;
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const out = [...(there ? [] : [...code(e.scrut), 0x21, ...u(e.s)]), 0x02, ...typeOf(e.result)];
        for (let j = 0; j < n; j++) out.push(0x02, 0x40);
        out.push(0x20, ...u(e.s), 0xfb, 0x02, ...u(b), 0x00, 0x0e, ...vec(e.arms.map((_, j) => u(j))), ...u(n - 1));
        e.arms.forEach((a, j) => out.push(0x0b, ...(a ? code(a) : [0x00]), ...(j < n - 1 ? [0x0c, ...u(n - 1 - j)] : [])));
        return [...out, 0x0b];
      }
      case "budget": {
        // save = fuel; fuel = n; res = body; (if fuel < 0 then otherwise else res); fuel = save
        return [
          0x23, 0x00, 0x21, ...u(e.save), 0x44, ...f64(e.n), 0x24, 0x00, ...code(e.body), 0x21, ...u(e.res),
          0x23, 0x00, 0x44, ...f64(0), 0x63, 0x04, ...typeOf(e.t), ...code(e.otherwise), 0x05, 0x20, ...u(e.res), 0x0b,
          0x20, ...u(e.save), 0x24, 0x00,
        ];
      }
      case "op": {
        const args = e.args.flatMap(code);
        if (hostIndex.has(e.op)) return [...args, 0x10, ...u(hostIndex.get(e.op)!)];
        return [...args, ...[INSTR[e.op]![0]].flat()];
      }
    }
  }
  const helperCode = helpers.map((x) => { const body = [0x00, ...x.code, 0x0b]; return [...u(body.length), ...body]; });
  const codeSec = vec([...funcs.map((f) => {
    // Locals past the parameters, grouped by runs of the same type.
    const extra = f.locals.slice(f.params.length);
    const groups: number[][] = [];
    for (let i = 0; i < extra.length;) {
      let j = i;
      while (j < extra.length && extra[j] === extra[i]) j++;
      groups.push([...u(j - i), ...typeOf(extra[i])]);
      i = j;
    }
    const body = [...vec(groups), ...spend(f), ...code(f.body), 0x0b];
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
  function wat(e: SExpr, f: SFunc, d: string): string {
    switch (e.k) {
      case "num": return `${d}f64.const ${e.v}`;
      case "int": return `${d}i64.const ${e.v}`;
      case "text": { const b = textBytes(e.v); return `${d}(array.new_fixed $bytes ${b.length}${b.map((x) => ` (i32.const ${x})`).join("")}) ;; ${JSON.stringify(e.v)}`; }
      case "rt": return [...e.args.map((a) => wat(a, f, d)), `${d}call $${e.fn}`].join("\n");
      case "bool": return `${d}i32.const ${e.v ? 1 : 0}`;
      case "local": return `${d}local.get ${local(f, e.i)}`;
      case "let": return `${wat(e.value, f, d)}\n${d}local.set ${local(f, e.i)}\n${wat(e.body, f, d)}`;
      case "if": return `${wat(e.cond, f, d)}\n${d}(if (result ${ty(e.t)})\n${d}  (then\n${wat(e.then, f, d + "    ")})\n${d}  (else\n${wat(e.else, f, d + "    ")}))`;
      case "call": return [...e.args.map((a) => wat(a, f, d)), `${d}${e.tail ? "return_call" : "call"} ${id(funcs[e.fn])}`].join("\n");
      case "make": return [...e.args.map((a) => wat(a, f, d)), `${d}struct.new ${recName(e.t)}`].join("\n");
      case "get": return `${wat(e.rec, f, d)}\n${d}struct.get ${recName(e.t)} ${e.i}`;
      case "new": return [`${d}i32.const ${e.c}`, ...e.args.map((a) => wat(a, f, d)), `${d}struct.new ${sname(caseIndex(e.t, e.c))}`].join("\n");
      case "field": { const k = sname(caseIndex(e.t, e.c)); return `${wat(e.rec, f, d)}\n${d}ref.cast (ref ${k})\n${d}struct.get ${k} ${e.i + 1}`; }
      case "tag": return `${wat(e.rec, f, d)}\n${d}struct.get ${recName(e.t)} 0`;
      case "closure": return [`${d}ref.func ${id(funcs[e.fn])}`, ...e.caps.map((a) => wat(a, f, d)), `${d}struct.new ${sname(shapeIndex[e.shape])}`].join("\n");
      case "cap": return [`${d}local.get ${local(f, 0)}`, `${d}ref.cast (ref ${sname(shapeIndex[e.shape])})`, `${d}struct.get ${sname(shapeIndex[e.shape])} ${e.i + 1}`].join("\n");
      case "apply": {
        const c = cloIndex.get(e.t.key)!, t = local(f, e.tmp);
        return [wat(e.fn, f, d), `${d}local.set ${t}`, `${d}local.get ${t}`, ...e.args.map((a) => wat(a, f, d)), `${d}local.get ${t}`, `${d}struct.get ${sname(c)} 0`, `${d}${e.tail ? "return_call_ref" : "call_ref"} ${sname(c + 1)}`].join("\n");
      }
      case "case": {
        const there = e.scrut.k === "local" && e.scrut.i === e.s;
        const n = e.arms.length, lines = [...(there ? [] : [wat(e.scrut, f, d), `${d}local.set ${local(f, e.s)}`]), `${d}(block (result ${ty(e.result)})`];
        for (let j = n - 1; j >= 0; j--) lines.push(`${d}${"  ".repeat(n - j)}(block ;; ${e.t.cases[j].name}`);
        const inner = d + "  ".repeat(n + 1);
        lines.push(`${inner}local.get ${local(f, e.s)}`, `${inner}struct.get ${recName(e.t)} 0`, `${inner}br_table ${e.arms.map((_, j) => j).join(" ")} ${n - 1})`);
        e.arms.forEach((a, j) => {
          const dd = d + "  ".repeat(n - j);
          lines.push(a ? wat(a, f, dd) : `${dd}unreachable`);
          lines.push(j < n - 1 ? `${dd}br ${n - 1 - j})` : `${dd.slice(2)})`);
        });
        return lines.join("\n");
      }
      case "budget": return [
        `${d}global.get $fuel`, `${d}local.set ${local(f, e.save)}`, `${d}f64.const ${e.n}`, `${d}global.set $fuel`, wat(e.body, f, d), `${d}local.set ${local(f, e.res)}`,
        `${d}global.get $fuel`, `${d}f64.const 0`, `${d}f64.lt`, `${d}(if (result ${ty(e.t)})`, `${d}  (then`, wat(e.otherwise, f, d + "    ") + ")", `${d}  (else`, `${d}    local.get ${local(f, e.res)}))`,
        `${d}local.get ${local(f, e.save)}`, `${d}global.set $fuel`,
      ].join("\n");
      case "op": return [...e.args.map((a) => wat(a, f, d)), `${d}${hostIndex.has(e.op) ? `call $Math.${e.op}` : INSTR[e.op]![1]}`].join("\n");
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
      const ls = f.locals.slice(f.params.length).map((t, j) => ` (local ${local(f, f.params.length + j)} ${ty(t)})`).join("");
      const none = isRec(f.result) ? `ref.null ${recName(f.result)}` : `${f.result}.const 0`;
      const spends = f.spends ? `    global.get $fuel\n    f64.const 1\n    f64.sub\n    global.set $fuel\n    global.get $fuel\n    f64.const 0\n    f64.lt\n    (if (then ${none} return))\n` : "";
      return `  ;; ${f.name}\n  (func ${id(f)}${f.budgeted || f.inner ? "" : ` (export "${exportName(f)}")`}${codeOf.has(i) ? ` (type ${sname(cloIndex.get(codeOf.get(i)!.key)! + 1)})` : ""}${ps} (result ${ty(f.result)})${ls}\n${spends}${wat(f.body, f, "    ")})`;
    }),
    ...helpers.map((x) => `  (func (export "${x.name}")${x.params.map((t) => ` (param ${ty(t)})`).join("")} (result ${ty(x.result)})\n${x.wat.map((l) => `    ${l}`).join("\n")})`),
    ...rtCode.map((c, k) => c.wat.replace(`(func $${rts[k].name}`, `(func $${rts[k].name}${RT_EXPORTS[rts[k].name] ? ` (export "${RT_EXPORTS[rts[k].name]}")` : ""}`)),
    ")",
  ].join("\n");

  return { bytes, wat: text + "\n", exports: [...entries.map(([f]) => exportName(f)), ...helpers.map((x) => x.name), ...rtExports.map((f) => RT_EXPORTS[f.name])] };
}

// The expressions directly inside e.
function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": return e.args;
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "get": case "field": case "tag": return [e.rec];
    case "case": return [e.scrut, ...e.arms.filter((a): a is SExpr => !!a)];
    case "budget": return [e.body, e.otherwise];
    case "closure": return e.caps;
    case "apply": return [e.fn, ...e.args];
    case "rt": return e.args;
    default: return [];
  }
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
