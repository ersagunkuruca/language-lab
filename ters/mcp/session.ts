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

import { keptIds } from "../src/keep-ids.ts";
import { showTypeWithUnits } from "../src/lang/unit-types.ts";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Code, Id, Node, NodeOf } from "../src/model.ts";
import { merge } from "../src/model.ts";
import { nodesOfKindIn, children, collect, freshId, parentLookup, parentOf, portNames, portsOf, scanningOnLayer, subtree, swapIn, isCall, type Call, type NodeData, copyNodes, dropNode, nodeIds, nodeValues, withNodes } from "../src/model.ts";
import { sameEverywhere, sharedPlaces } from "../src/lang/patterns.ts";
import type { Comments, Names, Presentation, Style } from "../src/presentation.ts";
import { root } from "../src/io.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { sameLines } from "../src/lang/modules.ts";
import { base, baseNames, optionsWith, programModules } from "../src/lang/load.ts";
import type { Module } from "../src/lang/modules.ts";
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
import { S, SIGS, TRUE } from "../src/lang/std.ts";
import { printSaved, readJsonFile, readSaved } from "../src/saved.ts";
import { setDisplayNames } from "../../editor/typed.ts";
import { addField, addParameter, addWay, deleteDefinition, nameClash, newDefinition, setWay, type Shape } from "../src/lang/toplevel.ts";
import { readCase, readType, typeNames, type Build } from "./type-text.ts";

