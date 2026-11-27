// A page's one WebGPU device (G13, docs/design/targets/GPU-DATA.md): the
// maps' kernels (compiler/src/branches-rt.ts) and the frames' draws
// (gpu-frame.ts) ask for it here, so a buffer one makes the other can bind.
// Null where there is no WebGPU, or no adapter or device. Asked for once.

// What of WebGPU this asks for, typed loosely: the compiler's runtime has
// no DOM types.
interface Gpu { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> } | null> }
let device: Promise<unknown> | undefined;
export function pageDevice<D>(): Promise<D | null> {
  device ??= (async () => {
    const gpu = (globalThis as { navigator?: { gpu?: Gpu } }).navigator?.gpu;
    const adapter = await gpu?.requestAdapter().catch(() => null);
    const dev = await adapter?.requestDevice().catch(() => null);
    if (!dev) return null;
    // A shader or pipeline the device refused says why on the console.
    (dev as { addEventListener?(t: string, f: (e: { error: { message: string } }) => void): void }).addEventListener?.("uncapturederror", (e) => console.error(`WebGPU: ${e.error.message}`));
    return dev;
  })();
  return device as Promise<D | null>;
}
