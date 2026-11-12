// One open program, as the MCP server (mcp/server.ts) sees it: what each
// tool reads and changes. Kept apart from the protocol so the tests can
// call it directly.
//
// The program is the tree of ids (model.ts); names are a side table. The
// text an LLM reads is the blocks text (render.ts blocksOf, the same walk as
// the editor's Blocks pane) with the ids it needs put back in: a name's id
// where it is bound (`total#k3fa`), a hole's (`□#9c0d`), and in a gutter the
// id of each block that starts on that line. Ids are shown as the shortest
// prefix (4 or more characters) no other node of the program shares.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Code, Id, NodeOf } from "../src/model.ts";
import { collect, freshId, portNames, portsOf, subtree, isCall, type Call, type NodeData } from "../src/model.ts";
import { sameEverywhere, sharedPlaces } from "../src/lang/patterns.ts";
import type { Comments, Names, Presentation, Style } from "../src/presentation.ts";
import { root } from "../src/io.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { sameLines } from "../src/lang/modules.ts";
import { base, baseNames, optionsWith } from "../src/lang/load.ts";
import { pinsOf, type Pins } from "../src/lang/signatures.ts";
import { blocksOf, pieceText, type Blk, type Piece } from "../src/lang/render.ts";
import { showIn, showType } from "../src/lang/types.ts";
import { fromFile, own, toFile, type ProgramFile } from "../src/files.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, htmlText } from "../src/lang/html.ts";
import { equal, mainProblem, pageProblem, runProgram, runMain, showerFor, withSteps, OutOfSteps, type World } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { runTests, savedFrom } from "../src/lang/tests.ts";
import * as T from "../../editor/typed.ts";
import { onTodaysIds, S, SIGS, TRUE } from "../src/lang/std.ts";
import { setDisplayNames } from "../../editor/typed.ts";
import { addField, addParameter, addWay, deleteDefinition, nameClash, newDefinition, setWay, type Shape } from "../src/lang/toplevel.ts";
import { readCase, readType, typeNames, type Build } from "./type-text.ts";

// A saved folder read as ters reads it (load.ts): older ids and shapes
// brought up to today's (std.ts onTodaysIds, I185).
const read = <T>(path: string, fallback: T): T => (existsSync(path) ? onTodaysIds(JSON.parse(readFileSync(path, "utf8"))) : fallback);
const STYLE: Style = read(join(root, "styles", "blocks.json"), { view: "blocks", notation: {} });
// A run that doesn't finish is stopped after this many steps.
export const STEPS = 20_000_000;
export const LINES = 40;

export class Session {
  path: string;
  title: string;
  // The whole code (library underneath), the program's own names and
  // comments, and for a file the rest of what it keeps.
  code!: Code;
  names!: Names;
  comments!: Comments;
  file?: ProgramFile;
  info!: Info;
  // The program's own pins (signatures.ts): a definition's type held, so
  // an edit inside it is checked against it and its callers against the
  // pin (L173c). A folder keeps them in signatures.json.
  pins: Pins = {};
  private short = new Map<Id, string>();

  constructor(path: string) {
    this.path = resolve(path);
    if (!existsSync(this.path)) throw new Error(`no such program: ${path}`);
    if (statSync(this.path).isDirectory()) {
      this.title = basename(this.path);
      this.code = base(read<Code>(join(this.path, "code.json"), { nodes: {}, defs: [] }));
      this.names = read<Names>(join(this.path, "names.default.json"), {});
      this.comments = read<Comments>(join(this.path, "comments.json"), {});
      this.pins = read<Pins>(join(this.path, "signatures.json"), {});
    } else {
      const r = fromFile(readFileSync(this.path, "utf8"), () => LIBRARY.code);
      if ("error" in r) throw new Error(`can't open ${path}: ${r.error}`);
      this.file = r.file;
      this.title = r.file.title;
      this.code = r.code;
      this.names = r.file.names;
      this.comments = r.file.comments ?? {};
      this.pins = r.file.signatures ?? {};
    }
    this.recheck();
  }

  get allNames(): Names { return baseNames(this.names); }
  get own(): Id[] { return this.code.defs.filter((d) => !LIBRARY.code.nodes[d]); }

  recheck() {
    // The editor's gestures check with the same pins (typed.ts infer).
    T.setProgramPins(this.pins);
    this.info = infer(this.code, this.allNames, undefined, optionsWith(this.pins));
    // Shortest unique prefixes, over the program's own nodes.
    const ids = Object.keys(this.code.nodes).filter((id) => !LIBRARY.code.nodes[id]).sort();
    this.short.clear();
    ids.forEach((id, i) => {
      const common = (o?: string) => { if (!o) return 0; let k = 0; while (k < id.length && id[k] === o[k]) k++; return k; };
      this.short.set(id, id.slice(0, Math.max(4, common(ids[i - 1]) + 1, common(ids[i + 1]) + 1)));
    });
  }

  save() {
    const mine = own(this.code, LIBRARY.code);
    if (this.file) {
      writeFileSync(this.path, toFile({ ...this.file, code: this.code, names: this.names, comments: this.comments, signatures: this.pins }, LIBRARY.code));
      return;
    }
    const json = (x: unknown) => JSON.stringify(x, null, 2) + "\n";
    writeFileSync(join(this.path, "code.json"), json(mine));
    writeFileSync(join(this.path, "names.default.json"), json(this.names));
    if (Object.keys(this.comments).length || existsSync(join(this.path, "comments.json"))) writeFileSync(join(this.path, "comments.json"), json(this.comments));
    if (Object.keys(this.pins).length || existsSync(join(this.path, "signatures.json"))) writeFileSync(join(this.path, "signatures.json"), json(this.pins));
  }

  id(id: Id): string { return this.short.get(id) ?? id; }
  name(id: Id): string { return this.allNames[id] ?? id; }

