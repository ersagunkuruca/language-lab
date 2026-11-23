// A picture made in a worker (E319c, EDITOR-THREAD-2026-11-23): lowering
// it to WGSL, WebAssembly and JavaScript and checking its Float32 copy
// grow with what the picture reaches, which on the editor's thread held
// the editor for each edit. The worker gives back the picture as the
// site's build does (picture.ts buildPicture, without the evaluator's
// answers, which the editor doesn't check against); the editor only draws
// it. Each ask gets a worker of its own, ended when it answers or a newer
// version is asked for.
import type { Code, Id } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Pins } from "../ters/src/lang/signatures.ts";
import type { Built } from "./pictureDraw.ts";
import { newWorker } from "./runViews.ts";
import { sendCode, type SentCode } from "./runCode.ts";

export type PictureAsk = { shipped?: Record<string, unknown>; picture: true; code: SentCode; names: Names; pins: Pins; entries: Record<string, Id> };
export type PictureSays = { built: Built } | { error: string };

export type Making = { done: Promise<Built>; stop(): void };

export function pictureInWorker(a: { code: Code; names: Names; pins: Pins; entries: Record<string, Id>; shipped?: Record<string, unknown> }): Making {
  const w = newWorker();
  let ok: (b: Built) => void = () => {}, fail: (e: Error) => void = () => {};
  const done = new Promise<Built>((y, n) => { ok = y; fail = n; });
  const end = (s: PictureSays) => { w.terminate(); if ("built" in s) ok(s.built); else fail(new Error(s.error)); ok = () => {}; fail = () => {}; };
  w.onmessage = (e: MessageEvent<PictureSays>) => end(e.data);
  w.onerror = (e) => { e.preventDefault(); end({ error: e.message || "the picture's worker failed" }); };
  const ask: PictureAsk = { ...(a.shipped ? { shipped: a.shipped } : {}), picture: true, code: sendCode(a.code), names: a.names, pins: a.pins, entries: a.entries };
  w.postMessage(ask);
  return { done, stop: () => end({ error: "redrawn" }) };
}
