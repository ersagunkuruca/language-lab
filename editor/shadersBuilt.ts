// shaders.html's programs compiled when the site is built (editor/build.ts):
// checked, rendered as blocks, lowered to WGSL and the CPU's program, and
// run through the evaluator at the check points, here in Node rather than
// in every visitor's browser, where it froze the page.

import type { Code, Id } from "../ters/src/model.ts";
import type { Names, Presentation, Style } from "../ters/src/presentation.ts";
import blocksStyle from "../ters/styles/blocks.json" with { type: "json" };
import { infer } from "../ters/src/lang/infer.ts";
import { LIBRARY } from "../ters/src/lang/library.ts";
import { renderBlocks } from "../ters/src/lang/render.ts";
import { merge } from "../ters/src/model.ts";
import { layer } from "../ters/src/presentation.ts";
import { readFileSync } from "node:fs";
import { buildPicture, pictureEntries } from "./picture.ts";
import type { ShaderBuilt } from "./shaders.ts";

const examples = new URL("../ters/examples/", import.meta.url).pathname;
const json = (f: string) => JSON.parse(readFileSync(examples + f, "utf8"));

// Each page section's id and the example folder it shows.
const SECTIONS = [["raymarch", "raymarch"], ["mandelbrot", "mandelbrot"], ["ripples", "shaders"]];

export async function shadersBuilt(): Promise<ShaderBuilt[]> {
  const out: ShaderBuilt[] = [];
  for (const [where, folder] of SECTIONS) {
    const own = json(`${folder}/code.json`) as Code;
    const code = merge(LIBRARY.code, own), names = layer<Names>(LIBRARY.names, json(`${folder}/names.default.json`) as Names);
    const info = infer(code, names, undefined, { pins: LIBRARY.pins, hidden: LIBRARY.hidden });
    if (info.errors.length) throw new Error(`${folder}: ${info.errors.map((e) => e.message).join("\n")}`);
    const pres: Presentation = { names, comments: json(`${folder}/comments.json`) as Record<Id, string>, hints: {}, style: blocksStyle as unknown as Style };
    const entries = pictureEntries(own.defs, names);
    if (!entries) throw new Error(`${folder}: a picture is a colour, or a red, green and blue, of (x, y, time)`);
    out.push({ where, program: own.defs.map((d) => renderBlocks(code, pres, info, d)).join("\n\n"), picture: await buildPicture(code, info, names, entries) });
  }
  return out;
}
