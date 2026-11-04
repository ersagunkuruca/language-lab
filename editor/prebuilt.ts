// Compiled output built with the site (BACKLOG E245, Ersagun 2026-11-04:
// "can't we have cached builds?"): the build (prebuild.ts) compiles each
// shipped example once and writes what it made to prebuilt/<key>.json
// beside the page, with prebuilt/index.json listing the keys. The key is
// the content hash of what was compiled (hash.ts: a definition's hash
// covers everything it uses), with the pins, so an example opened as
// shipped finds its output there, and after an edit that reaches it the
// key changes and the editor compiles as before. Opened from a file or
// with nothing built, there's no index, and every lookup is a miss.
import type { Code, Id } from "../ters/src/model.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import { digest, hashes } from "../ters/src/hash.ts";

export const prebuiltKey = (kind: string, code: Code, root: Id, pins: Pins): string => digest([kind, hashes(code, [root]).get(root), pins]);

let index: Promise<Set<string>> | null = null;
const keys = (): Promise<Set<string>> => (index ??= fetch("prebuilt/index.json").then((r) => (r.ok ? r.json() : [])).then((ks: string[]) => new Set(ks), () => new Set()));

// What the build made for this key, or null.
export async function prebuilt<T>(key: string): Promise<T | null> {
  try {
    if (!(await keys()).has(key)) return null;
    const r = await fetch(`prebuilt/${key}.json`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}
