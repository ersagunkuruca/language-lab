// The Files tab (split out of main.ts, E228p): the files a program is
// saved as, each with a short hash of its text and its size, the ones the
// last edit touched marked, and the definition's meaning hash, said to
// have moved or not. What it reads of the editor comes through
// `FilesHost`.
import type { Code } from "../ters/src/model.ts";
import type { Drafts } from "./drafts.ts";
import { hashDef } from "../ters/src/hash.ts";
import { h } from "./dom.ts";
import type { Doc, UI } from "./main.ts";

// The program without the library's builtins, as code.json keeps it.
export const userCode = (c: Code): Code => ({ nodes: Object.fromEntries(Object.entries(c.nodes).filter(([, n]) => n.kind !== "builtin")), defs: c.defs });

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
  const files = () => [
    { name: "code.json", get: (d: Doc) => JSON.stringify(userCode(prog(d))) },
    { name: "drafts.json", get: (d: Doc) => JSON.stringify(draftsOf(d)) },
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
      h("span", { class: "chip" }, meaning === prevMeaning ? "same as before last edit" : "changed by last edit")));
    for (const f of files()) {
      const txt = f.get(doc());
      box.append(h("div", { class: `file${ui.touched.includes(f.name) ? " hot" : ""}` },
        h("span", { class: "fname" }, f.name), h("code", {}, fnv(txt)), h("span", { class: "fsize" }, `${txt.length} B`)));
    }
    return box;
  }
  return { files, filesPanel };
}
