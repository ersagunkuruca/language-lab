// The program's choices, kept beside it (L280a, CHOICES-2026-11-20.md):
// what the compiler picked for main, one entry per line sorted by the
// stable id it is about (a type, an implementation, a solve), each with
// the facts the pick read. `ters choices` writes `<program>.choices`;
// `ters check` says which entries are stale (the facts or the pick came
// out otherwise) and which are new. Representations, ways and mode plans
// for now, on JavaScript's target; the code never selects
// (REPRESENTATIONS.md), and the compiler picks every entry again.

import type { Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CARRIED, HEAD, looped, uses, type Representation } from "../src/lang/represent.ts";
import { storedRows, type Pick } from "../src/lang/library-reps.ts";
import type { Program } from "./represented.ts";
import { leftToWays, NEUTRAL, pickWays, waysIn, interfaceOps } from "../src/lang/ways.ts";
import { reachedImplementing } from "../src/lang/reached.ts";
import { dependencies, isUse, subtree, useTarget, type NodeOf } from "../src/model.ts";
import { planSolve } from "../src/lang/solve.ts";
import { determinism, solveMode } from "../src/lang/modes.ts";
import { answerKeys } from "../src/lang/ports.ts";

export const choicesPath = (program: string) => `${program.replace(/[/\\]+$/, "")}.choices`;

// A job as a person reads it: the definition or case it names, `carried`
// or `head of` before it where the row costs that apart, a case's field
// by the case's name (represent.ts ontoField).
function jobText(j: string, names: Names): string {
  for (const [pre, as] of [[CARRIED, "carried "], [HEAD, "head of "]] as const) if (j.startsWith(pre)) return as + jobText(j.slice(pre.length), names);
  const onto = /^(.*) onto its field (\d+)$/.exec(j);
  if (onto) return `${jobText(onto[1], names)} onto its field ${onto[2]}`;
  return names[j] ?? LIBRARY.names[j] ?? j;
}

// The entries of `represented`'s picks for `main` of the program as
// written (`given`, before the rewrite): each pick with the jobs main
// uses on the type, those in a loop marked, which is what the chooser
// weighed (represent.ts choose), and the rows it chose among.
export function choiceLines(given: Program, main: Id, picks: readonly Pick[], target = "JavaScript"): string[] {
  const names = { ...LIBRARY.names, ...given.names };
  // The rows the chooser picked among: the program's and the library's
  // whole-type rows its definitions name (storedRows), or the library's
  // by type (library-reps.ts).
  const stored = storedRows(given.code, given.own, given.reps);
  const rowsOf = (of: Id): Representation[] => {
    const own = stored.filter((r) => r.of === of);
    return own.length ? own : LIBRARY.reps.filter((r) => r.of === of);
  };
  const lines = picks.map((p) => {
    const rows = rowsOf(p.of);
    const spec = rows.find((r) => r.canonical) ?? rows[0];
    const ordered = spec ? [spec, ...rows.filter((r) => r !== spec)] : rows;
    const jobs = ordered.length ? uses(given.code, main, ordered) : [];
    const inLoop = ordered.length ? looped(given.code, main, ordered) : new Set<string>();
    const jobList = jobs.map((j) => jobText(j, names) + (inLoop.has(j) ? " (in a loop)" : "")).sort();
    const from = p.from?.length ? ` from ${p.from.map((d) => names[d] ?? d).join(", ")}` : "";
    return `${p.of} representation: ${names[p.of] ?? p.of} as ${p.rep}${from}; among ${rows.map((r) => r.name).join(", ")}; jobs ${jobList.join(", ") || "none"}; target ${target}`;
  });
  return [...new Set([...lines, ...wayLines(given, main, target), ...modeLines(given, main, target)])].sort();
}

