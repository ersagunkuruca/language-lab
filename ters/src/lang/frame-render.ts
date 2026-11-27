// A frame rendered on a canvas (G9b, FRAMES.md): with WebGPU where the
// compiled page printed a site for every draw (gpu-frame.ts), else on the
// CPU (raster.ts). Given to html.ts (useRender) by a page that renders.

import { fromList, type Data, type Value } from "./run-values.ts";
import type { El, Mount } from "./html.ts";
import { rasterize } from "./raster.ts";
import { GpuFrames, sitedOf } from "./gpu-frame.ts";
import { drawnOnGpu } from "./gpu-device.ts";
import { FRAME_V } from "./std-ids.ts";

// A canvas renders with WebGPU when every draw of its first frame has a
// site the compiled page printed (gpu-frame.ts), and with raster.ts on the
// CPU otherwise: a canvas keeps the one kind of context it first gave. While
// WebGPU starts, the latest frame waits and is drawn once it can be.
const rendering = new WeakMap<El, { gpu: GpuFrames | null | "opening"; latest: Value | null }>();
// Every draw with a site (a copy pass has none to have).
const listed = (v: Value): Value[] => (Array.isArray(v) ? v : fromList(v));
const fieldOf = (o: Value, i: number): Value => (o as unknown as Record<string, Value>)[`f${i}`] ?? (o as Data).fields[i];
const allSited = (frame: Value) => listed(fieldOf(frame, 0)).every((p) => (p as Data).tag === FRAME_V.copy || listed(fieldOf(p, 3)).every((d) => sitedOf(d as Data)));
export function renderFrame(e: El, v: Value | null, call: Mount["call"]): void {
  if (v === null) return;
  let r = rendering.get(e);
  if (!r) {
    r = { gpu: null, latest: null };
    rendering.set(e, r);
    if ((globalThis.navigator as Navigator | undefined)?.gpu && allSited(v)) {
      const state = r;
      state.gpu = "opening";
      void GpuFrames.open(e as unknown as HTMLCanvasElement).catch(() => null).then((g) => {
        state.gpu = g;
        // Lists may stay on the GPU only while the frames draw there (G13b).
        drawnOnGpu(!!g);
        if (state.latest !== null) renderFrame(e, state.latest, call);
      });
    }
  }
  r.latest = v;
  if (r.gpu === "opening") return;
  if (r.gpu && r.gpu.draw(v, sitedOf) !== false) return;
  const c = e.getContext?.("2d");
  if (!c?.createImageData || !c.putImageData || v === null) return;
  const w = e.width || 300, h = e.height || 150;
  const img = rasterize(v, w, h, call), out = c.createImageData(w, h);
  out.data.set(img.rgba);
  c.putImageData(out, 0, 0);
}

