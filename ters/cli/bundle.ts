// ters as one file (I272): `node cli/bundle.ts [-o ters.mjs]`. The command
// line with its sources, the library and the styles inside, so ters runs
// where language-lab isn't checked out: another repository's teammates
// and CI install it with
//   curl -LO https://ersagunkuruca.github.io/language-lab/ters.mjs
//   node ters.mjs git-setup
// (the Pages site builds it, .github/workflows/pages.yml). It needs Node
// 22.18 or later and nothing else. What it keeps between runs goes to
// ~/.cache/ters (io.ts keptDir). Compiling to a JavaScript module or a
// page bundles the runtime's sources, so those commands need a checkout.

import { build } from "esbuild";
import { join, resolve } from "node:path";

const o = process.argv.indexOf("-o");
const out = resolve(o >= 0 ? process.argv[o + 1] : join(import.meta.dirname, "..", "..", "ters.mjs"));

export async function bundleTers(file: string) {
  await build({
    entryPoints: [join(import.meta.dirname, "ters.ts")],
    bundle: true, platform: "node", format: "esm", target: "node22", outfile: file, logLevel: "warning",
    // Asked for only by the commands that need a checkout, or a browser.
    external: ["esbuild", "playwright-core", "happy-dom"],
    // A bundled module has no `require`; a few dependencies ask for one.
    banner: { js: `// ters, the Ters command line, as one file: node ters.mjs help\nimport { createRequire as __tersRequire } from "node:module"; const require = __tersRequire(import.meta.url);` },
  });
}

if (import.meta.main) {
  await bundleTers(out);
  process.stderr.write(`wrote ${out}\n`);
}
