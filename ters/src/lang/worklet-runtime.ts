// What a page's program runs on the audio thread (AUDIO.md, A4): the
// compiler's runtime and `startSound`, prebuilt as one script that sets
// `$lab` in the AudioWorkletGlobalScope (cli/web.ts workletRuntime), for
// a worklet made in a browser without a bundler (page.ts workletFile).

export * from "../../../compiler/src/runtime.js";
export { startSound } from "./audio-worklet.ts";
