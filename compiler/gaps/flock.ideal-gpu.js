// flock-frame-page (BACKLOG G9d to G11, FRAMES.md's stage 2 round) written
// by hand for WebGPU in the browser: the same birds as flock.ideal.js
// (Float64Array columns, the grid a counting sort each tick), the same
// camera, and the same frame: the floor's image copied once into a
// texture; the floor, its grid and the top of the box, every bird's
// shadow and every bird into a texture; how far away each point is into
// another; then the first faded into the night by the second. Seven draws
// a frame, as the Ters page makes. What crosses to the GPU is only what
// changed: the birds' places and velocities as one Float32Array a frame,
// which the three draws of birds share, and the camera's turn and tilt.
// The meshes, the lines and the floor's image go once.
//
// startFlock(canvas, birds, floorPpm) runs it on a canvas of 640 × 600 and
// gives `stop`. compiler/gaps/bench-frames.ts measures it beside the page.

const SIDE = 120, SC = 12, CELLS = SC * SC * SC, STEP = 1 / 30;
const rnd = (s) => (s * 16807) % 2147483647;
const chance = (s) => s / 2147483647;
const along = (c) => Math.floor(c / 10) % SC;
const kept = (c) => Math.min(Math.max(c, 0), SIDE - 0.001);
const away = (c) => (c < 15 ? 0.08 : c > SIDE - 15 ? 0 - 0.08 : 0);
const swept = (tick, period) => { const u = tick % (2 * period), p = period; return u < p ? 25 + 70 * u / p : 95 - 70 * (u - p) / p; };

// The flock of flock.ideal.js, a tick at a time.
function makeFlock(n) {
  let x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
  let nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n), nvx = new Float64Array(n), nvy = new Float64Array(n), nvz = new Float64Array(n);
  const near = new Int32Array(n), cell = new Int32Array(n), order = new Int32Array(n), start = new Int32Array(CELLS + 1), fill = new Int32Array(CELLS);
  for (let i = 0; i < n; i++) {
    const s = rnd(i * 7919 + 13), a = rnd(s), b = rnd(a), c = rnd(b), d = rnd(c);
    x[i] = 20 + 80 * chance(s); y[i] = 20 + 80 * chance(a); z[i] = 20 + 80 * chance(b);
    vx[i] = chance(c) - 0.5; vy[i] = chance(d) - 0.5; vz[i] = chance(rnd(d)) - 0.5;
  }
  const f = { tick: 0, x, y, z, vx, vy, vz };
  f.step = () => {
    const tick = f.tick;
    start.fill(0);
    for (let i = 0; i < n; i++) { cell[i] = (along(z[i]) * SC + along(y[i])) * SC + along(x[i]); start[cell[i] + 1]++; }
    for (let c = 0; c < CELLS; c++) { start[c + 1] += start[c]; fill[c] = start[c + 1]; }
    for (let i = 0; i < n; i++) order[--fill[cell[i]]] = i;
    const gx = swept(tick, 450), gy = swept(tick, 610), gz = swept(tick, 370);
    for (let i = 0; i < n; i++) {
      const px = x[i], py = y[i], pz = z[i];
      let sx = 0, sy = 0, sz = 0, hx = 0, hy = 0, hz = 0, cx = 0, cy = 0, cz = 0, count = 0;
      const ax = along(px), ay = along(py), az = along(pz);
      let m = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (((az + dz + SC) % SC) * SC + (ay + dy + SC) % SC) * SC + (ax + dx + SC) % SC;
        for (let r = start[k]; r < start[k + 1]; r++) {
          const j = order[r];
          const ox = x[j] - px, oy = y[j] - py, oz = z[j] - pz, d2 = ox * ox + oy * oy + oz * oz;
          if (d2 < 100 && d2 > 0) { let q = m++; while (q > 0 && near[q - 1] > j) { near[q] = near[q - 1]; q--; } near[q] = j; }
        }
      }
      for (let q = 0; q < m; q++) {
        const j = near[q];
        const ox = x[j] - px, oy = y[j] - py, oz = z[j] - pz, inv = 1 / (ox * ox + oy * oy + oz * oz);
        sx = sx - ox * inv; sy = sy - oy * inv; sz = sz - oz * inv;
        hx += vx[j]; hy += vy[j]; hz += vz[j]; cx += ox; cy += oy; cz += oz; count++;
      }
      const ux = gx - px, uy = gy - py, uz = gz - pz, ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      let tx = 0, ty = 0, tz = 0;
      if (ul > 0) { const r = 1 / ul; tx = ux * r; ty = uy * r; tz = uz * r; }
      tx = tx * 0.012 + away(px); ty = ty * 0.012 + away(py); tz = tz * 0.012 + away(pz);
      const v0x = vx[i], v0y = vy[i], v0z = vz[i];
      let wx, wy, wz;
      if (count === 0) { wx = v0x + tx; wy = v0y + ty; wz = v0z + tz; }
      else {
        const inv = 1 / count, g = 0.03 / count;
        wx = v0x + ((sx * 0.3 + (hx * inv - v0x) * 0.12) + (cx * g + tx));
        wy = v0y + ((sy * 0.3 + (hy * inv - v0y) * 0.12) + (cy * g + ty));
        wz = v0z + ((sz * 0.3 + (hz * inv - v0z) * 0.12) + (cz * g + tz));
      }
      const sp = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (sp > 1.8) { const r = 1.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      else if (sp < 0.8 && sp > 0) { const r = 0.8 / sp; wx = wx * r; wy = wy * r; wz = wz * r; }
      nvx[i] = wx; nvy[i] = wy; nvz[i] = wz;
      nx[i] = kept(px + wx); ny[i] = kept(py + wy); nz[i] = kept(pz + wz);
    }
    [x, nx] = [nx, x]; [y, ny] = [ny, y]; [z, nz] = [nz, z]; [vx, nvx] = [nvx, vx]; [vy, nvy] = [nvy, vy]; [vz, nvz] = [nvz, vz];
    Object.assign(f, { x, y, z, vx, vy, vz });
    f.tick++;
  };
  return f;
}