// A saved folder read as ters reads it (load.ts): its number literals'
// digits read as values (saved.ts).
const read = <T>(path: string, fallback: T): T => (existsSync(path) ? readSaved(readJsonFile<T>(path, readFileSync(path, "utf8"))) : fallback);
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
  // The modules a folder uses (its `modules` folder, load.ts): their code
  // is under the program's as the library's is, their names under its
  // names and their pins under its pins, and none of it is saved with it.
  modules: Module[] = [];
  // The library and the modules: what isn't the program's own.
  under: Code = LIBRARY.code;
  private short = new Map<Id, string>();

  constructor(path: string) {
    this.path = resolve(path);
    if (!existsSync(this.path)) throw new Error(`no such program: ${path}`);
    if (statSync(this.path).isDirectory()) {
      this.title = basename(this.path);
      this.modules = programModules(this.path);
      const mine = read<Code>(join(this.path, "code.json"), { nodes: {}, defs: [] });
      if (this.modules.length) this.under = base(merge(...this.modules.map((m) => m.code)));
      this.code = base(this.modules.length ? merge(...this.modules.map((m) => m.code), mine) : mine);
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

  get allNames(): Names { return this.namesOver(this.names); }
  namesOver(names: Names): Names { return baseNames(...this.modules.map((m) => m.names), names); }
  get own(): Id[] { return this.code.defs.filter((d) => !this.under.nodes[d]); }
  // The pins the check reads: the modules' under the program's own.
  get checkPins(): Pins { return this.modules.length ? { ...Object.assign({}, ...this.modules.map((m) => m.pins)), ...this.pins } : this.pins; }

  recheck() {
    // The editor's gestures check with the same pins (typed.ts infer).
    T.setProgramPins(this.checkPins);
    // The editor's check, which keeps each definition group's check between
    // edits (check-cache.ts): an edit checks again what it changed and
    // what that reaches, not the whole program (I304).
    // An edit's own check, when it checked just this program, is the one.
    this.info = T.guardedInfo(this.code, this.checkPins) ?? T.infer(this.code, { ...LIBRARY.names, ...this.allNames });
    checked.set(this.code, this.info);
    // Shortest unique prefixes, over the program's own nodes.
    const ids = nodeIds(this.code.nodes).filter((id) => !this.under.nodes[id]).sort();
    this.short.clear();
    ids.forEach((id, i) => {
      const common = (o?: string) => { if (!o) return 0; let k = 0; while (k < id.length && id[k] === o[k]) k++; return k; };
      this.short.set(id, id.slice(0, Math.max(4, common(ids[i - 1]) + 1, common(ids[i + 1]) + 1)));
    });
  }

  save() {
    const mine = own(this.code, this.under);
    if (this.file) {
      writeFileSync(this.path, toFile({ ...this.file, code: this.code, names: this.names, comments: this.comments, signatures: this.pins }, LIBRARY.code));
      return;
    }
    const json = (x: unknown) => printSaved(x);
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
    const hash = /^\s*#/.test(ref);
    const r = ref.trim().replace(/^#/, "").replace(/^‹(.*)›$/, "$1");
    if (this.code.nodes[r]) return r;
    // A name before the start of an id, unless written #id: ids are
    // random, so a name like "top" is now and then the start of one.
    const byId = (): Id | undefined => {
      const hits = [...this.short.keys()].filter((id) => id.startsWith(r));
      if (r.length >= 3 && hits.length === 1) return hits[0];
      if (hits.length > 1 && r.length >= 3) throw new Error(`#${r} is ${hits.length} ids: ${hits.slice(0, 5).map((h) => this.id(h)).join(", ")}`);
    };
    const id = hash ? byId() : undefined;
    if (id) return id;
    const named = this.byName(r, within);
    if (named) return named;
    const late = hash ? undefined : byId();
    if (late) return late;
    throw new Error(`no id or definition ${ref}`);
  }

  private byName(r: string, within?: Id): Id | undefined {
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
  }

  // The definition a node belongs to.
  defOf(id: Id): Id | null {
    if (this.code.nodes[id]?.kind === "def") return id;
    // Up through the parents, looked up once per program (I304: a walk of
    // every definition's nodes was each edit's).
    if (!this.code.nodes[id]) return null;
    const code = this.code;
    let up = parents.get(code);
    if (!up) parents.set(code, (up = scanningOnLayer(code, () => parentLookup(code))));
    const defs = new Set(code.defs);
    let at: Id | undefined = id;
    while (at !== undefined && !defs.has(at)) at = up(at);
    return at ?? null;
  }

  pres(): Presentation {
    return { names: this.allNames, comments: { ...LIBRARY.comments, ...this.comments }, hints: {}, style: STYLE };
  }

  typeOf(id: Id): string {
    const t = this.info.typeOf.get(id);
    // With the units its signature shows (L252, known units only).
    return t ? showTypeWithUnits(this.code, id, t, this.allNames) : "(a type)";
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
    // A name several library definitions share (for each on a List and on
    // a Cell) lists each with its id, so one can be named (I230).
    const shared = new Set([...lib, ...builtins].map((d) => this.name(d)).filter((n, i, ns) => ns.indexOf(n) !== i));
    const idd = (d: Id, l: string) => (shared.has(this.name(d)) ? `${this.id(d)}  ${l}` : l);
    const all = [...lib.map((d) => idd(d, line(d))), ...builtins.map((b) => idd(b, sig(b)))];
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
    const gutter = (r: { id?: Id; text: string }) => (r.id && !this.under.nodes[r.id] && !r.text.includes(`#${this.id(r.id)}`) ? this.id(r.id) : "");
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
      if (!p.id || this.under.nodes[p.id]) return text;
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
    setDisplayNames(this.namesOver({}));
    const before = def ? this.viewLines(def) : [];
    const was = { code: this.code, names: this.names, comments: this.comments };
    const errs = this.info.errors.length;
    // Each other definition's type before, to say which the edit changed:
    // an answer that types one more narrowly than its callers pass gives
    // them a Choice, and the refusal came 30 definitions later (I377,
    // GAPS round 25 L5).
    const typed = new Map(this.own.filter((d) => d !== def).map((d) => [d, this.typeOf(d)]));
    const r = make();
    if (!r.ok) throw new Error(r.reason);
    // A body drawn once as the otherwise is a copy in each case it stands for.
    const same = share ? sameEverywhere(this.code, r.code, this.info) : { code: r.code, copied: [] as [Id, Id][] };
    const names = { ...r.names };
    for (const [x, y] of same.copied) if (names[x]) names[y] = names[x];
    // What the edit left unreached is dropped: only what it took out of a
    // node it changed can be (the program before was all reached), so
    // that is all that is looked at (I304: collect walked every node).
    this.code = dropUnreached(was.code, same.code);
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
    const moved = [...typed].filter(([d, t]) => this.code.nodes[d] && d !== at && this.typeOf(d) !== t).map(([d, t]) => `also ${this.name(d)} : ${this.typeOf(d)} (was ${t})`);
    const also = moved.length > 8 ? [...moved.slice(0, 8), `… ${moved.length - 8} more`] : moved;
    if (!at || !this.code.nodes[at]) return ["ok", ...also].join("\n");
    return [diff(at === def ? before : [], this.viewLines(at)) || "ok (nothing shown changed)", ...also].join("\n");
  }
  private infoHad(was: { code: Code }, id: Id): boolean { return !!was.code.nodes[id]; }
  // A definition's lines, kept per program: an edit's are the next one's
  // lines before (I304).
  private viewLines(def: Id): string[] {
    let m = viewed.get(this.code);
    if (!m) viewed.set(this.code, (m = new Map()));
    let v = m.get(def);
    if (!v) m.set(def, (v = this.view(def, 99).split("\n")));
    return v;
  }

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
    // The whole text written, which a question a part of it raises may
    // look at (a tuple's size, by the fields read on it, I303).
    if (this.reading !== null) return this.fillIn(code, names, hole, text, def, as);
    this.reading = text;
    try { return this.fillIn(code, names, hole, text, def, as); } finally { this.reading = null; }
  }
  private reading: string | null = null;

  private fillIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    // A record taken apart by a step written before `;`, `reading(called,
    // place) = nearest step(…); □`, is the step on a line of its own
    // (I343: it was read as a value, "nothing is named place here"); so is
    // any step before `;` with lines after it, `k = 2; match xs` and the
    // match's cases on the lines below (I318).
    const semi = firstSemicolon(text);
    const head = semi > 0 ? text.slice(0, semi) : "";
    const apart = /^\s*[\p{L}_][\p{L}\p{N}_' ]*?\s*\([^()]*\)\s*=(?![=>])/u.test(head);
    const step = /^\s*[\p{L}_][\p{L}\p{N}_' ]*?\s*=(?![=>])/u.test(head);
    if (semi > 0 && !head.includes("\n") && (apart || (step && text.slice(semi + 1).includes("\n")))) return this.fillIn(code, names, hole, `${head.trim()}\n${text.slice(semi + 1).replace(/^[ \t]+/, "")}`, def, as);
    const steps = this.stepsIn(code, names, hole, text, def, as);
    if (steps) return steps;
    if (/^\s*match\s/.test(text)) return this.matchIn(code, names, hole, text, def, as);
    if (/^\s*handle\s/.test(text)) return this.handleIn(code, names, hole, text, def, as);
    if (/^\s*fold\s/.test(text)) return this.foldIn(code, names, hole, text, def, as);
    const block = this.blockIn(code, names, hole, text, def, as);
    if (block) return block;
    const solve = this.solveIn(code, names, hole, text);
    if (!solve) return this.fillOne(code, names, hole, text, def, as);
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: solve.code, names };
    for (const [h, t] of solve.fills) {
      if (!cur.ok) return cur;
      cur = this.fillOne(cur.code, cur.names, h, t, def, as);
    }
    return cur;
  }

  private fillOne(code: Code, names: Names, hole: Id, t: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    // An implementation's field left to the interface's ways (WAYS.md):
    // the editor's text reader doesn't take it (I183), so it is put in
    // here; the checker says if no way grounds it.
    if (norm(t) === "by its ways") return { ok: true, names, code: { nodes: withNodes(code.nodes, { [hole]: { id: hole, kind: "ref", target: S.byItsWays } }), defs: code.defs } };
    const nested = this.nestedIn(code, names, hole, t, def, as);
    if (nested) return nested;
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
      const pick = want.length ? (exact.length === 1 ? exact[0] : fits.length === 1 ? fits[0] : undefined) : r.choices[this.byFieldsRead(code, names, labels.map(typesIn)) ?? -1];
      if (pick?.edit.ok) return pick.edit;
      return { ok: false, reason: `${t.trim()} reads ${labels.map((l) => `as ${l}`).join(" or ")}: a field or a function more than one type has, on a value whose type nothing settles yet. Give \`as\` (${labels.map((l) => JSON.stringify(l.replace(/^an?\s+/i, ""))).join(" or ")}), or settle the type first` };
    }
    if (r.ok || r.reason !== "a name alone is listed already") return r;
    // A name alone, which the editor's palette lists: the nearest in
    // scope (a case's field bound in its arm, I184), else a definition.
    const all = this.namesOver(names);
    const near = T.scopeAt(code, def, hole).filter((b) => all[b] === norm(t)).at(-1)
      ?? code.defs.find((d) => all[d] === norm(t) && !LIBRARY.code.nodes[d]) ?? code.defs.find((d) => all[d] === norm(t));
    if (!near) return r;
    return { ok: true, names, code: { nodes: withNodes(code.nodes, { [hole]: { id: hole, kind: "ref", target: near } }), defs: code.defs } };
  }

  // A match where a value goes, not only where a line or a case's body
  // begins (I303): in parentheses, `a + (match r; nil → 1; cons(c, s) → c)`,
  // or after `else`, `if b then 0 else match xs` with its cases on the
  // lines after. The text around is read as a function of each such match
  // called on a hole, so that each hole is known by its place, `((m1) =>
  // a + m1)(□)`; the function is then taken away, each hole put where its
  // name was, and each match read into its hole as text of its own. Null
  // when the text has no such match.
  private nestedIn(code: Code, names: Names, hole: Id, t: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } | null {
    const groups = nestedMatches(t);
    if (!groups.length) return null;
    if (groups.length === 1 && !t.slice(0, groups[0].from).trim() && !t.slice(groups[0].to).trim()) return this.fill(code, names, hole, groups[0].text, def, as);
    const taken = new Set(Object.values(this.namesOver(names)));
    const params: string[] = [];
    for (let i = 1; params.length < groups.length; i++) if (!taken.has(`nested match ${i}`)) params.push(`nested match ${i}`);
    let around = t;
    for (let i = groups.length - 1; i >= 0; i--) around = around.slice(0, groups[i].from) + `(${params[i]})` + around.slice(groups[i].to);
    // One function a match, each called on its hole: `((m1) => ((m2) =>
    // m1 * m2)(□))(□)`.
    const wrapped = params.reduceRight((body, p) => `((${p}) => ${body})(□)`, around.trim());
    const r = this.fillOne(code, names, hole, wrapped, def, as);
    if (!r.ok) return r;
    const nodes = copyNodes(r.code.nodes), out: Names = { ...r.names };
    const bound: Id[] = [];
    for (const _ of groups) {
      const call = nodes[hole], fn = isCall(call) ? nodes[call.fn] : undefined;
      if (!isCall(call) || fn?.kind !== "lambda" || fn.params.length !== 1 || call.args.length !== 1) return { ok: false, reason: `${t.trim()} doesn't read with its matches taken out` };
      bound.push(fn.params[0]);
      nodes[hole] = { ...nodes[fn.body], id: hole } as Node;
      for (const x of [fn.body, fn.id, ...call.args]) dropNode(nodes, x);
    }
    const inside = subtree({ nodes, defs: r.code.defs }, hole);
    const slots: Id[] = [];
    for (const p of bound) {
      const uses = inside.filter((x) => { const n = nodes[x]; return n?.kind === "ref" && n.target === p; });
      if (uses.length !== 1) return { ok: false, reason: `${t.trim()} doesn't read with its matches taken out` };
      nodes[uses[0]] = { id: uses[0], kind: "hole" } as Node;
      slots.push(uses[0]);
      dropNode(nodes, p); delete out[p];
    }
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: { nodes, defs: r.code.defs }, names: out };
    for (const [i, g] of groups.entries()) {
      if (!cur.ok) return cur;
      cur = this.fill(cur.code, cur.names, slots[i], g.text, def, as);
    }
    return cur;
  }

  // A field's reading asked of a value nothing has settled, settled by the
  // other fields the text reads (I303): `p.first` read with `p.third` is a
  // tuple of three, not two. Of tuples that all have them, the fewest
  // fields, as a tuple's size is its last field read; any other choice
  // still left open is asked.
  private byFieldsRead(code: Code, names: Names, types: string[][]): number | undefined {
    const all = this.namesOver(names);
    const read = new Set([...(this.reading ?? "").matchAll(/\.\s*([\p{L}_][\p{L}\p{N}_']*)/gu)].map((m) => m[1].toLowerCase()));
    const fieldsOf = (type: string): Set<string> | undefined => {
      const d = code.defs.find((x) => (all[x] ?? "").toLowerCase() === type);
      const td = d ? code.nodes[(code.nodes[d] as NodeOf<"def">).body!] : undefined;
      if (td?.kind !== "typedef") return undefined;
      return new Set(td.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant">).fields.map((f) => (all[f] ?? "").toLowerCase())));
    };
    const sets = types.map((ts) => ts.length === 1 ? fieldsOf(ts[0]) : undefined);
    if (sets.some((x) => !x)) return undefined;
    const known = new Set(sets.flatMap((x) => [...x!]));
    const wanted = [...read].filter((f) => known.has(f));
    const fit = types.map((_, i) => ({ i })).filter(({ i }) => wanted.every((f) => sets[i]!.has(f)));
    if (fit.length === 1) return fit[0].i;
    const size = (i: number) => /^tuple(\d+)$/.exec(types[i][0])?.[1];
    if (!wanted.length || !fit.length || fit.some(({ i }) => !size(i))) return undefined;
    return fit.reduce((a, b) => Number(size(b.i)) < Number(size(a.i)) ? b : a).i;
  }

  // A function whose body is on the lines after its `=>`, deeper than
  // the line it starts on (I228), as the view prints one:
  //   all(() =>
  //     a = one of(range from(1, 21))
  //     b = one of(range from(a + 1, 21))
  //     [a, b])
  // The text around it is read with the body a hole, then the body into
  // that hole as text of its own (steps, a match, ...), so its steps bind
  // and the reader never sees them. A closing bracket at the body's end
  // that the body doesn't open is the text around it's. Null when no line
  // ends in `=>` with deeper lines after it.
  private blockIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } | null {
    const lines = text.replace(/^\s*\n/, "").split("\n");
    const indent = (l: string) => l.length - l.trimStart().length;
    const at = lines.findIndex((l, i) => /=>\s*$/.test(l) && lines.slice(i + 1).find((m) => m.trim()) !== undefined && indent(lines.slice(i + 1).find((m) => m.trim())!) > indent(l));
    if (at < 0) return null;
    let end = at + 1;
    while (end < lines.length && (!lines[end].trim() || indent(lines[end]) > indent(lines[at]))) end++;
    let body = lines.slice(at + 1, end).join("\n").replace(/\s+$/, "");
    // The brackets the body closes without opening, from its end.
    let depth = 0, inText = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"') inText = !inText;
      else if (!inText && "([{".includes(c)) depth++;
      else if (!inText && ")]}".includes(c)) depth--;
    }
    let closers = "";
    while (depth < 0 && /[)\]}]\s*$/.test(body)) { body = body.replace(/\s*$/, ""); closers = body.slice(-1) + closers; body = body.slice(0, -1); depth++; }
    const around = [...lines.slice(0, at), `${lines[at].replace(/\s*$/, "")} □${closers}`, ...lines.slice(end)].join("\n");
    const before = new Set(nodeIds(code.nodes));
    const r = this.fill(code, names, hole, around, def, as);
    if (!r.ok) return r;
    // The new hole that is a function's body: where the body goes.
    const inside = subtree(r.code, hole).filter((x) => !before.has(x) || x === hole);
    const bodies = inside.filter((x) => { const n = r.code.nodes[x]; return n?.kind === "lambda" && r.code.nodes[n.body]?.kind === "hole" && !before.has(n.body); }).map((x) => (r.code.nodes[x] as NodeOf<"lambda">).body);
    if (bodies.length !== 1) return { ok: false, reason: `${lines[at].trim()} doesn't read as a function whose body is on the lines after it` };
    return this.fill(r.code, r.names, bodies[0], dedent(body), def, as);
  }

  // Steps on lines of their own, as the view prints a let (I217 M5):
  //   c = cost(shift)
  //   k = c * 2
  //   k + 1
  // each step read as `c = …; □`, and the lines after it into that hole,
  // so the last may be a match on lines (`ds = …` then `match ds`, M4).
  // Null when the text isn't steps: one line, or a first line that isn't
  // `name = value` with more at its indent.
  private stepsIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } | null {
    const lines = text.replace(/^\s*\n/, "").split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    const indent = (l: string) => l.length - l.trimStart().length;
    const top = indent(lines[0]);
    const next = lines.findIndex((l, i) => i > 0 && indent(l) <= top);
    if (next < 0) return null;
    const after = lines.slice(next).map((l) => l.slice(Math.min(top, indent(l)))).join("\n");
    // `tuple(a, b) = e` (M6): a match on e with its one case, the lines
    // after it that case's value.
    const parts = /^([\p{L}_][\p{L}\p{N}_' ]*?)\s*\(([^()]*)\)\s*=(?![=>])\s*(\S[\s\S]*)$/u.exec(lines[0].trim());
    if (parts) return this.fill(code, names, hole, `match ${[parts[3], ...lines.slice(1, next).map((l) => l.trim())].join(" ")}\n  ${parts[1]}(${parts[2]}) →\n${after.split("\n").map((l) => "    " + l).join("\n")}`, def, as);
    const step = /^([\p{L}_][\p{L}\p{N}_' ]*?)\s*=(?![=>])\s*(\S[\s\S]*)$/u.exec(lines[0].trim());
    // A case's lines (`nil → 1`, a match's cases written at its own
    // indent) are the match's to read, not steps.
    const arm = (l: string) => / → |→$/.test(l.trim().replace(/"(?:[^"\\]|\\.)*"/g, '""'));
    if (!step) return arm(lines[0]) || arm(lines[next]) ? null : this.bareStep(code, names, hole, lines.slice(0, next).map((l) => l.slice(Math.min(top, indent(l)))).join("\n"), after, def, as);
    // The step's value may go on over deeper lines.
    const value = [step[2], ...lines.slice(1, next).map((l) => l.trim())].join(" ");
    const r = this.fillOne(code, names, hole, `${step[1]} = ${value}; □`, def, as);
    if (!r.ok) return r;
    const call = r.code.nodes[hole], fn = isCall(call) ? r.code.nodes[call.fn] : undefined;
    if (fn?.kind !== "lambda" || r.code.nodes[fn.body]?.kind !== "hole") return { ok: false, reason: `${step[1]} = ${value} doesn't read as a step` };
    return this.fill(r.code, r.names, fn.body, after, def, as);
  }

  // A step whose value isn't named, as the view prints one: a print, or a
  // match over deeper lines with steps after it (I260, round 16's M1),
  //   match cs
  //     nil → print("none")
  //     cons(c, more) → print(c)
  //   length(cs)
  // read as `□; □`, the step's lines into the first hole and the lines
  // after it into the second. A first line that is a match's, a fold's or
  // a handler's alone is that, when nothing comes after it.
  private bareStep(code: Code, names: Names, hole: Id, value: string, after: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const r = this.fillOne(code, names, hole, "□; □", def, as);
    if (!r.ok) return r;
    // `a; b` is b in a function of a nothing reads, called on a.
    const call = r.code.nodes[hole], fn = isCall(call) ? r.code.nodes[call.fn] : undefined;
    if (!isCall(call) || fn?.kind !== "lambda" || r.code.nodes[call.args[0]]?.kind !== "hole" || r.code.nodes[fn.body]?.kind !== "hole") return { ok: false, reason: `${value.split("\n")[0].trim()} doesn't read as a step` };
    const first = this.fill(r.code, r.names, call.args[0], value, def, as);
    if (!first.ok) return first;
    return this.fill(first.code, first.names, fn.body, after, def, as);
  }

  // A fold as the view prints it (I218 M12), a case a line or after `;`s,
  // each recursive field's folded value named after `with`:
  //   fold xs
  //     nil → 0
  //     cons(head, tail) with total → head + total
  // Every case of the type is written (a fold has no otherwise); a
  // recursive field with no name after `with` isn't folded there.
  private foldIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const { head, cases } = casesOf(text, "fold");
    const all = this.namesOver(names);
    const read = cases.map((c) => /^(.+?)\s*(?:\(([^)]*)\))?\s*(?:with\s+([^→]+?))?\s*(?:→|->)\s*([\s\S]*)$/.exec(c.trim()));
    const bad = read.findIndex((k) => !k);
    if (bad >= 0) return { ok: false, reason: `a fold's case reads Case(fields) with folded → value, not ${cases[bad].trim()}` };
    const written = read.map((k) => norm(k![1]));
    const types = code.defs.filter((d) => {
      const b = (code.nodes[d] as NodeOf<"def"> | undefined)?.body, td = b ? code.nodes[b] : undefined;
      return td?.kind === "typedef" && !td.effect && td.variants.length === written.length && written.every((w) => td.variants.some((v) => norm(all[v] ?? "") === w));
    });
    const type = types.length === 1 ? types[0] : types.find((d) => !LIBRARY.code.nodes[d]);
    if (!type) return { ok: false, reason: `no data type has just the cases ${written.join(", ")}: a fold writes every case` };
    const td = code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;
    const self = new Set([type, td.id]);
    const nodes = copyNodes(code.nodes), out: Names = { ...names };
    const add = (n: Record<string, unknown>): Id => { const id = freshId(); nodes[id] = { id, ...n } as never; return id; };
    const fills: [Id, string][] = [];
    const scrutinee = add({ kind: "hole" });
    fills.push([scrutinee, head]);
    const arms: Id[] = [];
    for (const k of read as RegExpExecArray[]) {
      const variant = td.variants.find((v) => norm(all[v] ?? "") === norm(k[1]))!;
      const vf = (code.nodes[variant] as NodeOf<"variant">).fields;
      const fields = k[2]?.trim() ? k[2].split(",").map(norm) : [];
      if (fields.length && fields.length !== vf.length) return { ok: false, reason: `${norm(k[1])} has ${vf.length} field${vf.length === 1 ? "" : "s"}, not ${fields.length}` };
      const recursive = vf.map((f) => { const t = code.nodes[(code.nodes[f] as NodeOf<"field">).type]; return t?.kind === "tref" && self.has(t.target); });
      const folded = k[3]?.trim() ? k[3].split(",").map(norm) : [];
      if (folded.length > recursive.filter(Boolean).length) return { ok: false, reason: `${norm(k[1])} has ${recursive.filter(Boolean).length} field${recursive.filter(Boolean).length === 1 ? "" : "s"} to fold, not ${folded.length}` };
      const binds = vf.map((_, i) => { const b = add({ kind: "binder" }); out[b] = fields[i] ?? `field ${i + 1}`; return b; });
      let r = 0;
      const results = recursive.map((rec) => { if (!rec || r >= folded.length) return null; const b = add({ kind: "binder" }); out[b] = folded[r++]; return b; });
      const at = add({ kind: "hole" });
      fills.push([at, dedent(k[4])]);
      arms.push(add({ kind: "arm", variant, binds, results, body: at }));
    }
    nodes[hole] = { id: hole, kind: "fold", scrutinee, arms } as NodeOf<"fold">;
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: { nodes, defs: code.defs }, names: out };
    for (const [h, t] of fills) {
      if (!cur.ok) return cur;
      if (t && t !== "□" && t !== "?") cur = this.fill(cur.code, cur.names, h, t.replace(/[‹›]/g, ""), def, as);
    }
    return cur;
  }

  // A handler as the view prints it (I217 M7), its cases an effect's
  // operations, one a line or after `;`s:
  //   handle check(n)
  //     abort(reason) → 0
  //     otherwise → (v) => v + 1
  // The otherwise, when written, is what the value is given to when the
  // body asks nothing.
  private handleIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const { head, cases } = casesOf(text, "handle");
    const all = this.namesOver(names);
    const ops = new Map<string, NodeOf<"variant">>();
    for (const n of nodesOfKindIn(code.nodes, "typedef")) if (n.kind === "typedef" && n.effect) for (const v of n.variants) { const op = code.nodes[v]; if (op?.kind === "variant" && all[v] && !ops.has(norm(all[v]))) ops.set(norm(all[v]), op); }
    const nodes = copyNodes(code.nodes), out: Names = { ...names };
    const add = (n: Record<string, unknown>): Id => { const id = freshId(); nodes[id] = { id, ...n } as never; return id; };
    const fills: [Id, string][] = [];
    const scrutinee = add({ kind: "hole" });
    fills.push([scrutinee, head]);
    const arms: Id[] = [];
    let otherwise: Id | null = null;
    for (const c of cases) {
      const k = /^(.+?)\s*(?:\(([^)]*)\))?\s*(?:→|->)\s*([\s\S]*)$/.exec(c.trim());
      if (!k) return { ok: false, reason: `a handler's case reads operation(fields) → value, not ${c.trim()}` };
      const body = dedent(k[3]);
      if (norm(k[1]) === "otherwise") { otherwise = add({ kind: "hole" }); fills.push([otherwise, body]); continue; }
      const op = ops.get(norm(k[1]));
      if (!op) return { ok: false, reason: `no effect has an operation ${norm(k[1])}` };
      const fields = k[2]?.trim() ? k[2].split(",").map(norm) : [];
      if (fields.length !== op.fields.length && !(op.later && fields.length === op.fields.length + 1)) return { ok: false, reason: `${norm(k[1])} has ${op.fields.length} field${op.fields.length === 1 ? "" : "s"}, not ${fields.length}` };
      const binds = fields.map((f) => { const b = add({ kind: "binder" }); out[b] = f; return b; });
      const at = add({ kind: "hole" });
      fills.push([at, body]);
      arms.push(add({ kind: "arm", variant: op.id, binds, results: binds.map(() => null), body: at }));
    }
    if (!arms.length) return { ok: false, reason: "a handler needs a case for an operation" };
    nodes[hole] = { id: hole, kind: "match", scrutinee, arms, otherwise } as NodeOf<"match">;
    let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: { nodes, defs: code.defs }, names: out };
    for (const [h, t] of fills) {
      if (!cur.ok) return cur;
      if (t && t !== "□" && t !== "?") cur = this.fill(cur.code, cur.names, h, t.replace(/[‹›]/g, ""), def, as);
    }
    return cur;
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
  private matchIn(code: Code, names: Names, hole: Id, text: string, def: Id, as?: string): { ok: true; code: Code; names: Names } | { ok: false; reason: string } {
    const { head, cases } = casesOf(text, "match");
    const all = this.namesOver(names);
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
      return this.fill(code, names, hole, `${name} = ${head}\nmatch ${name}\n${cases.map((c) => "  " + c.replace(/\n/g, "\n  ")).join("\n")}`, def, as);
    }
    // Patterns inside patterns (L290b): `cons("-", rest) → …`,
    // `["-", ">", ..rest] → …`, `pair(0, y) → …`: read as the nested
    // matches they stand for, a case's value or case on a field a match on
    // that field (patterns.ts reads them back as these rows).
    const nested = nestedPatterns(on, cases);
    if (typeof nested === "string") return this.fill(code, names, hole, nested, def, as);
    if (nested) return nested;
    // List patterns (M2): `[a, b] → …`, `[] → …`, with `otherwise →` for
    // the lengths not written, read as the matches on nil and cons they
    // stand for.
    const lists = cases.map((c) => /^\[([^\]]*)\]\s*(?:→|->)\s*([\s\S]*)$/.exec(c.trim()));
    if (lists.some(Boolean)) {
      const other = cases.find((c) => /^otherwise\s*(?:→|->)/.test(c.trim()));
      const bad = cases.find((c, i) => !lists[i] && c !== other);
      if (bad) return { ok: false, reason: `with list patterns, the other cases are otherwise, not ${bad.trim()}` };
      const fallback = other ? dedent(other.trim().replace(/^otherwise\s*(?:→|->)/, "")) || "□" : "□";
      const written: ListCase[] = [];
      for (const k of lists) {
        if (!k) continue;
        const items = k[1].trim() ? k[1].split(",").map((x) => x.trim()) : [];
        // `..more` last: the rest of the list, however long (I340: read as
        // a fourth item, `[before, at, after, ..more]` matched four items).
        const at = items.findIndex((x) => x.startsWith(".."));
        if (at >= 0 && at !== items.length - 1) return { ok: false, reason: `a list pattern's rest, ${items[at]}, comes last` };
        const rest = at >= 0 ? items.pop()!.slice(2).trim() || "_" : undefined;
        written.push({ names: items, rest, body: dedent(k[2]) || "□" });
      }
      return this.fill(code, names, hole, listMatch(head, 0, written, fallback), def, as);
    }
    // A match on values (L164c): `"+" → …`, `3 → …`, then `otherwise →`.
    const byValue = cases.map((c) => /^("(?:[^"\\]|\\.)*"|[−-]?\d[\d.]*(?:e[+-]?\d+)?)\s*(?:→|->)\s*([\s\S]*)$/i.exec(c.trim()));
    if (byValue.some(Boolean)) {
      const other = cases.filter((c) => /^otherwise\s*(?:→|->)/.test(c.trim()));
      if (other.length > 1) return { ok: false, reason: "otherwise is written twice" };
      const bad = cases.find((c, i) => !byValue[i] && !other.includes(c));
      if (bad) return { ok: false, reason: `a match on values has a value or otherwise before each →, not ${bad.trim()}` };
      const written = byValue.filter((k): k is RegExpExecArray => !!k);
      const split = T.splitOnValues(code, names, editorInfo(code, names), hole, binder, written.map((k) => k[1]));
      if (!split.ok) return split;
      const m = split.code.nodes[hole] as NodeOf<"match">;
      let cur: { ok: true; code: Code; names: Names } | { ok: false; reason: string } = { ok: true, code: split.code, names: { ...split.names } };
      const bodies = [...written.map((k, i) => [(split.code.nodes[m.arms[i]] as NodeOf<"arm">).body, dedent(k[2])] as const), [m.otherwise!, other[0] ? dedent(other[0].trim().replace(/^otherwise\s*(?:→|->)/, "")) : ""] as const];
      for (const [at, body] of bodies) {
        if (!cur.ok) return cur;
        // Each case is a copy of the hole the match went into.
        if (body && body !== "□" && body !== "?") cur = this.fill(cur.code, cur.names, at, body.replace(/[‹›]/g, ""), def, as);
      }
      return cur;
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
    const of = types.length === 1 ? types[0] : types.find((d) => !LIBRARY.code.nodes[d]);
    const split = T.splitOn(code, names, editorInfo(code, names), hole, binder, of);
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
      if (body && body !== "□" && body !== "?") cur = this.fill(cur.code, cur.names, arm.body, body.replace(/[‹›]/g, ""), def, as);
    }
    const rest = otherwise[0] && dedent(otherwise[0][3]);
    if (rest && rest !== "□" && rest !== "?") for (const arm of arms) if (!seen.has(arm.id)) {
      if (!cur.ok) return cur;
      cur = this.fill(cur.code, cur.names, arm.body, rest.replace(/[‹›]/g, ""), def, as);
    }
    return cur;
  }

  private solveIn(code: Code, names: Names, hole: Id, text: string): { code: Code; fills: [Id, string][] } | null {
    const m = /^\s*(.+?)\s*\((.*)\)\s*$/s.exec(text);
    if (!m || !/=/.test(m[2])) return null;
    const all = this.namesOver(names);
    const head = norm(m[1]);
    // A field with ports of the program's (an interface's operation), else a
    // definition with results.
    const fields = nodesOfKindIn(code.nodes, "field").filter((n) => n.kind === "field" && !!portNames(code.nodes, n)?.length && all[n.id] === head);
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
    const nodes = copyNodes(code.nodes);
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
      // A case by its name, or in a match on values by its value (L164c).
      const caseText = (a: NodeOf<"arm">) => (a.value ? JSON.stringify((this.code.nodes[a.value] as NodeOf<"lit">).value) : this.name(a.variant));
      const wanted = T.valueLiteral(kase);
      const arm = m.arms.map((a) => this.code.nodes[a] as NodeOf<"arm">).find((a) => (a.value ? !!wanted && (this.code.nodes[a.value] as NodeOf<"lit">).value === wanted.value : this.name(a.variant) === kase.trim()));
      if (!arm) throw new Error(`no case ${kase}: ${m.arms.map((a) => caseText(this.code.nodes[a] as NodeOf<"arm">)).join(", ")}`);
      target = arm.body;
    }
    // An arm (an if's then or else line, a case of a match) is replaced by
    // what follows it, its body: put in the arm's place, an expression
    // left a match with an arm of no case, and the check crashed (mnist's
    // else line given an if).
    let t = text.trim();
    const arm = this.code.nodes[target];
    if (arm?.kind === "arm") { target = arm.body; t = t.replace(/^(then|else)\s+/, ""); }
    // An else if of a chain is shown on a line of its own, `else if …`
    // (E322): that line is the inner if's, and its else is the arm's word.
    else if (/^else\s/.test(t) && this.code.nodes[parentOf(this.code, target)?.parent ?? ""]?.kind === "arm") t = t.replace(/^else\s+/, "");
    const def = this.defOf(target);
    if (!def || target === def) throw new Error("replace a part of a definition, not the definition");
    return this.apply(def, () => {
      const info = editorInfo(this.code, this.names);
      // A hole is filled as it is (I304: making it a hole again checked
      // the program once more).
      const holed = this.code.nodes[target]?.kind === "hole" ? { ok: true as const, code: this.code, names: this.names } : T.toHole(this.code, this.names, info, target);
      if (!holed.ok || t === "□" || t === "?" || t === "") return holed;
      const r = this.fill(holed.code, holed.names, target, t, def, as);
      // What reads as it did keeps its ids (keep-ids.ts, I266).
      return r.ok ? { ok: true as const, ...keptIds(this.code, r.code, r.names, target) } : r;
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
    // `program` is the program's own comment, a line each, which the
    // editor shows in the Program tab and above the picture (credits go
    // there, CREDITS.md "How to credit").
    const id = at === "program" ? "program" : this.resolve(at);
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
    if (this.code.nodes[def]?.kind !== "def" || this.under.nodes[def]) throw new Error("pin takes one of the program's definitions");
    const was = { code: this.code, names: this.names, comments: this.comments, pins: this.pins };
    const pins = { ...this.pins };
    if (off) delete pins[def];
    else { const p = pinsOf(this.info, [def], this.code)[def]; if (!p) throw new Error(`${this.name(def)} has no type to pin`); pins[def] = p; }
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

  // A let `name = value` just before the step `at` is in (or at the top of
  // the body): before a let, before that let; at a hole after the steps,
  // after them, so a sequence is built top-down, each step naming the ones
  // before it (I229). Inside a function given as a value, all(() => □),
  // the step goes inside it, where its effects are handled.
  step(at: string, name: string, value: string): string {
    const before = this.resolve(at);
    const def = this.defOf(before);
    if (!def) throw new Error(`#${this.id(before)} isn't in a definition`);
    return this.apply(def, () => {
      const info = editorInfo(this.code, this.names);
      const r = before === def ? T.addStep(this.code, this.names, info, def) : this.stepBefore(info, def, before);
      if (!r.ok || !r.dot) return r.ok ? { ok: false, reason: "no step added" } : r;
      const names = { ...r.names, [r.dot]: name.trim() || "_" };
      const let_ = nodeValues(r.code.nodes).find((n): n is Call => isCall(n) && (r.code.nodes[n.fn] as { params?: Id[] }).params?.[0] === r.dot)!;
      const hole = let_.args[0];
      if (!value.trim()) return { ok: true, code: r.code, names };
      return this.fill(r.code, names, hole, value, def);
    });
  }

  // The let goes around the innermost body holding `part`: a function's,
  // a let's (the steps after it), a case's, the definition's.
  private stepBefore(info: Info, def: Id, part: Id): ReturnType<typeof T.addStep> {
    const code = this.code;
    if (!subtree(code, def).includes(part)) return { ok: false, reason: "a step goes before a value of this definition" };
    let at = part;
    for (let up = parentOf(code, at); up && up.parent !== def && up.slot !== "body" && up.slot !== "otherwise"; up = parentOf(code, at)) at = up.parent;
    const n = code.nodes[at];
    if (!n || n.kind === "def" || n.kind === "typedef" || n.kind === "arm") return { ok: false, reason: "a step goes before a value of this definition" };
    const dot = freshId(), hole = freshId(), lam = freshId(), let_ = freshId();
    const next = swapIn(code, at, let_);
    next.nodes[dot] = { id: dot, kind: "binder" };
    next.nodes[hole] = { id: hole, kind: "hole" };
    next.nodes[lam] = { id: lam, kind: "lambda", params: [dot], body: at };
    next.nodes[let_] = { id: let_, kind: "call", fn: lam, args: [hole] };
    const r = T.guardTyped(info, next, this.names, hole, "Added a step.");
    return r.ok ? { ...r, dot } : r;
  }

  // Replace a part by a match on a variable, one case per variant, each a copy.
  // `as`: the type to split by, where nothing fixes the variable's yet
  // (I116 in the editor, I184 here): the split fixes it.
  split(at: string, on: string, find?: string, as?: string, values?: string[]): string {
    const target = this.part(at, find);
    const def = this.defOf(target);
    if (!def) throw new Error(`#${this.id(target)} isn't in a definition`);
    const v = this.resolve(on, def);
    // By the values given (L164c): a case per value, then otherwise.
    if (values?.length) return this.apply(def, () => T.splitOnValues(this.code, this.names, editorInfo(this.code, this.names), target, v, values));
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
    const shape: Shape = kind === "function" ? { kind, params } : kind === "value" ? { kind } : kind === "type" ? { kind, firstCase: firstName, params } : kind === "effect" ? { kind, firstOperation: first } : kind === "interface" ? { kind, firstOperation: firstName } : (() => { throw new Error("kind: function, value, type, effect or interface"); })();
    return this.apply(null, () => {
      const r = newDefinition(this.code, this.names, name, shape);
      if (!r.ok) return r;
      const def = r.code.defs.at(-1)!;
      const td = r.code.nodes[(r.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
      if (kase) return this.withFields(this.withOwn(r, def, td.variants[0], kase.own), def, td.variants[0], kase.fields);
      if (op?.[2]) {
        const v = r.code.nodes[td.variants[0]] as NodeOf<"variant">;
        const nodes = copyNodes(r.code.nodes);
        const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as NodeOf<"hole">; return id; };
        const f = v.fields[0];
        nodes[f] = { ...(nodes[f] as NodeOf<"field">), type: this.typeIn(op[2], r.code, r.names, def)(add) };
        return { ...r, code: collect({ nodes, defs: r.code.defs }) };
      }
      return r;
    }, (c) => c.defs.at(-1)!);
  }

  // A case's own type variables and what each has (L256): `where a has
  // Appliance`, binders on the case and the types `Appliance a`.
  private withOwn(r: { ok: true; code: Code; names: Names }, type: Id, variant: Id, own: [string, string[]][]): { ok: true; code: Code; names: Names } {
    if (!own.length) return r;
    const nodes = copyNodes(r.code.nodes), names = { ...r.names };
    const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as NodeOf<"hole">; return id; };
    const known = typeNames(r.code, this.namesOver(r.names), r.code.defs.filter((d) => !this.under.nodes[d]));
    const params: Id[] = [], has: Id[] = [];
    for (const [a, ifaces] of own) {
      const p = add({ kind: "binder" });
      names[p] = a;
      params.push(p);
      for (const i of ifaces) {
        const iface = readType(i, known, new Map())(add);
        const t = nodes[iface] as NodeOf<"tref">;
        if (t?.kind !== "tref") throw new Error(`${i} isn't an interface`);
        nodes[iface] = { ...t, args: [add({ kind: "tref", target: p, args: [] })] };
        has.push(iface);
      }
    }
    nodes[variant] = { ...(nodes[variant] as NodeOf<"variant">), params, has };
    return { ok: true, code: { nodes, defs: r.code.defs }, names };
  }

  // Type text read in this program, with a type's own parameters by name,
  // and its cases' own (L256).
  private typeIn(text: string, code: Code, names: Names, type?: Id): Build {
    const all = this.namesOver(names);
    const td = type ? code.nodes[(code.nodes[type] as NodeOf<"def">).body ?? ""] : undefined;
    const own = td?.kind === "typedef" ? td.variants.flatMap((v) => (code.nodes[v] as NodeOf<"variant">).params ?? []) : [];
    const params = new Map<string, Id>(td?.kind === "typedef" ? [...td.params, ...own].map((p) => [all[p] ?? "a", p]) : []);
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
    if (!ps.length) { const { ports: _, ...plain } = t; return { ok: true, code: { nodes: withNodes(code.nodes, { [f.type]: plain }), defs: code.defs }, names }; }
    if (ps.length !== n) return { ok: false, reason: `${names[field] ?? "it"} has ${n ? `${n - 1} inputs and a result` : "no inputs"}: give ${n} ports, the inputs' then the result's` };
    return { ok: true, code: { nodes: withNodes(code.nodes, { [f.type]: { ...t, ports: ps } }), defs: code.defs }, names };
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
    setDisplayNames(this.namesOver({}));
    // An action of no inputs, as main is, so what it performs (Diverge,
    // Console) is its own row and it runs as main runs (I188).
    const made = newDefinition(this.code, this.names, `eval ${Date.now()}`, { kind: "function", params: [] });
    if (!made.ok) throw new Error(made.reason);
    const def = made.code.defs.at(-1)!;
    const hole = (made.code.nodes[(made.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">).body;
    let r = T.fillValue(made.code, made.names, editorInfo(made.code, made.names), hole, text, def);
    // A definition's name alone is its value (I233): the palette lists
    // names already, but eval has no list to pick from.
    if (!r.ok && r.reason === "a name alone is listed already") {
      const target = this.resolve(text);
      if (this.code.nodes[target]?.kind !== "def") throw new Error(`${text.trim()} isn't a definition`);
      r = { ok: true, code: { ...made.code, nodes: withNodes(made.code.nodes, { [hole]: { id: hole, kind: "ref", target } as NodeOf<"ref"> }) }, names: made.names, note: "" };
    }
    if (!r.ok) throw new Error(r.reason);
    const info = infer(r.code, this.namesOver(r.names), undefined, optionsWith(this.checkPins));
    const own = new Set(subtree(r.code, def));
    const e = info.errors.find((x) => own.has(x.id));
    if (e) throw new Error(e.message);
    const out: string[] = [];
    const names = this.namesOver(r.names);
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
      : !r.failures.length ? [`✓ ${r.name} (${r.cases} case${r.cases === 1 ? "" : "s"})`]
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
// Where a text's first `;` outside brackets and quotes is, or -1.
function firstSemicolon(t: string): number {
  let depth = 0, quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && !depth) return i;
  }
  return -1;
}

// A list pattern's items, and its rest (`..more`) when it has one.
type ListCase = { names: string[]; rest?: string; body: string };
// The matches on nil and cons that list patterns stand for, from the k-th
// item on. A pattern with a rest after k items matches every list from
// there: the lengths no pattern before it wrote get it, its rest named.
function listMatch(on: string, k: number, alive: ListCase[], fallback: string): string {
  const open = alive.findIndex((c) => c.rest !== undefined && c.names.length === k);
  if (open >= 0) {
    const c = alive[open];
    fallback = c.rest === "_" || c.rest === on ? c.body : `${c.rest} = ${on}\n${c.body}`;
    alive = alive.slice(0, open);
  }
  const ends = alive.find((c) => c.rest === undefined && c.names.length === k);
  const longer = alive.filter((c) => c.names.length > k);
  const block = (t: string) => t.split("\n").map((l) => "    " + l).join("\n");
  const nil = `  nil →\n${block(ends ? ends.body : fallback)}`;
  if (!longer.length) return open >= 0 && !ends ? fallback : `match ${on}\n${nil}\n  cons(item ${k + 1}, rest ${k + 1}) →\n${block(fallback)}`;
  const named = longer[0].names[k];
  const field = named !== "_" && longer.every((c) => c.names[k] === named) ? named : `item ${k + 1}`;
  const next = longer.map((c) => ({ ...c, body: c.names[k] === field || c.names[k] === "_" ? c.body : `${c.names[k]} = ${field}\n${c.body}` }));
  return `match ${on}\n${nil}\n  cons(${field}, rest ${k + 1}) →\n${block(listMatch(`rest ${k + 1}`, k + 1, next, fallback))}`;
}

// A pattern as written: a name, _, a value, or a case with its fields'
// patterns; a list pattern is the conses and nil it stands for.
type P = { k: "var"; name: string } | { k: "any" } | { k: "lit"; text: string } | { k: "con"; name: string; args: P[] };
const VALUE = /^("(?:[^"\\]|\\.)*"|[−-]?\d[\d.]*(?:e[+-]?\d+)?)$/i;

// Where a case's → is, outside brackets and quotes, or -1.
function arrowAt(t: string): number {
  let depth = 0, quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (!depth && (c === "→" || (c === "-" && t[i + 1] === ">"))) return i;
  }
  return -1;
}

function readPattern(t: string, isCase: (n: string) => boolean): P | string {
  t = t.trim();
  if (t === "_") return { k: "any" };
  if (VALUE.test(t)) return { k: "lit", text: t.replace(/^−/, "-") };
  if (t.startsWith("[") && t.endsWith("]")) {
    const items = t.slice(1, -1).trim() ? topLevel(t.slice(1, -1), ",") : [];
    const last = items.at(-1);
    const rest = last?.startsWith("..") ? items.pop()!.slice(2).trim() || "_" : undefined;
    if (items.some((x) => x.startsWith(".."))) return `a list pattern's rest comes last: ${t}`;
    let out: P | string = rest === undefined ? { k: "con", name: "nil", args: [] } : readPattern(rest, isCase);
    for (const x of items.reverse()) {
      const head = readPattern(x, isCase);
      if (typeof head === "string") return head;
      if (typeof out === "string") return out;
      out = { k: "con", name: "cons", args: [head, out] };
    }
    return out;
  }
  const call = /^([^()]+?)\s*\(([\s\S]*)\)$/.exec(t);
  if (call) {
    const args = call[2].trim() ? topLevel(call[2], ",").map((a) => readPattern(a, isCase)) : [];
    const bad = args.find((a) => typeof a === "string");
    return bad !== undefined ? bad : { k: "con", name: norm(call[1]), args: args as P[] };
  }
  // A name is the field's name, as a case's fields always were (`after`,
  // though Order has a case so named), but for a list's end, nil.
  if (/^[\p{L}_][\p{L}\p{N}_' ]*$/u.test(norm(t))) return isCase(norm(t)) ? { k: "con", name: norm(t), args: [] } : { k: "var", name: norm(t) };
  return `a pattern is a name, _, a value, a case with its fields or a list, not ${t}`;
}

type PRow = { pats: P[]; lets: [string, string][]; body: string };

// Rows of patterns as the matches they stand for, one column at a time,
// the first that the first row tests (a match compiler, as in Wadler's
// chapter of The Implementation of Functional Programming Languages): a
// match on that column, a case for each value or case its rows test, each
// with the rows that test it or take anything there, and otherwise the
// rows that take anything. A name taken is a step naming the value.
function patternMatch(on: string[], rows: PRow[], fallback: string, fresh: (base: string) => string): string {
  if (!rows.length) return fallback;
  const block = (t: string) => t.split("\n").map((l) => "    " + l).join("\n");
  const [r0] = rows;
  const col = r0.pats.findIndex((p) => p.k === "lit" || p.k === "con");
  if (col < 0) {
    const lets = [...r0.lets, ...r0.pats.flatMap((p, i): [string, string][] => (p.k === "var" && p.name !== on[i] ? [[p.name, on[i]]] : []))];
    return [...lets.map(([n, v]) => `${n} = ${v}`), r0.body].join("\n");
  }
  const s = on[col];
  const without = <T,>(xs: T[], put: T[] = []) => [...xs.slice(0, col), ...put, ...xs.slice(col + 1)];
  // A row that takes anything here, with its name for it.
  const taking = (r: PRow, put: P[]): PRow => {
    const p = r.pats[col];
    return { pats: without(r.pats, put), lets: p.k === "var" && p.name !== s ? [...r.lets, [p.name, s]] : r.lets, body: r.body };
  };
  const anyRows = rows.filter((r) => r.pats[col].k === "var" || r.pats[col].k === "any");
  const tested = (r: PRow) => r.pats[col] as Extract<P, { k: "lit" | "con" }>;
  const heads: string[] = [];
  for (const r of rows) { const p = r.pats[col]; const key = p.k === "lit" ? p.text : p.k === "con" ? p.name : null; if (key !== null && !heads.includes(key)) heads.push(key); }
  const lines = [`match ${s}`];
  for (const h of heads) {
    const mine = rows.filter((r) => { const p = r.pats[col]; return p.k === "var" || p.k === "any" || (p.k === "lit" ? p.text === h : p.k === "con" && p.name === h); });
    const first = rows.map(tested).find((p) => (p.k === "lit" ? p.text : p.name) === h)!;
    if (first.k === "lit") {
      const sub = mine.map((r) => (r.pats[col].k === "lit" ? { ...r, pats: without(r.pats) } : taking(r, [])));
      lines.push(`  ${h} →`, block(patternMatch(without(on), sub, fallback, fresh)));
      continue;
    }
    const n = first.args.length;
    // A field the rows testing this case name alike, where they name it, is
    // named so; else a fresh name, each row naming it with a step.
    const fields = Array.from({ length: n }, (_, i) => {
      const said = mine.map((r) => r.pats[col]).filter((p): p is Extract<P, { k: "con" }> => p.k === "con").map((p) => p.args[i]);
      const name = said.find((p) => p.k === "var")?.name;
      return name && !on.includes(name) && said.every((p) => p.k !== "var" || p.name === name) ? name : fresh(h === "cons" ? (i ? "rest" : "item") : "field");
    });
    const sub = mine.map((r) => { const p = r.pats[col]; return p.k === "con" ? { ...r, pats: without(r.pats, p.args) } : taking(r, fields.map((): P => ({ k: "any" }))); });
    lines.push(`  ${h}${n ? `(${fields.join(", ")})` : ""} →`, block(patternMatch(without(on, fields), sub, fallback, fresh)));
  }
  lines.push("  otherwise →", block(patternMatch(without(on), anyRows.map((r) => taking(r, [])), fallback, fresh)));
  return lines.join("\n");
}

// The text of the nested matches a match's cases stand for, when a case
// has a pattern inside a pattern (L290b); null when none has; ok false
// when one doesn't read.
function nestedPatterns(on: string, cases: string[]): string | { ok: false; reason: string } | null {
  const rows: PRow[] = [];
  let fallback = "□", deep = false;
  for (const c of cases) {
    const at = arrowAt(c);
    if (at < 0) return null;
    const head = c.slice(0, at).trim(), body = dedent(c.slice(at + (c[at] === "→" ? 1 : 2))) || "□";
    if (head === "otherwise") { fallback = body; continue; }
    const p = readPattern(head, (n) => n === "nil");
    if (typeof p === "string") return null;
    if (p.k === "con" && p.args.some((a) => a.k === "lit" || a.k === "con") && !(head.startsWith("[") && listOnly(p))) deep = true;
    rows.push({ pats: [p], lets: [], body });
  }
  if (!deep) return null;
  let k = 0;
  return patternMatch([on], rows, fallback, (base) => `${base} ${++k}`);
}

// A list pattern of names alone, [a, b, ..rest], which listMatch reads.
const listOnly = (p: P): boolean => p.k !== "con" || (p.name === "nil" ? true : p.name === "cons" && (p.args[0].k === "var" || p.args[0].k === "any") && listOnly(p.args[1]));

// The matches in a text that are where a value goes (I303): in a
// bracket that isn't a call's, `(match …)`, or the end of the text after
// an `else` outside brackets, `else match xs …`; a bracket around an
// `if … else match …` is one too. Outermost only, in the order written;
// what is inside one is read with it.
function nestedMatches(t: string): { from: number; to: number; text: string }[] {
  const found: { from: number; to: number; text: string }[] = [];
  const open: number[] = [];
  let quoted = false;
  const elseMatch = (s: string): number => {
    let depth = 0, q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === "\\") i++; else if (c === '"') q = false; continue; }
      if (c === '"') q = true;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (!depth && /^else\s+match\s/.test(s.slice(i)) && !/[\p{L}\p{N}_']$/u.test(s.slice(0, i))) return i + /^else\s+/.exec(s.slice(i))![0].length;
    }
    return -1;
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    // A call's parentheses follow a name or a closing bracket; after a
    // word of the language's own (`a and (match …)`) they group (I361).
    else if (c === "(") open.push(/[\p{L}\p{N}_')\]]\s*$/u.test(t.slice(0, i)) && !/(?<![\p{L}\p{N}_'])(and|or|not|if|then|else)\s*$/u.test(t.slice(0, i)) ? -1 : i);
    else if ("[{".includes(c)) open.push(-1);
    else if (")]}".includes(c)) {
      const from = open.pop();
      if (from === undefined || from < 0 || c !== ")") continue;
      const inside = t.slice(from + 1, i);
      if (/^\s*match\s/.test(inside) || elseMatch(inside) >= 0) found.push({ from, to: i + 1, text: inside });
    }
  }
  // A function's body that is a match, among a call's arguments, `map(xs,
  // (i) => match i …)`: the match goes on to the bracket that closes
  // around it, or a comma outside brackets (I361).
  for (let i = 0, q = false; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === "\\") i++; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; continue; }
    const arrow = /^=>\s*(?=match\s)/.exec(t.slice(i));
    if (!arrow) continue;
    const from = i + arrow[0].length;
    let depth = 0, to = t.length, inq = false;
    for (let j = from; j < t.length; j++) {
      const d = t[j];
      if (inq) { if (d === "\\") j++; else if (d === '"') inq = false; continue; }
      if (d === '"') inq = true;
      else if ("([{".includes(d)) depth++;
      else if (")]}".includes(d)) { if (depth === 0) { to = j; break; } depth--; }
      else if (d === "," && depth === 0) { to = j; break; }
    }
    // A whole text that is a function whose body is a match reads as it is.
    if (to < t.length) found.push({ from, to, text: t.slice(from, to).replace(/\s+$/, "") });
  }
  const tail = elseMatch(t);
  if (tail >= 0) found.push({ from: tail, to: t.length, text: t.slice(tail) });
  return found.filter((g) => !found.some((o) => o !== g && o.from <= g.from && g.to <= o.to)).sort((a, b) => a.from - b.from);
}