  // An id as given: in full, a unique prefix of one of the program's own,
  // or a definition's name (the program's own first, then the library's).
  resolve(ref: string, within?: Id): Id {
    const r = ref.trim().replace(/^#/, "").replace(/^‹(.*)›$/, "$1");
    if (this.code.nodes[r]) return r;
    const hits = [...this.short.keys()].filter((id) => id.startsWith(r));
    if (r.length >= 3 && hits.length === 1) return hits[0];
    if (hits.length > 1 && r.length >= 3) throw new Error(`#${r} is ${hits.length} ids: ${hits.slice(0, 5).map((h) => this.id(h)).join(", ")}`);
    const all = this.allNames;
    const named = this.own.find((d) => this.names[d] === r) ?? this.code.defs.find((d) => all[d] === r);
    if (named) return named;
    // A case or a field (an interface's operation) of the program's own
    // types, by its name where only one has it.
    const parts = this.own.flatMap((d) => { const b = this.code.nodes[(this.code.nodes[d] as NodeOf<"def">).body ?? ""]; return b?.kind === "typedef" ? b.variants.flatMap((v) => [v, ...(this.code.nodes[v] as NodeOf<"variant">).fields]) : []; }).filter((x) => this.names[x] === r);
    if (parts.length === 1 && !within) return parts[0];
    // A variable, case or field by its name, inside a definition.
    if (within) {
      const local = subtree(this.code, within).filter((x) => this.names[x] === r);
      if (local.length === 1) return local[0];
      if (local.length > 1) throw new Error(`${local.length} named ${r}: use the id`);
    }
    throw new Error(`no id or definition ${ref}`);
  }

  // The definition a node belongs to.
  defOf(id: Id): Id | null {
    if (this.code.nodes[id]?.kind === "def") return id;
    for (const d of this.code.defs) if (subtree(this.code, d).includes(id)) return d;
    return null;
  }

  pres(): Presentation {
    return { names: this.allNames, comments: { ...LIBRARY.comments, ...this.comments }, hints: {}, style: STYLE };
  }

  typeOf(id: Id): string {
    const t = this.info.typeOf.get(id);
    return t ? showType(t, this.allNames) : "(a type)";
  }

  // ---------------------------------------------------------------- reading

  defs(filter?: string, library = false): string {
    const f = filter?.toLowerCase();
    const pick = (ds: Id[]) => ds.filter((d) => !f || this.name(d).toLowerCase().includes(f));
    const errs = new Set(this.info.errors.map((e) => this.defOf(e.id)));
    const line = (d: Id) => `${library ? "" : `${this.id(d)}  `}${this.name(d)} : ${this.typeOf(d)}${errs.has(d) ? "  ✗" : ""}`;
    const mine = pick(this.own).map(line);
    if (!library) return mine.join("\n") || "(none)";
    const lib = pick(LIBRARY.code.defs.filter((d) => !LIBRARY.hidden?.has(d) && this.allNames[d]));
    // The builtins too (range, floor, …): typed by their signatures.
    const builtins = pick(Object.keys(SIGS).filter((b) => this.code.nodes[b] && this.allNames[b] && !/^builtin\.(int\.|arith\.)/.test(b)));
    const sig = (b: Id) => `${this.name(b)} : ${showType(this.info.subst.zonk(SIGS[b](this.info.subst)), this.allNames)}`;
    const all = [...lib.map(line), ...builtins.map(sig)];
    return [...mine, ...all.slice(0, 60), ...(all.length > 60 ? [`… ${all.length - 60} more: narrow the filter`] : [])].join("\n") || "(none)";
  }

  // A definition, or the block of one that `at` names, as text with ids,
  // blocks deeper than `depth` shown as `…` with their id to view next.
  // With no depth, the deepest that fits in LINES lines.
  view(at: string, depth?: number): string {
    const id = this.resolve(at);
    const def = this.defOf(id);
    if (!def) throw new Error(`#${this.id(id)} isn't in a definition`);
    const blocks = blocksOf(this.code, this.pres(), this.info, def);
    const found = id === def ? blocks : findBlk(blocks, id);
    let lines = this.lines(found ?? blocks, depth ?? 99);
    for (let d = 12; depth === undefined && lines.length > LINES && d >= 2; d--) lines = this.lines(found ?? blocks, d);
    const errors = this.info.errors.filter((e) => subtree(this.code, found ? id : def).includes(e.id)).map((e) => `✗ #${this.id(e.id)} ${e.message}`);
    const head = id === def || !found ? [] : [`in ${this.name(def)}:`];
    // A match whose cases read the same shows them once, as otherwise.
    const folded = subtree(this.code, found ? id : def).flatMap((x) => {
      const m = this.code.nodes[x];
      if (m?.kind !== "match") return [];
      const ps = sharedPlaces(this.code, this.info, m).filter((p) => p.slot === "body");
      return ps.length ? [`${this.id(x)} otherwise is: ${ps.map((p) => this.name((this.code.nodes[p.parent] as NodeOf<"arm">).variant)).join(", ")}`] : [];
    });
    // What the lines don't show: an operation's ports, a way's mark.
    const marks = subtree(this.code, found ? id : def).flatMap((x) => {
      const n = this.code.nodes[x];
      const ports = n?.kind === "field" ? portNames(this.code.nodes, n) : undefined;
      if (ports?.length) return [`${this.id(x)} ports: ${ports.slice(0, -1).join(", ")} -> ${ports.at(-1)}`];
      if (n?.kind === "def" && n.way) return [`${this.id(x)} a way of ‹${this.name(n.way)}›${n.cost != null ? `, cost ${n.cost}` : ""}`];
      return [];
    });
    return [...head, ...lines, ...folded, ...marks, ...errors].join("\n");
  }

  // The gutter: the id of a block that starts on the line, else blank.
  lines(bs: Blk[], depth: number): string[] {
    const rows: { id?: Id; text: string }[] = [];
    const walk = (bs: Blk[], ind: string, level: number, pending?: Id) => {
      bs.forEach((b, i) => {
        const at = i === 0 ? pending : undefined;
        if ("line" in b) { rows.push({ id: b.id ?? at ?? lineDef(b.line, this.code), text: ind + this.piece(b.line) }); return; }
        if (level >= depth && b.pad > 0) {
          const first = b.id ?? firstId(b.kids);
          rows.push({ id: first, text: ind + " ".repeat(b.pad) + "…" });
          return;
        }
        walk(b.kids, ind + " ".repeat(b.pad), b.pad > 0 ? level + 1 : level, b.id ?? at);
      });
    };
    walk(bs, "", 0);
    const w = Math.max(4, ...rows.map((r) => (r.id ? this.id(r.id).length : 0)));
    // An id the line already shows inline isn't repeated in the gutter.
    const gutter = (r: { id?: Id; text: string }) => (r.id && !LIBRARY.code.nodes[r.id] && !r.text.includes(`#${this.id(r.id)}`) ? this.id(r.id) : "");
    return rows.map((r) => `${gutter(r).padEnd(w)}  ${r.text}`.trimEnd());
  }

  // A line's pieces as text: a name where it is bound carries its id, so
  // does a hole.
  piece(ps: Piece[]): string {
    return ps.map((p) => {
      if (typeof p === "string") return p;
      if (p.pane) return "";
      const text = this.piece(p.kids);
      const cls = p.cls.split(" ")[0];
      if (!p.id || LIBRARY.code.nodes[p.id]) return text;
      // A field's id goes after its name, before its type.
      if (cls === "fld") { const [n, ...rest] = p.kids; return `${this.piece([n])}#${this.id(p.id)}${this.piece(rest)}`; }
      if (cls === "bnd" || cls === "def" || cls === "hole") return `${text}#${this.id(p.id)}`;
      return text;
    }).join("");
  }

  // What each node of a definition reads as on one line, for finding a part
  // by its text (edits' `find`).
  texts(def: Id): Map<Id, string> {
    const out = new Map<Id, string>();
    const walk = (ps: Piece[]) => ps.forEach((p) => { if (typeof p !== "string") { if (p.id && !out.has(p.id)) out.set(p.id, pieceText(p.kids).trim()); walk(p.kids); } });
    const blk = (bs: Blk[]) => bs.forEach((b) => ("line" in b ? walk(b.line) : blk(b.kids)));
    blk(blocksOf(this.code, this.pres(), this.info, def));
    return out;
  }

  errors(): string {
    // Drafts the same as a library definition or another draft (SHARING.md
    // §7): said, never merged.
    const same = sameLines(this.code, this.allNames, LIBRARY).map((l) => `= ${l}`);
    if (!this.info.errors.length) return ["ok", ...same].join("\n");
    return [...this.info.errors.map((e) => { const d = this.defOf(e.id); return `✗ ${d ? this.name(d) : "?"} #${this.id(e.id)}: ${e.message}`; }), ...same].join("\n");
  }

  // ---------------------------------------------------------------- editing
  //
  // Each edit is one of the editor's own gestures (editor/typed.ts,
  // src/lang/toplevel.ts), so an LLM edits the way a person does. It is
  // kept only if the program has no more type errors than before, then
  // saved; the answer is the changed lines of the definition, or why not.

  private undos: { code: Code; names: Names; comments: Comments; pins?: Pins }[] = [];

  private apply(def: Id | null, make: () => { ok: true; code: Code; names: Names } | { ok: false; reason: string }, after?: (code: Code) => Id | null, share = true): string {
    setDisplayNames(LIBRARY.names);
    const before = def ? this.viewLines(def) : [];
    const was = { code: this.code, names: this.names, comments: this.comments };
    const errs = this.info.errors.length;
    const r = make();
    if (!r.ok) throw new Error(r.reason);
    // A body drawn once as the otherwise is a copy in each case it stands for.
    const same = share ? sameEverywhere(this.code, r.code, this.info) : { code: r.code, copied: [] as [Id, Id][] };
    const names = { ...r.names };
    for (const [x, y] of same.copied) if (names[x]) names[y] = names[x];
    this.code = collect(same.code);
    this.names = names;
    this.recheck();
    if (this.info.errors.length > errs) {
      const fresh = this.info.errors.filter((e) => !was.code.nodes[e.id] || !this.infoHad(was, e.id)).at(0) ?? this.info.errors.at(-1)!;
      const why = `${fresh.message}`;
      Object.assign(this, was);
      this.recheck();
      throw new Error(why);
    }
    this.undos.push(was);
    this.save();
    const at = (after ? after(r.code) : def) ?? def;
    if (!at || !this.code.nodes[at]) return "ok";
    return diff(at === def ? before : [], this.viewLines(at)) || "ok (nothing shown changed)";
  }
  private infoHad(was: { code: Code }, id: Id): boolean { return !!was.code.nodes[id]; }
  private viewLines(def: Id): string[] { return this.view(def, 99).split("\n"); }

  // A part of `at`: itself, or the part inside it that reads as `find`.
  part(at: string, find?: string): Id {
    const id = this.resolve(at);
    if (find === undefined || find === "") return id;
    const def = this.defOf(id);
    if (!def) throw new Error(`#${this.id(id)} isn't in a definition`);
    const want = norm(find);
    const inside = new Set(subtree(this.code, id));
    const hits = [...this.texts(def)].filter(([x, t]) => inside.has(x) && norm(t) === want).map(([x]) => x);
    // The outermost, when a part and its only child read the same (a call
    // and its name, say).
    const top = hits.filter((x) => !hits.some((y) => y !== x && subtree(this.code, y).includes(x)));
    if (!top.length) throw new Error(`no part of #${this.id(id)} reads ${find}`);
    if (top.length > 1) throw new Error(`${top.length} parts read ${find}: give the id of a block around just one`);
    // A thunk reads as its body (first's `() => …`): the body is the part.
    const n = this.code.nodes[top[0]];
    return n?.kind === "lambda" && !n.params.length && hits.includes(n.body) ? n.body : top[0];
  }

  // A hole filled from text as the editor reads it, and a relation's solve
  // as the view prints one (L231): `gap at(body = b, wall = w, gap = 0)`,
  // the ports given by name and the one left out the value.
  private fill(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const steps = this.stepsIn(code, names, hole, text, def);
    if (steps) return steps;
    if (/^\s*match\s/.test(text)) return this.matchIn(code, names, hole, text, def);
    const solve = this.solveIn(code, names, hole, text);
    if (!solve) return this.fillOne(code, names, hole, text, def, as);
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: solve.code, names };
    for (const [h, t] of solve.fills) {
      if (!cur.ok) return cur;
      cur = this.fillOne(cur.code, cur.names, h, t, def);
    }
    return cur;
  }

