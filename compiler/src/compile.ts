// A compiler from the typed core (projectional/src/lang) to JavaScript.
//
// The evaluator (run.ts) treats every expression as a lazy stream of
// results, because any of them might be a Choice. The compiler doesn't have
// to guess: the checker has already worked out, in each function's type,
// whether it can produce several results or none. So it generates two kinds
// of code:
//
//   - code without Choice is ordinary JavaScript: expressions, ternaries for
//     `if`, loops for `fold` (no JS stack per item), `&&` for `and`;
//   - code with Choice becomes nested `for … of` loops, one per choice point,
//     with the rest of the computation (the continuation) inside the
//     innermost loop. `one of` is a loop over a list, `fail` is the absence
//     of a continuation, and a handler is a loop that stops early (`first`),
//     counts (`count`) or collects (`all`). That is what you'd write by hand
//     for backtracking search, and the checker is what makes it safe.
//
// A function whose type has Choice is a generator function; anything else
// is a plain function. Effect-polymorphic definitions (`map`, whose effects
// are its argument's) get one copy per calling convention they're used at:
// there are only two, so at most two copies.
//
// `solve` nodes call the relation solver at compile time, not at run time:
// the direction is fixed where the node is, so the plan is too, and it is
// emitted as straight-line code (src/relation.ts). Plans that need numeric
// search fall back to the solver at run time, with the plan made once.

import { subtree, type Code, type Id, type Node, type NodeOf } from "../../projectional/src/model.ts";
import type { Names } from "../../projectional/src/presentation.ts";
import type { Info } from "../../projectional/src/lang/infer.ts";
import { CHOICE, INT, NUMBER, STRING, type Row, type Type } from "../../projectional/src/lang/types.ts";
import { B } from "../../projectional/src/prelude.ts";
import { fieldShapes, shapeOf, type Shape } from "../../projectional/src/lang/nested.ts";
import { BOOL, CELL_OPS, CONS, FALSE, INT_OPS, IO, NIL, S, SET, SHOW_ANY, STD_IMPL, STD_MANY, TEXT_OPS, TRUE, UNIT_V, NONE, SOME } from "../../projectional/src/lang/std.ts";
import { fieldPath } from "../../projectional/src/lang/records.ts";
import { planSolve } from "../../projectional/src/lang/solve.ts";
import { compileSolve } from "./relation.ts";
import { foldPlan } from "../../projectional/src/lang/represent.ts";

type Rho = Map<number, boolean>;
type K = (value: string) => string;

export interface Options {
  // Where the generated module imports the runtime from.
  runtime: string;
  // Definitions to export, by display name.
  exports: string[];
}

// Builtins that are just JavaScript. `bool` ones produce a JS boolean.
// `ids`, where given, are the argument nodes, for builtins that compile
// differently when an argument is a constant.
const OPS: Record<Id, { js: (a: string[], ids?: Id[]) => string; bool?: true }> = {
  [B.add]: { js: ([a, b]) => `(${a} + ${b})` },
  [B.sub]: { js: ([a, b]) => `(${a} - ${b})` },
  [B.mul]: { js: ([a, b]) => `(${a} * ${b})` },
  [B.div]: { js: ([a, b]) => `(${a} / ${b})` },
  [B.neg]: { js: ([a]) => `(-${a})` },
  [B.pow]: { js: ([a, b]) => `(${a} ** ${b})` },
  [B.sqrt]: { js: ([a]) => `Math.sqrt(${a})` },
  [B.sin]: { js: ([a]) => `Math.sin(${a})` },
  [B.cos]: { js: ([a]) => `Math.cos(${a})` },
  [B.exp]: { js: ([a]) => `Math.exp(${a})` },
  [B.log]: { js: ([a]) => `Math.log(${a})` },
  [B.tan]: { js: ([a]) => `Math.tan(${a})` },
  [B.atan2]: { js: ([a, b]) => `Math.atan2(${a}, ${b})` },
  [S.abs]: { js: ([a]) => `Math.abs(${a})` },
  [S.floor]: { js: ([a]) => `Math.floor(${a})` },
  [S.mod]: { js: ([a, b]) => `$mod(${a}, ${b})` },
  [S.concat]: { js: ([a, b]) => `(${a} + ${b})` },
  [S.show]: { js: ([a]) => `$show(${a})` },
  [S.range]: { js: ([a]) => `$range(${a})` },
  [S.print]: { js: ([a]) => `$print(${a})` },
  // The world: the runtime's World, set by whoever runs the program.
  [IO.printError]: { js: ([a]) => `$io.printError(${a})` },
  [IO.readInput]: { js: () => `$io.readInput()` },
  [IO.readLine]: { js: () => `$io.readLine()` },
  [IO.readFile]: { js: ([a]) => `$io.readFile(${a})` },
  [IO.writeFile]: { js: ([a, b]) => `$io.writeFile(${a}, ${b})` },
  [IO.appendFile]: { js: ([a, b]) => `$io.appendFile(${a}, ${b})` },
  [IO.fileExists]: { js: ([a]) => `$io.fileExists(${a})` },
  [IO.listFolder]: { js: ([a]) => `$io.listFolder(${a})` },
  [IO.fetchText]: { js: ([a]) => `$io.fetchText(${a})` },
  // Cells: the runtime's one handler (projectional/src/lang/cells.ts). A
  // formula is given its compiled thunk; a read of one that gave no value
  // throws, which ends whatever formula is reading it, as in the evaluator.
  [CELL_OPS.cell]: { js: ([a]) => `$cells().cell(${a})` },
  [CELL_OPS.formula]: { js: ([f]) => `$cells().formula(${f})` },
  [CELL_OPS.read]: { js: ([c]) => `$cells().read(${c})` },
  [CELL_OPS.write]: { js: ([c, v]) => `($cells().write(${c}, ${v}), $unit)` },
  [S.less]: { js: ([a, b]) => `(${a} < ${b})`, bool: true },
  [S.and]: { js: ([a, b]) => `(${a} && ${b})`, bool: true },
  [S.hence]: { js: ([a, b]) => `(${a} && ${b})`, bool: true },
  [S.or]: { js: ([a, b]) => `(${a} || ${b})`, bool: true },
  [S.not]: { js: ([a]) => `!${a}`, bool: true },
  // Int: a number while it's a safe integer, a BigInt beyond (int.ts), so
  // comparisons are plain JS ones.
  [INT_OPS.add]: { js: ([a, b]) => `$int.add(${a}, ${b})` },
  [INT_OPS.sub]: { js: ([a, b]) => `$int.sub(${a}, ${b})` },
  [INT_OPS.mul]: { js: ([a, b]) => `$int.mul(${a}, ${b})` },
  [INT_OPS.neg]: { js: ([a]) => `$int.neg(${a})` },
  [INT_OPS.less]: { js: ([a, b]) => `(${a} < ${b})`, bool: true },
  [INT_OPS.show]: { js: ([a]) => `String(${a})` },
  [INT_OPS.toNumber]: { js: ([a]) => `Number(${a})` },
  // Code-point order. When one side is a constant whose characters all come
  // before the surrogates (U+D800), JS's UTF-16 order gives the same answer.
  [TEXT_OPS.less]: { js: ([a, b], ids) => (ids && ids.some(narrowText) ? `(${a} < ${b})` : `$text.less(${a}, ${b})`), bool: true },
  // Cases print with the names the program was compiled with ($names).
  [SHOW_ANY]: { js: ([a]) => `$showAny(${a}, $names)` },
};
// Other std builtins run their implementation from std.ts: `$impl` for
// those with one answer, `$many` (an array of answers) for those with Choice.
const implOf = (id: Id) => (OPS[id] ? null : STD_IMPL[id] ? `$impl[${JSON.stringify(id)}]` : null);
const manyOf = (id: Id) => (STD_MANY[id] ? `$many[${JSON.stringify(id)}]` : null);
const BOOL_ARGS = new Set([S.and, S.hence, S.or, S.not]);
const HANDLERS = new Set([S.first, S.all, S.count, S.optional, S.fuel]);

