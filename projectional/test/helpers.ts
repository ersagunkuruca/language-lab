import { freshId, type Code, type Id } from "../src/model.ts";

// The same program with every one of its own ids replaced by a fresh one:
// what writing it again would give. Hashes must not tell the two apart.
export function reId(own: Code): { code: Code; ids: Map<Id, Id> } {
  const ids = new Map(Object.keys(own.nodes).map((id) => [id, freshId()]));
  let text = JSON.stringify(own);
  for (const [a, b] of ids) text = text.split(`"${a}"`).join(`"${b}"`);
  return { code: JSON.parse(text), ids };
}
