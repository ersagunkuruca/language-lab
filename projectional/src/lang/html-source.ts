// The html module: pages written as short calls instead of `element`
// spelled out. A page is still the std Html rose tree (std.ts, WEB.md);
// everything here is an ordinary function that builds one, so the editor
// shows a page as a tree of calls like any other program, and nothing is a
// node kind of its own.
//
// Three choices make a page short:
//   - An element takes only its children: `p([words("Hello")])`. Most
//     elements have no attributes, so the common case is one argument.
//     Attributes are added by wrapping, `with`, `styled`, `classed`, and
//     read as "styled this way, a paragraph".
//   - Text that doesn't change is `words(t)`; `text(() => …)` stays for text
//     that does.
//   - A style sheet is a list of rules, each a selector and its
//     declarations, so the editor shows it rule by rule instead of as one
//     long text, and it can be a definition of its own. Declarations stay
//     text (`color: #777; margin: 0`): one value per property would be a
//     node per property, which is busier, not calmer.
//
// Prior art: Elm's Html module (Evan Czaplicki), where each tag is a
// function, and Hiccup (James Reeves), markup as plain data. Published like the prelude
// (library/build.ts writes library/html.json).

import { merge, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { PRELUDE } from "./library.ts";
import { CELL_OPS, CONS, HTML_V, NIL, SHOW_ANY, std } from "./std.ts";

export function buildHtml(): Module {
  // Built on the prelude (its append), so the prelude is what it's
  // published against, besides the builtins.
  const known = merge(prelude, std, PRELUDE.code);
  const k = new Lang(known);
  const append = PRELUDE.exports.find((d) => PRELUDE.names[d] === "append")!;
  const el = (tag: Id, attributes: Id, children: Id) => k.call(HTML_V.element, tag, attributes, children);
  const join = (...parts: Id[]) => k.text(...parts);

  // Lists of text joined with a separator between them.
  const joined = k.def("joined");
  k.define(joined, k.fn(["texts", "between"], (xs, between) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit("") },
    {
      variant: CONS, names: ["first", "rest"], results: [null, "rest joined"],
      body: ([first, rest], [, r]) => k.match(rest, [{ variant: NIL, names: [], body: () => first }], join(first, between, r!)),
    },
  ])));

  // An element with these children, by its tag's name.
  const tag = k.def("tag");
  k.define(tag, k.fn(["name", "children"], (name, children) => el(name, NIL, children)));
  const tags = ["div", "span", "p", "h1", "h2", "section", "footer", "label", "ul", "li", "strong"].map((t) => {
    const d = k.def(t);
    k.define(d, k.fn(["children"], (children) => el(k.lit(t), NIL, children)));
    return d;
  });
  const input = k.def("input");
  k.define(input, k.fn(["attributes"], (attributes) => el(k.lit("input"), attributes, NIL)));

  const words = k.def("words");
  k.define(words, k.fn(["text"], (t) => k.call(HTML_V.text, k.thunk(() => t))));

  const attribute = k.def("attribute");
  k.define(attribute, k.fn(["name", "value"], (name, value) => k.call(HTML_V.property, name, k.thunk(() => value))));

  const button = k.def("button");
  k.define(button, k.fn(["label", "then"], (label, then) =>
    el(k.lit("button"), k.list(k.call(HTML_V.on, k.lit("click"), then)), k.list(k.call(words, label)))));

  const withAttributes = k.def("with");
  k.define(withAttributes, k.fn(["attributes", "html"], (extra, html) => k.match(html, [
    { variant: HTML_V.element, names: ["tag", "own", "children"], body: ([t, own, children]) => el(t, k.call(append, own, extra), children) },
  ], html)));

  const styled = k.def("styled");
  k.define(styled, k.fn(["style", "html"], (st, html) => k.call(withAttributes, k.list(k.call(attribute, k.lit("style"), st)), html)));
  const named = k.def("named");
  k.define(named, k.fn(["id", "html"], (id, html) => k.call(withAttributes, k.list(k.call(attribute, k.lit("id"), id)), html)));
  const classed = k.def("classed");
  k.define(classed, k.fn(["class", "html"], (c, html) => k.call(withAttributes, k.list(k.call(attribute, k.lit("class"), c)), html)));

  const rule = k.def("rule");
  k.define(rule, k.fn(["selector", "declarations"], (sel, ds) => join(sel, k.lit(" { "), ds, k.lit(" }"))));
  const media = k.def("media");
  k.define(media, k.fn(["query", "rules"], (q, rules) => join(k.lit("@media "), q, k.lit(" { "), k.call(joined, rules, k.lit(" ")), k.lit(" }"))));
  const stylesheet = k.def("style sheet");
  k.define(stylesheet, k.fn(["rules"], (rules) => el(k.lit("style"), NIL, k.list(k.call(words, k.call(joined, rules, k.lit("\n")))))));

  // A list on the page that keeps its rows: an item still in the list keeps
  // the row drawn for it, with whatever it holds (a cell, focus, what's
  // typed), and only new items get a row. Solid's <For> (prior art).
  const forEach = k.def("for each");
  k.define(forEach, k.fn(["items", "row", "inside"], (items, row, inside) =>
    k.let("rows", k.call(CELL_OPS.each, items, row), (rows) => k.call(HTML_V.part, k.thunk(() => k.call(inside, k.call(CELL_OPS.read, rows)))))));

  const px = k.def("px");
  k.define(px, k.fn(["n"], (n) => join(k.call(SHOW_ANY, n), k.lit("px"))));

  const offered: Id[] = [tag, ...tags, input, words, button, attribute, withAttributes, styled, named, classed, forEach, rule, media, stylesheet, px, joined];
  const comments: Record<Id, string> = {
    [tag]: "An element with these children, for a tag that has no function of its own here (main, nav, table, …). Each tag a function, as in Elm's Html module (prior art).",
    [tags[0]]: "A div with these children. To give it attributes, wrap it: styled, classed, with.",
    [input]: "An input field: it has attributes and no children.",
    [words]: "Text that doesn't change. Text that does is text(() => …), which the page runs again when what it reads changes.",
    [button]: "A button with this label that runs then when it's clicked.",
    [attribute]: "An attribute whose value doesn't change.",
    [withAttributes]: "The same element with these attributes added after its own. Text and parts have no attributes, so they come back as they are.",
    [styled]: "The same element with this inline style (CSS declarations, such as color: #777; margin: 0).",
    [named]: "The same element with this id.",
    [classed]: "The same element in this class, for a style sheet's rules to select.",
    [forEach]: "The items of a cell's list, each drawn by row and all put inside (ul, div, …). An item still there when the list changes keeps its row as it was; only new items get one. Solid's <For> (prior art).",
    [rule]: "A style sheet rule: a selector and its declarations. A style sheet is a list of these, so it shows rule by rule instead of as one long text.",
    [media]: "Rules that apply only when the query holds, such as (prefers-color-scheme: dark).",
    [stylesheet]: "A style element holding these rules.",
    [px]: "A length in pixels, from a Number or an Int.",
    [joined]: "The texts with between between each two of them.",
  };
  const p = publish(merge(known, k.code), k.names, offered, known);
  if (!p.ok) throw new Error(`the html module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  // The prelude's append travels with it, pinned as the prelude pins it.
  return makeModule("html", p.code, p.names, offered.map(at), { ...PRELUDE.pins, ...p.pins }, notes);
}
