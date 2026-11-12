// A page that asks for the microphone (L236b), for the "iOS app"
// workflow's `permission` and ters/test/ios-app.test.ts: its button "go"
// writes "asking", then "microphone: yes" or "microphone: no" by the
// person's answer. Arg: the folder to write.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ASK_PERMISSION_OP, CELL_OPS, HTML_V } from "../../ters/src/lang/std.ts";

const dir = process.argv[2];
if (!dir) throw new Error("permission.ts needs a folder");
const k = new Lang(LIBRARY.code);
const el = (tag: string, attrs: string[], kids: string[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
const text = (f: () => string) => k.call(HTML_V.text, k.thunk(f));
const main = k.def("main");
k.define(main, k.thunk(() => k.let("said", k.call(CELL_OPS.cell, k.lit("idle")), (said) =>
  el("div", [], [
    el("button", [k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.seq(k.call(CELL_OPS.write, said, k.lit("asking")),
      k.call(CELL_OPS.write, said, k.if(k.call(ASK_PERMISSION_OP, k.lit("microphone")), k.lit("microphone: yes"), k.lit("microphone: no"))))))], [text(() => k.lit("go"))]),
    el("p", [], [text(() => k.call(CELL_OPS.read, said))]),
  ]))));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "code.json"), JSON.stringify(k.code));
writeFileSync(join(dir, "names.default.json"), JSON.stringify(k.names));