  private fillOne(code: Code, names: Names, hole: Id, t: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    // An implementation's field left to the interface's ways (WAYS.md):
    // the editor's text reader doesn't take it (I183), so it is put in
    // here; the checker says if no way grounds it.
    if (norm(t) === "by its ways") return { ok: true, names, code: { nodes: { ...code.nodes, [hole]: { id: hole, kind: "ref", target: S.byItsWays } }, defs: code.defs } };
    const r = T.fillValue(code, names, editorInfo(code, names), hole, t, def);
    // A field several types have, read on a value nothing has settled,
    // fits as each (the editor offers each, E186): none is taken silently
    // (I187: round 12's p.place took Ball's, and pocket toucher was then
    // refused two definitions later). `as` names the one meant.
    if (r.ok && r.choices && r.choices.length > 1) {
      const labels = r.choices.map((c) => c.label.replace(/^as /, ""));
      // Each label names the types its fields are read on ("Person, a
      // Problem, a Shift"); `as` may name them all or only the ones that
      // tell the readings apart ("Person", I218 M11).
      const typesIn = (l: string) => l.split(/\s*(?:,|\band\b)\s*/).map((x) => x.trim().replace(/^(an?|the)\s+/i, "").toLowerCase()).filter(Boolean);
      const want = as?.trim() ? typesIn(as) : [];
      const fits = r.choices.filter((_, i) => { const has = typesIn(labels[i]); return want.every((w) => has.includes(w)); });
      const exact = fits.filter((c) => typesIn(c.label.replace(/^as /, "")).join() === want.join());
      const pick = want.length ? (exact.length === 1 ? exact[0] : fits.length === 1 ? fits[0] : undefined) : undefined;
      if (pick?.edit.ok) return pick.edit;
      return { ok: false, reason: `${t.trim()} reads ${labels.map((l) => `as ${l}`).join(" or ")}: a field more than one type has, on a value whose type nothing settles yet. Give \`as\` (${labels.map((l) => JSON.stringify(l.replace(/^an?\s+/i, ""))).join(" or ")}), or settle the type first` };
    }
    if (r.ok || r.reason !== "a name alone is listed already") return r;
    // A name alone, which the editor's palette lists: the nearest in
    // scope (a case's field bound in its arm, I184), else a definition.
    const all = baseNames(names);
    const near = T.scopeAt(code, def, hole).filter((b) => all[b] === norm(t)).at(-1)
      ?? code.defs.find((d) => all[d] === norm(t) && !LIBRARY.code.nodes[d]) ?? code.defs.find((d) => all[d] === norm(t));
    if (!near) return r;
    return { ok: true, names, code: { nodes: { ...code.nodes, [hole]: { id: hole, kind: "ref", target: near } }, defs: code.defs } };
  }

