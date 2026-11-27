// Edit sequences through the MCP tools, shrunk as sequences (T18g,
// EPHYRA-LESSONS-2026-11-27): seeded steps on a copy of an example (a
// part replaced by another part's text, by a literal or by a hole, a
// definition renamed, a comment, an undo), each made as an LLM makes it,
// through ters/mcp/session.ts. After each step:
//
//   1. a step refused leaves the program as it was;
//   2. the session's check (kept between edits, I304) says of every node
//      of the program's own what a check from scratch says;
//   3. what it saved reads back as the same program;
//   4. an undo gives back the program before the step it undoes.
//
// And over two sequences from the same start, merge laws (merge-files.ts):
// a side merged with an unchanged one is that side, a side merged with
// itself is itself, and where nothing conflicts, ours with theirs is
// theirs with ours.
//
// A step is kept as numbers (which definition, which part, which text),
// read against the program as it is when it runs, so a sequence with a
// step taken out still runs: a broken law is cut down one step at a time
// to a sequence where every step is needed (delta debugging, Zeller and
// Hildebrandt, 2002).
//
// Influence: Ephyra's state-machine properties (datadog-labs/ephyra),
// sequences of commands generated and shrunk as sequences, after
// QuickCheck's (Hughes, "QuickCheck testing for fun and profit", 2007).

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../mcp/session.ts";
import * as T from "../../editor/typed.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { showIn } from "../src/lang/types.ts";
import { sameValue, subtree, type Code, type Id } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";
import { mergeFiles } from "../src/merge-files.ts";
import { root } from "../src/io.ts";

export type Op = "copy" | "literal" | "hole" | "rename" | "comment" | "undo";
export type Step = { op: Op; a: number; b: number };
export type Broken = { at: number; law: string; text: string };

const OPS: Op[] = ["copy", "copy", "literal", "literal", "hole", "rename", "comment", "undo"];
const LITERALS = ["0", "1", "2.5", "true", "\"a\"", "[]"];
const EXPRESSIONS = new Set(["call", "lit", "ref", "match", "lambda", "let", "list"]);

// mulberry32, so a sequence can be made again from its seed.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export function steps(seed: number, n: number): Step[] {
  const r = random(seed);
  return Array.from({ length: n }, () => ({ op: OPS[Math.floor(r() * OPS.length)], a: Math.floor(r() * 1000), b: Math.floor(r() * 1000) }));
}

export const show = (s: Step) => `${s.op} ${s.a} ${s.b}`;

// What a check says of the program's own nodes, to compare two checks.
function seen(code: Code, info: Info, names: Names, mine: Id[]) {
  const t = (x: Parameters<typeof showIn>[0]) => showIn(x, names, info.subst);
  const ids = mine.flatMap((d) => subtree(code, d));
  return {
    errors: info.errors.map((e) => `${e.id} ${e.message}`).sort(),
    schemes: mine.flatMap((d) => { const s = info.schemes.get(d); return s ? [`${d} ${t(s.type)}`] : []; }),
    types: ids.flatMap((id) => { const x = info.typeOf.get(id); return x ? [`${id} ${t(x)}`] : []; }),
  };
}

const ownNodes = (s: Session) => Object.fromEntries(s.own.flatMap((d) => subtree(s.code, d)).map((id) => [id, s.code.nodes[id]]));
const state = (s: Session) => ({ defs: s.own, nodes: ownNodes(s), names: s.names, comments: s.comments });
type State = ReturnType<typeof state>;

// One step on the session, read against the program as it is now; what it
// answered, or why it was refused.
function step(s: Session, st: Step): { ok: boolean; said: string } {
  const defs = s.own.filter((d) => s.code.nodes[d]?.kind === "def").sort((x, y) => s.name(x).localeCompare(s.name(y)));
  if (!defs.length) return { ok: false, said: "no definitions" };
  const def = defs[st.a % defs.length];
  const parts = [...s.texts(def)].filter(([id]) => id !== def && EXPRESSIONS.has(s.code.nodes[id]?.kind ?? ""));
  try {
    if (st.op === "undo") return { ok: true, said: s.undo() };
    if (st.op === "rename") return { ok: true, said: s.rename(def, `${s.name(def)} ${st.b % 10}`) };
    if (!parts.length) return { ok: false, said: "no parts" };
    const [at] = parts[st.b % parts.length];
    if (st.op === "comment") return { ok: true, said: s.comment(at, `note ${st.b}`) };
    const text = st.op === "copy" ? parts[(st.b * 7 + 3) % parts.length][1] : st.op === "literal" ? LITERALS[st.b % LITERALS.length] : "□";
    return { ok: true, said: s.replace(at, text) };
  } catch (e) { return { ok: false, said: (e as Error).message.split("\n")[0] }; }
}