// Set by compile(): is this node a text literal below the surrogates?
let narrowText: (id: Id) => boolean = () => false;

export function compile(code: Code, info: Info, names: Names, opts: Options): string {
  narrowText = (id) => { const n = code.nodes[id]; return n.kind === "lit" && typeof n.value === "string" && n.of === undefined && /^[\u0000-\ud7ff]*$/.test(n.value); };
  const sub = info.subst;
  // Effects a program defines: an operation is a variant of an effect, and a
  // match on operations is a handler (runtime.js $perform, $handle).
  const effectOf = (variant: Id): Id | null => {
    const def = info.owner.get(variant);
    const body = def ? (code.nodes[def] as NodeOf<"def">).body : null;
    return body && (code.nodes[body] as NodeOf<"typedef">).effect ? def! : null;
  };
  const handlerOf = (n: NodeOf<"match">) => (n.arms.length ? effectOf((code.nodes[n.arms[0]] as NodeOf<"arm">).variant) : null);
  const perform = (op: Id, args: string[]) => `$perform(${JSON.stringify(effectOf(op))}, ${tag(op)}, [${args.join(", ")}])`;
  const ty = (id: Id): Type => sub.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  // `equal`, one rule on every type (run.ts `sameNumber`). A Number, an Int
  // or a text on its own is compared without the general loop: an Int is
  // always whole, so === is the rule for it.
  const equalJs = (arg: Id, [a, b]: string[]) => {
    const t = ty(arg);
    if (t.t === "con" && t.id === NUMBER) return `$sameNumber(${a}, ${b})`;
    if (t.t === "con" && (t.id === STRING || t.id === INT)) return `(${a} === ${b})`;
    return `$eq(${a}, ${b})`;
  };
  const node = <K extends NodeOf<any>["kind"]>(id: Id) => code.nodes[id] as NodeOf<K>;

  // ---- identifiers: display names where there are some, made unique
  const used = new Set<string>();
  const idents = new Map<string, string>();
  const ident = (key: string, hint: string): string => {
    if (idents.has(key)) return idents.get(key)!;
    let base = hint.replace(/[^\p{ID_Continue}$]+/gu, "_").replace(/^_+|_+$/g, "") || "v";
    if (!/^[\p{ID_Start}$]/u.test(base)) base = "_" + base;
    let name = base;
    for (let i = 2; used.has(name) || RESERVED.has(name); i++) name = `${base}${i}`;
    used.add(name);
    idents.set(key, name);
    return name;
  };
  // Tags are variant ids; the name is only a comment.
  const tag = (variant: Id) => `${JSON.stringify(variant)}${names[variant] && names[variant] !== variant ? ` /* ${names[variant]} */` : ""}`;
  const local = (binder: Id) => ident(binder, names[binder] ?? "x");
  let temps = 0;
  const temp = (hint = "t") => `${hint}$${temps++}`;
  // A fold's field that holds the type in a container: its shape.
  const nestedShape = (a: NodeOf<"arm">, i: number): Shape | null => {
    const def = info.owner.get(a.variant)!;
    if (fieldShapes(code, def, a.variant)[i] !== "nested") return null;
    return shapeOf(code, def, node<"field">(node<"variant">(a.variant).fields[i]).type);
  };

  const referenced = new Set<Id>();
  for (const n of Object.values(code.nodes)) if (n.kind === "ref") referenced.add(n.target);

  // ---- reflection
  // Some things look inside a function at run time: a relation run
  // backwards by the relational interpreter (relate.ts), when a function is
  // passed to it, and `derivative`. In a program that does either, compiled
  // functions remember the node they came from and the values they closed
  // over, the same as the evaluator's (META), and the module carries its
  // own node table for the interpreter to read.
  const relational = (n: NodeOf<"solve">) => planSolve(code, n).mode === "relational";
  const reflective = Object.values(code.nodes).some((n) => (n.kind === "solve" && relational(n)) || (n.kind === "ref" && (n.target === S.derivative || n.target === S.exists)));
  // The expressions a solve node hands over: all of its given ports for the
  // interpreter, only the solver's known ones (not a predicate's out = true)
  // for a planned direction.
  const givenOf = (n: NodeOf<"solve">) => (relational(n) ? Object.values(n.given) : planSolve(code, n).known.map((k) => n.given[k]));
  // The binders a lambda closes over: used inside it, bound outside it.
  function captured(lambda: Id): Id[] {
    const inside = subtree(code, lambda);
    const own = new Set(inside.filter((id) => code.nodes[id].kind === "binder"));
    const out = new Set<Id>();
    for (const id of inside) {
      const n = code.nodes[id];
      if (n.kind === "ref" && code.nodes[n.target]?.kind === "binder" && !own.has(n.target)) out.add(n.target);
    }
    return [...out];
  }

  // ---- effects under a specialization
  const choice = (row: Row, rho: Rho) => {
    const r = sub.resolveRow(row);
    return r.effs.includes(CHOICE) || (r.tail !== null && rho.get(r.tail) === true);
  };
  const streamsFn = (t: Type, rho: Rho) => t.t === "fn" && choice(t.eff, rho);

  // Where `ret` puts a value.
  interface Out { bool: boolean; leaf: (js: string) => string }
  const RETURN: Out = { bool: false, leaf: (js) => `return ${js};` };
  const RETURN_BOOL: Out = { bool: true, leaf: (js) => `return ${js};` };

  // ---- specializations of definitions
  // `plain`: parameters whose type says Choice, but whose argument at the
  // calls this copy serves is a function written in place that never
  // chooses, so the copy calls them as plain functions (GAPS.md G4).
  // `bool`: the copy returns a JS boolean, not Bool data. Its callers test
  // it as it is, or make it data where they need a value (GAPS.md G3).
  interface Spec { def: Id; rho: Rho; name: string; streams: boolean; plain: Set<Id>; bool: boolean }
  const specs = new Map<string, Spec>();
  const queue: Spec[] = [];
  const isFnDef = (def: Id) => code.nodes[node<"def">(def).body!]?.kind === "lambda";
  const isBool = (t: Type) => { const z = sub.zonk(t); return z.t === "con" && z.id === BOOL; };
  // A use of a copy as a value: Bool data out, as everywhere else.
  const asValue = (s: Spec) => (s.bool ? `((...a) => $bool(${s.name}(...a)))` : s.name);

  function spec(def: Id, rho: Rho, plain: Set<Id> = new Set()): Spec {
    const scheme = info.schemes.get(def)!;
    const on = scheme.rows.filter((r) => rho.get(r)).sort((a, b) => a - b);
    const key = `${def}|${on.join(",")}|${[...plain].sort().join(",")}`;
    if (!specs.has(key)) {
      const base = names[def] ?? def;
      const streams = streamsFn(scheme.type, rho), t = scheme.type;
      const bool = !reflective && !streams && isFnDef(def) && t.t === "fn" && isBool(t.ret);
      const s: Spec = { def, rho, plain, name: ident(key, `${base}${on.length ? "$choice" : ""}${plain.size ? "$plain" : ""}`), streams, bool };
      specs.set(key, s);
      queue.push(s);
    }
    return specs.get(key)!;
  }

  // The specialization a use of `def` needs. Row variables that only appear
  // as the definition's own effect (not inside a parameter) are pure: a
  // definition that doesn't do Choice itself can't start doing it because
  // a caller does. The others follow the argument passed for them.
  function specAt(ref: Id, def: Id, rho: Rho, plain?: Set<Id>): Spec {
    const scheme = info.schemes.get(def)!;
    const inner = new Set<number>();
    const collect = (t: Type, top: boolean) => {
      if (t.t === "con") t.args.forEach((a) => collect(a, false));
      if (t.t !== "fn") return;
      if (!top && t.eff.tail !== null) inner.add(t.eff.tail);
      t.params.forEach((p) => collect(p, false));
      collect(t.ret, false);
    };
    collect(scheme.type, true);
    const out: Rho = new Map();
    const walk = (s: Type, t: Type) => {
      if (s.t === "con" && t.t === "con") s.args.forEach((a, i) => walk(a, t.args[i]));
      if (s.t !== "fn" || t.t !== "fn") return;
      // Where the position already says Choice, the variable adds nothing,
      // so only positions without it tell us what the variable stands for.
      if (s.eff.tail !== null && inner.has(s.eff.tail) && !s.eff.effs.includes(CHOICE) && !out.get(s.eff.tail)) out.set(s.eff.tail, choice(t.eff, rho));
      s.params.forEach((p, i) => walk(p, t.params[i]));
      walk(s.ret, t.ret);
    };
    walk(scheme.type, ty(ref));
    return spec(def, out, plain);
  }

  // The parameters of a function definition that are only ever called,
  // never passed on or stored, so a copy may call them plainly.
  const onlyCalled = new Map<Id, Set<Id>>();
  function calledParams(def: Id): Set<Id> {
    if (!onlyCalled.has(def)) {
      const lam = node<"lambda">(node<"def">(def).body!);
      const ok = new Set(lam.params);
      const callee = new Set<Id>();
      for (const id of subtree(code, lam.body)) {
        const n = code.nodes[id];
        if (n.kind === "call") callee.add(n.fn);
      }
      for (const id of subtree(code, lam.body)) {
        const n = code.nodes[id];
        if (n.kind === "ref" && ok.has(n.target) && !callee.has(id)) ok.delete(n.target);
      }
      onlyCalled.set(def, ok);
    }
    return onlyCalled.get(def)!;
  }

  // ---- solve nodes: one function each, shared by every specialization
  const solvers = new Map<Id, string>();
  const solverCode: string[] = [];
  function solver(n: NodeOf<"solve">): string {
    if (!solvers.has(n.id)) {
      const name = `solve$${solvers.size}`;
      solvers.set(n.id, name);
      const label = (port: string) => names[`${n.fn}#${port}`] ?? names[port] ?? port;
      if (relational(n)) {
        // Through cases, folds and text: the relational interpreter runs it.
        // A static mode analysis that compiles these too is the next stage.
        const given = Object.keys(n.given), ps = given.map((_, i) => `g${i}`);
        solverCode.push(`// ${names[n.fn] ?? n.fn}, run backwards by the relational interpreter: given ${given.map(label).join(", ")}, ` +
          `solve for ${Object.keys(n.binds).map(label).join(", ")}\nfunction ${name}(${ps.join(", ")}) {\n` +
          `return $relate($program, ${JSON.stringify(n.fn)}, { ${given.map((g, i) => `${JSON.stringify(g)}: ${ps[i]}`).join(", ")} }, ${JSON.stringify(Object.keys(n.binds))});\n}`);
        return name;
      }
      solverCode.push(compileSolve(name, planSolve(code, n).rel!, planSolve(code, n).known, Object.keys(n.binds), names[n.fn] ?? n.fn, label));
    }
    return solvers.get(n.id)!;
  }

  // ---- one specialization's body
  function body(sp: Spec): string {
    const rho = sp.rho;
    const memo = new Map<Id, boolean>();
    const d = node<"def">(sp.def);
    // Lambdas here that are typed Choice but never choose, and are passed
    // where the callee's copy calls them plainly.
    const plainHere = new Set<Id>();

    // The copy of a definition a call needs: by the effects of its
    // arguments' types, and which of its Choice-typed function parameters
    // get a lambda written in place that doesn't choose.
    function defCall(n: NodeOf<"call">): Spec {
      const f = node<"ref">(n.fn);
      const plain = new Set<Id>();
      if (!reflective && isFnDef(f.target)) {
        const params = node<"lambda">(node<"def">(f.target).body!).params;
        const called = calledParams(f.target);
        n.args.forEach((a, i) => {
          const arg = code.nodes[a];
          if (arg.kind === "lambda" && called.has(params[i]) && streamsFn(ty(a), rho) && !streamy(arg.body)) {
            plain.add(params[i]);
            plainHere.add(a);
          }
        });
      }
      return specAt(f.id, f.target, rho, plain);
    }

    // Does evaluating this expression give anything other than exactly
    // one result? (A lambda doesn't: it's a value; calling it might.)
    function streamy(id: Id): boolean {
      if (memo.has(id)) return memo.get(id)!;
      const n = code.nodes[id];
      let r = false;
      switch (n.kind) {
        case "call": {
          const f = code.nodes[n.fn];
          if (f.kind === "lambda") r = n.args.some(streamy) || streamy(f.body);
          else r = streamy(n.fn) || n.args.some(streamy) || callStreams(n);
          break;
        }
        case "match": r = streamy(n.scrutinee) || n.arms.some((a) => streamy(node<"arm">(a).body)) || (!!n.otherwise && streamy(n.otherwise)); break;
        case "fold": r = streamy(n.scrutinee) || n.arms.some((a) => streamy(node<"arm">(a).body)); break;
        case "solve": r = !planSolve(code, n).unique || Object.values(n.given).some(streamy) || streamy(n.body); break;
      }
      memo.set(id, r);
      return r;
    }

    // Does this call's callee produce a stream (is it a generator)?
    function callStreams(n: NodeOf<"call">): boolean {
      const f = code.nodes[n.fn];
      if (f.kind === "ref") {
        const t = code.nodes[f.target];
        if (t.kind === "def") return defCall(n).streams;
        if (sp.plain.has(f.target)) return false;
        if (t.kind === "variant" || t.kind === "field") return false;
        if (t.kind === "builtin") {
          if (f.target === S.oneOf || f.target === S.fail || f.target === S.fuel || manyOf(f.target)) return true;
          if (f.target === S.first) return streamsFn(ty(n.args[1]), rho);
          if (f.target === S.seeded) return streamsFn(ty(n.args[1]), rho);
          return false;
        }
      }
      return streamsFn(ty(n.fn), rho);
    }

    // ---- expressions with exactly one result: a JS expression
    function ex(id: Id): string {
      if (streamy(id)) throw new Error(`internal: ${id} in ${names[sp.def]} has Choice but is compiled as a plain expression`);
      const n = code.nodes[id];
      switch (n.kind) {
        case "lit":
          if (n.of === INT && typeof n.value === "string") return `${n.value}n`;
          return typeof n.value === "number" && n.value < 0 ? `(${n.value})` : JSON.stringify(n.value);
        case "ref": return refValue(n);
        case "hole": return `$hole(${JSON.stringify(id)})`;
        case "lambda": return lambda(n);
        case "call": return call(n);
        case "match": return match(n);
        case "fold": return foldEx(n);
        case "solve": {
          const binds = Object.values(n.binds).map(local);
          return `((${binds.join(", ")}) => ${ex(n.body)})(...$one(${solver(n)}(${givenOf(n).map(ex).join(", ")})))`;
        }
        default: throw new Error(`can't compile a ${n.kind}`);
      }
    }

    // A boolean expression as a JS boolean, without building Bool data.
    function exBool(id: Id): string {
      const n = code.nodes[id];
      if (n.kind === "ref" && (n.target === TRUE || n.target === FALSE)) return String(n.target === TRUE);
      if (n.kind === "call" && code.nodes[n.fn].kind === "ref") {
        const target = node<"ref">(n.fn).target;
        if (OPS[target]?.bool) return OPS[target].js(n.args.map(BOOL_ARGS.has(target) ? exBool : ex), n.args);
        if (target === S.equal) return equality(n);
        if (code.nodes[target]?.kind === "def" && !streamy(id)) {
          const s = defCall(n);
          if (s.bool) {
            const c = `${s.name}(${n.args.map(ex).join(", ")})`;
            return info.divergent.has(target) ? `($spendOrThrow(), ${c})` : c;
          }
        }
      }
      if (n.kind === "match" && !handlerOf(n) && !streamy(id)) return `(() => {\n${ret(id, false, RETURN_BOOL)}\n})()`;
      return `(${ex(id)}.tag === ${JSON.stringify(TRUE)})`;
    }

    function equality(n: NodeOf<"call">): string {
      return equalJs(n.args[0], n.args.map(ex));
    }

    function refValue(n: NodeOf<"ref">): string {
      const t = code.nodes[n.target];
      const wrap = (f: string, isGen: boolean) => (streamsFn(ty(n.id), rho) && !isGen ? `$lift(${f})` : f);
      switch (t.kind) {
        case "binder": return local(n.target);
        case "def": {
          const s = specAt(n.id, n.target, rho);
          if (!isFnDef(n.target)) return `${s.name}()`;
          // A function without Choice, where a Choice function goes (a list
          // holding both kinds): lifted to a stream of one result.
          return wrap(asValue(s), s.streams);
        }
        case "variant":
          if (effectOf(n.target)) return wrap(`((...a) => ${perform(n.target, ["...a"])})`, false);
          if (n.target === TRUE) return "$T";
          if (n.target === FALSE) return "$F";
          if (n.target === NIL) return "$nil";
          if (n.target === UNIT_V) return "$unit";
          if (!t.fields.length) return `({ tag: ${tag(n.target)}, fields: [] })`;
          return wrap(`((${t.fields.map((_, i) => `a${i}`).join(", ")}) => ${construct(n.target, t.fields.map((_, i) => `a${i}`))})`, false);
        case "field": return wrap(`((d) => d.fields[${fieldIndex(n.target)}])`, false);
        case "builtin": {
          if (OPS[n.target]) {
            const ps = Array.from({ length: arity(n.id) }, (_, i) => `a${i}`);
            const js = OPS[n.target].bool ? `$bool(${OPS[n.target].js(ps)})` : OPS[n.target].js(ps);
            return wrap(`((${ps.join(", ")}) => ${js})`, false);
          }
          const runtime: Record<Id, [string, boolean]> = {
            [S.oneOf]: ["$oneOf", true], [S.fail]: ["$fail", true], [S.all]: ["$all", false], [S.count]: ["$count", false], [S.optional]: ["$optional", false],
            [S.equal]: ["((a, b) => $bool($eq(a, b)))", false],
          };
          if (n.target === S.first) return streamsFn(ty(n.id), rho) ? "$firstS" : "$first";
          if (n.target === S.seeded) return streamsFn(ty(n.id), rho) ? "$seededS" : "$seeded";
          if (manyOf(n.target)) return wrap(manyOf(n.target)!, true);
          if (implOf(n.target)) return wrap(implOf(n.target)!, false);
          if (runtime[n.target]) return wrap(...runtime[n.target]);
          throw new Error(`${names[n.target] ?? n.target} can't be used as a value yet`);
        }
        default: throw new Error(`can't refer to a ${t.kind}`);
      }
    }
    const arity = (id: Id) => { const t = ty(id); return t.t === "fn" ? t.params.length : 0; };

    // set: the checker made sure the path is fields written in place, so
    // the positions are known now.
    function setCall(get: Id, record: string, value: string): string {
      const path = fieldPath(code, get)!.map(fieldIndex);
      return `$setPath(${record}, ${JSON.stringify(path)}, ${value})`;
    }

    function construct(variant: Id, fields: string[]): string {
      if (variant === CONS) return `$cons(${fields.join(", ")})`;
      return `({ tag: ${tag(variant)}, fields: [${fields.join(", ")}] })`;
    }
    function fieldIndex(field: Id): number {
      const def = info.owner.get(field)!;
      const variant = node<"typedef">(node<"def">(def).body!).variants[0];
      return node<"variant">(variant).fields.indexOf(field);
    }

    function lambda(n: NodeOf<"lambda">): string {
      if (!reflective) return plainLambda(n);
      // The evaluator calls every function as a stream, so a plain function
      // it might call is wrapped.
      const env = captured(n.id).map((b) => {
        const t = ty(b);
        return `[${JSON.stringify(b)}, ${t.t === "fn" ? `$toEval(${local(b)}, ${streamsFn(t, rho)})` : local(b)}]`;
      });
      return `$meta(${plainLambda(n)}, ${JSON.stringify(n.id)}${env.length ? `, () => [${env.join(", ")}]` : ""})`;
    }
    function plainLambda(n: NodeOf<"lambda">): string {
      const ps = n.params.map(local).join(", ");
      if (streamsFn(ty(n.id), rho) && !plainHere.has(n.id)) return `(function* (${ps}) {\n${st(n.body, (v) => `yield ${v};`)}\n})`;
      const b = code.nodes[n.body].kind;
      if (b === "match" || b === "fold" || (b === "call" && code.nodes[node<"call">(n.body).fn].kind === "lambda")) return `((${ps}) => {\n${ret(n.body)}\n})`;
      return `((${ps}) => ${ex(n.body)})`;
    }

    // A call with one result.
    function call(n: NodeOf<"call">): string {
      const f = code.nodes[n.fn];
      if (f.kind === "lambda") return block(n.id);
      if (f.kind === "ref") {
        const t = code.nodes[f.target];
        if (t.kind === "builtin") {
          if (OPS[f.target]) {
            const js = OPS[f.target].js(n.args.map(BOOL_ARGS.has(f.target) ? exBool : ex), n.args);
            return OPS[f.target].bool ? `$bool(${js})` : js;
          }
          if (f.target === S.equal) return `$bool(${equality(n)})`;
          if (HANDLERS.has(f.target)) return handlerEx(f.target, n);
          if (f.target === S.seeded) return `$seeded(${ex(n.args[0])}, ${ex(n.args[1])})`;
          if (f.target === S.derivative) return `$derivative($program, ${ex(n.args[0])}, ${streamsFn(ty(n.id), rho)})`;
          if (f.target === S.exists) return `$exists($program, ${ex(n.args[0])})`;
          if (f.target === SET) return setCall(n.args[0], ex(n.args[1]), ex(n.args[2]));
          if (implOf(f.target)) return `${implOf(f.target)}(${n.args.map(ex).join(", ")})`;
        }
        if (t.kind === "variant") return effectOf(f.target) ? perform(f.target, n.args.map(ex)) : construct(f.target, n.args.map(ex));
        if (t.kind === "field") return `${ex(n.args[0])}.fields[${fieldIndex(f.target)}]`;
        if (t.kind === "def") {
          const s = defCall(n);
          const c = `${s.name}(${n.args.map(ex).join(", ")})`;
          const v = s.bool ? `$bool(${c})` : c;
          return info.divergent.has(f.target) ? `($spendOrThrow(), ${v})` : v;
        }
      }
      return `${ex(n.fn)}(${n.args.map(ex).join(", ")})`;
    }

    // Handlers whose thunks are written in place become loops; otherwise
    // the runtime's versions are called with the thunks as values.
    const thunk = (id: Id) => (code.nodes[id].kind === "lambda" && !node<"lambda">(id).params.length ? node<"lambda">(id) : null);
    function handlerEx(h: Id, n: NodeOf<"call">): string {
      const body = thunk(n.args[h === S.fuel ? 1 : 0]);
      if (h === S.first) {
        const g = thunk(n.args[1]);
        if (!body) return `$first(${ex(n.args[0])}, ${ex(n.args[1])})`;
        return `(() => {\n${st(body.body, (v) => `return ${v};`)}\nreturn ${g ? ex(g.body) : `${ex(n.args[1])}()`};\n})()`;
      }
      if (h === S.all) {
        if (!body) return `$all(${ex(n.args[0])})`;
        const acc = temp("all");
        return `(() => {\nconst ${acc} = [];\n${st(body.body, (v) => `${acc}.push(${v});`)}\nreturn $toList(${acc});\n})()`;
      }
      if (h === S.optional) {
        if (!body) return `$optional(${ex(n.args[0])})`;
        return `(() => {\n${st(body.body, (v) => `return { tag: ${tag(SOME)}, fields: [${v}] };`)}\nreturn { tag: ${tag(NONE)}, fields: [] };\n})()`;
      }
      if (h === S.count) {
        if (!body) return `$count(${ex(n.args[0])})`;
        const c = temp("count");
        return `(() => {\nlet ${c} = 0;\n${st(body.body, () => `${c}++;`)}\nreturn ${c};\n})()`;
      }
      throw new Error("with fuel always has Choice");
    }

    // A handler: its cases as functions, answers and escapes apart (an
    // answer never has Choice; an escape may, when the match does).
    function handlerCases(n: NodeOf<"match">, streams: boolean): [string, string] {
      const arms = n.arms.map((a) => node<"arm">(a));
      const fn = (a: NodeOf<"arm">, gen: boolean) => {
        const ps = a.binds.map(local).join(", ");
        return gen ? `function* (${ps}) {\n${st(a.body, (v) => `yield ${v};`)}\n}` : `((${ps}) => {\n${ret(a.body)}\n})`;
      };
      const table = (as: NodeOf<"arm">[], gen: boolean) => `{ ${as.map((a) => `${tag(a.variant)}: ${fn(a, gen)}`).join(", ")} }`;
      const answers = arms.filter((a) => node<"variant">(a.variant).returns);
      return [table(answers, false), table(arms.filter((a) => !answers.includes(a)), streams)];
    }
    function handleEx(n: NodeOf<"match">): string {
      const [answers, escapes] = handlerCases(n, false);
      return `$handle(${JSON.stringify(handlerOf(n))}, ${answers}, ${escapes}, () => {\n${ret(n.scrutinee)}\n})`;
    }

    function match(n: NodeOf<"match">): string {
      if (handlerOf(n)) return handleEx(n);
      const arms = n.arms.map((a) => node<"arm">(a));
      if (isBoolMatch(n)) {
        const [t, e] = boolArms(n);
        return `(${exBool(n.scrutinee)} ? ${ex(t)} : ${ex(e)})`;
      }
      return block(n.id);
    }
    // Only the fields the arm uses are taken out.
    const binds = (a: NodeOf<"arm">, s: string) => a.binds.map((b, i) => (referenced.has(b) ? `\nconst ${local(b)} = ${s}.fields[${i}];` : "")).join("");
    const isBoolMatch = (n: NodeOf<"match">) => n.arms.every((a) => [TRUE, FALSE].includes(node<"arm">(a).variant)) && (n.arms.length === 2 || (n.arms.length === 1 && !!n.otherwise));
    const boolArms = (n: NodeOf<"match">): [Id, Id] => {
      const arm = (v: Id) => n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === v)?.body ?? n.otherwise!;
      return [arm(TRUE), arm(FALSE)];
    };

    // fold: a loop, children first (bottom-up).
    const foldEx = (n: NodeOf<"fold">) => block(n.id);

    // An expression that needs statements (a let, a match, a fold) inside
    // an expression.
    const block = (id: Id) => `(() => {\n${ret(id)}\n})()`;

    // Statements that return the value of `id` (no Choice). Lets become
    // consts, matches become switches, folds local recursive functions.
    // `tail`: these statements end the definition's own body, so a call
    // of the definition to itself here is a jump back to its start.
    // `out`: what to do with the value (return it, or put it in a
    // variable), and whether it's wanted as a JS boolean instead of Bool
    // data.
    function ret(id: Id, tail = false, out: Out = RETURN): string {
      const n = code.nodes[id];
      if (streamy(id)) throw new Error(`internal: ${id} in ${names[sp.def]} has Choice but is compiled as a plain expression`);
      if (n.kind === "call" && code.nodes[n.fn].kind === "lambda") {
        const f = node<"lambda">(n.fn);
        return f.params.map((p, i) => bindLet(p, ex(n.args[i]))).join("") + ret(f.body, tail, out);
      }
      if (n.kind === "match") {
        if (handlerOf(n)) return out.leaf(out.bool ? `(${handleEx(n)}.tag === ${JSON.stringify(TRUE)})` : handleEx(n));
        if (isBoolMatch(n)) {
          const [t, e] = boolArms(n);
          return `${condition(n.scrutinee, (c) => `if (${c}) {\n${ret(t, tail, out)}\n}\n${ret(e, tail, out)}`)}`;
        }
        const s = temp("s");
        const cases = n.arms.map((a) => node<"arm">(a)).map((a) => `case ${tag(a.variant)}: {${binds(a, s)}\n${ret(a.body, tail, out)}\n}`);
        if (n.otherwise) cases.push(`default: {\n${ret(n.otherwise, tail, out)}\n}`);
        return `const ${s} = ${ex(n.scrutinee)};\nswitch (${s}.tag) {\n${cases.join("\n")}\n}`;
      }
      if (n.kind === "fold" && !out.bool) return out === RETURN ? foldLoop(n) : out.leaf(foldEx(n));
      if (tail && selfCall(n)) {
        // The new arguments go into the loop's inputs, and the body runs
        // again with them: no JS stack (COMPILER.md, stage 2½).
        jumps = true;
        const lam = node<"lambda">(d.body!);
        const args = (n as NodeOf<"call">).args.map(ex);
        const spend = info.divergent.has(sp.def) ? "$spendOrThrow();\n" : "";
        return `${spend}${lam.params.map((p, i) => `${local(p)}$in = ${args[i]};`).join("\n")}\ncontinue;`;
      }
      return out.leaf(out.bool ? exBool(id) : ex(id));
    }

    // A test of a Bool. When it is decided by a match (`is mark` in calc),
    // the match runs as statements that set a JS boolean, instead of a
    // function called in place that returns Bool data.
    function condition(id: Id, k: (c: string) => string): string {
      const n = code.nodes[id];
      if (n.kind !== "match" || handlerOf(n)) return k(exBool(id));
      const c = temp("c"), done = temp("done");
      return `let ${c};\n${done}: {\n${ret(id, false, { bool: true, leaf: (js) => `${c} = ${js};\nbreak ${done};` })}\n}\n${k(c)}`;
    }
    // A call of this very specialization of the definition.
    let jumps = false;
    function selfCall(n: Node): boolean {
      if (n.kind !== "call") return false;
      const f = code.nodes[n.fn];
      return f.kind === "ref" && f.target === sp.def && defCall(n).name === sp.name;
    }

    // A fold without Choice is a loop, not a recursion, so a list of a
    // million items needs no JS stack. One function, `step`, runs an arm
    // given a value and the folded results of its recursive fields. Children
    // are folded before parents, as the evaluator does it.
    //  - When no case has more than one recursive field (lists, Nat, any
    //    chain), walk down the spine into an array, then run the steps back
    //    up it.
    //  - Otherwise (trees), keep an explicit stack of values whose children
    //    are being folded.
    //  - When a field holds the type nested in a container (a rose tree's
    //    List Tree), `parts` lists the trees inside it (projectional/src/
    //    lang/nested.ts) and puts their results back in a copy of it.
    // How it loops is the fold job of the storage its input has
    // (projectional/src/lang/represent.ts, `foldPlan`).
    function foldLoop(n: NodeOf<"fold">): string {
      const plan = foldPlan(code, n);
      switch (plan.rep.jobs.fold) {
        case "cells.loop": return foldCells(n, ex(plan.on));
        case "text.reverse": return foldText(n, ex(plan.on));
        case "count.down": return foldCount(n, ex(plan.on), plan.rep.meaning === INT_OPS.range);
        default: throw new Error(`no template for ${plan.rep.jobs.fold}`);
      }
    }

    function foldCells(n: NodeOf<"fold">, input: string): string {
      const arms = n.arms.map((a) => node<"arm">(a));
      const recOf = (a: NodeOf<"arm">) => a.results.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
      if (arms.some((a) => recOf(a).some((i) => nestedShape(a, i)))) return foldNested(input, arms, recOf);
      const chain = arms.every((a) => recOf(a).length <= 1);
      const step = temp("step"), s = temp("s"), rs = temp("rs");
      const cases = arms.map((a) => {
        const rec = recOf(a).map((i, k) => `\nconst ${local(a.results[i]!)} = ${chain ? rs : `${rs}[${k}]`};`).join("");
        return `case ${tag(a.variant)}: {${binds(a, s)}${rec}\n${ret(a.body)}\n}`;
      });
      const recursive = arms.filter((a) => recOf(a).length);
      const fn = `const ${step} = (${s}, ${rs}) => {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n`;
      const v = temp("v"), r = temp("r");
      if (chain) {
        const spine = temp("spine"), i = temp("i");
        const next = recursive.map((a) => `${v}.tag === ${tag(a.variant)} ? ${recOf(a)[0]} : `).join("") + "-1";
        const k = temp("k");
        return `${fn}const ${spine} = [];\nlet ${v} = ${input};\n` +
          `for (let ${k} = ${next}; ${k} >= 0; ${k} = ${next}) {\n${spine}.push(${v});\n${v} = ${v}.fields[${k}];\n}\n` +
          `let ${r} = ${step}(${v});\nfor (let ${i} = ${spine}.length - 1; ${i} >= 0; ${i}--) ${r} = ${step}(${spine}[${i}], ${r});\nreturn ${r};`;
      }
      const todo = temp("todo"), top = temp("top"), ix = temp("ix");
      const fields = `{ ${recursive.map((a) => `${tag(a.variant).split(" ")[0]}: [${recOf(a).join(", ")}]`).join(", ")} }`;
      return `${fn}const ${ix} = ${fields};\nconst ${todo} = [{ v: ${input}, i: 0, rs: [] }];\n` +
        `for (;;) {\nconst ${top} = ${todo}[${todo}.length - 1];\nconst ${v} = ${ix}[${top}.v.tag];\n` +
        `if (${v} && ${top}.i < ${v}.length) {\n${todo}.push({ v: ${top}.v.fields[${v}[${top}.i++]], i: 0, rs: [] });\ncontinue;\n}\n` +
        `const ${r} = ${step}(${top}.v, ${top}.rs);\n${todo}.pop();\nif (!${todo}.length) return ${r};\n${todo}[${todo}.length - 1].rs.push(${r});\n}`;
    }

    // A fold over `characters(t)`, run on t: the characters from the end,
    // a surrogate pair taken as one, as `characters` splits them. No list.
    function foldText(n: NodeOf<"fold">, input: string): string {
      const [nil, cons, nilFn, consFn, i, r] = foldArms(n);
      const t = temp("t"), j = temp("j");
      return `${nilFn}${consFn}const ${t} = ${input};\nlet ${r} = ${nil}();\n` +
        `for (let ${i} = ${t}.length, ${j}; ${i} > 0; ${i} = ${j}) {\n${j} = ${i} - 1;\n` +
        `if (${j} > 0 && (${t}.charCodeAt(${j}) & 0xfc00) === 0xdc00 && (${t}.charCodeAt(${j} - 1) & 0xfc00) === 0xd800) ${j}--;\n` +
        `${r} = ${cons}(${t}.slice(${j}, ${i}), ${r});\n}\nreturn ${r};`;
    }

    // A fold over `range(n)`, run on n: the cons arm for n − 1 down to 0,
    // as many as `range` makes (the whole part of n for a Number, none for
    // NaN or below 1). No list.
    function foldCount(n: NodeOf<"fold">, input: string, int: boolean): string {
      const [nil, cons, nilFn, consFn, i, r] = foldArms(n);
      return `${nilFn}${consFn}let ${r} = ${nil}();\n` +
        `for (let ${i} = ${int ? `Number(${input})` : `Math.floor(${input})`} - 1; ${i} >= 0; ${i}--) ${r} = ${cons}(${i}, ${r});\nreturn ${r};`;
    }

    // The two arms of a fold over a list as local functions, for the
    // templates that run it on other storage: () for nil, (item, folded
    // rest) for cons.
    function foldArms(n: NodeOf<"fold">): [string, string, string, string, string, string] {
      const arm = (v: Id) => n.arms.map((a) => node<"arm">(a)).find((a) => a.variant === v)!;
      const nil = arm(NIL), cons = arm(CONS);
      const ifNil = temp("nil"), ifCons = temp("cons");
      const c = referenced.has(cons.binds[0]) ? local(cons.binds[0]) : temp("c");
      const after = cons.results[1] ? local(cons.results[1]) : temp("after");
      return [ifNil, ifCons, `const ${ifNil} = () => {\n${ret(nil.body)}\n};\n`, `const ${ifCons} = (${c}, ${after}) => {\n${ret(cons.body)}\n};\n`, temp("i"), temp("r")];
    }

    function foldNested(input: string, arms: NodeOf<"arm">[], recOf: (a: NodeOf<"arm">) => number[]): string {
      const step = temp("step"), s = temp("s"), rs = temp("rs"), parts = temp("parts");
      const cases = arms.map((a) => {
        const rec = recOf(a).map((i, k) => `\nconst ${local(a.results[i]!)} = ${rs}[${k}];`).join("");
        return `case ${tag(a.variant)}: {${binds(a, s)}${rec}\n${ret(a.body)}\n}`;
      });
      const partCases = arms.filter((a) => recOf(a).length).map((a) => `case ${tag(a.variant)}: return [${recOf(a).map((i) => {
        const shape = nestedShape(a, i);
        return shape ? `$spread(${JSON.stringify(shape)}, ${s}.fields[${i}])` : `$self(${s}.fields[${i}])`;
      }).join(", ")}];`);
      const todo = temp("todo"), top = temp("top"), r = temp("r"), at = temp("at");
      return `const ${step} = (${s}, ${rs}) => {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n` +
        `const ${parts} = (${s}) => {\nswitch (${s}.tag) {\n${partCases.join("\n")}\ndefault: return [];\n}\n};\n` +
        `const ${todo} = [{ v: ${input}, ps: null, kids: null, i: 0, rs: [] }];\n` +
        `for (;;) {\nconst ${top} = ${todo}[${todo}.length - 1];\n` +
        `if (!${top}.ps) { ${top}.ps = ${parts}(${top}.v); ${top}.kids = ${top}.ps.flatMap((p) => p.children); }\n` +
        `if (${top}.i < ${top}.kids.length) {\n${todo}.push({ v: ${top}.kids[${top}.i++], ps: null, kids: null, i: 0, rs: [] });\ncontinue;\n}\n` +
        `let ${at} = 0;\nconst ${r} = ${step}(${top}.v, ${top}.ps.map((p) => p.rebuild(${top}.rs.slice(${at}, (${at} += p.children.length)))));\n` +
        `${todo}.pop();\nif (!${todo}.length) return ${r};\n${todo}[${todo}.length - 1].rs.push(${r});\n}`;
    }

    // `let x = v`, or just `v;` for the `_` of a sequence.
    function bindLet(p: Id, v: string): string {
      if (referenced.has(p)) return `const ${local(p)} = ${v};\n`;
      return /^[\p{L}\p{N}_$]+$/u.test(v) ? "" : `${v};\n`;
    }

    // ---- expressions with Choice: statements that run `k` once per result
    function st(id: Id, k: K): string {
      if (!streamy(id)) return k(ex(id));
      const n = code.nodes[id];
      switch (n.kind) {
        case "call": return stCall(n, k);
        case "match": {
          if (!handlerOf(n)) return stMatch(n, k);
          const [answers, escapes] = handlerCases(n, true), r = temp("r");
          return `for (const ${r} of $handleS(${JSON.stringify(handlerOf(n))}, ${answers}, ${escapes}, function* () {\n${st(n.scrutinee, (v) => `yield ${v};`)}\n})) {\n${k(r)}\n}`;
        }
        case "fold": return stFold(n, k);
        case "solve": {
          return parts(givenOf(n), (vals) => {
            const sol = temp("sol");
            const bs = Object.values(n.binds).map((b, i) => `const ${local(b)} = ${sol}[${i}];`).join(" ");
            return `for (const ${sol} of ${solver(n)}(${vals.join(", ")})) {\n${bs}\n${st(n.body, k)}\n}`;
          });
        }
        default: throw new Error(`internal: a ${n.kind} with Choice`);
      }
    }

    // Evaluate parts left to right, earlier choices varying slowest (as the
    // evaluator does). A part without Choice that a later part loops over
    // is computed once, before the loop.
    function parts(ids: Id[], k: (vals: string[]) => string, i = 0, acc: string[] = []): string {
      if (i === ids.length) return k(acc);
      const id = ids[i];
      if (streamy(id)) return st(id, (v) => {
        if (/^[\p{L}\p{N}_$]+$/u.test(v)) return parts(ids, k, i + 1, [...acc, v]);
        const t = temp();
        return `const ${t} = ${v};\n${parts(ids, k, i + 1, [...acc, t])}`;
      });
      const kind = code.nodes[id].kind;
      if (kind === "lit" || kind === "ref" || !ids.slice(i + 1).some(streamy)) return parts(ids, k, i + 1, [...acc, ex(id)]);
      const t = temp();
      return `const ${t} = ${ex(id)};\n${parts(ids, k, i + 1, [...acc, t])}`;
    }

    // Run k more than once only if it's short; otherwise loop over a local
    // generator and run k once, after it.
    function branch(k: K, gen: (y: K) => string): string {
      const probe = k("$$");
      if (probe.length < 160) return gen(k);
      const r = temp("r");
      return `for (const ${r} of (function* () {\n${gen((v) => `yield ${v};`)}\n})()) {\n${k(r)}\n}`;
    }

    function stCall(n: NodeOf<"call">, k: K): string {
      const f = code.nodes[n.fn];
      if (f.kind === "lambda") {
        return parts(n.args, (vals) => `${f.params.map((p, i) => bindLet(p, vals[i])).join("")}${st(f.body, k)}`);
      }
      if (f.kind === "ref" && code.nodes[f.target].kind === "builtin") {
        const h = f.target;
        if (h === S.fail) return "/* fail */";
        if (h === S.oneOf) return parts(n.args, ([xs]) => {
          const l = temp("l"), x = temp("x");
          return `for (let ${l} = ${xs}; ${l}.tag === ${JSON.stringify(CONS)}; ${l} = ${l}.fields[1]) {\nconst ${x} = ${l}.fields[0];\n${k(x)}\n}`;
        });
        if (h === S.first && callStreams(n)) {
          const body = thunk(n.args[0]), g = thunk(n.args[1]);
          if (body && g) return branch(k, (y) => {
            const L = temp("first");
            return `${L}: {\n${st(body.body, (v) => `${y(v)}\nbreak ${L};`)}\n${st(g.body, y)}\n}`;
          });
        }
        if (h === S.seeded && callStreams(n)) return parts(n.args, ([seed, body]) => {
          const r = temp("r");
          return `for (const ${r} of $seededS(${seed}, ${body})) {\n${k(r)}\n}`;
        });
        if (h === S.fuel) return parts(n.args, ([fuel, body]) => {
          const r = temp("r");
          return `for (const ${r} of $fuel(${fuel}, ${body}, ${streamsFn(ty(n.args[1]), rho)})) {\n${k(r)}\n}`;
        });
      }
      const target = f.kind === "ref" ? f.target : null;
      const kind = target ? code.nodes[target].kind : null;
      const callee = kind === "def" ? defCall(n) : null;
      return parts([n.fn, ...n.args], ([fn, ...args]) => {
        let c: string;
        if (callee) c = callee.bool ? `$bool(${callee.name}(${args.join(", ")}))` : `${callee.name}(${args.join(", ")})`;
        else if (kind === "variant") c = effectOf(target!) ? perform(target!, args) : construct(target!, args);
        else if (kind === "field") c = `${args[0]}.fields[${fieldIndex(target!)}]`;
        else if (kind === "builtin" && OPS[target!]) {
          const js = OPS[target!].js(BOOL_ARGS.has(target!) ? args.map((a) => `(${a}.tag === ${JSON.stringify(TRUE)})`) : args);
          c = OPS[target!].bool ? `$bool(${js})` : js;
        } else if (target === S.equal) c = `$bool(${equalJs(n.args[0], args)})`;
        else if (target === S.derivative) c = `$derivative($program, ${args[0]}, ${streamsFn(ty(n.id), rho)})`;
        else if (target === S.exists) c = `$exists($program, ${args[0]})`;
        else if (target === SET) c = setCall(n.args[0], args[1], args[2]);
        else if (kind === "builtin" && (manyOf(target!) ?? implOf(target!))) c = `${manyOf(target!) ?? implOf(target!)}(${args.join(", ")})`;
        else c = `${fn}(${args.join(", ")})`;
        let out: string;
        if (callStreams(n)) {
          const r = temp("r");
          out = `for (const ${r} of ${c}) {\n${k(r)}\n}`;
        } else out = k(c);
        // Out of fuel: this call has no result, the others carry on.
        return target && info.divergent.has(target) ? `if ($spend()) {\n${out}\n}` : out;
      });
    }

    function stMatch(n: NodeOf<"match">, k: K): string {
      return parts([n.scrutinee], ([s]) => branch(k, (y) => {
        if (isBoolMatch(n)) {
          const [t, e] = boolArms(n);
          const c = code.nodes[n.scrutinee].kind === "call" && !streamy(n.scrutinee) ? exBool(n.scrutinee) : `(${s}.tag === ${JSON.stringify(TRUE)})`;
          return `if (${c}) {\n${st(t, y)}\n} else {\n${st(e, y)}\n}`;
        }
        const v = temp("s");
        const cases = n.arms.map((a) => node<"arm">(a)).map((a) => `case ${tag(a.variant)}: {${binds(a, v)}\n${st(a.body, y)}\nbreak;\n}`);
        if (n.otherwise) cases.push(`default: {\n${st(n.otherwise, y)}\n}`);
        return `{\nconst ${v} = ${s};\nswitch (${v}.tag) {\n${cases.join("\n")}\n}\n}`;
      }));
    }

    // A fold with Choice: a local generator; each combination of the
    // children's results is a separate branch.
    function stFold(n: NodeOf<"fold">, k: K): string {
      const f = temp("fold"), s = temp("s");
      const cases = n.arms.map((id) => {
        const a = node<"arm">(id);
        let inner = st(a.body, (v) => `yield ${v};`);
        for (let i = a.results.length - 1; i >= 0; i--) {
          const r = a.results[i];
          const shape = r ? nestedShape(a, i) : null;
          if (r) inner = `for (const ${local(r)} of ${shape ? `$foldNested(${f}, $spread(${JSON.stringify(shape)}, ${s}.fields[${i}]))` : `${f}(${s}.fields[${i}])`}) {\n${inner}\n}`;
        }
        return `case ${tag(a.variant)}: {${binds(a, s)}\n${inner}\nbreak;\n}`;
      });
      const r = temp("r");
      return `const ${f} = function* (${s}) {\nswitch (${s}.tag) {\n${cases.join("\n")}\n}\n};\n` +
        parts([n.scrutinee], ([v]) => `for (const ${r} of ${f}(${v})) {\n${k(r)}\n}`);
    }

    // ---- the definition itself
    const b = d.body!;
    const header = `// ${names[sp.def] ?? sp.def}${sp.rho.size && [...sp.rho.values()].some(Boolean) ? " (called with a Choice function)" : ""}`;
    if (isFnDef(sp.def)) {
      const lam = node<"lambda">(b);
      const ps = lam.params.map(local).join(", ");
      const meta = reflective ? `\n$meta(${sp.name}, ${JSON.stringify(b)});` : "";
      if (sp.streams) return `${header}\nfunction* ${sp.name}(${ps}) {\n${st(lam.body, (v) => `yield ${v};`)}\n}${meta}`;
      const stmts = ret(lam.body, true, sp.bool ? RETURN_BOOL : RETURN);
      // Self tail calls jump: the parameters become the loop's inputs, and
      // each pass binds them afresh, so a function made in one pass keeps
      // that pass's values.
      if (jumps) {
        const ins = lam.params.map((p) => `${local(p)}$in`).join(", ");
        const fresh = lam.params.length ? `const ${lam.params.map((p) => `${local(p)} = ${local(p)}$in`).join(", ")};\n` : "";
        return `${header}\nfunction ${sp.name}(${ins}) {\nfor (;;) {\n${fresh}${stmts}\n}\n}${meta}`;
      }
      return `${header}\nfunction ${sp.name}(${ps}) {\n${stmts}\n}${meta}`;
    }
    const cell = temp("value");
    return `${header}\nlet ${cell};\nfunction ${sp.name}() {\nreturn ${cell} ??= ${ex(b)};\n}`;
  }

  // ---- the module
  const out: string[] = [];
  const exported: string[] = [];
  for (const name of opts.exports) {
    const def = code.defs.find((d) => names[d] === name);
    if (!def) throw new Error(`no definition named ${name}`);
    exported.push(`  ${JSON.stringify(name)}: ${asValue(spec(def, new Map()))},`);
  }
  for (let s; (s = queue.shift());) out.push(body(s));

  const helpers = ["$showAny", "$int", "$text", "$impl", "$many", "$setPath", "$T", "$F", "$unit", "$nil", "$cons", "$bool", "$toList", "$range", "$eq", "$show", "$mod", "$first", "$firstS",
    "$all", "$count", "$oneOf", "$fail", "$lift", "$one", "$hole", "$fuel", "$spend", "$spendOrThrow", "$ok", "$clean", "$key",
    "$close", "$near", "$sameNumber", "$planned", "$solveRuntime", "$print", "$FN", "$perform", "$handle", "$handleS", "$io", "$seeded", "$seededS", "$optional", "$cells", "$spread", "$self", "$foldNested",
    ...(reflective ? ["$loadProgram", "$meta", "$toEval", "$relate", "$derivative", "$exists"] : [])];
  // The interpreter's copy of the program, and which definitions spend fuel.
  const program = reflective ? [`const $program = $loadProgram(${JSON.stringify(code)}, ${JSON.stringify([...info.divergent])});`] : [];
  return indent([
    `// Generated by compiler/src/compile.ts from a typed program. Do not edit.`,
    `import { ${helpers.join(", ")} } from ${JSON.stringify(opts.runtime)};`,
    ``,
    ...program,
    ...(referenced.has(SHOW_ANY) ? [`const $names = ${JSON.stringify(Object.fromEntries(Object.values(code.nodes).filter((n) => n.kind === "variant" && names[n.id] !== undefined).map((n) => [n.id, names[n.id]])))};`] : []),
    ...solverCode,
    ``,
    out.join("\n\n"),
    ``,
    `export const defs = {\n${exported.join("\n")}\n};`,
    ``,
  ].join("\n"));
}

// Indent by braces, so the output is readable.
function indent(src: string): string {
  let depth = 0;
  return src.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return "";
    const opens = (t.match(/[{(\[]/g) ?? []).length, closes = (t.match(/[})\]]/g) ?? []).length;
    const lead = /^[})\]]/.test(t) ? 1 : 0;
    const out = "  ".repeat(Math.max(0, depth - lead)) + t;
    depth = Math.max(0, depth + opens - closes);
    return out;
  }).join("\n");
}

const RESERVED = new Set(("break case catch class const continue debugger default delete do else export extends false finally for function if " +
  "import in instanceof new null return super switch this throw true try typeof var void while with yield let static enum await implements " +
  "package protected interface private public arguments eval undefined NaN Infinity Math Object Array Number String Symbol defs").split(" "));
