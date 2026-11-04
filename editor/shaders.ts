// shaders.html: programs in the language, compiled to WGSL and drawn by the
// GPU with WebGPU, each next to its code and the WGSL it became. The drawing
// (and its fallbacks without WebGPU) is editor/pictureDraw.ts, shared with
// the editor's Run panel.
//
// The programs are fixed, so they're compiled when the site is built
// (editor/build.ts, shadersBuilt below): the page gets each one's text, its
// shaders, its CPU fallback and the evaluator's answers at the check points,
// and only draws. To show the GPU computes what the language means, a
// compute shader runs the same functions at those points and the page
// compares them with the evaluator's answers.

import { drawableOf, drawDrawable, type Built } from "./pictureDraw.ts";

// Each program's blocks text and its picture, built ahead.
export interface ShaderBuilt { where: string; program: string; picture: Built }
declare const SHADERS_BUILT: ShaderBuilt[];

const params = new URLSearchParams(location.search);
// ?time=2 holds the pictures still at that time (for screenshots and tests).
const still = params.has("time") ? Number(params.get("time")) : null;

async function show(b: ShaderBuilt): Promise<{ ready: Promise<void> }> {
  const box = document.getElementById(b.where)!;
  const $ = (c: string) => box.querySelector(`.${c}`) as HTMLElement;
  $("program").textContent = b.program;
  const picture = await drawDrawable(drawableOf(b.picture), { canvas: $("picture") as HTMLCanvasElement, status: $("status"), check: $("check"), still });
  $("wgsl").textContent = picture.wgsl;
  $("fragment").textContent = picture.fragment;
  return { ready: picture.ready };
}

const shown = SHADERS_BUILT.map(show);
Promise.all(shown.map((s) => s.then((x) => x.ready))).then(() => { document.body.dataset.ready = "true"; }, (e) => {
  for (const s of document.querySelectorAll(".status")) if (s.textContent === "Starting…") s.textContent = `Error: ${e.message}`;
  document.body.dataset.ready = "error";
  throw e;
});
