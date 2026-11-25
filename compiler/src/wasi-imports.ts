// The imports a WASI command is started with under Node (C344): node:wasi's
// own, each wrapped in a plain JavaScript function. Node 22 gives its WASI
// calls to V8 as fast API calls, which optimised WebAssembly calls directly;
// fd_read's allocation can start a collection inside one, and V8 then walks
// the calling WebAssembly frame wrongly and crashes (a segfault in
// IterateTurbofanOptimizedFrame, mnist under node:wasi about one run in
// three). Through a wrapper the call leaves WebAssembly by an ordinary
// JavaScript frame, which a collection walks safely.

import type { WASI } from "node:wasi";

export const wasiImports = (w: WASI): WebAssembly.Imports => {
  const all = w.getImportObject() as Record<string, Record<string, (...a: unknown[]) => unknown>>;
  return Object.fromEntries(Object.entries(all).map(([m, fs]) =>
    [m, Object.fromEntries(Object.entries(fs).map(([k, f]) => [k, (...a: unknown[]) => f(...a)]))])) as WebAssembly.Imports;
};

// The same, as source for a script a benchmark or test writes and runs:
// `${wasiImportsSource}` defines `wasiImports` there.
export const wasiImportsSource = "const wasiImports = (w) => Object.fromEntries(Object.entries(w.getImportObject()).map(([m, fs]) => [m, Object.fromEntries(Object.entries(fs).map(([k, f]) => [k, (...a) => f(...a)]))]));";
