// The program's choices, kept beside it (L280a, CHOICES-2026-11-20.md):
// what the compiler picked for main, one entry per line sorted by the
// stable id it is about (a type, an implementation, a solve), each with
// the facts the pick read. `ters decisions` writes `<program>.decisions`;
// `ters check` says which entries are stale (the facts or the pick came
// out otherwise) and which are new. Representations, ways, mode plans
// placements and schedules for now, on JavaScript's target; the code never selects
// (REPRESENTATIONS.md), and the compiler picks every entry again.

import type { Id } from "../src/model.ts";
import type { Measure } from "../src/lang/run.ts";
import type { Names } from "../src/presentation.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";
import { CARRIED, FOLD_OF_ITEMS, HEAD, looped, matchJob, uses, type Measured, type Representation } from "../src/lang/represent.ts";
import { storedRows, type Pick } from "../src/lang/library-reps.ts";
import { COMPANIONS } from "../src/lang/together.ts";
import type { Program } from "./represented.ts";
import { leftToWays, NEUTRAL, pickWays, waysIn, interfaceOps } from "../src/lang/ways.ts";
import { reachedImplementing } from "../src/lang/reached.ts";
import { dependencies, isUse, parentLookup, subtree, useTarget, type Code, type NodeOf } from "../src/model.ts";
import { planSolve } from "../src/lang/solve.ts";
import { determinism, solveMode } from "../src/lang/modes.ts";
import { answerKeys } from "../src/lang/ports.ts";
import { writtenAt } from "../src/lang/prelude-ids.ts";

