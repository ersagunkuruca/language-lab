// shaders.html's programs compiled when the site is built (editor/build.ts):
// checked, rendered as blocks, lowered to WGSL and the CPU's program, and
// run through the evaluator at the check points, here in Node rather than
// in every visitor's browser, where it froze the page.

import type { Presentation, Style } from "../ters/src/presentation.ts";
import blocksStyle from "../ters/styles/blocks.json" with { type: "json" };
import { infer } from "../ters/src/lang/infer.ts";
import { loadProgram } from "../ters/src/lang/load.ts";
import { renderBlocks } from "../ters/src/lang/render.ts";
import { buildPicture, pictureEntries } from "./picture.ts";
import type { ShaderBuilt } from "./shaders.ts";

const examples = new URL("../ters/examples/", import.meta.url).pathname;

// Each page section's id and the example folder it shows.
const SECTIONS = [["raymarch", "raymarch"], ["mandelbrot", "mandelbrot"], ["ripples", "shaders"]];

export async function shadersBuilt(): Promise<ShaderBuilt[]> {
  const out: ShaderBuilt[] = [];
  for (const [where, folder] of SECTIONS) {
    // Loaded as ters and the editor load a program (load.ts): on the
    // library's layer, with ids since renamed read as today's (the numbers
    // module's Complex, L207b) and the library's insiders.
    const p = loadProgram(examples + folder), own = p.own, code = p.code, names = p.pres.names;
    const info = infer(code, names, undefined, p.options);
    if (info.errors.length) throw new Error(`${folder}: ${info.errors.map((e) => e.message).join("\n")}`);
    const pres: Presentation = { ...p.pres, hints: {}, style: blocksStyle as unknown as Style };
    const entries = pictureEntries(own.defs, names);
    if (!entries) throw new Error(`${folder}: a picture is a colour, or a red, green and blue, of (x, y, time)`);
    out.push({ where, program: own.defs.map((d) => renderBlocks(code, pres, info, d)).join("\n\n"), picture: await buildPicture(code, info, names, entries) });
  }
  return out;
}
