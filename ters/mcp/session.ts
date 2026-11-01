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
import { collect, subtree } from "../src/model.ts";
import { sameEverywhere, sharedPlaces } from "../src/lang/patterns.ts";
import type { Comments, Names, Presentation, Style } from "../src/presentation.ts";
import { root } from "../src/io.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { blocksOf, pieceText, type Blk, type Piece } from "../src/lang/render.ts";
import { showType } from "../src/lang/types.ts";
import { fromFile, own, toFile, type ProgramFile } from "../src/files.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, htmlText } from "../src/lang/html.ts";
import { equal, mainProblem, pageProblem, runProgram, runMain, showValue, withSteps, OutOfSteps, type World } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { runTests, savedFrom } from "../src/lang/tests.ts";
import * as T from "../../editor/typed.ts";
import { SIGS } from "../src/lang/std.ts";
import { setDisplayNames } from "../../editor/typed.ts";
import { addParameter, deleteDefinition, nameClash, newDefinition, type Shape } from "../src/lang/toplevel.ts";

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
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
  private short = new Map<Id, string>();

  constructor(path: string) {
    this.path = resolve(path);
    if (!existsSync(this.path)) throw new Error(`no such program: ${path}`);
    if (statSync(this.path).isDirectory()) {
      this.title = basename(this.path);
      this.code = base(read<Code>(join(this.path, "code.json"), { nodes: {}, defs: [] }));
      this.names = read<Names>(join(this.path, "names.default.json"), {});
      this.comments = read<Comments>(join(this.path, "comments.json"), {});
    } else {
      const r = fromFile(readFileSync(this.path, "utf8"), () => LIBRARY.code);
      if ("error" in r) throw new Error(`can't open ${path}: ${r.error}`);
      this.file = r.file;
      this.title = r.file.title;
      this.code = r.code;
      this.names = r.file.names;
      this.comments = r.file.comments ?? {};
    }
    this.recheck();
  }

  get allNames(): Names { return baseNames(this.names); }
  get own(): Id[] { return this.code.defs.filter((d) => !LIBRARY.code.nodes[d]); }

  recheck() {
    this.info = infer(this.code, this.allNames, undefined, checkOptions);
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
      writeFileSync(this.path, toFile({ ...this.file, code: this.code, names: this.names, comments: this.comments }, LIBRARY.code));
      return;
    }
    const json = (x: unknown) => JSON.stringify(x, null, 2) + "\n";
    writeFileSync(join(this.path, "code.json"), json(mine));
    writeFileSync(join(this.path, "names.default.json"), json(this.names));
    if (Object.keys(this.comments).length || existsSync(join(this.path, "comments.json"))) writeFileSync(join(this.path, "comments.json"), json(this.comments));
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
    return [...head, ...lines, ...folded, ...errors].join("\n");
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
    if (!this.info.errors.length) return "ok";
    return this.info.errors.map((e) => { const d = this.defOf(e.id); return `✗ ${d ? this.name(d) : "?"} #${this.id(e.id)}: ${e.message}`; }).join("\n");
  }

  // ---------------------------------------------------------------- editing
  //
  // Each edit is one of the editor's own gestures (editor/typed.ts,
  // src/lang/toplevel.ts), so an LLM edits the way a person does. It is
  // kept only if the program has no more type errors than before, then
  // saved; the answer is the changed lines of the definition, or why not.

  private undos: { code: Code; names: Names; comments: Comments }[] = [];

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
    return top[0];
  }

  // `kase`: in a match, the body of that one case, even where the view
  // shows it folded into otherwise; else an edit to a folded otherwise is
  // made in every case it stands for, as in the editor.
  replace(at: string, text: string, find?: string, kase?: string): string {
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
      return T.fillValue(holed.code, holed.names, editorInfo(holed.code, holed.names), target, t, def);
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
      const let_ = Object.values(r.code.nodes).find((n): n is NodeOf<"call"> => n.kind === "call" && (r.code.nodes[n.fn] as { params?: Id[] }).params?.[0] === r.dot)!;
      const hole = let_.args[0];
      if (!value.trim()) return { ok: true, code: r.code, names };
      return T.fillValue(r.code, names, editorInfo(r.code, names), hole, value, def);
    });
  }

  // Replace a part by a match on a variable, one case per variant, each a copy.
  split(at: string, on: string, find?: string): string {
    const target = this.part(at, find);
    const def = this.defOf(target);
    if (!def) throw new Error(`#${this.id(target)} isn't in a definition`);
    const v = this.resolve(on, def);
    return this.apply(def, () => T.splitOn(this.code, this.names, editorInfo(this.code, this.names), target, v));
  }

  define(name: string, kind: string, params: string[] = [], first = ""): string {
    const shape: Shape = kind === "function" ? { kind, params } : kind === "value" ? { kind } : kind === "type" ? { kind, firstCase: first } : kind === "effect" ? { kind, firstOperation: first } : kind === "interface" ? { kind, firstOperation: first } : (() => { throw new Error("kind: function, value, type, effect or interface"); })();
    return this.apply(null, () => newDefinition(this.code, this.names, name, shape), (c) => c.defs.at(-1)!);
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
    const made = newDefinition(this.code, this.names, `eval ${Date.now()}`, { kind: "value" });
    if (!made.ok) throw new Error(made.reason);
    const def = made.code.defs.at(-1)!;
    const hole = (made.code.nodes[def] as NodeOf<"def">).body!;
    const r = T.fillValue(made.code, made.names, editorInfo(made.code, made.names), hole, text, def);
    if (!r.ok) throw new Error(r.reason);
    const info = infer(r.code, baseNames(r.names), undefined, checkOptions);
    const own = new Set(subtree(r.code, def));
    const e = info.errors.find((x) => own.has(x.id));
    if (e) throw new Error(e.message);
    const out: string[] = [];
    const names = baseNames(r.names);
    const rt = { print: (s: string) => out.push(s), names, world: this.world(out, "") };
    const t = info.typeOf.get(def);
    try {
      const v = withSteps(STEPS, () => showValue(runMain(r.code, info, def, rt), r.code, names));
      return clip([...out, `= ${v} : ${t ? showType(info.subst.zonk(t), names) : "?"}`]).join("\n");
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
        // A page prints once, as static HTML (as lab run does).
        if (t?.t === "fn" && !pageProblem(this.info, def, this.allNames)) return `page, as text:\n${pageText(htmlText(runMain(this.code, this.info, def, { ...rt, cells: new Cells(equal) }), evaluatorCall))}`;
        if (!problem) return `exit ${runProgram(this.code, this.info, def, args, rt)}`;
        return `= ${showValue(runMain(this.code, this.info, def, rt), this.code, this.allNames)}`;
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
