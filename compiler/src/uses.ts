// A use's binds and body, now that a use may come without them (L211,
// PORTS-2026-11-01.md §3): one with no body gives its produced ports as
// one value. ters/src/lang/ports.ts's fillUses reads it at load as the use
// that binds each produced port and gives them back, so what the compiler
// sees has both, except a use whose ports aren't known (a hole, an unknown
// target), which nothing here compiles anyway.

import type { Id, Use } from "../../ters/src/model.ts";

export const bindsOf = (n: Use): Record<string, Id> => n.binds ?? {};

export function bodyOf(n: Use): Id {
  if (n.body === undefined) throw new Error(`a use whose ports aren't known gives its ports as one value, which isn't compiled (${n.id})`);
  return n.body;
}
