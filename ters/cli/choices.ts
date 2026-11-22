// The program's choices, kept beside it (L280a, CHOICES-2026-11-20.md):
// what the compiler picked for main, one entry per line sorted by the
// stable id it is about (a type, an implementation, a solve), each with
// the facts the pick read. `ters choices` writes `<program>.choices`;
// `ters check` says which entries are stale (the facts or the pick came
// out otherwise) and which are new. Representations, ways, mode plans
// placements and schedules for now, on JavaScript's target; the code never selects
// (REPRESENTATIONS.md), and the compiler picks every entry again.

import type { Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";
import { CARRIED, HEAD, looped, uses, type Representation } from "../src/lang/represent.ts";
import { storedRows, type Pick } from "../src/lang/library-reps.ts";
import type { Program } from "./represented.ts";
import { leftToWays, NEUTRAL, pickWays, waysIn, interfaceOps } from "../src/lang/ways.ts";
import { reachedImplementing } from "../src/lang/reached.ts";
import { dependencies, isUse, parentLookup, subtree, useTarget, type Code, type NodeOf } from "../src/model.ts";
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
  return [...new Set([...lines, ...wayLines(given, main, target), ...modeLines(given, main, target), ...searchLines(given, main, target)])].sort();
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

// The placement entries (the third kind): where each map, keep or fold a
// page's handler sends away may run (WHERE-IT-RUNS.md, scalar.ts
// awayMaps): on the page's workers once it is slow, and on the GPU where
// it has a kernel (gpu-maps.ts, `gpu`, by site) and the browser WebGPU.
// By the function's id, with the definition it is in.
// A command-line program's (no handler sends any away): each map, keep,
// fold or search it shares out on worker threads once it is slow
// (branches-rt.ts, scalar.ts sharedSites), where its code kept the site.
export interface Lowered { code: Code; funcs?: readonly { body: unknown }[]; awayMaps?: { site: number; fn: Id; how: string }[]; sharedSites?: { site: number; at: Id; how: string }[] }
const HOW: Record<string, string> = { map: "map", keep: "keep", add: "fold adding", max: "fold keeping the largest", min: "fold keeping the smallest", with: "fold of fields", first: "search for the first answer", count: "count of a search's answers", all: "search for all answers", any: "check of any item", every: "check of every item", "first where": "first item that passes" };
// The sites the lowered code shares out: a runtime call's (`map.pure`,
// `fold.pure`, `count.search`, …) number after the fuel it is given.
function sitesKept(funcs: readonly { body: unknown }[]): Set<number> {
  const kept = new Set<number>(), seen = new Set<object>();
  const walk = (e: unknown): void => {
    if (!e || typeof e !== "object" || seen.has(e)) return;
    seen.add(e);
    const x = e as { k?: string; fn?: unknown; args?: unknown[] };
    if (x.k === "rt" && typeof x.fn === "string" && /\.(pure|search)$/.test(x.fn) && Array.isArray(x.args)) {
      const at = x.args.findIndex((a) => (a as { k?: string; fn?: string })?.k === "rt" && (a as { fn?: string }).fn === "fuel.get");
      const site = x.args[at + 1] as { k?: string; v?: unknown } | undefined;
      if (at >= 0 && site?.k === "num" && typeof site.v === "number") kept.add(site.v);
    }
    for (const v of Array.isArray(e) ? e : Object.values(e)) walk(v);
  };
  for (const f of funcs) walk(f.body);
  return kept;
}
// A shared job's items are cut into this many runs, which the threads
// take (branches-rt.ts RUNS, L280e): a map's, a keep's, a fold's, a
// check's; a search is cut by its first two choices.
export const RUNS = 32;
const IN_RUNS = new Set(["map", "keep", "add", "max", "min", "with", "every", "any", "first where"]);
export function placeLines(ir: Lowered, gpu: ReadonlySet<number>, names: Names, target = "JavaScript page"): string[] {
  const all = { ...LIBRARY.names, ...names }, up = parentLookup(ir.code);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && ir.code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  // A definition by its name as written: main's copy stored otherwise
  // (library-reps.ts) is still main.
  const nameOf = (d: Id | undefined) => d ? (all[d] ?? d).replace(/ as stored$/, "") : "a definition";
  if (!ir.awayMaps?.length) {
    if (!ir.sharedSites?.length) return [];
    const kept = sitesKept(ir.funcs ?? []);
    return [...new Set(ir.sharedSites.filter((m) => kept.has(m.site)).map((m) => {
      return `${m.at} place: ${nameOf(defOf(m.at))}'s ${HOW[m.how] ?? m.how}: worker threads when slow; among main thread, worker threads${IN_RUNS.has(m.how) ? `; in ${RUNS} runs` : ""}; target JavaScript`;
    }))];
  }
  return ir.awayMaps.map((m) => {
    const d = defOf(m.fn), on = gpu.has(m.site);
    return `${m.fn} place: ${nameOf(d)}'s ${HOW[m.how] ?? m.how}: workers when slow${on ? ", the GPU where the browser has WebGPU" : ""}; among main thread, workers${on ? ", GPU" : ""}; in ${RUNS} runs; target ${target}`;
  });
}

// C's (`ters native`): each call its threads run (c.ts `par:`, scalar.ts
// threadSites), by the node it is about, where the lowered code still
// has a call of that runtime function (the passes after rebuild them).
const THREADS: Record<string, string> = { ...HOW, together: "together", both: "two calls of one function", counted: "fold counting into a map" };
export function threadLines(ir: Lowered & { threadSites?: { e: unknown; at: Id; how: string }[] }, names: Names): string[] {
  if (!ir.threadSites?.length) return [];
  const all = { ...LIBRARY.names, ...names }, up = parentLookup(ir.code), seen = new Set<unknown>(), kept = new Set<string>();
  const walk = (e: unknown): void => {
    if (!e || typeof e !== "object" || seen.has(e)) return;
    seen.add(e);
    const x = e as { k?: string; fn?: unknown };
    if (x.k === "rt" && typeof x.fn === "string" && x.fn.startsWith("par:")) kept.add(x.fn);
    for (const v of Array.isArray(e) ? e : Object.values(e)) walk(v);
  };
  for (const f of ir.funcs ?? []) walk(f.body);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && ir.code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  const nameOf = (d: Id | undefined) => d ? (all[d] ?? d).replace(/ as stored$/, "") : "a definition";
  return [...new Set(ir.threadSites.filter((t) => kept.has((t.e as { fn?: string }).fn ?? "")).map((t) => `${t.at} place: ${nameOf(defOf(t.at))}'s ${THREADS[t.how] ?? t.how}: threads when slow; among main thread, threads; target C`))];
}

// The schedule entries (the fourth kind, the order and grouping of
// work): each walk main reaches taken where its list is made, as the
// rounds took them (fuse-walks.ts), by the call's id. The items are met
// in the same order, one loop for both.
// Named by the program's own definitions (E309): a call in a definition
// a round made is the one the program wrote in the definition it was
// made from, and a walker a round made the walker it was copied from.
export function scheduleLines(p: { code: Code; names: Names; fused?: readonly { at: Id; walker: Id; over: string; made?: Id }[] }, main: Id, target = "JavaScript"): string[] {
  if (!p.fused?.length) return [];
  const all = { ...LIBRARY.names, ...p.names }, up = parentLookup(p.code), reached = new Set([main, ...dependencies(p.code, main)]);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && p.code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  const nameOf = (d: Id | undefined) => d ? (all[d] ?? d).replace(/ as stored$/, "") : "a definition";
  const inDef = new Map<Id, Id>(), walkerOf = new Map<Id, Id>();
  return [...new Set(p.fused.flatMap((f) => {
    const d = defOf(f.at), at = d && (inDef.get(d) ?? d), walker = walkerOf.get(f.walker) ?? f.walker;
    if (f.made && at) { inDef.set(f.made, at); walkerOf.set(f.made, walker); }
    return d && at && reached.has(d) ? [`${f.at} schedule: ${nameOf(at)}'s ${nameOf(walker)} walk, its list made by ${f.over}: one loop; among made then walked, one loop; target ${target}`] : [];
  }))];
}

// And each search main reaches (all, first, count, optional of one): its
// answers come in the fair order that interleaves its choices, the one
// order there is for now (decided 2026-11-12; compiled code keeps it).
const SEARCHES: [Id, string][] = [[S.all, "all"], [S.first, "first"], [S.count, "count"], [S.optional, "optional"]];
export function searchLines(given: Program, main: Id, target = "JavaScript"): string[] {
  const names = { ...LIBRARY.names, ...given.names }, own = new Set(given.own), kinds = new Map(SEARCHES);
  const lines: string[] = [];
  for (const d of [main, ...dependencies(given.code, main)]) {
    if (!own.has(d) || given.code.nodes[d]?.kind !== "def") continue;
    for (const id of subtree(given.code, d)) {
      const n = given.code.nodes[id];
      if (n?.kind !== "call") continue;
      const f = given.code.nodes[n.fn], kind = f?.kind === "ref" ? kinds.get(f.target) : undefined;
      if (kind) lines.push(`${id} schedule: ${names[d] ?? d}'s ${kind} of a search: answers in the fair order, its choices interleaved; among fair order; target ${target}`);
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
// A placement: its node, where it runs, what it is among, how many runs
// its items are shared out in (L280e), its target.
const PLACE = /^(\S+) place: .*: ([^:;]+); among ([^;]+)(?:; in (\d+) runs)?; target (.+)$/;
// The placements held on the main thread (L280h), by the node each is
// about, for JavaScript (a page's or a command-line program's workers)
// and for C's threads; and a command-line program's held on its worker
// threads (`workers`), or C's on its threads (`threads`), shared out from
// its first items; and a page's on its workers or its GPU (`page`).
// And the runs held (L280e): JavaScript's, a command-line program's or a
// page's, by the node.
export interface HeldPlaces { js: Id[]; c: Id[]; workers: Id[]; threads: Id[]; page: [Id, "workers" | "GPU"][]; runs: [Id, number][] }
export function heldPlaces(lines: readonly string[]): HeldPlaces {
  const out: HeldPlaces = { js: [], c: [], workers: [], threads: [], page: [], runs: [] };
  for (const l of lines) {
    const p = l.startsWith(HELD) ? PLACE.exec(l.slice(HELD.length)) : null;
    if (!p) continue;
    const [, id, on, , runs, target] = p;
    if (on === "main thread") (target === "C" ? out.c : out.js).push(id);
    if (on === "worker threads" && target === "JavaScript") out.workers.push(id);
    if (on === "threads" && target === "C") out.threads.push(id);
    if ((on === "workers" || on === "GPU") && target === "JavaScript page") out.page.push([id, on]);
    if (runs && target !== "C") out.runs.push([id, Number(runs)]);
  }
  return out;
}
// What a placement can be held on: what its entry is among (the main
// thread, a command-line program's worker threads, C's threads, a page's
// workers, and its GPU where the site has a kernel), or where the
// compiler runs it (`worker threads when slow`), its runs held alone.
const HOLDABLE = (among: string, on: string) => among.split(", ").some((a) => on === a || on === `${a} when slow` || on.startsWith(`${a} when slow, `));
const ENTRY = /^(\S+) representation: .*? as ([^;]+?); among /;
// The held entries' rows, by the type's id: a split's with the
// definitions it is from (`array of List from a, b`).
export function heldOf(lines: readonly string[]): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const l of lines) {
    if (!l.startsWith(HELD)) continue;
    const m = ENTRY.exec(l.slice(HELD.length));
    // A placement held (L280h): heldPlaces's.
    const place = PLACE.exec(l.slice(HELD.length));
    if (!m && place) {
      if (!HOLDABLE(place[3], place[2])) throw new Error(`a placement is held on one of what it is among: ${l}`);
      if (place[4] !== undefined && !(Number(place[4]) >= 1 && Number(place[4]) <= 4096)) throw new Error(`a placement's runs are from 1 to 4096: ${l}`);
      continue;
    }
    if (!m && /^\S+ (way|mode plan|schedule): /.test(l.slice(HELD.length))) throw new Error(`only a type's representation or a placement can be held yet: ${l}`);
    if (!m) throw new Error(`a held choice isn't read: ${l}`);
    out.set(m[1], m[2]);
  }
  return out;
}
// The entries written again: the held ones as they were, the rest as
// picked now (with the held ones held).
export function heldAndPicked(written: readonly string[], now: readonly string[]): string[] {
  const held = written.filter((l) => l.startsWith(HELD)), isHeld = heldIn(held);
  return [...held, ...now.filter((l) => !isHeld(l))].sort((a, b) => key(a).localeCompare(key(b)));
}
// Whether an entry made now is one a held entry stands for: a type's,
// by the type, or a placement's, by its node and target.
function heldIn(written: readonly string[]): (l: string) => boolean {
  const of = new Set(heldOf(written).keys());
  const places = new Set(written.flatMap((l) => { const p = l.startsWith(HELD) ? PLACE.exec(l.slice(HELD.length)) : null; return p ? [`${p[1]} ${p[5]}`] : []; }));
  return (l) => { const p = PLACE.exec(l); return of.has(ENTRY.exec(l)?.[1] ?? "") || (!!p && places.has(`${p[1]} ${p[5]}`)); };
}
const key = (l: string) => (l.startsWith(HELD) ? l.slice(HELD.length) : l);
// What a check says of the held entries: where the compiler, choosing
// alone, picks another row (`alone`, the entries made with nothing held).
export function heldWarnings(written: readonly string[], alone: readonly string[]): string[] {
  const picks = new Map(alone.flatMap((l) => { const m = ENTRY.exec(l); return m ? [[m[1], m[2]] as const] : []; }));
  const placed = new Map(alone.flatMap((l) => { const p = PLACE.exec(l); return p ? [[`${p[1]} ${p[5]}`, p] as const] : []; }));
  const places = written.flatMap((l) => {
    const p = l.startsWith(HELD) ? PLACE.exec(l.slice(HELD.length)) : null, was = p && placed.get(`${p[1]} ${p[5]}`);
    if (!p || !was) return [];
    return [...(was[2] !== p[2] ? [`held   ${p[1]} (${p[5]}): ${p[2]}, where the compiler would run it on ${was[2]}`] : []), ...(p[4] && was[4] && p[4] !== was[4] ? [`held   ${p[1]} (${p[5]}): in ${p[4]} runs, where the compiler would share it in ${was[4]}`] : [])];
  });
  return [...[...heldOf(written)].filter(([of, rep]) => picks.has(of) && picks.get(of) !== rep).map(([of, rep]) => `held   ${of}: ${rep}, where the compiler would pick ${picks.get(of)}`), ...places];
}

// The entries of a choices file, its comments left out.
export const readChoices = (text: string): string[] => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

// What a check says of a choices file against the picks made now.
export function staleChoices(written: readonly string[], now: readonly string[]): string[] {
  const isHeld = heldIn(written);
  written = written.filter((l) => !l.startsWith(HELD));
  now = now.filter((l) => !isHeld(l));
  const was = new Set(written), is = new Set(now);
  return [...written.filter((l) => !is.has(l)).map((l) => `stale  ${l}`), ...now.filter((l) => !was.has(l)).map((l) => `new    ${l}`)];
}