// The algorithm entries (CHOICES-2026-11-20.md's second kind): for each
// implementation main reaches whose fields have ways (WAYS.md), the way
// each field is given by, as the arithmetic's resolving picks it
// (ways.ts pickWays, target-neutral as JavaScript's is), among the field
// as written and its ways.
export function wayLines(given: Program, main: Id, target = "JavaScript"): string[] {
  const names = { ...LIBRARY.names, ...given.names };
  const code = reachedImplementing(given.code, [main], given.info);
  const ways = waysIn(code, interfaceOps(code));
  if (!ways.size) return [];
  const impls = new Set(given.info.implementations?.values() ?? []);
  // Only the operations main uses: its own definitions and what they
  // call, and what an operation it uses is given by (an implementation's
  // field as written, its ways), on until nothing new is asked. An
  // implementation is reached by its type, all its fields with it.
  const asked = new Set<Id>(), seen = new Set<Id>();
  const reach = (d: Id) => {
    for (const x of [d, ...dependencies(code, d)]) {
      if (seen.has(x) || code.nodes[x]?.kind !== "def") continue;
      seen.add(x);
      if (impls.has(x)) continue;
      for (const y of subtree(code, x)) {
        const n = code.nodes[y], op = n?.kind === "ref" ? n.target : n && isUse(n) ? useTarget(code.nodes, n) : undefined;
        if (op === undefined || !ways.has(op) || asked.has(op)) continue;
        asked.add(op);
        for (const w of ways.get(op)!) reach(w.def);
        for (const impl of impls) {
          const b = code.nodes[(code.nodes[impl] as NodeOf<"def"> | undefined)?.body ?? ""], f = b?.kind === "call" ? code.nodes[b.fn] : undefined, v = f?.kind === "ref" ? code.nodes[f.target] : undefined;
          const at = v?.kind === "variant" ? v.fields.indexOf(op) : -1;
          if (at >= 0 && b?.kind === "call" && b.args) for (const z of subtree(code, b.args[at])) { const m = code.nodes[z]; if (m?.kind === "ref" && code.nodes[m.target]?.kind === "def") reach(m.target); }
        }
      }
    }
  };
  reach(main);
  const lines: string[] = [];
  for (const impl of code.defs) {
    if (!impls.has(impl)) continue;
    const body = code.nodes[(code.nodes[impl] as NodeOf<"def">).body ?? ""];
    if (body?.kind !== "call" || !body.args) continue;
    const fn = code.nodes[body.fn], variant = fn?.kind === "ref" ? code.nodes[fn.target] : undefined;
    if (variant?.kind !== "variant") continue;
    const fields = variant.fields.filter((f) => ways.has(f) && asked.has(f));
    if (!fields.length) continue;
    const pick = pickWays(code, ways, variant, body.args, NEUTRAL);
    for (const f of fields) {
      const way = pick.get(f), written = !leftToWays(code, body.args[variant.fields.indexOf(f)]);
      const among = [...(written ? ["as written"] : []), ...ways.get(f)!.map((w) => names[w.def] ?? w.def)];
      lines.push(`${impl} way: ${names[impl] ?? impl}'s ${names[f] ?? f}: ${way ? names[way] ?? way : way === null ? "as written" : "none"}; among ${among.join(", ")}; target ${target}`);
    }
  }
  return lines;
}

