// A small page written with the DSL, for the web tests (compiler/test/
// web.test.ts, test/web.test.ts): a temperature converter whose fields
// bind by running backwards, a counter, and a todo list with a part that
// redraws. Elements carry ids so a test can find them.

import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CELL_OPS, HTML_V, NONE, S, SOME } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

const C = CELL_OPS;
const VALUE = "std.event.event.value", KEY = "std.event.event.key";

export function pageProgram() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
  const read = (c: Id) => k.call(C.read, c);
  const el = (tag: string, attrs: Id[], kids: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...kids));
  const prop = (name: string, f: () => Id) => k.call(HTML_V.property, k.lit(name), k.thunk(f));
  const on = (name: string, f: (e: Id) => Id) => k.call(HTML_V.on, k.lit(name), k.fn(["event"], f));
  const text = (f: () => Id) => k.call(HTML_V.text, k.thunk(f));

  const fahrenheit = k.def("as fahrenheit");
  k.define(fahrenheit, k.fn(["c"], (c) => k.call(S.show, k.call(B.add, k.call(B.div, k.call(B.mul, c, k.lit(9)), k.lit(5)), k.lit(32)))));
  const celsius = k.def("as celsius");
  k.define(celsius, k.fn(["c"], (c) => k.call(S.show, c)));
  const portOf = (f: Id) => (k.code.nodes[(k.code.nodes[f] as { body: Id }).body] as { params: Id[] }).params[0];
  // A field showing view(read(cell)); typing writes what view, run
  // backwards from the text, gives; text with no answer changes nothing.
  const field = (id: string, view: Id, cell: Id) => el("input", [
    prop("id", () => k.lit(id)),
    prop("value", () => k.call(view, read(cell))),
    on("input", (e) => k.match(k.call(S.optional, k.thunk(() => k.solve(view, { out: k.call(VALUE, e) }, { [portOf(view)]: "c" }, (b) => b[portOf(view)]))), [
      { variant: SOME, names: ["c"], body: ([c]) => k.call(C.write, cell, c) },
      { variant: NONE, names: [], body: () => k.unitValue },
    ])),
  ], []);

  const main = k.def("main");
  k.define(main, k.thunk(() =>
    k.let("celsius", k.call(C.cell, k.lit(20)), (temp) =>
    k.let("count", k.call(C.cell, k.lit(0)), (count) =>
    k.let("todos", k.call(C.cell, k.list(k.lit("milk"))), (todos) =>
    k.let("draft", k.call(C.cell, k.lit("")), (draft) =>
      el("div", [prop("class", () => k.lit("app"))], [
        field("c", celsius, temp),
        field("f", fahrenheit, temp),
        el("button", [prop("id", () => k.lit("plus")), on("click", () => k.call(C.write, count, k.call(B.add, read(count), k.lit(1))))], [text(() => k.lit("+"))]),
        el("span", [prop("id", () => k.lit("count"))], [text(() => k.call(S.show, read(count)))]),
        el("input", [prop("id", () => k.lit("new")), prop("value", () => read(draft)),
          on("input", (e) => k.call(C.write, draft, k.call(VALUE, e))),
          on("keydown", (e) => k.if(k.equal(k.call(KEY, e), k.lit("Enter")),
            k.seq(k.call(C.write, todos, k.call(lib("append"), read(todos), k.list(read(draft)))), k.call(C.write, draft, k.lit(""))),
            k.unitValue))], []),
        k.call(HTML_V.part, k.thunk(() => k.call(HTML_V.element, k.lit("ul"), k.list(),
          k.call(lib("map"), read(todos), k.fn(["todo"], (t) => el("li", [], [text(() => t)])))))),
      ])))))));
  return { k, main };
}
