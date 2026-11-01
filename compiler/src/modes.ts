// A relational solve whose mode is det or semidet, compiled (MODES.md, plan
// step 5; COMPILER.md stage 1b).
//
// modes.ts plans each function in each mode once: its goals in the order
// they can run, and a choice of arms. relate.ts runs the plan with logic
// variables. Here the plan is written out as JavaScript instead, once per
// function and mode: the order is fixed, so at each goal the compiler knows
// which slots hold a value, and each goal becomes a computation, a test, or
// a value taken apart. A mode function takes its known ports and returns
// the others in an array, or $no when there is no answer. Since the mode
// has at most one answer, the first arm that gives one is the answer.
//
// What isn't written out (a goal waiting at run time, a function only known
// then, a fold run one level down, numbers solved by equations, a mode that
// may have several answers) throws Unsupported, and that solve stays with
// relate.ts.
//
// A mode whose one unknown port is a list built front to back (Haar's join
// run backwards: two samples consed onto the rest the call of itself gives)
// also has an `$into` copy, as compile.ts's definitions do (GAPS.md P4): it
// pushes the items onto an array it is handed and returns whether it has
// an answer. The cells that would hold them are left out, and a call of a
// mode for the rest hands the array on.

import type { Code, Id, NodeOf } from "../../ters/src/model.ts";
import { analyzer, determinism, type Exec, type Plan } from "../../ters/src/lang/modes.ts";
import { CONS, INT_OPS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";

export class Unsupported extends Error {}

export interface ModeEmit {
  // A literal, or a reference to something defined, as a value; null when
  // it can't be written at the top of the module.
  value(id: Id): string | null;
  // A call whose arguments are all known, run forward; null when it can't
  // be. `partial`: the answer may be $no (a builtin with Choice).
  forward(call: NodeOf<"call">, args: string[]): { js: string; partial?: boolean } | null;
  tag(variant: Id): string;
}

export function modeCompiler(code: Code, names: Record<Id, string>) {
  const nodes = code.nodes;
  const an = analyzer(code, names);
  // Mode functions by def and known ports, with their names and code.
  const made = new Map<string, string>();
  const out: string[] = [];
  let temps = 0;

  const portNode = (lam: NodeOf<"lambda">, p: string) => (p === "out" ? lam.body : lam.params[Number(p)]);
  const portsOf = (lam: NodeOf<"lambda">) => [...lam.params.map((_, i) => String(i)), "out"];
  const order = (ps: string[]) => [...ps].sort((a, b) => (a === "out" ? 1 : b === "out" ? -1 : Number(a) - Number(b)));

  // Values an `$into` mode builds (temp -> case and fields) and mode calls
  // it makes (temp -> the call), which its answer may write instead.
  let built: Map<string, { variant: Id; fields: string[] }> | null = null;
  let calls: Map<string, { def: Id; ins: string[]; vals: string[] }> | null = null;
  let handed = new Set<string>();
  // Failures after which nothing else is tried: the function gives no
  // answer (the last arm's, inside the last arm…). An `$into` mode's call of
  // itself there is a jump, and what it pushed needn't be taken back.
  const finals = new Set<string>(["return false;"]);
  let self: { name: string; params: string[]; jumps: boolean } | null = null;

  // The function for `def` with these ports known: its name. `into`: the
  // `$into` copy, for a mode with one unknown port.
  function modeFn(def: Id, known: string[], emit: ModeEmit, into = false): string {
    const key = `${def}|${order(known).join(",")}${into ? "|i" : ""}`;
    if (made.has(key)) return made.get(key)!;
    const lam = nodes[(nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    if (lam?.kind !== "lambda") throw new Unsupported("not a function");
    const name = `${(names[def] ?? def).replace(/[^\p{ID_Continue}$]+/gu, "_")}$mode${made.size}${into ? "$into" : ""}`;
    made.set(key, name);
    const was = [built, calls, handed, self] as const;
    try {
      const ins = order(known), outs = portsOf(lam).filter((p) => !ins.includes(p));
      if (into && outs.length !== 1) throw new Unsupported("an array for more than one port");
      const env = new Map<Id, string>();
      const params = ins.map((p) => { const v = `p$${temps++}`; env.set(an.slot(portNode(lam, p)), v); return v; });
      const plan = an.planOf({ k: "def", id: def }, { known: ins, spec: [] });
      const done = (env: Map<Id, string>, fail: string) => {
        const vs = outs.map((p) => env.get(an.slot(portNode(lam, p))));
        if (vs.some((v) => v === undefined)) throw new Unsupported("a port is never found");
        return into ? pushed(vs[0]!, fail, emit) : `return ${vs.length === 1 ? vs[0] : `[${vs.join(", ")}]`};`;
      };
      [built, calls, handed, self] = into ? [new Map(), new Map(), new Set(), { name, params, jumps: false }] : [null, null, handed, null];
      let body = writePlan(plan, env, done, emit, into ? "return false;" : "return $no;");
      if (into) body = unused(body);
      if (self?.jumps) body = `for (;;) {\n${body}\n}`;
      out.push(`// ${names[def] ?? def}, run with ${ins.length ? ins.map((p) => (p === "out" ? "its result" : names[lam.params[Number(p)]] ?? p)).join(", ") : "nothing"} known${into ? " (its answer pushed onto `d$`)" : ""}\nfunction ${name}(${[...(into ? ["d$"] : []), ...params].join(", ")}) {\n${body}\n}`);
    } catch (e) {
      made.delete(key);
      throw e;
    } finally {
      [built, calls, handed, self] = was;
    }
    return name;
  }

  // An `$into` mode's answer: the items of the cells it built pushed in
  // order, then the rest: nothing after a nil, a mode call that writes into
  // the array, or a list it only has as a value copied in. Where a failure
  // leaves an arm for the next one, what this arm pushed is taken back.
  function pushed(v: string, fail: string, emit: ModeEmit): string {
    const lines: string[] = [];
    let at = v;
    for (let c = built!.get(at); c?.variant === CONS; c = built!.get(at)) {
      lines.push(`d$.push(${c.fields[0]});`);
      at = c.fields[1];
    }
    const top = finals.has(fail);
    const n = top ? "" : `n$${temps++}`;
    const back = top ? fail : `{\nd$.length = ${n};\n${fail}\n}`;
    const call = calls!.get(at);
    let g: string | null = null;
    if (call) {
      try { g = modeFn(call.def, call.ins, emit, true); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
    }
    if (built!.get(at)?.variant === NIL || at === "$nil") {}
    else if (call && g && top && g === self?.name) {
      const ps = self.params;
      lines.push(ps.length === 1 ? `${ps[0]} = ${call.vals[0]};` : `[${ps.join(", ")}] = [${call.vals.join(", ")}];`, "continue;");
      self.jumps = true;
      handed.add(at);
      return lines.join("\n");
    } else if (call && g) { lines.push(`if (!${g}(${["d$", ...call.vals].join(", ")})) ${back}`); handed.add(at); }
    else lines.push(`$pushList(d$, ${at});`);
    return [...(n && lines.some((l) => l.startsWith("if")) ? [`const ${n} = d$.length;`] : []), ...lines, "return true;"].join("\n");
  }
  // The lines that built a cell or called a mode whose value nothing else
  // reads now, left out.
  function unused(body: string): string {
    const word = (t: string) => new RegExp(`(?<![\\p{ID_Continue}$])${t.replace(/\$/g, "\\$")}(?![\\p{ID_Continue}$])`, "u");
    let lines = body.split("\n"), left = [...built!.keys(), ...handed];
    for (let again = true; again; ) {
      again = false;
      for (const t of left) {
        const mine = (l: string) => l.startsWith(`const ${t} = `) || (handed.has(t) && l.startsWith(`if (${t} === $no) `));
        if (lines.some((l) => !mine(l) && word(t).test(l))) continue;
        lines = lines.filter((l) => !mine(l));
        left = left.filter((x) => x !== t);
        again = true;
      }
    }
    return lines.join("\n");
  }

  // What the statements of a plan see: the slots that hold a value, the
  // statements so far, in order, and what to do when this way fails
  // (`return $no;`, or leave an arm's block for the next arm).
  interface Scope { env: Map<Id, string>; lines: string[]; emit: ModeEmit; fail: string }
  const get = (sc: Scope, s: Id) => sc.env.get(an.slot(s));
  const fresh = (sc: Scope, js: string) => { const t = `m$${temps++}`; sc.lines.push(`const ${t} = ${js};`); return t; };
  // The temps that hold a case with no fields (a nil), by its variant.
  const bare = new Map<string, Id>();
  // A slot gets a value: if it has one, they must be equal (for a case
  // with no fields, the same tag).
  const bind = (sc: Scope, s: Id, js: string, variant?: Id) => {
    const k = an.slot(s), was = sc.env.get(k);
    const v = variant ?? bare.get(js), w = was !== undefined ? bare.get(was) : undefined;
    if (was !== undefined && v !== undefined) sc.lines.push(`if (${was}.tag !== ${sc.emit.tag(v)}) ${sc.fail}`);
    else if (was !== undefined && w !== undefined) sc.lines.push(`if (${js}.tag !== ${sc.emit.tag(w)}) ${sc.fail}`);
    else if (was !== undefined) sc.lines.push(`if (!$eq(${was}, ${js})) ${sc.fail}`);
    else {
      const t = /^[\p{L}\p{N}_$]+$/u.test(js) ? js : fresh(sc, js);
      if (v !== undefined) bare.set(t, v);
      sc.env.set(k, t);
    }
  };

  // The statements of a plan: each goal, then the choice, then `done`.
  function writePlan(plan: Plan, env0: Map<Id, string>, done: (env: Map<Id, string>, fail: string) => string, emit: ModeEmit, fail: string): string {
    // `fail`: this way gives no answer, whatever is left (the goals before
    // it can only fail too).
    if (fails(plan)) return fail;
    const sc: Scope = { env: new Map(env0), lines: [], emit, fail };
    for (const e of plan.steps) exec(e, sc);
    sc.lines.push(plan.branch ? choose(plan.branch, sc.env, done, emit, fail) : done(sc.env, fail));
    return sc.lines.join("\n");
  }

  const fails = (plan: Plan) => plan.steps.some((e) => {
    const f = e.k === "call" ? nodes[(nodes[e.node] as NodeOf<"call">).fn] : undefined;
    return f?.kind === "ref" && f.target === S.fail;
  });

  function exec(e: Exec, sc: Scope) {
    if (e.waits) throw new Unsupported("a goal waits");
    switch (e.k) {
      case "given": {
        const js = sc.emit.value(e.node);
        if (js === null) throw new Unsupported("a value only known in its scope");
        const n = nodes[e.node];
        bind(sc, e.node, js, n.kind === "ref" && nodes[n.target]?.kind === "variant" ? n.target : undefined);
        break;
      }
      case "same": {
        if (an.slot(e.a) === an.slot(e.b)) break;
        const a = get(sc, e.a), b = get(sc, e.b);
        if (a !== undefined) bind(sc, e.b, a);
        else if (b !== undefined) bind(sc, e.a, b);
        else throw new Unsupported("two unknowns made one");
        break;
      }
      case "case": {
        const val = get(sc, e.value);
        if (val !== undefined) {
          sc.lines.push(`if (${val}.tag !== ${sc.emit.tag(e.variant)}) ${sc.fail}`);
          e.binds.forEach((b, i) => bind(sc, b, `${val}.fields[${i}]`));
        } else {
          const fs = e.binds.map((b) => get(sc, b));
          if (fs.some((f) => f === undefined)) throw new Unsupported("a value built from unknowns");
          bind(sc, e.value, `{ tag: ${sc.emit.tag(e.variant)}, fields: [${fs.join(", ")}] }`);
          built?.set(get(sc, e.value)!, { variant: e.variant, fields: fs as string[] });
        }
        break;
      }
      case "call": call(nodes[e.node] as NodeOf<"call">, e.callee?.known ?? null, e.callee?.spec.length ?? 0, sc); break;
      default: throw new Unsupported(`a ${e.k} goal`);
    }
  }

  function call(n: NodeOf<"call">, callee: string[] | null, specs: number, sc: Scope) {
    const head = nodes[n.fn];
    if (head.kind !== "ref" || nodes[head.target]?.kind === "binder") throw new Unsupported("a function known only when it runs");
    const t = nodes[head.target];
    const args = n.args.map((a) => get(sc, a)), res = get(sc, n.id);
    const check = (r: string) => sc.lines.push(`if (${r} === $no) ${sc.fail}`);
    if (args.every((a) => a !== undefined)) {
      const f = sc.emit.forward(n, args as string[]);
      if (!f) throw new Unsupported("a call that can't run forward");
      if (!f.partial) return bind(sc, n.id, f.js);
      const r = fresh(sc, f.js);
      check(r);
      return bind(sc, n.id, r);
    }
    if (t.kind === "def") {
      if (!callee || specs) throw new Unsupported("a call in a mode not planned");
      const lam = nodes[t.body!] as NodeOf<"lambda">;
      const ins = order(callee), outs = portsOf(lam).filter((p) => !ins.includes(p));
      const port = (p: string) => (p === "out" ? n.id : n.args[Number(p)]);
      const vals = ins.map((p) => get(sc, port(p)));
      if (vals.some((x) => x === undefined)) throw new Unsupported("a mode's input not known");
      const r = fresh(sc, `${modeFn(head.target, ins, sc.emit)}(${vals.join(", ")})`);
      if (outs.length === 1) calls?.set(r, { def: head.target, ins, vals: vals as string[] });
      check(r);
      return outs.forEach((p, i) => bind(sc, port(p), outs.length === 1 ? r : `${r}[${i}]`));
    }
    if (t.kind === "variant" && res !== undefined) {
      sc.lines.push(`if (${res}.tag !== ${sc.emit.tag(head.target)}) ${sc.fail}`);
      return n.args.forEach((a, i) => bind(sc, a, `${res}.fields[${i}]`));
    }
    if (t.kind === "builtin" && res !== undefined) {
      const id = head.target, [a, b] = args;
      // Text joined: one side known, the other is what's left.
      if (id === S.concat && a !== undefined) {
        sc.lines.push(`if (!${res}.startsWith(${a})) ${sc.fail}`);
        return bind(sc, n.args[1], `${res}.slice(${a}.length)`);
      }
      if (id === S.concat && b !== undefined) {
        sc.lines.push(`if (!${res}.endsWith(${b})) ${sc.fail}`);
        return bind(sc, n.args[0], `${res}.slice(0, ${res}.length - ${b}.length)`);
      }
      // Whole numbers: any two sides give the third (relate.ts does the same).
      if (id === INT_OPS.add && a !== undefined) return bind(sc, n.args[1], `$int.sub(${res}, ${a})`);
      if (id === INT_OPS.add && b !== undefined) return bind(sc, n.args[0], `$int.sub(${res}, ${b})`);
      if (id === INT_OPS.sub && a !== undefined) return bind(sc, n.args[1], `$int.sub(${a}, ${res})`);
      if (id === INT_OPS.sub && b !== undefined) return bind(sc, n.args[0], `$int.add(${res}, ${b})`);
      if (id === INT_OPS.neg) return bind(sc, n.args[0], `$int.neg(${res})`);
      // Float64s the same way, one unknown at a time (Haar's join written as
      // lifting steps); a product or quotient only by a number written in
      // the program that isn't 0, so there is one answer.
      const literal = (js: string | undefined) => (js !== undefined && /^\(?-?\d+(\.\d+)?(e[-+]?\d+)?\)?$/.test(js) && Number(js.replace(/[()]/g, "")) !== 0);
      if (id === B.add && a !== undefined) return bind(sc, n.args[1], `(${res} - ${a})`);
      if (id === B.add && b !== undefined) return bind(sc, n.args[0], `(${res} - ${b})`);
      if (id === B.sub && a !== undefined) return bind(sc, n.args[1], `(${a} - ${res})`);
      if (id === B.sub && b !== undefined) return bind(sc, n.args[0], `(${res} + ${b})`);
      if (id === B.neg) return bind(sc, n.args[0], `(-${res})`);
      if (id === B.mul && literal(a)) return bind(sc, n.args[1], `(${res} / ${a})`);
      if (id === B.mul && literal(b)) return bind(sc, n.args[0], `(${res} / ${b})`);
      if (id === B.div && literal(b)) return bind(sc, n.args[0], `(${res} * ${b})`);
    }
    throw new Unsupported("a call with no backwards reading here");
  }

  // A choice of arms. The value known: its arm. Else each arm in turn, in
  // a block of its own that it leaves when it fails, until one gives the
  // answer (and returns it).
  function choose(c: NonNullable<Plan["branch"]>, env: Map<Id, string>, done: (env: Map<Id, string>, fail: string) => string, emit: ModeEmit, fail: string): string {
    const val = env.get(an.slot(c.value));
    if (val !== undefined) {
      const written = c.arms.filter((a) => a.variant !== null);
      const other = c.arms.find((a) => a.variant === null);
      const parts = written.map((a) => {
        const inner = new Map(env);
        const pre = a.binds.map((b, i) => {
          const k = an.slot(b), was = inner.get(k);
          if (was !== undefined) return `if (!$eq(${was}, ${val}.fields[${i}])) ${fail}`;
          const t = `m$${temps++}`;
          inner.set(k, t);
          return `const ${t} = ${val}.fields[${i}];`;
        });
        return `if (${val}.tag === ${emit.tag(a.variant!)}) {\n${[...pre, writePlan(a.plan, inner, done, emit, fail)].join("\n")}\n}`;
      });
      return [...parts, other ? `{\n${writePlan(other.plan, new Map(env), done, emit, fail)}\n}` : fail].join("\n");
    }
    if (c.arms.some((a) => a.variant === null)) throw new Unsupported("otherwise, for a value not known");
    // The arms' plans build the value themselves (a case goal).
    const ways = c.arms.filter((a) => !fails(a.plan));
    const tries = ways.map((a, i) => {
      const r = `arm$${temps++}`;
      if (i === ways.length - 1 && finals.has(fail)) finals.add(`break ${r};`);
      return `${r}: {\n${writePlan(a.plan, new Map(env), done, emit, `break ${r};`)}\n}`;
    });
    return [...tries, fail].join("\n");
  }

  // The function for a solve node, or null when it stays with relate.ts:
  // `solve(given…)` gives its one answer, or none, in the list of answers
  // the interpreter's solver gives. `into`: also `name$into(d$, given…)`,
  // which pushes the one bind, a list, onto `d$` (`intoSolvers`), when the
  // mode can write it.
  const intoSolvers = new Set<string>();
  function solver(n: NodeOf<"solve">, name: string, emit: ModeEmit, into = false): string | null {
    const v = an.ofSolve(n);
    if (!v || !v.ends || v.stuck.length || v.dynamic.length) return null;
    const d = determinism(v.answers);
    if (d !== "det" && d !== "semidet") return null;
    const def = nodes[n.fn];
    if (def.kind !== "def") return null;
    const lam = nodes[def.body!] as NodeOf<"lambda">;
    const portOf = (k: string) => (k === "out" ? "out" : String(lam.params.indexOf(k)));
    const given = Object.keys(n.given).map(portOf);
    if (given.includes("-1")) return null;
    const mark = out.length, size = made.size;
    try {
      const f = modeFn(n.fn, given, emit);
      const ins = order(given), outs = portsOf(lam).filter((p) => !ins.includes(p));
      const gs = Object.keys(n.given).map((_, i) => `g${i}`);
      const at = (p: string) => gs[given.indexOf(p)];
      const pick = Object.keys(n.binds).map((k) => (outs.length === 1 ? "r" : `r[${outs.indexOf(portOf(k))}]`));
      out.push(`// ${names[n.fn] ?? n.fn}, run backwards (${d}): its plan written out\nfunction ${name}(${gs.join(", ")}) {\nconst r = ${f}(${ins.map(at).join(", ")});\nreturn r === $no ? [] : [[${pick.join(", ")}]];\n}\n` +
        // At most one answer: its binds (one bind as itself), or $no
        // (GAPS.md P2).
        `function ${name}$one(${gs.join(", ")}) {\n${(pick.length === 1 && pick[0] === "r") || (outs.length > 1 && pick.length === outs.length && pick.every((p, i) => p === `r[${i}]`)) ? `return ${f}(${ins.map(at).join(", ")});` : `const r = ${f}(${ins.map(at).join(", ")});\nreturn r === $no ? $no : ${pick.length === 1 ? pick[0] : `[${pick.join(", ")}]`};`}\n}`);
      if (into && pick.length === 1 && pick[0] === "r") {
        const mark = out.length, size = made.size;
        try {
          const g = modeFn(n.fn, given, emit, true);
          out.push(`function ${name}$into(${["d$", ...gs].join(", ")}) {\nreturn ${g}(${["d$", ...ins.map(at)].join(", ")});\n}`);
          intoSolvers.add(name);
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          out.length = mark;
          for (const k of [...made.keys()].slice(size)) made.delete(k);
        }
      }
      return name;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      out.length = mark;
      for (const k of [...made.keys()].slice(size)) made.delete(k);
      return null;
    }
  }

  // Can this solve be written out? The same walk with an emit that writes
  // nothing, keeping nothing.
  function compilable(n: NodeOf<"solve">, dry: ModeEmit): boolean {
    const mark = out.length, size = made.size, t = temps;
    const ok = solver(n, "dry", dry) !== null;
    out.length = mark;
    for (const k of [...made.keys()].slice(size)) made.delete(k);
    temps = t;
    return ok;
  }

  return { solver, compilable, code: out, intoSolvers };
}
