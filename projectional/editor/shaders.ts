// shaders.html: programs in the language, compiled to WGSL and drawn by the
// GPU with WebGPU, each next to its code and the WGSL it became. The drawing
// (and its fallbacks without WebGPU) is editor/picture.ts, shared with the
// editor's Run panel.
//
// To show the GPU computes what the language means, a compute shader runs
// the same functions at sample points and the page compares them with the
// evaluator.

import type { Code, Id } from "../src/model.ts";
import type { Names, Presentation, Style } from "../src/presentation.ts";
import blocksStyle from "../styles/blocks.json" with { type: "json" };
import ripplesCode from "../examples/shaders/code.json" with { type: "json" };
import ripplesNames from "../examples/shaders/names.default.json" with { type: "json" };
import ripplesComments from "../examples/shaders/comments.json" with { type: "json" };
import marchCode from "../examples/raymarch/code.json" with { type: "json" };
import marchNames from "../examples/raymarch/names.default.json" with { type: "json" };
import marchComments from "../examples/raymarch/comments.json" with { type: "json" };
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { renderBlocks } from "../src/lang/render.ts";
import { merge } from "../src/model.ts";
import { layer } from "../src/presentation.ts";
import { drawPicture, pictureEntries } from "./picture.ts";

interface Program { code: unknown; names: unknown; comments: unknown }

const params = new URLSearchParams(location.search);
// ?time=2 holds the pictures still at that time (for screenshots and tests).
const still = params.has("time") ? Number(params.get("time")) : null;

async function show(where: string, p: Program) {
  const box = document.getElementById(where)!;
  const $ = (c: string) => box.querySelector(`.${c}`) as HTMLElement;
  const own = p.code as Code;
  const code = merge(LIBRARY.code, own), names = layer<Names>(LIBRARY.names, p.names as Names);
  const info = infer(code, names, undefined, { pins: LIBRARY.pins, hidden: LIBRARY.hidden });
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("\n"));
  const pres: Presentation = { names, comments: p.comments as Record<Id, string>, hints: {}, style: blocksStyle as unknown as Style };
  const entries = pictureEntries(own.defs, names);
  if (!entries) throw new Error("a picture is a colour, or a red, green and blue, of (x, y, time)");
  $("program").textContent = own.defs.map((d) => renderBlocks(code, pres, info, d)).join("\n\n");
  const picture = await drawPicture({ code, info, names, entries, canvas: $("picture") as HTMLCanvasElement, status: $("status"), check: $("check"), still });
  $("wgsl").textContent = picture.wgsl;
  $("fragment").textContent = picture.fragment;
  await picture.ready;
}

Promise.all([
  show("ripples", { code: ripplesCode, names: ripplesNames, comments: ripplesComments }),
  show("raymarch", { code: marchCode, names: marchNames, comments: marchComments }),
]).then(() => { document.body.dataset.ready = "true"; }, (e) => {
  for (const s of document.querySelectorAll(".status")) if (s.textContent === "Starting…") s.textContent = `Error: ${e.message}`;
  document.body.dataset.ready = "error";
  throw e;
});