// The mode plans (the algorithm kind's other entry, MODES.md): for each
// solve main reaches, by the solve's stable id, what is known and what is
// asked (the facts), and how it is run: by the equation solver, or
// relationally with its goals in the order the plan runs them (the first
// branch's, modes.ts), how many answers that gives and whether it ends.
export function modeLines(given: Program, main: Id, target = "JavaScript"): string[] {
  const names = { ...LIBRARY.names, ...given.names }, code = given.code;
  const port = (k: string) => (k === "out" ? "answer" : names[k] ?? (/^\d+$/.test(k) ? `input ${+k + 1}` : k));
  const lines: string[] = [];
  for (const d of [main, ...dependencies(code, main)]) {
    if (code.nodes[d]?.kind !== "def") continue;
    for (const id of subtree(code, d)) {
      const n = code.nodes[id];
      if (!isUse(n)) continue;
      let plan: ReturnType<typeof planSolve>;
      try { plan = planSolve(code, n); } catch { continue; }
      const of = useTarget(code.nodes, n), known = Object.keys(n.given).map(port).join(", "), asked = answerKeys(code, n).map(port).join(", ");
      const facts = `${names[d] ?? d}'s solve of ${names[of] ?? of} for ${asked || "nothing"} from ${known || "nothing"}`;
      if (plan.mode === "solver") {
        lines.push(`${id} mode plan: ${facts}: equations; ${plan.status === "solved" ? (plan.unique ? "exactly one answer" : plan.many ? "any number of answers" : "at most one answer") : `${plan.needMore} more needed`}; target ${target}`);
        continue;
      }
      const v = solveMode(code, n, given.names);
      if (!v) continue;
      const many = { det: "exactly one answer", semidet: "at most one answer", multi: "at least one answer", nondet: "any number of answers" }[determinism(v.answers)];
      const how = v.stuck.length ? `stuck at ${v.stuck[0]}` : `${many}, ${v.ends ? "ends" : "may not end"}`;
      lines.push(`${id} mode plan: ${facts}: relational, goals ${v.order.filter((g) => g).join(", ") || "none"}; ${how}; target ${target}`);
    }
  }
  return lines;
}

export function choicesText(main: string, lines: readonly string[]): string {
  return [`# The compiler's choices for ${main} (L280a): picked again whenever their facts change.`, ...lines].join("\n") + "\n";
}

// A held entry (L280c, rule 3): a person wrote `held` before it, and the
// compiler stores the type as it says, where that keeps the meaning (the
// chooser could pick that row), and says when it would pick another.
export const HELD = "held ";
const ENTRY = /^(\S+) representation: .*? as ([^;]+?)(?: from [^;]*)?; among /;
// The held entries' rows, by the type's id.
export function heldOf(lines: readonly string[]): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const l of lines) {
    if (!l.startsWith(HELD)) continue;
    const m = ENTRY.exec(l.slice(HELD.length));
    if (!m && /^\S+ (way|mode plan): /.test(l.slice(HELD.length))) throw new Error(`only a type's representation can be held yet: ${l}`);
    if (!m) throw new Error(`a held choice isn't read: ${l}`);
    if (/ from [^;]*; among /.test(l)) throw new Error(`a list's split can't be held yet: ${l}`);
    out.set(m[1], m[2]);
  }
  return out;
}
// The entries written again: the held ones as they were, the rest as
// picked now (with the held ones held).
export function heldAndPicked(written: readonly string[], now: readonly string[]): string[] {
  const held = written.filter((l) => l.startsWith(HELD)), of = new Set(heldOf(held).keys());
  return [...held, ...now.filter((l) => !of.has(ENTRY.exec(l)?.[1] ?? ""))].sort((a, b) => key(a).localeCompare(key(b)));
}
const key = (l: string) => (l.startsWith(HELD) ? l.slice(HELD.length) : l);
// What a check says of the held entries: where the compiler, choosing
// alone, picks another row (`alone`, the entries made with nothing held).
export function heldWarnings(written: readonly string[], alone: readonly string[]): string[] {
  const picks = new Map(alone.flatMap((l) => { const m = ENTRY.exec(l); return m ? [[m[1], m[2]] as const] : []; }));
  return [...heldOf(written)].filter(([of, rep]) => picks.has(of) && picks.get(of) !== rep).map(([of, rep]) => `held   ${of}: ${rep}, where the compiler would pick ${picks.get(of)}`);
}

// The entries of a choices file, its comments left out.
export const readChoices = (text: string): string[] => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

// What a check says of a choices file against the picks made now.
export function staleChoices(written: readonly string[], now: readonly string[]): string[] {
  const of = new Set(heldOf(written).keys());
  written = written.filter((l) => !l.startsWith(HELD));
  now = now.filter((l) => !of.has(ENTRY.exec(l)?.[1] ?? ""));
  const was = new Set(written), is = new Set(now);
  return [...written.filter((l) => !is.has(l)).map((l) => `stale  ${l}`), ...now.filter((l) => !was.has(l)).map((l) => `new    ${l}`)];
}