// A P3 file's width, height and texels as RGBA bytes.
function ppm(text) {
  const ns = text.split("\n").flatMap((l) => l.split("#")[0].split(/\s+/)).filter((w) => w !== "").slice(1).map(Number);
  const [w, h, m] = ns, bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { for (let k = 0; k < 3; k++) bytes[i * 4 + k] = Math.round((ns[3 + i * 3 + k] / m) * 255); bytes[i * 4 + 3] = 255; }
  return { w, h, bytes };
}

// The camera and the shapes, as the page's functions are: seen_by,
// clip_of, raised, dart_point, line_corner, the colours and the fog.
const COMMON = /* wgsl */ `
struct Cam { turn: f32, tilt: f32, _a: f32, _b: f32 }
@group(0) @binding(0) var<uniform> cam: Cam;
fn seen(p: vec3f) -> vec3f {
  let q = p - vec3f(60.0);
  let x1 = q.x * cos(cam.turn) - q.z * sin(cam.turn);
  let z1 = q.x * sin(cam.turn) + q.z * cos(cam.turn);
  let y1 = q.y * cos(cam.tilt) + z1 * sin(cam.tilt);
  let z2 = z1 * cos(cam.tilt) - q.y * sin(cam.tilt) + 230.0;
  return vec3f(320.0 + 560.0 * x1 / z2, 300.0 - 560.0 * y1 / z2, z2);
}
fn clipOf(p: vec3f) -> vec4f { let q = seen(p); return vec4f((q.x - 320.0) * 0.003125, (300.0 - q.y) * 0.0033333333333333335, q.z * 0.001, 1.0); }
fn unit(a: vec3f) -> vec3f { let l = length(a); if (l > 0.0) { return a / l; } return vec3f(0.0); }
fn dart(place: vec3f, velocity: vec3f, c: vec2f) -> vec3f { let u = unit(velocity); return place + u * c.x + unit(vec3f(-u.z, 0.0, u.x)) * c.y; }
fn fogged(d: f32) -> f32 { return clamp((d - 180.0) * 0.008, 0.0, 1.0); }
struct Bird { place: vec3f, velocity: vec3f }
@group(0) @binding(1) var<storage, read> birds: array<f32>;
fn birdAt(i: u32) -> Bird { let k = i * 6u; return Bird(vec3f(birds[k], birds[k + 1u], birds[k + 2u]), vec3f(birds[k + 3u], birds[k + 4u], birds[k + 5u])); }
struct Out { @builtin(position) at: vec4f, @location(0) v: vec2f }
`;
const SHADERS = {
  floor: `@group(0) @binding(2) var ground: texture_2d<f32>; @group(0) @binding(3) var lin: sampler;
@vertex fn vs(@location(0) c: vec3f) -> Out { var p = clipOf(c); p.z += 0.002; return Out(p, vec2f(c.x / ${SIDE}.0, c.z / ${SIDE}.0)); }
@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(textureSampleLevel(ground, lin, o.v, 0.0).rgb, 1.0); }`,
  line: `@group(0) @binding(2) var<storage, read> lines: array<f32>;
@vertex fn vs(@builtin(instance_index) i: u32, @location(0) c: vec3f) -> Out {
  let k = i * 6u;
  let a = clipOf(vec3f(lines[k], lines[k + 1u], lines[k + 2u])); let b = clipOf(vec3f(lines[k + 3u], lines[k + 4u], lines[k + 5u]));
  let dx = (b.x - a.x) * 320.0; let dy = (b.y - a.y) * 300.0; let n = sqrt(dx * dx + dy * dy + 0.000001);
  return Out(vec4f(a.x + (b.x - a.x) * c.x - dy / n * c.y * 0.003125, a.y + (b.y - a.y) * c.x + dx / n * c.y * 0.0033333333333333335, a.z + (b.z - a.z) * c.x + 0.001, 1.0), vec2f(0.0));
}
@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(0.47, 0.63, 0.82, 0.3); }`,
  shadow: `@vertex fn vs(@builtin(instance_index) i: u32, @location(0) c: vec3f) -> Out { let b = birdAt(i); let p = dart(b.place, b.velocity, c.xy); return Out(clipOf(vec3f(p.x, 0.0, p.z)), vec2f(0.0)); }
@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 0.35); }`,
  bird: `@vertex fn vs(@builtin(instance_index) i: u32, @location(0) c: vec3f) -> Out { let b = birdAt(i); return Out(clipOf(dart(b.place, b.velocity, c.xy)), vec2f(seen(b.place).z, 0.0)); }
@fragment fn fs(o: Out) -> @location(0) vec4f { let t = clamp((o.v.x - 170.0) * 0.008333333333333333, 0.0, 1.0); return vec4f(0.96 - 0.58 * t, 0.95 - 0.53 * t, 0.9 - 0.36 * t, 1.0); }`,
  floorFar: `@vertex fn vs(@location(0) c: vec3f) -> Out { var p = clipOf(c); p.z += 0.002; return Out(p, vec2f(seen(c).z, 0.0)); }
@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(fogged(o.v.x), 0.0, 0.0, 1.0); }`,
  birdFar: `@vertex fn vs(@builtin(instance_index) i: u32, @location(0) c: vec3f) -> Out { let b = birdAt(i); return Out(clipOf(dart(b.place, b.velocity, c.xy)), vec2f(seen(b.place).z, 0.0)); }
@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(fogged(o.v.x), 0.0, 0.0, 1.0); }`,
  fog: `@group(0) @binding(2) var scene: texture_2d<f32>; @group(0) @binding(3) var lin: sampler; @group(0) @binding(4) var farTex: texture_2d<f32>;
@vertex fn vs(@location(0) c: vec3f) -> Out { return Out(vec4f(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.5, 1.0), c.xy); }
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let s = textureSampleLevel(scene, lin, o.v, 0.0); let f = textureSampleLevel(farTex, lin, o.v, 0.0).r;
  return vec4f(s.r + (0.043 - s.r) * f, s.g + (0.071 - s.g) * f, s.b + (0.125 - s.b) * f, 1.0);
}`,
};

