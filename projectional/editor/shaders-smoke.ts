// The built shaders.html, and the same pictures in the editor, in a real
// browser, twice: with WebGPU (headless Chromium draws with SwiftShader, a
// GPU in software), where the page's own check of the GPU against the
// evaluator must pass for each picture; and without, where each picture must
// still be drawn on the CPU. Fails on any error the page throws or logs.
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
  await browser.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("shaders.html: ok");
