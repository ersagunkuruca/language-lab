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

// Whether the page's frames draw with WebGPU (gpu-frame.ts, once opened):
// only then may a list stay on the GPU, a draw its only reader there.
let frames = false;
export const framesOnGpu = () => frames;
export const drawnOnGpu = (on: boolean) => { frames = on; };

// A list kept on the GPU between ticks (G13b, GPU-DATA.md): the buffer of
// its items' words, `words` an item, `n` items. A kernel takes its buffer
// as its items and a draw as its instances; nothing on the CPU reads its
// items, but a test or a value viewer may await `items()`, which maps the
// buffer back. Never equal to another: each tick's is new. Its buffer is
// freed when nothing holds it.
interface Freed { destroy(): void }
const freed = typeof FinalizationRegistry === "undefined" ? null : new FinalizationRegistry<Freed>((b) => b.destroy());
export class GpuItems {
  readonly onGpu = true;
  readonly buffer: unknown;
  readonly n: number;
  readonly words: number;
  readonly items: () => Promise<unknown[]>;
  constructor(buffer: unknown, n: number, words: number, items: () => Promise<unknown[]>) {
    this.buffer = buffer; this.n = n; this.words = words; this.items = items;
    freed?.register(this, buffer as Freed);
  }
}
export const isGpuItems = (x: unknown): x is GpuItems => x instanceof GpuItems;
