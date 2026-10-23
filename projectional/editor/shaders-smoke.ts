// The built shaders.html, and the same pictures in the editor, in a real
// browser, twice: with WebGPU (headless Chromium draws with SwiftShader, a
// GPU in software), where the page's own check of the GPU against the
// evaluator must pass for each picture; and without, where each picture must
// still be drawn on the CPU. Then each way, a soak: the pictures move for
// 10 s, and the page must stay responsive and keep drawing frames on time
// (a frame loop that hangs after a few seconds passes the first-frame
// checks). Fails on any error the page throws or logs.
//
//   npm run build-editor && npm run smoke-shaders
//
// It uses the Chromium in CHROMIUM if set, otherwise the installed Chrome.

import { chromium } from "playwright-core";

const url = new URL("../../shaders.html?time=2", import.meta.url).href;
const errors: string[] = [];
const GPU = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader", "--use-gl=angle"];

for (const [label, args] of [["with WebGPU", GPU], ["without WebGPU", ["--disable-features=WebGPU"]]] as const) {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: "chrome" }), args: [...args] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => errors.push(`${label}: ${e.stack ?? e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector("body[data-ready]", { timeout: 120_000 });
  if ((await page.locator("body").getAttribute("data-ready")) !== "true") errors.push(`${label}: the page stopped with an error`);
  for (const section of ["raymarch", "ripples"]) {
    const where = `${label}, ${section}`;
    const $ = (c: string) => page.locator(`#${section} .${c}`);
    const status = await $("status").innerText();
    const worst = await $("check").getAttribute("data-worst");
    console.log(`${where}: ${status}${worst ? `; largest difference from the evaluator ${worst}` : ""}`);
    if (label === "with WebGPU") {
      if (!status.startsWith("WebGPU")) errors.push(`${where}: didn't draw with WebGPU: ${status}`);
      if (worst === null || !(Number(worst) < 2e-3)) errors.push(`${where}: the GPU is ${worst} away from the evaluator`);
    } else if (!status.includes("on the CPU")) errors.push(`${where}: didn't fall back to the CPU: ${status}`);
    // The middle of the picture isn't black.
    const box = (await $("picture").boundingBox())!;
    await $("picture").scrollIntoViewIfNeeded();
    const shot = await $("picture").screenshot();
    const lit = await page.evaluate(async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4) / 3;
    }, shot.toString("base64"));
    if (!box || lit < 20) errors.push(`${where}: the middle of the picture is black (average ${lit.toFixed(0)} of 255)`);
  }
  // The editor draws the same pictures above Run (editor/picture.ts).
  await page.goto(new URL("../../index.html", import.meta.url).href);
  for (const program of ["Shader: ripples", "Shader: ray marching"]) {
    await page.locator(".nav-row:not([data-def])", { hasText: program }).first().click();
    const said = page.locator(".picture-box p");
    await page.waitForFunction(() => !/…/.test(document.querySelector(".picture-box p")?.textContent ?? "…"), null, { timeout: 120_000 }).catch(() => {});
    const status = await said.innerText().catch(() => "no picture");
    console.log(`${label}, the editor's ${program}: ${status}`);
    if (label === "with WebGPU" ? !status.startsWith("WebGPU") : !status.includes("on the CPU")) errors.push(`${label}: the editor didn't draw ${program}: ${status}`);
  }
  await soak(page, label);
  await browser.close();
}

// The pictures moving for 10 s. Every second the page must answer within a
// second, the browser must have shown a frame within the last half second,
// and each picture must say it's still drawing at a usable rate. The limits
// are loose on purpose: SwiftShader on a CI runner is slow, and what this
// catches is a loop that stops or freezes the page, not a slow one.
async function soak(page: import("playwright-core").Page, label: string) {
  await page.goto(new URL("../../shaders.html", import.meta.url).href);
  await page.waitForSelector("body[data-ready]", { timeout: 120_000 });
  await page.evaluate(() => {
    const w = window as unknown as { longest: number };
    w.longest = 0;
    let last = performance.now();
    const frame = (t: number) => { w.longest = Math.max(w.longest, t - last); last = t; requestAnimationFrame(frame); };
    requestAnimationFrame(() => requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); }));
  });
  const rate = (status: string) => {
    const fps = /(\d+) frames a second/.exec(status), ms = /(\d+) ms a frame/.exec(status);
    return fps ? Number(fps[1]) : ms ? 1000 / Number(ms[1]) : 0;
  };
  let slowest = 0, worstRate = Infinity;
  for (let second = 1; second <= 10; second++) {
    await page.waitForTimeout(1000);
    const asked = Date.now();
    const said = await Promise.race([
      page.evaluate(() => [...document.querySelectorAll("section .status")].map((e) => e.textContent ?? "")),
      new Promise<null>((go) => setTimeout(() => go(null), 5000)),
    ]);
    const answered = Date.now() - asked;
    slowest = Math.max(slowest, answered);
    if (!said) { errors.push(`${label}, soak: the page didn't answer for 5 s after ${second} s`); return; }
    if (answered > 1000) errors.push(`${label}, soak: the page took ${answered} ms to answer after ${second} s`);
    // The first second's status may still be the starting one.
    if (second > 1) for (const status of said) {
      worstRate = Math.min(worstRate, rate(status));
      if (rate(status) < 2) errors.push(`${label}, soak: a picture stopped drawing after ${second} s: ${status}`);
    }
  }
  const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest);
  console.log(`${label}, soak: 10 s; the page answered within ${slowest} ms, the longest gap between frames was ${Math.round(longest)} ms, the slowest picture drew ${worstRate.toFixed(0)} frames a second`);
  if (longest > 500) errors.push(`${label}, soak: the browser went ${Math.round(longest)} ms without a frame`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("shaders.html: ok");
