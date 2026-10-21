// Bundles editor/main.ts (and the core it imports) into one self-contained
// HTML file. Needs esbuild: npm install, then npm run build-editor.
//   editor/dist/index.html    open locally in a browser
//   editor/dist/page.html     the same page without the document wrapper

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const out = await build({ entryPoints: [here + "main.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false });
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const page = readFileSync(here + "page.html", "utf8").replace("<script>/*SCRIPT*/</script>", () => `<script>${js}</script>`);
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/page.html", page);
writeFileSync(here + "dist/index.html", `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log(`editor/dist: ${(page.length / 1024).toFixed(0)} KB`);
