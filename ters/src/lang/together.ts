// Types stored together (L280f, POOL-CHOICE-2026-11-23.md): a type whose
// representation's jobs give a companion type stored its own way, which
// is chosen with it, by the same name. A pool in slots gives keys that
// carry their slot, so a Pool's "slots" comes with its Pool key's.
import type { Id } from "../model.ts";
import { POOL, POOL_KEY } from "./std-ids.ts";

export const TOGETHER: Record<Id, Id[]> = { [POOL]: [POOL_KEY] };
// The types only ever chosen with another's.
export const COMPANIONS: ReadonlySet<Id> = new Set(Object.values(TOGETHER).flat());
