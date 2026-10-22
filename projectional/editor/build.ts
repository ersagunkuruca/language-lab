// Bundles editor/main.ts (and the core it imports) into one self-contained
// HTML file. Needs esbuild: npm install, then npm run build-editor.
//   editor/dist/index.html    open locally in a browser
//   editor/dist/page.html     the same page without the document wrapper
//   editor/dist/tutorial.html TUTORIAL.md as a page, with its screenshots

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { markdown } from "./markdown.ts";

const here = new URL(".", import.meta.url).pathname;
const out = await build({ entryPoints: [here + "main.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false });
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const page = readFileSync(here + "page.html", "utf8").replace("<script>/*SCRIPT*/</script>", () => `<script>${js}</script>`);
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/page.html", page);
writeFileSync(here + "dist/index.html", `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log(`editor/dist: ${(page.length / 1024).toFixed(0)} KB`);

// The tutorial, styled like the editor (same colours and fonts).
const tokens = page.slice(page.indexOf(":root {"), page.indexOf("* { box-sizing"));
const fonts = /<link rel="stylesheet" href="https:\/\/fonts[^>]*>/.exec(page)?.[0] ?? "";
writeFileSync(here + "dist/tutorial.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Language tutorial</title>
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
</style>
</head>
<body>
<main>
<nav><a href="./">← Back to the editor</a></nav>
${markdown(readFileSync(here + "../TUTORIAL.md", "utf8"))}
</main>
</body>
</html>
`);
cpSync(here + "../tutorial", here + "dist/tutorial", { recursive: true });
