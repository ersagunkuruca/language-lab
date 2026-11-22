// The Files tab (split out of main.ts, E228p): the files a program is
// saved as, each with a short hash of its text and its size, the ones the
// last edit touched marked, and the definition's meaning hash, said to
// have moved or not. What it reads of the editor comes through
// `FilesHost`.
import type { Code } from "../ters/src/model.ts";
import type { Drafts } from "./drafts.ts";
import { hashDef } from "../ters/src/hash.ts";
import { savedForm } from "../ters/src/saved.ts";
import { h } from "./dom.ts";
import type { Doc, UI } from "./main.ts";
import { nodeEntries, nodeIds, sameValue } from "../ters/src/model.ts";

// The program without the library's builtins, as code.json keeps it.
export const userCode = (c: Code): Code => ({ nodes: Object.fromEntries(nodeEntries(c.nodes).filter(([, n]) => n.kind !== "builtin")), defs: c.defs });

// Whether two versions of the program would be saved the same: node by
// node, the same object or the same value (QA 11-22d M1: Undo wrote both
// out as code.json to tell, 0.25 s of sheet's).
export function sameCode(a: Code, b: Code): boolean {
  if (a === b) return true;
  if (a.defs.length !== b.defs.length || a.defs.some((d, i) => b.defs[i] !== d)) return false;
  const ids = nodeIds(a.nodes);
  let n = 0;
  for (const id of ids) {
    const x = a.nodes[id], y = b.nodes[id];
    if (x === undefined) continue;
    n++;
    if (x !== y && !sameValue(x, y)) return false;
  }
  for (const id of nodeIds(b.nodes)) if (b.nodes[id] !== undefined) n--;
  return n === 0;
}

// A short hash of a file's text (FNV-1a), to see that it changed.
export function fnv(s: string) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return x.toString(16).padStart(8, "0");
}

export interface FilesHost {
  doc(): Doc;
  ui: UI;
  undo: Doc[];
  // The program with its drafts in place, and the drafts on their own.
  prog(d: Doc): Code;
  draftsOf(d: Doc): Drafts;
}

export function filesPanels(host: FilesHost) {
  const { doc, ui, undo, prog, draftsOf } = host;
  // `same`, where telling two versions apart is quicker than writing them.
  const files = (): { name: string; get: (d: Doc) => string; same?: (a: Doc, b: Doc) => boolean }[] => [
    { name: "code.json", get: (d: Doc) => JSON.stringify(savedForm(userCode(prog(d)))), same: (a, b) => sameCode(prog(a), prog(b)) },
    { name: "drafts.json", get: (d: Doc) => JSON.stringify(draftsOf(d)), same: (a, b) => (a.code === b.code && a.loose === b.loose && a.home === b.home) || JSON.stringify(draftsOf(a)) === JSON.stringify(draftsOf(b)) },
    { name: "names.short.json", get: (d: Doc) => JSON.stringify(d.names.short) },
    { name: "names.descriptive.json", get: (d: Doc) => JSON.stringify(d.names.descriptive) },
    { name: "comments.json", get: (d: Doc) => JSON.stringify(d.comments) },
    { name: "layout.json", get: (d: Doc) => JSON.stringify(d.layout) },
    { name: "examples.json", get: (d: Doc) => JSON.stringify(d.examples ?? {}) },
  ];
  const meaningOf = (code: Code): string => { try { return hashDef(code, ui.def); } catch { return "—"; } };

  function filesPanel(): HTMLElement {
    const box = h("div", { class: "files" });
    const meaning = meaningOf(doc().code);
    const prev = undo.at(-1);
    const prevMeaning = prev && prev.code.nodes[ui.def] ? meaningOf(prev.code) : meaning;
    box.append(h("div", { class: `meaning${meaning !== prevMeaning ? " moved" : ""}` },
      h("span", {}, "Meaning hash"), h("code", {}, meaning),
      h("span", { class: "chip", title: "The meaning hash before the last edit, compared with now" }, meaning === prevMeaning ? "unchanged" : "changed")));
    for (const f of files()) {
      const txt = f.get(doc());
      box.append(h("div", { class: `file${ui.touched.includes(f.name) ? " hot" : ""}` },
        h("span", { class: "fname" }, f.name), h("code", {}, fnv(txt)), h("span", { class: "fsize" }, `${txt.length} B`)));
    }
    return box;
  }
  return { files, filesPanel };
}
