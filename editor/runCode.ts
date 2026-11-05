// A program as Run sends it to its worker (I177): only the nodes that
// aren't the library's own, the library's that are gone, and the
// definitions. The worker puts them back on its own copy of the library,
// so its check reads through to the library's kept check (infer.ts
// `under`, L216) instead of checking the ~27,000 library nodes again,
// which a copy of every node, made by postMessage, always did.
import type { Code, Id, Node } from "../ters/src/model.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";

export type SentCode = { own: Record<Id, Node>; gone: Id[]; defs: Id[] };

export function sendCode(code: Code): SentCode {
  const lib = LIBRARY.code.nodes, own: Record<Id, Node> = {}, gone: Id[] = [];
  for (const id in code.nodes) if (code.nodes[id] !== lib[id]) own[id] = code.nodes[id];
  for (const id in lib) if (!(id in code.nodes)) gone.push(id);
  return { own, gone, defs: code.defs };
}

export function receivedCode(s: SentCode): Code {
  const nodes: Record<Id, Node> = { ...LIBRARY.code.nodes, ...s.own };
  for (const id of s.gone) delete nodes[id];
  return { nodes, defs: s.defs };
}