// A match's or handler's text: what follows the keyword, and its cases,
// one a line (deeper lines go on the case above) or after `;`s.
function casesOf(text: string, keyword: string): { head: string; cases: string[] } {
  const lines = text.replace(/^\s*\n/, "").split("\n");
  const first = lines[0].trim().replace(new RegExp(`^${keyword}\\s+`), "");
  if (lines.length === 1 || !lines.slice(1).some((l) => l.trim())) {
    // One line: the scrutinee, then the cases after `;`s outside brackets.
    const parts = topLevel(first, ";");
    return { head: parts[0], cases: parts.slice(1) };
  }
  // Cases begin on the least indented of the lines after the first.
  const rest = lines.slice(1).filter((l) => l.trim());
  const indent = (l: string) => l.length - l.trimStart().length;
  const least = Math.min(...rest.map(indent));
  const cases: string[] = [];
  for (const l of rest) if (indent(l) === least || !cases.length) cases.push(l.trim()); else cases[cases.length - 1] += "\n" + l;
  return { head: first, cases };
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
const parents = new WeakMap<Code, (id: Id) => Id | undefined>();
const viewed = new WeakMap<Code, Map<Id, string[]>>();

// The program after an edit without the nodes the edit left unreached. The
// program before was all reached, so a node can be unreached only if it
// was a child of a node the edit changed or dropped, and isn't a child of
// one it changed or made; it goes with everything under it.
function dropUnreached(before: Code, after: Code): Code {
  if (after.defs.length !== before.defs.length || after.defs.some((d, i) => before.defs[i] !== d)) return collect(after);
  const was = new Set<Id>(), now = new Set<Id>();
  for (const id of nodeIds(after.nodes)) if (after.nodes[id] !== before.nodes[id]) { for (const c of children(after.nodes[id])) now.add(c); if (before.nodes[id]) for (const c of children(before.nodes[id])) was.add(c); }
  for (const id of nodeIds(before.nodes)) if (after.nodes[id] === undefined) for (const c of children(before.nodes[id])) was.add(c);
  // So with a node the edit made that nothing holds (one it made and then
  // replaced).
  const defs = new Set(after.defs);
  const lost = [...was].filter((c) => !now.has(c) && after.nodes[c] !== undefined);
  for (const id of nodeIds(after.nodes)) if (before.nodes[id] === undefined && !now.has(id) && !defs.has(id) && after.nodes[id].kind !== "builtin") lost.push(id);
  if (!lost.length) return after;
  const nodes = copyNodes(after.nodes);
  const drop = (id: Id) => { const n = nodes[id]; if (!n) return; dropNode(nodes, id); for (const c of children(n)) if (!now.has(c)) drop(c); };
  for (const id of lost) drop(id);
  return { nodes, defs: after.defs };
}

// A program checked already (the session's own, after each edit) isn't
// checked again for each filling read on it (I304).
const checked = new WeakMap<Code, Info>();
const editorInfo = (code: Code, names: Names): Info => checked.get(code) ?? T.infer(code, { ...LIBRARY.names, ...names });

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