  // Steps on lines of their own, as the view prints a let (I217 M5):
  //   c = cost(shift)
  //   k = c * 2
  //   k + 1
  // each step read as `c = …; □`, and the lines after it into that hole,
  // so the last may be a match on lines (`ds = …` then `match ds`, M4).
  // Null when the text isn't steps: one line, or a first line that isn't
  // `name = value` with more at its indent.
  private stepsIn(code: Code, names: Names, hole: Id, text: string, def: Id): { ok: true; code: Code; names: Names } | { ok: false; reason: string } | null {
    const lines = text.replace(/^\s*\n/, "").split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    const indent = (l: string) => l.length - l.trimStart().length;
    const top = indent(lines[0]);
    const next = lines.findIndex((l, i) => i > 0 && indent(l) <= top);
    if (next < 0 || /^match\s/.test(lines[0].trim())) return null;
    const after = lines.slice(next).map((l) => l.slice(Math.min(top, indent(l)))).join("\n");
    // `tuple(a, b) = e` (M6): a match on e with its one case, the lines
    // after it that case's value.
    const parts = /^([\p{L}_][\p{L}\p{N}_' ]*?)\s*\(([^()]*)\)\s*=(?![=>])\s*(\S[\s\S]*)$/u.exec(lines[0].trim());
    if (parts) return this.fill(code, names, hole, `match ${[parts[3], ...lines.slice(1, next).map((l) => l.trim())].join(" ")}\n  ${parts[1]}(${parts[2]}) →\n${after.split("\n").map((l) => "    " + l).join("\n")}`, def);
    const step = /^([\p{L}_][\p{L}\p{N}_' ]*?)\s*=(?![=>])\s*(\S[\s\S]*)$/u.exec(lines[0].trim());
    if (!step) return null;
    // The step's value may go on over deeper lines.
    const value = [step[2], ...lines.slice(1, next).map((l) => l.trim())].join(" ");
    const r = this.fillOne(code, names, hole, `${step[1]} = ${value}; □`, def);
    if (!r.ok) return r;
    const call = r.code.nodes[hole], fn = isCall(call) ? r.code.nodes[call.fn] : undefined;
    if (fn?.kind !== "lambda" || r.code.nodes[fn.body]?.kind !== "hole") return { ok: false, reason: `${step[1]} = ${value} doesn't read as a step` };
    return this.fill(r.code, r.names, fn.body, after, def);
  }

  // A match written as view prints it (I212), one case a line:
  //   match ids
  //     nil → m
  //     cons(head, tail) → herons over(put(m, head, start heron(head)), tail)
  // or on one line, its cases after `;`s. It is the editor's Split on the
  // variable (T.splitOn: one case per variant of its type, none missing),
  // each case's fields named as written and its body read as text in
  // turn, so a case's body may be a match too (on deeper lines). `->` reads
  // as →; a case left out, or written □, stays a hole.
  private matchIn(code: Code, names: Names, hole: Id, text: string, def: Id): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const lines = text.replace(/^\s*\n/, "").split("\n");
    let head = lines[0].trim().replace(/^match\s+/, "");
    let cases: string[];
    if (lines.length === 1 || !lines.slice(1).some((l) => l.trim())) {
      // One line: the scrutinee, then the cases after `;`s outside brackets.
      const parts = topLevel(head, ";");
      head = parts[0];
      cases = parts.slice(1);
    } else {
      // Cases begin on the least indented of the lines after the first;
      // deeper lines go on the case above.
      const rest = lines.slice(1).filter((l) => l.trim());
      const indent = (l: string) => l.length - l.trimStart().length;
      const least = Math.min(...rest.map(indent));
      cases = [];
      for (const l of rest) if (indent(l) === least || !cases.length) cases.push(l.trim()); else cases[cases.length - 1] += "\n" + l;
    }
    const all = baseNames(names);
    const on = norm(head);
    const scope = T.scopeAt(code, def, hole);
    const binder = scope.filter((b) => all[b] === on).at(-1);
    // A match on a value that isn't a name in scope (`match cases of(x)`,
    // M4): the value named first, as a step, and the match on that name.
    if (!binder) {
      if (/^[\p{L}_][\p{L}\p{N}_' ]*$/u.test(on)) return { ok: false, reason: `match reads a variable here, and nothing in scope is named ${on}` };
      const taken = new Set(scope.map((b) => all[b]));
      let name = "it";
      for (let i = 2; taken.has(name); i++) name = `it ${i}`;
      return this.fill(code, names, hole, `${name} = ${head}\nmatch ${name}\n${cases.map((c) => "  " + c.replace(/\n/g, "\n  ")).join("\n")}`, def);
    }
    // List patterns (M2): `[a, b] → …`, `[] → …`, with `otherwise →` for
    // the lengths not written, read as the matches on nil and cons they
    // stand for.
    const lists = cases.map((c) => /^\[([^\]]*)\]\s*(?:→|->)\s*([\s\S]*)$/.exec(c.trim()));
    if (lists.some(Boolean)) {
      const other = cases.find((c) => /^otherwise\s*(?:→|->)/.test(c.trim()));
      const bad = cases.find((c, i) => !lists[i] && c !== other);
      if (bad) return { ok: false, reason: `with list patterns, the other cases are otherwise, not ${bad.trim()}` };
      const fallback = other ? dedent(other.trim().replace(/^otherwise\s*(?:→|->)/, "")) || "□" : "□";
      const written = lists.filter(Boolean).map((k) => ({ names: k![1].trim() ? k![1].split(",").map((x) => x.trim()) : [], body: dedent(k![2]) || "□" }));
      return this.fill(code, names, hole, listMatch(head, 0, written, fallback), def);
    }
    const parsed = cases.map((c) => /^(.+?)\s*(?:\(([^)]*)\))?\s*(?:→|->)\s*([\s\S]*)$/.exec(c.trim()));
    const bad = parsed.findIndex((k) => !k);
    if (bad >= 0) return { ok: false, reason: `a case reads Case(fields) → value, not ${cases[bad].trim()}` };
    // `otherwise → value` (M3), as the view folds the cases left: each
    // case not written gets the value.
    const otherwise = parsed.filter((k) => norm(k![1]) === "otherwise");
    if (otherwise.length > 1) return { ok: false, reason: "otherwise is written twice" };
    const read = parsed.filter((k) => norm(k![1]) !== "otherwise");
    // A variable nothing has typed yet (a new function's input) is split
    // on the data type the cases name, as split's `as` says it.
    const written = read.map((k) => norm(k![1]));
    const types = code.defs.filter((d) => {
      const b = (code.nodes[d] as NodeOf<"def"> | undefined)?.body, td = b ? code.nodes[b] : undefined;
      return td?.kind === "typedef" && written.every((w) => td.variants.some((v) => norm(all[v] ?? "") === w));
    });
    const as = types.length === 1 ? types[0] : types.find((d) => !LIBRARY.code.nodes[d]);
    const split = T.splitOn(code, names, editorInfo(code, names), hole, binder, as);
    if (!split.ok) return !types.length ? { ok: false, reason: `no data type has the cases ${written.join(", ")}` } : split;
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: split.code, names: { ...split.names } };
    const m = split.code.nodes[hole] as NodeOf<"match">;
    const arms = m.arms.map((a) => split.code.nodes[a] as NodeOf<"arm">);
    const caseName = (a: NodeOf<"arm">) => norm(all[a.variant] ?? this.name(a.variant));
    const seen = new Set<Id>();
    for (const k of read as RegExpExecArray[]) {
      const arm = arms.find((a) => caseName(a) === norm(k[1]));
      if (!arm) return { ok: false, reason: `${on}'s cases are ${arms.map(caseName).join(", ")}, not ${norm(k[1])}` };
      if (seen.has(arm.id)) return { ok: false, reason: `the case ${norm(k[1])} is written twice` };
      seen.add(arm.id);
      const fields = k[2]?.trim() ? k[2].split(",").map(norm) : [];
      if (fields.length && fields.length !== arm.binds.length) return { ok: false, reason: `${norm(k[1])} has ${arm.binds.length} field${arm.binds.length === 1 ? "" : "s"}, not ${fields.length}` };
      if (!cur.ok) return cur;
      fields.forEach((f, i) => { (cur as { names: Names }).names[arm.binds[i]] = f; });
      const body = dedent(k[3]);
      if (body && body !== "□" && body !== "?") cur = this.fill(cur.code, cur.names, arm.body, body.replace(/[‹›]/g, ""), def);
    }
    const rest = otherwise[0] && dedent(otherwise[0][3]);
    if (rest && rest !== "□" && rest !== "?") for (const arm of arms) if (!seen.has(arm.id)) {
      if (!cur.ok) return cur;
      cur = this.fill(cur.code, cur.names, arm.body, rest.replace(/[‹›]/g, ""), def);
    }
    return cur;
  }

  private solveIn(code: Code, names: Names, hole: Id, text: string): { code: Code; fills: [Id, string][] } | null {
    const m = /^\s*(.+?)\s*\((.*)\)\s*$/s.exec(text);
    if (!m || !/=/.test(m[2])) return null;
    const all = baseNames(names);
    const head = norm(m[1]);
    // A field with ports of the program's (an interface's operation), else a
    // definition with results.
    const fields = Object.values(code.nodes).filter((n) => n.kind === "field" && !!portNames(code.nodes, n)?.length && all[n.id] === head);
    const defs = code.defs.filter((d) => all[d] === head && portsOf(code.nodes, d));
    const target = fields.length === 1 ? fields[0].id : defs.length === 1 ? defs[0] : null;
    if (!target) return null;
    const f = code.nodes[target];
    const keys: [string, string][] = f.kind === "field"
      ? portNames(code.nodes, f)!.map((p, i) => [p, String(i)])
      : (code.nodes[(code.nodes[target] as NodeOf<"def">).body!] as NodeOf<"lambda">).params.map((p) => [all[p] ?? p, p]);
    // Split the inputs on commas outside brackets.
    const parts: string[] = [];
    let depth = 0, from = 0;
    const a = m[2];
    for (let i = 0; i < a.length; i++) {
      if ("([{".includes(a[i])) depth++;
      else if (")]}".includes(a[i])) depth--;
      else if (a[i] === "," && !depth) { parts.push(a.slice(from, i)); from = i + 1; }
    }
    parts.push(a.slice(from));
    const nodes = { ...code.nodes };
    const given: Record<string, Id> = {};
    const fills: [Id, string][] = [];
    for (const part of parts) {
      const eq = /^\s*([^=]+?)\s*=(?!=)\s*(.+?)\s*$/s.exec(part);
      if (!eq) return null;
      const key = keys.find(([n]) => n === norm(eq[1]))?.[1];
      if (key === undefined) throw new Error(`${head} has no port ${eq[1].trim()}: its ports are ${keys.map(([n]) => n).join(", ")}`);
      const h = freshId();
      nodes[h] = { id: h, kind: "hole" };
      given[key] = h;
      fills.push([h, eq[2]]);
    }
    const ref = freshId(), yes = freshId();
    nodes[ref] = { id: ref, kind: "ref", target };
    nodes[yes] = { id: yes, kind: "ref", target: TRUE };
    nodes[hole] = { id: hole, kind: "call", fn: ref, given: { ...given, out: yes } } as NodeOf<"call">;
    return { code: { nodes, defs: code.defs }, fills };
  }

  // `kase`: in a match, the body of that one case, even where the view
  // shows it folded into otherwise; else an edit to a folded otherwise is
  // made in every case it stands for, as in the editor.
  replace(at: string, text: string, find?: string, kase?: string, as?: string): string {
    let target = this.part(at, find);
    if (kase) {
      const m = this.code.nodes[target];
      if (m?.kind !== "match") throw new Error(`#${this.id(target)} isn't a match`);
      const arm = m.arms.map((a) => this.code.nodes[a] as NodeOf<"arm">).find((a) => this.name(a.variant) === kase.trim());
      if (!arm) throw new Error(`no case ${kase}: ${m.arms.map((a) => this.name((this.code.nodes[a] as NodeOf<"arm">).variant)).join(", ")}`);
      target = arm.body;
    }
    const def = this.defOf(target);
    if (!def || target === def) throw new Error("replace a part of a definition, not the definition");
    const t = text.trim();
    return this.apply(def, () => {
      const info = editorInfo(this.code, this.names);
      const holed = T.toHole(this.code, this.names, info, target);
      if (!holed.ok || t === "□" || t === "?" || t === "") return holed;
      return this.fill(holed.code, holed.names, target, t, def, as);
    }, undefined, !kase);
  }

  // The smallest parts of each definition whose text contains `text`,
  // with their ids, to edit next.
  search(text: string): string {
    const want = norm(text);
    const out: string[] = [];
    for (const d of this.own) {
      const hits = [...this.texts(d)].filter(([, t]) => norm(t).includes(want)).map(([x]) => x);
      const small = hits.filter((x) => !hits.some((y) => y !== x && subtree(this.code, x).includes(y)));
      const texts = this.texts(d);
      for (const x of small) { const t = texts.get(x)!; out.push(`${this.id(x)}  ${this.name(d)}: ${t.length > 90 ? t.slice(0, 90) + "…" : t}`); }
    }
    return clip(out, 60).join("\n") || "(none)";
  }

  rename(at: string, name: string): string {
    const id = this.resolve(at);
    const clash = nameClash(this.code, this.allNames, id, name);
    if (clash) throw new Error(clash);
    const def = this.defOf(id);
    // A rename changes every use; the definitions that read it are shown elsewhere.
    return this.apply(def, () => ({ ok: true, code: this.code, names: { ...this.names, [id]: name.trim() } }));
  }

  comment(at: string, text: string): string {
    const id = this.resolve(at);
    const was = { code: this.code, names: this.names, comments: this.comments };
    const comments = { ...this.comments };
    if (text.trim()) comments[id] = text.trim(); else delete comments[id];
    this.undos.push(was);
    this.comments = comments;
    this.save();
    return "ok";
  }

  // Pin a definition at the type it has now (or with `off`, unpin it):
  // edits inside it must keep that type, and its callers are checked
  // against it, as the editor's pin does (signatures.ts). With a pin, a
  // body that doesn't say its inputs' types itself (fields mapped of an
  // input) is still checked at them (L173c).
  pin(at: string, off = false): string {
    const def = this.resolve(at);
    if (this.code.nodes[def]?.kind !== "def" || LIBRARY.code.nodes[def]) throw new Error("pin takes one of the program's definitions");
    const was = { code: this.code, names: this.names, comments: this.comments, pins: this.pins };
    const pins = { ...this.pins };
    if (off) delete pins[def];
    else { const p = pinsOf(this.info, [def])[def]; if (!p) throw new Error(`${this.name(def)} has no type to pin`); pins[def] = p; }
    const errs = this.info.errors.length;
    this.pins = pins;
    this.recheck();
    // Unpinning a body that needs the pin (fields mapped of an input) is refused.
    if (this.info.errors.length > errs) {
      const why = this.info.errors.at(-1)!.message;
      Object.assign(this, was);
      this.recheck();
      throw new Error(why);
    }
    this.undos.push(was);
    this.save();
    return off ? "ok" : `ok: ${this.name(def)} : ${this.typeOf(def)}`;
  }

  // A let before `before` (or at the top of the body): `name = value`.
  step(at: string, name: string, value: string): string {
    const before = this.resolve(at);
    const def = this.defOf(before);
    if (!def) throw new Error(`#${this.id(before)} isn't in a definition`);
    return this.apply(def, () => {
      const info = editorInfo(this.code, this.names);
      const r = T.addStep(this.code, this.names, info, def, before === def ? undefined : before);
      if (!r.ok || !r.dot) return r.ok ? { ok: false, reason: "no step added" } : r;
      const names = { ...r.names, [r.dot]: name.trim() || "_" };
      const let_ = Object.values(r.code.nodes).find((n): n is Call => isCall(n) && (r.code.nodes[n.fn] as { params?: Id[] }).params?.[0] === r.dot)!;
      const hole = let_.args[0];
      if (!value.trim()) return { ok: true, code: r.code, names };
      return this.fill(r.code, names, hole, value, def);
    });
  }

  // Replace a part by a match on a variable, one case per variant, each a copy.
  // `as`: the type to split by, where nothing fixes the variable's yet
  // (I116 in the editor, I184 here): the split fixes it.
  split(at: string, on: string, find?: string, as?: string): string {
    const target = this.part(at, find);
    const def = this.defOf(target);
    if (!def) throw new Error(`#${this.id(target)} isn't in a definition`);
    const v = this.resolve(on, def);
    const type = as?.trim() ? this.resolve(as) : undefined;
    return this.apply(def, () => T.splitOn(this.code, this.names, editorInfo(this.code, this.names), target, v, type));
  }

  // A type's first case may be written with its fields, `ball(number: Int,
  // place: Vec)`; an interface's first operation with its type, `gap at:
  // (a, Ball, Float64) -> Float64` (I183).
  define(name: string, kind: string, params: string[] = [], first = ""): string {
    const kase = kind === "type" ? readCase(first) : null;
    const op = kind === "interface" ? /^([^:]*?)\s*(?::\s*(.*))?$/s.exec(first.trim())! : null;
    const firstName = kase ? kase.name : op ? op[1] : first;
    const shape: Shape = kind === "function" ? { kind, params } : kind === "value" ? { kind } : kind === "type" ? { kind, firstCase: firstName } : kind === "effect" ? { kind, firstOperation: first } : kind === "interface" ? { kind, firstOperation: firstName } : (() => { throw new Error("kind: function, value, type, effect or interface"); })();
    return this.apply(null, () => {
      const r = newDefinition(this.code, this.names, name, shape);
      if (!r.ok) return r;
      const def = r.code.defs.at(-1)!;
      const td = r.code.nodes[(r.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
      if (kase) return this.withFields(r, def, td.variants[0], kase.fields);
      if (op?.[2]) {
        const v = r.code.nodes[td.variants[0]] as NodeOf<"variant">;
        const nodes = { ...r.code.nodes };
        const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as NodeOf<"hole">; return id; };
        const f = v.fields[0];
        nodes[f] = { ...(nodes[f] as NodeOf<"field">), type: this.typeIn(op[2], r.code, r.names, def)(add) };
        return { ...r, code: collect({ nodes, defs: r.code.defs }) };
      }
      return r;
    }, (c) => c.defs.at(-1)!);
  }

  // Type text read in this program, with a type's own parameters by name.
  private typeIn(text: string, code: Code, names: Names, type?: Id): Build {
    const all = baseNames(names);
    const td = type ? code.nodes[(code.nodes[type] as NodeOf<"def">).body ?? ""] : undefined;
    const params = new Map<string, Id>(td?.kind === "typedef" ? td.params.map((p) => [all[p] ?? "a", p]) : []);
    return readType(text, typeNames(code, all, code.defs.filter((d) => !LIBRARY.code.nodes[d])), params);
  }

  private withFields(r: { ok: true; code: Code; names: Names }, type: Id, variant: Id, fields: [string, string][]) {
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = r;
    for (const [n, t] of fields) {
      if (!cur.ok) return cur;
      const build = this.typeIn(t, cur.code, cur.names, type);
      cur = addField(cur.code, cur.names, type, variant, n, build);
    }
    return cur;
  }

  // The type and case a node names: a type (its one case), or a case.
  private caseOf(at: string): { type: Id; variant: Id } {
    const id = this.resolve(at);
    const n = this.code.nodes[id];
    const body = n?.kind === "def" ? this.code.nodes[n.body ?? ""] : undefined;
    if (body?.kind === "typedef") {
      if (body.variants.length !== 1) throw new Error(`${this.name(id)} has ${body.variants.length} cases: give the case`);
      return { type: id, variant: body.variants[0] };
    }
    if (n?.kind === "variant") return { type: this.defOf(id)!, variant: id };
    throw new Error(`#${this.id(id)} isn't a type or a case`);
  }

  // A new case of a type, with its fields: `pocketed(ball: Int)` (I183).
  addCase(at: string, text: string): string {
    const type = this.resolve(at);
    const kase = readCase(text);
    return this.apply(type, () => {
      const e = T.addCase(this.code, this.names, editorInfo(this.code, this.names), type, kase.name, []);
      if (!e.ok) return e;
      const td = e.code.nodes[(e.code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
      return this.withFields({ ok: true, code: e.code, names: e.names }, type, td.variants.at(-1)!, kase.fields);
    });
  }

  // A field of a case (or of a type's one case), or an interface's
  // operation, of a type written as text; an operation's ports, its
  // inputs' and its result's names, make it a relation (POLAR.md).
  addField(at: string, name: string, type: string, ports?: string[]): string {
    const { type: td, variant } = this.caseOf(at);
    return this.apply(td, () => {
      const r = addField(this.code, this.names, td, variant, name, this.typeIn(type, this.code, this.names, td));
      if (!r.ok || !ports?.length) return r;
      return this.portsIn(r.code, r.names, r.select, ports);
    });
  }

  ports(at: string, ports: string[]): string {
    const field = this.resolve(at);
    return this.apply(this.defOf(field), () => this.portsIn(this.code, this.names, field, ports));
  }

  private portsIn(code: Code, names: Names, field: Id, ports: string[]): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const f = code.nodes[field];
    if (f?.kind !== "field") return { ok: false, reason: "ports go on an interface's operation" };
    const t = code.nodes[f.type];
    const n = t?.kind === "tfun" ? t.params.length + 1 : 0;
    const ps = ports.map((p) => p.trim());
    // The names go on the field's function type (L182c3).
    if (t?.kind !== "tfun") return ps.length ? { ok: false, reason: `${names[field] ?? "it"} has no inputs` } : { ok: true, code, names };
    if (!ps.length) { const { ports: _, ...plain } = t; return { ok: true, code: { nodes: { ...code.nodes, [f.type]: plain }, defs: code.defs }, names }; }
    if (ps.length !== n) return { ok: false, reason: `${names[field] ?? "it"} has ${n ? `${n - 1} inputs and a result` : "no inputs"}: give ${n} ports, the inputs' then the result's` };
    return { ok: true, code: { nodes: { ...code.nodes, [f.type]: { ...t, ports: ps } }, defs: code.defs }, names };
  }

  // A way of an operation (WAYS.md): a new definition with a hole for its
  // body, marked as one way of computing it, at a cost.
  addWay(at: string, name: string, cost?: number): string {
    const field = this.resolve(at);
    const iface = this.defOf(field);
    if (!iface) throw new Error(`#${this.id(field)} isn't an operation`);
    return this.apply(null, () => {
      const r = addWay(this.code, this.names, iface, field, name);
      if (!r.ok || cost === undefined) return r;
      return setWay(r.code, r.names, r.select, { cost });
    }, (c) => c.defs.at(-1)!);
  }

  // A way's cost (none: the usual), or the mark taken off.
  cost(at: string, cost: number | null, off = false): string {
    const def = this.resolve(at);
    return this.apply(def, () => setWay(this.code, this.names, def, off ? null : { cost }));
  }

  addInput(at: string, name: string): string {
    const def = this.resolve(at);
    return this.apply(this.defOf(def), () => addParameter(this.code, this.names, def, name));
  }

  remove(at: string): string {
    const def = this.resolve(at);
    if (this.code.nodes[def]?.kind !== "def") throw new Error("remove takes a definition; replace a part with □ to clear it");
    this.apply(null, () => deleteDefinition(this.code, this.names, def));
    return "ok";
  }

  undo(): string {
    const was = this.undos.pop();
    if (!was) throw new Error("nothing to undo");
    Object.assign(this, was);
    this.recheck();
    this.save();
    return "ok";
  }

  // The value of an expression written as it prints, in the program's scope.
  eval(text: string): string {
    setDisplayNames(LIBRARY.names);
    // An action of no inputs, as main is, so what it performs (Diverge,
    // Console) is its own row and it runs as main runs (I188).
    const made = newDefinition(this.code, this.names, `eval ${Date.now()}`, { kind: "function", params: [] });
    if (!made.ok) throw new Error(made.reason);
    const def = made.code.defs.at(-1)!;
    const hole = (made.code.nodes[(made.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">).body;
    const r = T.fillValue(made.code, made.names, editorInfo(made.code, made.names), hole, text, def);
    if (!r.ok) throw new Error(r.reason);
    const info = infer(r.code, baseNames(r.names), undefined, optionsWith(this.pins));
    const own = new Set(subtree(r.code, def));
    const e = info.errors.find((x) => own.has(x.id));
    if (e) throw new Error(e.message);
    const out: string[] = [];
    const names = baseNames(r.names);
    const rt = { print: (s: string) => out.push(s), names, world: this.world(out, "") };
    const ft = info.typeOf.get(def), t = ft?.t === "fn" ? ft.ret : ft;
    try {
      const v = withSteps(STEPS, () => showerFor(r.code, info, names)(runMain(r.code, info, def, rt)));
      return clip([...out, `= ${v} : ${t ? showIn(t, names, info.subst) : "?"}`]).join("\n");
    } catch (x) {
      if (x instanceof OutOfSteps) return clip([...out, `stopped: still running after ${STEPS.toLocaleString("en")} steps`]).join("\n");
      throw x;
    }
  }

  // ---------------------------------------------------------------- running

  // Run `main` (or another action), with the arguments and standard input
  // given; what it prints comes back, not to the server's own output.
  run(entry = "main", args: string[] = [], input = ""): string {
    const def = this.resolve(entry);
    const out: string[] = [];
    const t = this.info.typeOf.get(def);
    const problem = mainProblem(this.info, def, this.allNames);
    // main takes the arguments or nothing; anything else is called with nothing.
    const takesArgs = t?.t === "fn" && t.params.length === 1 && showType(this.info.subst.zonk(t.params[0]), this.allNames) === "List Text";
    if (t?.t === "fn" && t.params.length && !takesArgs) throw new Error(`${this.name(def)} takes inputs: use eval to call it`);
    const world = this.world(out, input);
    const rt = { print: (s: string) => out.push(s), names: this.allNames, world };
    let result: string;
    try {
      result = withSteps(STEPS, () => {
        // A page prints once, as static HTML (as ters run does).
        if (t?.t === "fn" && !pageProblem(this.info, def, this.allNames)) return `page, as text:\n${pageText(htmlText(runMain(this.code, this.info, def, { ...rt, cells: new Cells(equal) }), evaluatorCall))}`;
        if (!problem) return `exit ${runProgram(this.code, this.info, def, args, rt)}`;
        return `= ${showerFor(this.code, this.info, this.allNames)(runMain(this.code, this.info, def, rt))}`;
      });
    } catch (e) {
      if (!(e instanceof OutOfSteps) && !out.length) throw e;
      result = e instanceof OutOfSteps ? `stopped: still running after ${STEPS.toLocaleString("en")} steps` : `✗ ${(e as Error).message}`;
    }
    return clip([...out, result]).join("\n");
  }

  world(out: string[], input: string): World {
    const w = nodeWorld();
    let rest = input;
    return {
      ...w,
      error: (s) => out.push(`stderr: ${s}`),
      log: (s) => out.push(`log: ${s}`),
      input: () => { const all = rest; rest = ""; return all; },
      readLine: () => { if (!rest) return null; const i = rest.indexOf("\n"); const line = i < 0 ? rest : rest.slice(0, i); rest = i < 0 ? "" : rest.slice(i + 1); return line; },
    };
  }

  test(): string {
    if (this.info.errors.length) return this.errors();
    const saved = this.file ? savedFrom(this.file.examples ?? {}) : savedFrom(read(join(this.path, "examples.json"), {}));
    const out: string[] = [];
    const results = withSteps(STEPS, () => runTests(this.code, this.info, this.allNames, this.own, saved, { world: this.world(out, "") }));
    if (!results.length) return "no tests (a test is a definition that performs Check, or an accepted answer)";
    return results.flatMap((r) => r.error ? [`✗ ${r.name}: ${r.error}`]
      : !r.failures.length ? [`✓ ${r.name} (${r.cases})`]
      : r.failures.slice(0, 3).map((f) => `✗ ${r.name}(${f.inputs.join(", ")}): ${f.what.join("; ")}`)).join("\n");
  }
}

// The block standing for `id`: a line or a group.
function findBlk(bs: Blk[], id: Id): Blk[] | null {
  for (const b of bs) {
    if (b.id === id) return [b];
    if ("kids" in b) { const r = findBlk(b.kids, id); if (r) return r; }
    else if (hasPart(b.line, id)) return [b];
  }
  return null;
}
const hasPart = (ps: Piece[], id: Id): boolean => ps.some((p) => typeof p !== "string" && (p.id === id || hasPart(p.kids, id)));
const firstId = (bs: Blk[]): Id | undefined => {
  for (const b of bs) {
    if (b.id) return b.id;
    if ("kids" in b) { const r = firstId(b.kids); if (r) return r; }
    else { const p = b.line.find((x): x is Exclude<Piece, string> => typeof x !== "string" && !!x.id); if (p) return p.id; }
  }
  return undefined;
};
// A definition's first line is its own.
const lineDef = (ps: Piece[], code: Code): Id | undefined => {
  const p = ps.find((x): x is Exclude<Piece, string> => typeof x !== "string");
  return p?.id && code.nodes[p.id]?.kind === "def" ? p.id : undefined;
};

// A page's text, as a reader sees it: no styles, a line per block.
export function pageText(html: string): string {
  return html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<\/(p|div|h\d|li|tr|main|section|button)>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

// Long output is cut, keeping the end, where the answer is.
export function clip(lines: string[], max = 200, chars = 6000): string[] {
  const out = lines.length <= max ? lines : [`… ${lines.length - max} lines before`, ...lines.slice(-max)];
  const all = out.join("\n");
  return all.length <= chars ? out : [all.slice(0, chars), `… ${all.length - chars} more characters`];
}

// Text as an LLM copies it from view: ids dropped, operators as typed.
// Parts of a text split at `sep` outside brackets and quotes.
function topLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === sep && !depth) { out.push(text.slice(from, i).trim()); from = i + 1; }
  }
  out.push(text.slice(from).trim());
  return out;
}
// List patterns as matches on nil and cons, one item a level: at the k-th
// item, a pattern of k items ends there (nil), longer ones go on (cons),
// and a length no pattern has is the fallback. An item named alike by
// every pattern still going is the cons's field; else the field is
// `item k` and each pattern names it with a step.
function listMatch(on: string, k: number, alive: { names: string[]; body: string }[], fallback: string): string {
  const ends = alive.find((c) => c.names.length === k);
  const longer = alive.filter((c) => c.names.length > k);
  const block = (t: string) => t.split("\n").map((l) => "    " + l).join("\n");
  const nil = `  nil →\n${block(ends ? ends.body : fallback)}`;
  if (!longer.length) return `match ${on}\n${nil}\n  cons(item ${k + 1}, rest ${k + 1}) →\n${block(fallback)}`;
  const named = longer[0].names[k];
  const field = named !== "_" && longer.every((c) => c.names[k] === named) ? named : `item ${k + 1}`;
  const next = longer.map((c) => ({ names: c.names, body: c.names[k] === field || c.names[k] === "_" ? c.body : `${c.names[k]} = ${field}\n${c.body}` }));
  return `match ${on}\n${nil}\n  cons(${field}, rest ${k + 1}) →\n${block(listMatch(`rest ${k + 1}`, k + 1, next, fallback))}`;
}

// A case's body as its own text: the part on the case's line, and the
// lines under it at that part's indent, so steps on lines read there too.
function dedent(text: string): string {
  const [first, ...more] = text.split("\n");
  const lines = more.filter((l) => l.trim());
  const least = Math.min(...lines.map((l) => l.length - l.trimStart().length));
  return [first.trim(), ...lines.map((l) => l.slice(least))].filter((l, i) => i > 0 || l).join("\n").trim();
}

const norm = (s: string) => s.replace(/#[0-9a-v]{3,}\b/g, "").replace(/[‹›]/g, "").replace(/·/g, "*").replace(/−/g, "-").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/\s+/g, " ").trim();

// The editor's own check, which its gestures compare against.
const editorInfo = (code: Code, names: Names): Info => T.infer(code, { ...LIBRARY.names, ...names });

// The lines that changed, - before and + after, in order (a longest
// common subsequence of lines).
export function diff(a: string[], b: string[]): string {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out.join("\n");
}
