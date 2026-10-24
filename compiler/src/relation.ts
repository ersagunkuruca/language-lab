// A relation used in one direction, compiled.
//
// The solver (invertible/src/relation.js) turns (relation, known ports) into
// a plan: isolate this variable (with these branches and guards), solve this
// linear block, check that equation. At run time it walks the plan. Here the
// plan is made once, at compile time, and written out as JavaScript: a block
// per branch, an `if` per guard or check, and the solutions collected in the
// same order and with the same rounding as the solver's. So `split(10, 4)`
// compiles to two subtractions and a halving.
//
// Plans with numeric search (tearing, Newton) or a periodic family (sin⁻¹
// plus 2πk) stay with the solver at run time, which streams them lazily;
// the compiled code makes their plan once when the program loads. A branch
// that hits a degenerate case (0·x = 0, where x is free) hands the whole
// call to the solver too, which knows how to report it.

import { plan } from "../../invertible/src/relation.js";

interface Expr { k: "num" | "var" | "call"; v?: number; name?: string; f?: string; args?: Expr[] }
interface Branch { expr: Expr; guards: Expr[]; free: Expr[][]; params: string[] }
type Step =
  | { type: "solve"; x: string; branches: Branch[] }
  | { type: "linear"; xs: string[]; exprs: Record<string, Expr> }
  | { type: "check"; eq: { lhs: Expr; rhs: Expr } }
  | { type: "tear" | "newton" };
interface Relation { name: string; ports: string[]; vars: string[] }

const INFIX: Record<string, string> = { add: "+", sub: "-", mul: "*", div: "/", pow: "**" };
const MATH = new Set(["sqrt", "abs", "exp", "log", "sin", "cos", "tan", "asin", "acos", "atan", "atan2"]);

// The code, and whether it also wrote `name$one`: the answer's binds, or
// $no, for a plan with one way to an answer and no case the solver must
// take over (GAPS.md P2).
export function compileSolve(name: string, rel: Relation, known: string[], binds: string[], title = rel.name, label = (port: string) => port): { code: string; once: boolean } {
  const p = (plan as (r: Relation, k: string[]) => { steps: Step[] })(rel, known);
  const vars = new Map(rel.vars.map((v, i) => [v, `v${i}`]));
  const id = (n: string) => vars.get(n) ?? (() => { throw new Error(`unknown variable ${n}`); })();
  const params = known.map(id);
  const runtime = `${name}$plan`;
  const fallback = `const ${runtime} = $planned(${JSON.stringify(rel)}, ${JSON.stringify(known)});`;
  const values = `{ ${known.map((k, i) => `${JSON.stringify(k)}: ${params[i]}`).join(", ")} }`;
  const viaSolver = `$solveRuntime(${runtime}, ${values}, ${JSON.stringify(binds)})`;
  const doc = `// ${title}: given ${known.map(label).join(", ")}, solve for ${binds.map(label).join(", ")}`;

  const simple = p.steps.every((s) => s.type === "check" || s.type === "linear" ||
    (s.type === "solve" && s.branches.every((b) => !b.params.length)));
  if (!simple) return { code: `${doc} (numeric or periodic: the solver runs it)\n${fallback}\nfunction ${name}(${params.join(", ")}) {\nreturn ${viaSolver};\n}`, once: false };

  const js = (e: Expr): string => {
    if (e.k === "num") return e.v! < 0 ? `(${e.v})` : String(e.v);
    if (e.k === "var") return id(e.name!);
    const a = e.args!.map(js);
    if (INFIX[e.f!]) return `(${a[0]} ${INFIX[e.f!]} ${a[1]})`;
    if (e.f === "neg") return `(-${a[0]})`;
    if (MATH.has(e.f!)) return `Math.${e.f}(${a.join(", ")})`;
    return `$FN.${e.f}.eval(${a.join(", ")})`;
  };

  // One way to an answer: nothing to tell apart, so no key and no set
  // (the pedal's tanh, run as atanh backwards, is 128 of these a block).
  const ways = p.steps.reduce((n, s) => n * (s.type === "solve" ? s.branches.length : 1), 1);
  // A degenerate case (every coefficient zero) hands over to the solver;
  // one with a nonzero number among its coefficients can't happen.
  const live = (g: Expr[]) => !g.some((e) => e.k === "num" && Math.abs(e.v!) > 1e-9);
  const once = ways === 1 && p.steps.every((s) => s.type !== "solve" || s.branches.every((b) => !b.free.some(live)));
  const answer = `[${binds.map((b) => `$clean(${id(b)})`).join(", ")}]`;
  const gen = (i: number, found = `out.push(${answer});`): string => {
    if (i === p.steps.length && ways === 1) return found;
    if (i === p.steps.length) {
      const all = rel.ports.map((port) => `$clean(${id(port)})`);
      const pick = binds.map((b) => `vals[${rel.ports.indexOf(b)}]`);
      return `const vals = [${all.join(", ")}], key = $key(vals);\nif (!seen.has(key)) { seen.add(key); out.push([${pick.join(", ")}]); }`;
    }
    const s = p.steps[i];
    if (s.type === "check") return `if ($close(${js(s.eq.lhs)}, ${js(s.eq.rhs)})) {\n${gen(i + 1, found)}\n}`;
    if (s.type === "linear") {
      const xs = s.xs.map((x) => `const ${id(x)} = ${js(s.exprs[x])};`).join(" ");
      return `{\n${xs}\nif (${s.xs.map((x) => `$ok(${id(x)})`).join(" && ")}) {\n${gen(i + 1, found)}\n}\n}`;
    }
    if (s.type !== "solve") throw new Error("unreachable");
    return s.branches.map((b) => {
      const free = b.free.filter(live).map((g) => g.map((e) => `Math.abs(${js(e)}) <= 1e-9`).join(" && "));
      const guards = b.guards.map((g) => ` && ${js(g)} >= -1e-9`).join("");
      return `{\n${free.length ? `if (${free.join(" || ")}) return null;\n` : ""}const ${id(s.x)} = ${js(b.expr)};\nif ($ok(${id(s.x)})${guards}) {\n${gen(i + 1, found)}\n}\n}`;
    }).join("\n");
  };

  const one = once ? `\nfunction ${name}$one(${params.join(", ")}) {\n${gen(0, `return ${answer};`)}\nreturn $no;\n}` : "";
  return { code: `${doc}\n${fallback}\nfunction ${name}$direct(${params.join(", ")}) {\nconst out = []${ways === 1 ? "" : ", seen = new Set()"};\n${gen(0)}\nreturn out;\n}\n` +
    `function ${name}(${params.join(", ")}) {\nreturn ${name}$direct(${params.join(", ")}) ?? ${viaSolver};\n}` + one, once };
}
