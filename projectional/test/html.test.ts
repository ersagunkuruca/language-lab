// The html module (library/html.json): pages written as short calls, which
// build the same std Html values `element` spelled out did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML_MODULE, LIBRARY } from "../src/lang/library.ts";
import { buildHtml } from "../src/lang/html-source.ts";
import { verify } from "../src/lang/modules.ts";
import { infer } from "../src/lang/infer.ts";
import { fromList, makeRunner, toList, type Data, type Value } from "../src/lang/run.ts";
import { HTML_V } from "../src/lang/std.ts";

const lib = (name: string) => HTML_MODULE.exports.find((d) => HTML_MODULE.names[d] === name)!;
const r = makeRunner(LIBRARY.code, infer(LIBRARY.code, LIBRARY.names), { print: () => {} });
const call = (name: string, ...args: Value[]) => [...r.call(r.value(lib(name)), ...args)][0] as Data;

// A view's first answer (functions give their answers as a generator).
const run = (f: Value) => [...(f as () => Iterable<string>)()][0];
// An Html value as a short string: <tag attr="value">children</tag>.
function draw(h: Value): string {
  const d = h as Data;
  if (d.tag === HTML_V.text) return run(d.fields[0]);
  if (d.tag !== HTML_V.element) return "?";
  const [tag, attrs, kids] = d.fields as [string, Value, Value];
  const as = (fromList(attrs) as Data[]).map((a) => a.tag === HTML_V.property ? ` ${a.fields[0]}="${run(a.fields[1])}"` : ` on${a.fields[0]}`).join("");
  return `<${tag}${as}>${(fromList(kids) as Value[]).map(draw).join("")}</${tag}>`;
}

test("the html module is published as built: rebuilding gives the same ids", () => {
  assert.deepEqual(buildHtml(), HTML_MODULE);
  assert.equal(verify(HTML_MODULE, LIBRARY.code, true), null);
});

test("each tag is a function of its children, and attributes wrap it", () => {
  const hello = call("p", toList([call("words", "Hello")]));
  assert.equal(draw(hello), "<p>Hello</p>");
  assert.equal(draw(call("styled", "color: #777", hello)), `<p style="color: #777">Hello</p>`);
  // Wrapping again adds after what's there.
  assert.equal(draw(call("named", "greeting", call("classed", "lead", hello))), `<p class="lead" id="greeting">Hello</p>`);
  assert.equal(draw(call("tag", "main", toList([hello]))), "<main><p>Hello</p></main>");
  // Text has no attributes: it comes back as it is.
  assert.equal(draw(call("styled", "color: red", call("words", "plain"))), "plain");
  assert.equal(draw(call("button", "Roll", () => [] as Value[])), "<button onclick>Roll</button>");
});

test("a style sheet is a list of rules", () => {
  const sheet = call("style sheet", toList([
    [...r.call(r.value(lib("rule")), "h1", "font-size: 28px")][0],
    [...r.call(r.value(lib("media")), "(prefers-color-scheme: dark)", toList([[...r.call(r.value(lib("rule")), ":root", "--bg: #161615")][0]]))][0],
  ] as Value[]));
  assert.equal(draw(sheet), "<style>h1 { font-size: 28px }\n@media (prefers-color-scheme: dark) { :root { --bg: #161615 } }</style>");
  assert.equal([...r.call(r.value(lib("px")), 12)][0], "12px");
  assert.equal([...r.call(r.value(lib("joined")), toList(["a", "b", "c"]), ", ")][0], "a, b, c");
});
