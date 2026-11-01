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
import { subtree } from "../src/model.ts";
import type { Comments, Names, Presentation, Style } from "../src/presentation.ts";
import { root } from "../src/io.ts";
import { infer, type Info } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { blocksOf, pieceText, type Blk, type Piece } from "../src/lang/render.ts";
import { showType } from "../src/lang/types.ts";
import { fromFile, own, toFile, type ProgramFile } from "../editor/files.ts";
import { Cells } from "../src/lang/cells.ts";
import { evaluatorCall, htmlText } from "../src/lang/html.ts";
import { equal, mainProblem, pageProblem, runProgram, runMain, showValue, withSteps, OutOfSteps, type World } from "../src/lang/run.ts";
import { nodeWorld } from "../src/lang/world.ts";
import { runTests, savedFrom } from "../src/lang/tests.ts";

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const STYLE: Style = read(join(root, "styles", "blocks.json"), { view: "blocks", notation: {} });
// A run that doesn't finish is stopped after this many steps.
export const STEPS = 20_000_000;
export const DEPTH = 4;

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
  resolve(ref: string): Id {
    const r = ref.trim().replace(/^#/, "").replace(/^‹(.*)›$/, "$1");
    if (this.code.nodes[r]) return r;
    const hits = [...this.short.keys()].filter((id) => id.startsWith(r));
    if (r.length >= 3 && hits.length === 1) return hits[0];
    if (hits.length > 1 && r.length >= 3) throw new Error(`#${r} is ${hits.length} ids: ${hits.slice(0, 5).map((h) => this.id(h)).join(", ")}`);
    const all = this.allNames;
    const named = this.own.find((d) => this.names[d] === r) ?? this.code.defs.find((d) => all[d] === r);
    if (named) return named;
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
    return [...mine, ...lib.slice(0, 60).map(line), ...(lib.length > 60 ? [`… ${lib.length - 60} more: narrow the filter`] : [])].join("\n") || "(none)";
  }

  // A definition, or the block of one that `at` names, as text with ids,
  // blocks deeper than `depth` shown as `…` with their id to view next.
  view(at: string, depth = DEPTH): string {
    const id = this.resolve(at);
    const def = this.defOf(id);
    if (!def) throw new Error(`#${this.id(id)} isn't in a definition`);
    const blocks = blocksOf(this.code, this.pres(), this.info, def);
    const found = id === def ? blocks : findBlk(blocks, id);
    const lines = this.lines(found ?? blocks, depth);
    const errors = this.info.errors.filter((e) => subtree(this.code, found ? id : def).includes(e.id)).map((e) => `✗ #${this.id(e.id)} ${e.message}`);
    const head = id === def || !found ? [] : [`in ${this.name(def)}:`];
    return [...head, ...lines, ...errors].join("\n");
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
        if (t?.t === "fn" && !pageProblem(this.info, def, this.allNames)) return `page:\n${htmlText(runMain(this.code, this.info, def, { ...rt, cells: new Cells(equal) }), evaluatorCall)}`;
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

// Long output is cut, keeping the end, where the answer is.
export function clip(lines: string[], max = 200, chars = 6000): string[] {
  const out = lines.length <= max ? lines : [`… ${lines.length - max} lines before`, ...lines.slice(-max)];
  const all = out.join("\n");
  return all.length <= chars ? out : [all.slice(0, chars), `… ${all.length - chars} more characters`];
}

export type { NodeOf };