export async function startFlock(canvas, n, floorPpm) {
  const adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu"), format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const W = 640, H = 600, TEX = "rgba8unorm";
  const buffer = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  const texture = (w, h, usage) => device.createTexture({ size: [w, h], format: TEX, usage: usage | GPUTextureUsage.TEXTURE_BINDING });
  // Sent once: the meshes, the lines, the floor's image.
  const quad = (pts) => ({ corners: buffer(new Float32Array(pts), GPUBufferUsage.VERTEX), triangles: buffer(new Uint32Array([0, 1, 2, 0, 2, 3]), GPUBufferUsage.INDEX), count: 6 });
  const floorMesh = quad([0, 0, 0, SIDE, 0, 0, SIDE, 0, SIDE, 0, 0, SIDE]);
  const lineMesh = quad([0, -0.75, 0, 1, -0.75, 0, 1, 0.75, 0, 0, 0.75, 0]);
  const screenMesh = quad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const birdMesh = { corners: buffer(new Float32Array([0, 0, 0, -4, 0.9, 0, -3, 0, 0, -4, -0.9, 0]), GPUBufferUsage.VERTEX), triangles: buffer(new Uint32Array([0, 1, 2, 0, 2, 3]), GPUBufferUsage.INDEX), count: 6 };
  const corner = (i) => [i & 1 ? SIDE : 0, i >= 4 ? SIDE : 0, (i >> 1) & 1 ? SIDE : 0];
  const lineList = [...[0, 30, 60, 90, 120].flatMap((c) => [[c, 0, 0, c, 0, SIDE], [0, 0, c, SIDE, 0, c]]), ...[[4, 5], [5, 7], [7, 6], [6, 4]].map(([a, b]) => [...corner(a), ...corner(b)])];
  const lines = buffer(new Float32Array(lineList.flat()), GPUBufferUsage.STORAGE);
  const floor = ppm(floorPpm), ground = texture(floor.w, floor.h, GPUTextureUsage.COPY_DST);
  device.queue.writeTexture({ texture: ground }, floor.bytes, { bytesPerRow: floor.w * 4 }, [floor.w, floor.h]);
  const scene = texture(W, H, GPUTextureUsage.RENDER_ATTACHMENT), far = texture(W, H, GPUTextureUsage.RENDER_ATTACHMENT);
  const depth = device.createTexture({ size: [W, H], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const lin = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  // Sent when they change: the camera, and the birds each frame.
  const cam = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const birds = device.createBuffer({ size: Math.max(16, n * 24), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const words = new Float32Array(n * 6), camWords = new Float32Array(4);
  const blend = { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
  const pipe = (code, fmt, tested, extra) => {
    const module = device.createShaderModule({ code: COMMON + code });
    const p = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
      fragment: { module, entryPoint: "fs", targets: [{ format: fmt, blend }] },
      primitive: { topology: "triangle-list" },
      ...(tested ? { depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" } } : {}),
    });
    // The fog pass reads no camera, so its layout has no binding 0.
    const entries = [...(code === SHADERS.fog ? [] : [{ binding: 0, resource: { buffer: cam } }]), ...extra];
    return { p, group: device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }) };
  };
  const withBirds = [{ binding: 1, resource: { buffer: birds } }];
  const draws = {
    floor: pipe(SHADERS.floor, TEX, true, [{ binding: 2, resource: ground.createView() }, { binding: 3, resource: lin }]),
    line: pipe(SHADERS.line, TEX, true, [{ binding: 2, resource: { buffer: lines } }]),
    shadow: pipe(SHADERS.shadow, TEX, true, withBirds),
    bird: pipe(SHADERS.bird, TEX, true, withBirds),
    floorFar: pipe(SHADERS.floorFar, TEX, true, []),
    birdFar: pipe(SHADERS.birdFar, TEX, true, withBirds),
    fog: pipe(SHADERS.fog, format, false, [{ binding: 2, resource: scene.createView() }, { binding: 3, resource: lin }, { binding: 4, resource: far.createView() }]),
  };
  const draw = (rp, d, mesh, instances) => { rp.setPipeline(d.p); rp.setBindGroup(0, d.group); rp.setVertexBuffer(0, mesh.corners); rp.setIndexBuffer(mesh.triangles, "uint32"); rp.drawIndexed(mesh.count, instances); };
  const pass = (enc, view, clear, tested) => enc.beginRenderPass({
    colorAttachments: [{ view, clearValue: clear, loadOp: "clear", storeOp: "store" }],
    ...(tested ? { depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } } : {}),
  });
  const night = { r: 11 / 255, g: 18 / 255, b: 32 / 255, a: 1 };
  const flock = makeFlock(n);
  let yaw = 0.6, pitch = 0.35, spare = 0, last = performance.now(), sentYaw = NaN, running = true;
  const frame = (now) => {
    if (!running) return;
    // The page's fixed step: as many ticks as the spare seconds hold, at most two a frame.
    spare += (now - last) / 1000; last = now;
    for (let k = 0; spare >= STEP; k++) { if (k === 2) { spare = 0; break; } flock.step(); yaw += 0.003; spare -= STEP; }
    const enc = device.createCommandEncoder();
    if (yaw !== sentYaw) { camWords[0] = yaw; camWords[1] = pitch; device.queue.writeBuffer(cam, 0, camWords); sentYaw = yaw; }
    const { x, y, z, vx, vy, vz } = flock;
    for (let i = 0, k = 0; i < n; i++, k += 6) { words[k] = x[i]; words[k + 1] = y[i]; words[k + 2] = z[i]; words[k + 3] = vx[i]; words[k + 4] = vy[i]; words[k + 5] = vz[i]; }
    device.queue.writeBuffer(birds, 0, words);
    let rp = pass(enc, scene.createView(), night, true);
    draw(rp, draws.floor, floorMesh, 1); draw(rp, draws.line, lineMesh, lineList.length); draw(rp, draws.shadow, birdMesh, n); draw(rp, draws.bird, birdMesh, n);
    rp.end();
    rp = pass(enc, far.createView(), { r: 1, g: 0, b: 0, a: 1 }, true);
    draw(rp, draws.floorFar, floorMesh, 1); draw(rp, draws.birdFar, birdMesh, n);
    rp.end();
    rp = pass(enc, ctx.getCurrentTexture().createView(), night, false);
    draw(rp, draws.fog, screenMesh, 1);
    rp.end();
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return { stop: () => { running = false; } };
}