// A copy of the example to edit, and its session.
function open(example: string): { dir: string; s: Session; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `edits-${example}-`));
  cpSync(join(root, "examples", example), dir, { recursive: true });
  return { dir, s: new Session(dir), done: () => rmSync(dir, { recursive: true, force: true }) };
}

// The steps on a fresh copy, the laws after each; the first law broken,
// and the saved code.json at the end.
export function run(example: string, seq: Step[]): { broken: Broken | null; kept: number; saved: unknown } {
  const { dir, s, done } = open(example);
  const undos: State[] = [];
  let kept = 0;
  try {
    for (let i = 0; i < seq.length; i++) {
      const before = state(s), was = s.code;
      const r = step(s, seq[i]);
      const at = (law: string, text: string): Broken => ({ at: i, law, text: `${law} after ${show(seq[i])} (${r.ok ? "made" : `refused: ${r.said}`}): ${text}` });
      if (!r.ok) {
        if (s.code !== was && !sameValue(state(s), before)) return { broken: at("refused leaves it", "the program changed"), kept, saved: null };
      } else {
        kept++;
        if (seq[i].op === "undo") {
          const want = undos.pop();
          if (want && !sameValue(state(s), want)) return { broken: at("undo gives it back", "not the program before the step undone"), kept, saved: null };
        } else undos.push(before);
      }
      const names = { ...LIBRARY.names, ...s.allNames };
      const fresh = infer(s.code, names, undefined, { ...T.programOptions()!, cache: undefined });
      const a = seen(s.code, s.info, names, s.own), b = seen(s.code, fresh, names, s.own);
      if (!sameValue(a, b)) {
        const k = (Object.keys(a) as (keyof typeof a)[]).find((x) => !sameValue(a[x], b[x]))!;
        const only = a[k].filter((x) => !b[k].includes(x)).slice(0, 2), other = b[k].filter((x) => !a[k].includes(x)).slice(0, 2);
        return { broken: at("check as from scratch", `${k}: kept ${only.join("; ")}, from scratch ${other.join("; ")}`), kept, saved: null };
      }
      const back = new Session(dir);
      if (!sameValue(state(back), state(s))) return { broken: at("saved reads back", "the program read from its files differs"), kept, saved: null };
    }
    return { broken: null, kept, saved: JSON.parse(readFileSync(join(dir, "code.json"), "utf8")) };
  } finally { done(); }
}

// The steps of a sequence that breaks a law, cut down to those it needs to
// break the same one.
export function shrunk(example: string, seq: Step[], law: string, budget = 60): Step[] {
  let cur = seq.slice(0, run(example, seq).broken!.at + 1), tries = 0;
  for (let cut = true; cut && tries < budget;) {
    cut = false;
    for (let i = cur.length - 1; i >= 0 && tries < budget; i--) {
      const next = [...cur.slice(0, i), ...cur.slice(i + 1)];
      tries++;
      const b = run(example, next).broken;
      if (b?.law === law) { cur = next.slice(0, b.at + 1); cut = true; break; }
    }
  }
  return cur;
}

// The merge laws over the files two sequences saved from one start.
export function mergeLaws(start: unknown, ours: unknown, theirs: unknown): string[] {
  const out: string[] = [];
  const m = (b: unknown, x: unknown, y: unknown) => mergeFiles(structuredClone(b), structuredClone(x), structuredClone(y));
  for (const [side, x] of [["ours", ours], ["theirs", theirs]] as const) {
    const a = m(start, x, start), b = m(start, start, x), c = m(start, x, x);
    if (a.conflicts.length || !sameValue(a.merged, x)) out.push(`${side} merged with the start isn't ${side}`);
    if (b.conflicts.length || !sameValue(b.merged, x)) out.push(`the start merged with ${side} isn't ${side}`);
    if (c.conflicts.length || !sameValue(c.merged, x)) out.push(`${side} merged with itself isn't ${side}`);
  }
  const ab = m(start, ours, theirs), ba = m(start, theirs, ours);
  if (!ab.conflicts.length && !ba.conflicts.length && !sameValue(ab.merged, ba.merged)) out.push("ours with theirs isn't theirs with ours");
  if (!!ab.conflicts.length !== !!ba.conflicts.length) out.push("ours with theirs conflicts one way only");
  return out;
}

export function startOf(example: string): unknown {
  return JSON.parse(readFileSync(join(root, "examples", example, "code.json"), "utf8"));
}