// The program's decisions beside it, `<program>.decisions`, named
// `<program>.choices` until 2026-11-23 (the Choice effect has the name),
// which `ters` still reads when that is all there is.
export const choicesPath = (program: string) => `${program.replace(/[/\\]+$/, "")}.decisions`;
export const oldChoicesPath = (program: string) => `${program.replace(/[/\\]+$/, "")}.choices`;

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
  // A type stored with another (a pool's key, together.ts) has no entry
  // of its own: it goes the way its pool's entry says.
  const lines = picks.filter((p) => !COMPANIONS.has(p.of)).map((p) => {
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
// it has a kernel (gpu-maps.ts, `gpu`, by site) and the browser WebGPU;
// one whose kernel's arithmetic is only close to the CPU's (`close`, G12)
// may be held on the GPU so (`GPU close`), never put there by the compiler.
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
// C's, how many runs a thread (c.ts, the map's `per`).
export const C_RUNS = 8;
// And a C fold counting into a map, the items in each chunk a thread
// counts from empty (c.ts chunksC's chunk).
export const C_CHUNK = 16384;
// And how many workers or threads a program starts beside its main one:
// the cores less one, at most so many (branches-rt.ts sizeOf and webSize,
// c.ts lab_pool_ready), one entry for the program where any of its work
// may be shared; held to a count from 0 to 64.
export const POOL = { JavaScript: 3, "JavaScript page": 7, C: 15 } as const;
const POOL_OF = { JavaScript: "worker threads", "JavaScript page": "workers", C: "threads" } as const;
const poolLine = (main: Id, name: string, target: keyof typeof POOL) => `${main} place: ${name}'s ${POOL_OF[target]}: cores less one, at most ${POOL[target]}; among 0 to 64; target ${target}`;
const POOLED = /^(\S+) place: .*'s (?:worker threads|workers|threads): (cores less one, at most \d+|\d+); among 0 to 64; target (JavaScript|JavaScript page|C)$/;
// A placement on the GPU whose answers may differ from the CPU's in the
// last bits (G12): a person's to hold, the compiler's never.
export const CLOSE = "GPU close";
const IN_RUNS = new Set(["map", "keep", "add", "max", "min", "with", "every", "any", "first where"]);
// With `main`, the program's workers' entry too.
export function placeLines(ir: Lowered, gpu: ReadonlySet<number>, names: Names, target: "JavaScript page" | "JavaScript" = "JavaScript page", main?: Id, close: ReadonlySet<number> = new Set()): string[] {
  const lines = sitesPlaced(ir, gpu, names, target, close);
  return main !== undefined && lines.length ? [...lines, poolLine(main, ({ ...LIBRARY.names, ...names })[main] ?? main, ir.awayMaps?.length ? target : "JavaScript")] : lines;
}
function sitesPlaced(ir: Lowered, gpu: ReadonlySet<number>, names: Names, target: string, close: ReadonlySet<number>): string[] {
  const all = { ...LIBRARY.names, ...names }, up = parentLookup(ir.code);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && ir.code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  // A definition by its name as written: main's copy stored otherwise
  // (library-reps.ts) is still main.
  const nameOf = (d: Id | undefined) => d ? (all[d] ?? d).replace(/ as stored$/, "") : "a definition";
  if (!ir.awayMaps?.length) {
    if (!ir.sharedSites?.length) return [];
    const kept = sitesKept(ir.funcs ?? []);
    return [...new Set(ir.sharedSites.filter((m) => kept.has(m.site)).map((m) => {
      return `${writtenAt(m.at)} place: ${nameOf(defOf(m.at))}'s ${HOW[m.how] ?? m.how}: worker threads when slow; among main thread, worker threads${IN_RUNS.has(m.how) ? `; in ${RUNS} runs` : ""}; target JavaScript`;
    }))];
  }
  return ir.awayMaps.map((m) => {
    const d = defOf(m.fn), on = gpu.has(m.site), near = !on && close.has(m.site);
    return `${writtenAt(m.fn)} place: ${nameOf(d)}'s ${HOW[m.how] ?? m.how}: workers when slow${on ? ", the GPU where the browser has WebGPU" : ""}; among main thread, workers${on ? ", GPU" : near ? `, ${CLOSE}` : ""}; in ${RUNS} runs; target ${target}`;
  });
}

// Each call of neighbours main reaches (L280g, NEARBY-2026-11-22.md), as
// compiled JavaScript finds them: on a grid of cells reach on a side,
// among every pair, or by a k-d tree, as held (`grid of 5 cells`, L280e's
// parameter).
const NEAR = /^(\S+) way: .*'s neighbours: (every pair|grid of (reach|[^ ;]+) cells|k-d tree); among every pair, grid, k-d tree; target (.+)$/;
export function nearLines(ir: Lowered & { nearSites?: { at: Id; by: "grid" | "k-d tree" }[] }, names: Names): string[] {
  if (!ir.nearSites?.length) return [];
  const all = { ...LIBRARY.names, ...names }, up = parentLookup(ir.code);
  const defOf = (id: Id) => { let at: Id | undefined = id; for (let i = 0; at !== undefined && ir.code.nodes[at]?.kind !== "def" && i < 10000; i++) at = up(at); return at; };
  const nameOf = (d: Id | undefined) => d ? (all[d] ?? d).replace(/ as stored$/, "") : "a definition";
  return [...new Set(ir.nearSites.map(({ at, by }) => `${at} way: ${nameOf(defOf(at))}'s neighbours: ${by === "grid" ? "grid of reach cells" : by}; among every pair, grid, k-d tree; target JavaScript`))];
}
// The ways held, by the call: every pair, or a grid of cells this wide.
const nearHeld = (l: string): [Id, "every pair" | "k-d tree" | number] | null => {
  const m = l.startsWith(HELD) ? NEAR.exec(l.slice(HELD.length)) : null;
  return m && m[3] !== "reach" ? [m[1], m[2] === "every pair" || m[2] === "k-d tree" ? m[2] : Number(m[3])] : null;
};

// C's (`ters native`): each call its threads run (c.ts `par:`, scalar.ts
// threadSites), by the node it is about, where the lowered code still
// has a call of that runtime function (the passes after rebuild them).
const THREADS: Record<string, string> = { ...HOW, together: "together", both: "two calls of one function", counted: "fold counting into a map" };
export function threadLines(ir: Lowered & { threadSites?: { e: unknown; at: Id; how: string }[] }, names: Names, main?: Id): string[] {
  const lines = threadsPlaced(ir, names);
  return main !== undefined && lines.length ? [...lines, poolLine(main, ({ ...LIBRARY.names, ...names })[main] ?? main, "C")] : lines;
}
function threadsPlaced(ir: Lowered & { threadSites?: { e: unknown; at: Id; how: string }[] }, names: Names): string[] {
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
  return [...new Set(ir.threadSites.filter((t) => kept.has((t.e as { fn?: string }).fn ?? "")).map((t) => `${writtenAt(t.at)} place: ${nameOf(defOf(t.at))}'s ${THREADS[t.how] ?? t.how}: threads when slow; among main thread, threads${IN_RUNS.has(t.how) ? `; in ${C_RUNS} runs a thread` : t.how === "counted" ? `; in chunks of ${C_CHUNK} items` : ""}; target C`))];
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
  return [`# The compiler's decisions for ${main} (L280a): picked again whenever their facts change.`, ...lines].join("\n") + "\n";
}

// A held entry (L280c, rule 3): a person wrote `held` before it, and the
// compiler stores the type as it says, where that keeps the meaning (the
// chooser could pick that row), and says when it would pick another.
export const HELD = "held ";
// A placement: its node, where it runs, what it is among, how many runs
// its items are shared out in (L280e), its target.
// C's runs are a thread's; a C fold counting into a map is cut in chunks
// of so many items instead.
const PLACE = /^(\S+) place: .*: ([^:;]+); among ([^;]+)(?:; in (?:chunks of )?(\d+) (?:runs(?: a thread)?|items))?; target (.+)$/;
const CHUNKED = "; in chunks of ";
// The placements held on the main thread (L280h), by the node each is
// about, for JavaScript (a page's or a command-line program's workers)
// and for C's threads; and a command-line program's held on its worker
// threads (`workers`), or C's on its threads (`threads`), shared out from
// its first items; and a page's on its workers or its GPU (`page`).
// And the runs held (L280e): JavaScript's, a command-line program's or a
// page's, by the node; C's runs a thread, or its chunks' items.
// And the workers or threads a program starts, by the target (`pool`).
// And how each call of neighbours is held to find them (`near`, L280g).
// And the maps held on the GPU though their arithmetic is only close
// (`close`, G12), each among the page's too, on the GPU.
export interface HeldPlaces { js: Id[]; c: Id[]; workers: Id[]; threads: Id[]; page: [Id, "workers" | "GPU"][]; runs: [Id, number][]; cRuns: [Id, number][]; pool: [string, number][]; near: [Id, "every pair" | "k-d tree" | number][]; close: Id[] }
export const NONE_HELD: HeldPlaces = { js: [], c: [], workers: [], threads: [], page: [], runs: [], cRuns: [], pool: [], near: [], close: [] };
export function heldPlaces(lines: readonly string[]): HeldPlaces {
  const out: HeldPlaces = { js: [], c: [], workers: [], threads: [], page: [], runs: [], cRuns: [], pool: [], near: [], close: [] };
  for (const l of lines) {
    const near = nearHeld(l);
    if (near) { out.near.push(near); continue; }
    const pooled = l.startsWith(HELD) ? POOLED.exec(l.slice(HELD.length)) : null;
    if (pooled) { if (/^\d+$/.test(pooled[2])) out.pool.push([pooled[3], Number(pooled[2])]); continue; }
    const p = l.startsWith(HELD) ? PLACE.exec(l.slice(HELD.length)) : null;
    if (!p) continue;
    const [, id, on, , runs, target] = p;
    if (on === "main thread") (target === "C" ? out.c : out.js).push(id);
    if (on === "worker threads" && target === "JavaScript") out.workers.push(id);
    if (on === "threads" && target === "C") out.threads.push(id);
    if ((on === "workers" || on === "GPU") && target === "JavaScript page") out.page.push([id, on]);
    if (on === CLOSE && target === "JavaScript page") { out.page.push([id, "GPU"]); out.close.push(id); }
    if (runs) (target === "C" ? out.cRuns : out.runs).push([id, Number(runs)]);
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
    const pooled = POOLED.exec(l.slice(HELD.length));
    if (pooled) {
      if (/^\d+$/.test(pooled[2]) && Number(pooled[2]) > 64) throw new Error(`a program starts from 0 to 64 workers: ${l}`);
      continue;
    }
    if (!m && / place: .*'s (?:worker threads|workers|threads): [^;]*; among 0 to 64; /.test(l)) throw new Error(`a program starts from 0 to 64 workers: ${l}`);
    const place = PLACE.exec(l.slice(HELD.length));
    if (!m && place) {
      if (!HOLDABLE(place[3], place[2])) throw new Error(`a placement is held on one of what it is among: ${l}`);
      if (l.includes(CHUNKED)) { if (!(Number(place[4]) >= 1 && Number(place[4]) <= 1 << 24)) throw new Error(`a placement's chunks are from 1 to 16777216 items: ${l}`); }
      else if (place[4] !== undefined && !(Number(place[4]) >= 1 && Number(place[4]) <= 4096)) throw new Error(`a placement's runs are from 1 to 4096: ${l}`);
      continue;
    }
    const near = NEAR.exec(l.slice(HELD.length));
    if (!m && near) {
      if (near[3] !== undefined && near[3] !== "reach" && !(Number(near[3]) > 0 && Number.isFinite(Number(near[3])))) throw new Error(`a grid's cells are some positive number of the reach's units on a side: ${l}`);
      continue;
    }
    if (!m && /^\S+ (way|mode plan|schedule): /.test(l.slice(HELD.length))) throw new Error(`only a type's representation, a placement or a way of neighbours can be held yet: ${l}`);
    if (!m) throw new Error(`a held decision isn't read: ${l}`);
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
// by the type, a placement's, by its node and target, or a way of
// neighbours, by its call.
function heldIn(written: readonly string[]): (l: string) => boolean {
  const of = new Set(heldOf(written).keys());
  const places = new Set(written.flatMap((l) => { const p = l.startsWith(HELD) ? PLACE.exec(l.slice(HELD.length)) : null; return p ? [`${p[1]} ${p[5]}`] : []; }));
  const near = new Set(written.flatMap((l) => { const m = l.startsWith(HELD) ? NEAR.exec(l.slice(HELD.length)) : null; return m ? [m[1]] : []; }));
  return (l) => { const p = PLACE.exec(l); return of.has(ENTRY.exec(l)?.[1] ?? "") || (!!p && places.has(`${p[1]} ${p[5]}`)) || near.has(NEAR.exec(l)?.[1] ?? ""); };
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
    if (POOLED.test(l.slice(HELD.length))) return was[2] !== p[2] ? [`held   ${p[1]} (${p[5]}): ${p[2]} ${POOL_OF[p[5] as keyof typeof POOL_OF].replace(p[2] === "1" ? /s$/ : /$^/, "")}, where the compiler would start ${was[2]}`] : [];
    return [...(was[2] !== p[2] ? [`held   ${p[1]} (${p[5]}): ${p[2]}, where the compiler would run it on ${was[2]}`] : []), ...(p[4] && was[4] && p[4] !== was[4] ? [l.includes(CHUNKED) ? `held   ${p[1]} (${p[5]}): in chunks of ${p[4]} items, where the compiler would cut it in chunks of ${was[4]}` : `held   ${p[1]} (${p[5]}): in ${p[4]} runs${p[5] === "C" ? " a thread" : ""}, where the compiler would share it in ${was[4]}`] : [])];
  });
  const ways = new Map(alone.flatMap((l) => { const m = NEAR.exec(l); return m ? [[m[1], m[2]] as const] : []; }));
  const near = written.flatMap((l) => { const m = l.startsWith(HELD) ? NEAR.exec(l.slice(HELD.length)) : null, was = m && ways.get(m[1]); return m && was && was !== m[2] ? [`held   ${m[1]}: neighbours by ${m[2]}, where the compiler would find them on a ${was}`] : []; });
  return [...[...heldOf(written)].filter(([of, rep]) => picks.has(of) && picks.get(of) !== rep).map(([of, rep]) => `held   ${of}: ${rep}, where the compiler would pick ${picks.get(of)}`), ...places, ...near];
}

// The entries of a choices file, its comments left out.
export const readChoices = (text: string): string[] => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

// What a check says of a choices file against the picks made now.
export function staleChoices(written: readonly string[], now: readonly string[]): string[] {
  const isHeld = heldIn(written);
  // A measured entry is what a run found, not a pick: never stale.
  written = written.filter((l) => !l.startsWith(HELD) && !MEASURED.test(l));
  now = now.filter((l) => !isHeld(l));
  const was = new Set(written.map(meaningOf)), is = new Set(now.map(meaningOf));
  return [...written.filter((l) => !is.has(meaningOf(l))).map((l) => `stale  ${l}`), ...now.filter((l) => !was.has(meaningOf(l))).map((l) => `new    ${l}`)];
}

// What an entry says, not how (R12 §3): its id, kind, pick, facts, what
// it is among and its target. A way's, a place's or a schedule's job is
// said with the name of the definition it is in ("flown's flock over
// walk"), which changes when that definition is renamed or the job is
// found by another path; the words after the last "'s" name the job
// itself. A representation's type and a mode plan's facts stay whole.
const KIND = /^(\S+) (representation|way|mode plan|place|schedule): (.*)$/;
function meaningOf(line: string): string {
  const m = KIND.exec(line);
  if (!m) return line;
  const [head, ...rest] = m[3].split("; ");
  if (m[2] === "representation" || m[2] === "mode plan") return line;
  const cut = head.lastIndexOf(": ");
  if (cut < 0) return line;
  const about = head.slice(0, cut), i = about.lastIndexOf("'s "), job = i < 0 ? about : about.slice(i + 3);
  return [m[1], m[2], job, head.slice(cut + 2), ...rest].join("\u0000");
}

// Measured (L280d): each type with a pick, how often main's own
// definitions call its jobs in a run (its constructors and the functions
// its rows implement), and the largest value of it those calls gave, in
// items (its cases with parts: a list's cells, a tree's nodes). Written
// by `ters decisions --measure`, kept as written until measured again
// (CHOICES rule 4: measurements are committed).
export interface Measuring { measure: Measure; lines: (args: readonly string[], said?: string) => string[] }
export function measuring(given: Program, main: Id, picks: readonly Pick[]): Measuring {
  const names = { ...LIBRARY.names, ...given.names }, code = given.code;
  const casesOf = (t: Id): Id[] => { const d = code.nodes[t]; return d?.kind === "def" && code.nodes[d.body!]?.kind === "typedef" ? (code.nodes[d.body!] as NodeOf<"typedef">).variants : []; };
  // Each job's call nodes, by the type and the job (`T job`).
  const jobOf = new Map<Id, Id>(), typeOf = new Map<string, Id>();
  const picked = new Set(picks.map((p) => p.of));
  for (const t of picked) for (const j of jobsOf(given, t)) if (!jobOf.has(j)) { jobOf.set(j, t); typeOf.set(`${t} ${j}`, t); }
  const own = new Set(given.own), calls = new Map<Id, string>();
  for (const d of [main, ...dependencies(code, main)]) {
    if (!own.has(d)) continue;
    for (const id of subtree(code, d)) {
      const n = code.nodes[id];
      // A match or fold on a picked type: its job (`match`, `fold`).
      if (n?.kind === "match" || n?.kind === "fold") {
        for (const t of picked) { const j = matchJob(code, n, t); if (j) { calls.set(id, `${t} ${j}`); typeOf.set(`${t} ${j}`, t); break; } }
        continue;
      }
      if (n?.kind !== "call") continue;
      const f = code.nodes[n.fn], t = f?.kind === "ref" ? jobOf.get(f.target) : undefined;
      if (t !== undefined) calls.set(id, `${t} ${(f as NodeOf<"ref">).target}`);
    }
  }
  // A value's items: the cells of the recursive types it is made of (a
  // list's, a tree's), through the parts whose type is written as one of
  // its types (not an item's, which is a type parameter), up to 10
  // million: a Map's entries list, a list's cells.
  const fieldTypes = (t: Id): Id[] => casesOf(t).flatMap((c) => (code.nodes[c] as NodeOf<"variant">).fields.flatMap((f) => {
    const tr = code.nodes[(code.nodes[f] as NodeOf<"field">).type as Id] as { kind?: string; target?: Id } | undefined;
    return tr?.kind === "tref" && tr.target && casesOf(tr.target).length ? [tr.target] : [];
  }));
  const all = new Map<Id, Set<string>>(), items = new Map<Id, Set<string>>();
  for (const t of new Set(typeOf.values())) {
    const reached = new Set<Id>([t]);
    for (const x of reached) for (const y of fieldTypes(x)) reached.add(y);
    const recursive = [...reached].filter((x) => fieldTypes(x).includes(x));
    all.set(t, new Set([...reached].flatMap(casesOf)));
    items.set(t, new Set(recursive.flatMap((x) => casesOf(x).filter((c) => (code.nodes[c] as NodeOf<"variant">).fields.length))));
  }
  const largest = new Map<Id, number>();
  const sizeOf = (t: Id, v: unknown): number => {
    const of = all.get(t)!, cells = items.get(t)!;
    let n = 0;
    const todo: unknown[] = [v];
    while (todo.length && n < 1e7) {
      const x = todo.pop() as { tag?: unknown; fields?: unknown[] } | null;
      if (!x || typeof x !== "object" || typeof x.tag !== "string" || !of.has(x.tag) || !Array.isArray(x.fields)) continue;
      if (cells.has(x.tag)) n++;
      for (const y of x.fields) todo.push(y);
    }
    return n;
  };
  const measure: Measure = { calls, counts: new Map(), gave: (job, v) => { const t = typeOf.get(job)!, n = sizeOf(t, v); if (n > (largest.get(t) ?? 0)) largest.set(t, n); } };
  const lines = (args: readonly string[], said = args.length ? args.join(" ") : "no arguments") => [...new Set(typeOf.values())].flatMap((t) => {
    const counted = [...measure.counts].filter(([j, c]) => typeOf.get(j) === t && c > 0).map(([j, c]) => [names[j.slice(t.length + 1)] ?? j.slice(t.length + 1), c] as const).sort(([a], [b]) => a.localeCompare(b));
    if (!counted.length) return [];
    const most = largest.get(t);
    return [`${t} measured: ${names[t] ?? t}: ${counted.map(([j, c]) => `${j} ${c} ${c === 1 ? "time" : "times"}`).join(", ")}${most ? `; up to ${most} ${most === 1 ? "item" : "items"}` : ""}; from a run with ${said}`];
  });
  return { measure, lines };
}
// A type's jobs a run counts: its constructors and the definitions its
// rows say what they cost.
function jobsOf(given: Program, t: Id): Set<Id> {
  const code = given.code, d = code.nodes[t];
  const cases = d?.kind === "def" && code.nodes[d.body!]?.kind === "typedef" ? (code.nodes[d.body!] as NodeOf<"typedef">).variants : [];
  const own = storedRows(code, given.own, given.reps).filter((r) => r.of === t), rows = own.length ? own : LIBRARY.reps.filter((r) => r.of === t);
  return new Set([...cases, ...rows.flatMap((r) => Object.keys(r.cost)).filter((k) => code.nodes[k]?.kind === "def"), "match", "fold", FOLD_OF_ITEMS]);
}
const MEASURED = /^\S+ measured: /;
const MEASURE = /^(\S+) measured: [^:]*: ([^;]+?)(?:; up to (\d+) items?)?; from a run with .*$/;
// The measured entries read back for the chooser (represent.ts Measured),
// by the type: each job by its name among the type's jobs.
export function measuredOf(given: Program, lines: readonly string[]): Map<Id, Measured> {
  const names = { ...LIBRARY.names, ...given.names }, out = new Map<Id, Measured>();
  for (const l of lines) {
    const m = MEASURE.exec(l);
    if (!m) continue;
    const [, t, calls, size] = m, byName = new Map([...jobsOf(given, t)].map((j) => [names[j] ?? j, j]));
    const counted = new Map<string, number>();
    for (const c of calls.split(", ")) {
      const x = /^(.+) (\d+) times?$/.exec(c), j = x && byName.get(x[1]);
      if (!x || !j) throw new Error(`a measured entry names a job ${names[t] ?? t} doesn't have: ${l}`);
      counted.set(j, Number(x[2]));
    }
    out.set(t, { calls: counted, size: size ? Number(size) : 1 });
  }
  return out;
}
// The measured entries of a choices file, kept as written.
export const measuredIn = (lines: readonly string[]): string[] => lines.filter((l) => MEASURED.test(l));
