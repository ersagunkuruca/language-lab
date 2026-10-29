// Bundles editor/main.ts (and the core it imports) into one self-contained
// HTML file. Needs esbuild: npm install, then npm run build-editor.
// It writes to the repository root, and the Pages workflow publishes the
// repository with these pages in it, so the editor is the site's home page.
// They are build output, not committed (.gitignore):
//   index.html     the editor; open it locally too
//   tutorial.html  TUTORIAL.md as a page, its screenshots read from
//                  projectional/tutorial/
//   guide.html     GUIDE.md the same way (screenshots in projectional/guide/)
//   reactive.html  the Cells programs running live (editor/reactive.ts)
//   shaders.html   a program compiled to WGSL, drawn by WebGPU
//                  (editor/shaders.ts)
//   apps/*.html    web apps written in the language (examples/converter, examples/dice, examples/pig, examples/tumble, examples/pedal),
//                  each one file built like `lab build-web` (WEB.md)

import { build } from "esbuild";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { markdown } from "./markdown.ts";
import { mkdirSync } from "node:fs";
import { pageRuntime, recordings, webPage, workletRuntime } from "../cli/web.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";

const here = new URL(".", import.meta.url).pathname;
const site = here + "../../";
// What the editor's "Save page" puts before a page's compiled program.
// The worker Run uses (editor/runWorker.ts), as text the editor starts.
const worker = await build({ entryPoints: [here + "runWorker.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false });
const out = await build({ entryPoints: [here + "main.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false, define: { PAGE_RUNTIME: JSON.stringify(await pageRuntime()), RUN_WORKER: JSON.stringify(worker.outputFiles[0].text), WORKLET_RUNTIME: JSON.stringify(await workletRuntime()) } });
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const page = readFileSync(here + "page.html", "utf8").replace("<script>/*SCRIPT*/</script>", () => `<script>${js}</script>`);
writeFileSync(site + "index.html", `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log(`index.html: ${(page.length / 1024).toFixed(0)} KB`);

// The tutorial, styled like the editor (same colours and fonts).
const tokens = page.slice(page.indexOf(":root {"), page.indexOf("* { box-sizing"));
const fonts = /<link rel="stylesheet" href="https:\/\/fonts[^>]*>/.exec(page)?.[0] ?? "";
// Links in the docs are relative to projectional/; the pages are at the root.
const docPage = (md: string, out: string, title: string) => {
  const body = markdown(readFileSync(here + "../" + md, "utf8"))
    .replace(/(src|href)="(?![a-z]+:|#|\/|index\.html|tutorial\.html|guide\.html)/g, '$1="projectional/');
  writeFileSync(site + out, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${fonts}
<style>
${tokens}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 var(--font-ui); }
main { max-width: 46rem; margin: 0 auto; padding: 24px 16px 80px; }
nav { font-size: 14px; margin-bottom: 8px; }
a { color: var(--accent); }
h1, h2, h3 { line-height: 1.25; margin: 1.6em 0 0.5em; }
h1 { font-size: 30px; margin-top: 0.4em; }
h2 { font-size: 23px; } h3 { font-size: 18px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2.5em 0; }
code, pre { font-family: var(--font-code); font-size: 0.88em; }
:not(pre) > code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; line-height: 1.45; }
table { border-collapse: collapse; width: 100%; font-size: 14px; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
figure { margin: 1.2em 0; }
img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { color: var(--muted); font-size: 13px; margin-top: 4px; }
figure.embed iframe { width: 100%; height: 560px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
</style>
</head>
<body>
<main>
<nav><a href="./">← Back to the editor</a></nav>
${body}
</main>
</body>
</html>
`);
};
docPage("TUTORIAL.md", "tutorial.html", "Language tutorial");
// The hands-on start (GUIDE.md): the editor's Learn button opens it.
docPage("GUIDE.md", "guide.html", "A hands-on guide to the editor and the language");

// The Cells page: reactive.html's text around editor/reactive.ts.
const rout = await build({ entryPoints: [here + "reactive.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false });
const rjs = rout.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
writeFileSync(site + "reactive.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cells: reactivity and values on demand</title>
${fonts}
<style>
${tokens}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 var(--font-ui); }
main { max-width: 72rem; margin: 0 auto; padding: 24px 16px 80px; }
nav { font-size: 14px; }
a { color: var(--accent); }
h1 { font-size: 30px; line-height: 1.25; margin: 0.6em 0 0.4em; }
h2 { font-size: 21px; margin: 0 0 12px; }
p { max-width: 46rem; }
code, pre { font-family: var(--font-code); font-size: 0.86em; }
:not(pre) > code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
.hint, .credits, .log { color: var(--muted); font-size: 14px; }
.log { font-variant-numeric: tabular-nums; min-height: 1.6em; margin: 8px 0; }
.demo { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin: 28px 0; }
.pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .pair { grid-template-columns: minmax(0, 1fr); } }
pre.code { margin: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow: auto; max-height: 34rem; line-height: 1.45; font-size: 12.5px; }
.live { font-size: 15px; }
.ui-column { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.ui-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
lab-part > .ui-column { gap: 6px; }
.ui-text { padding: 1px 6px; border-radius: 6px; font-family: var(--font-code); font-size: 14px; overflow-wrap: anywhere; }
.ui-button { font: inherit; font-size: 14px; padding: 4px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
.ui-button:hover { border-color: var(--accent); }
.ui-entry { font: inherit; font-size: 14px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); min-width: 16rem; }
.ui-slider { display: flex; gap: 10px; align-items: center; font-size: 14px; }
.ui-slider-label { min-width: 3.5em; color: var(--muted); }
.ui-slider input { width: 14rem; accent-color: var(--accent); }
.ui-slider output { font-variant-numeric: tabular-nums; min-width: 2em; }
@keyframes ran { from { background: var(--hot-soft); box-shadow: 0 0 0 2px var(--hot); } to { background: transparent; box-shadow: 0 0 0 2px transparent; } }
.ran { animation: ran 0.9s ease-out; }
</style>
</head>
<body>
${readFileSync(here + "reactive.html", "utf8")}<script>${rjs}</script>
</body>
</html>
`);

// The shaders page: shaders.html's text around editor/shaders.ts.
const sout = await build({ entryPoints: [here + "shaders.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false });
const sjs = sout.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
writeFileSync(site + "shaders.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shaders: the language on the GPU</title>
${fonts}
<style>
${tokens}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 var(--font-ui); }
main { max-width: 72rem; margin: 0 auto; padding: 24px 16px 80px; }
nav { font-size: 14px; }
a { color: var(--accent); }
h1 { font-size: 30px; line-height: 1.25; margin: 0.6em 0 0.4em; }
h2 { font-size: 21px; margin: 0 0 12px; }
p { max-width: 46rem; }
code, pre { font-family: var(--font-code); font-size: 0.86em; }
:not(pre) > code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
.hint, .credits, .log { color: var(--muted); font-size: 14px; }
.log { font-variant-numeric: tabular-nums; min-height: 1.6em; margin: 8px 0 0; }
.demo { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin: 28px 0; }
.pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .pair { grid-template-columns: minmax(0, 1fr); } }
pre.code { margin: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow: auto; max-height: 34rem; line-height: 1.45; font-size: 12.5px; }
.picture { display: block; width: 100%; aspect-ratio: 1; border-radius: 8px; background: #000; }
details { margin-top: 16px; }
summary { cursor: pointer; color: var(--muted); font-size: 14px; }
details .pair { margin-top: 10px; }
</style>
</head>
<body>
${readFileSync(here + "shaders.html", "utf8")}<script>${sjs}</script>
</body>
</html>
`);
console.log("shaders.html");

// The web apps: each example program whose main is a page, as one file.
mkdirSync(site + "apps", { recursive: true });
for (const name of ["converter", "dice", "pig", "tumble", "pedal"]) {
  const p = loadProgram(here + "../examples/" + name);
  const info = infer(p.code, p.pres.names, undefined, p.options);
  writeFileSync(site + `apps/${name}.html`, await webPage(name[0].toUpperCase() + name.slice(1), p.code, info, p.pres.names, p.named("main")));
  console.log(`apps/${name}.html`);
  // The recordings a page with sound plays (AUDIO.md), beside it.
  for (const f of recordings(p.code)) copyFileSync(here + `../examples/${name}/${f}`, site + `apps/${f}`);
}
