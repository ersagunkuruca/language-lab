// The built shaders.html in a real browser, twice: with WebGPU (headless
// Chromium draws with SwiftShader, a GPU in software), where the page's own
// check of the GPU against the evaluator must pass; and without, where the
// page must fall back to WebAssembly and still draw. Fails on any error the
// page throws or logs.
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
  await page.waitForSelector("body[data-ready]", { timeout: 60_000 });
  const status = await page.locator("#status").innerText();
  const worst = await page.locator("#check").getAttribute("data-worst");
  console.log(`${label}: ${status}${worst ? `; largest difference from the evaluator ${worst}` : ""}`);
  if ((await page.locator("body").getAttribute("data-ready")) !== "true") errors.push(`${label}: the page stopped with an error`);
  if (label === "with WebGPU") {
    if (!status.startsWith("WebGPU")) errors.push(`${label}: didn't draw with WebGPU: ${status}`);
    if (worst === null || !(Number(worst) < 2e-3)) errors.push(`${label}: the GPU is ${worst} away from the evaluator`);
  } else if (!status.includes("WebAssembly")) errors.push(`${label}: didn't fall back to WebAssembly: ${status}`);
  // The middle of the picture isn't black.
  const box = (await page.locator("#picture").boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x + box.width / 2 - 20, y: box.y + box.height / 2 - 20, width: 40, height: 40 } });
  const lit = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  }, shot.toString("base64"));
  if (lit < 20) errors.push(`${label}: the middle of the picture is black (average ${lit.toFixed(0)} of 255)`);
  await browser.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("shaders.html: ok");
