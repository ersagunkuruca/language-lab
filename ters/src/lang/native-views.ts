// A view of the platform's own in the Android app (L235, FOREIGN.md "A
// view of the platform's own"). On the web the host's function gives a DOM
// element and the border carries it in; the native app's page is C, which
// can't hold an Android View. So for `ters build-native-app` each call of
// an operation that gives Html and that hosts/android.java answers is
// written, before anything is checked or lowered, as the element that
// stands for it: tag `ters-view`, the host's method and the inputs as text,
// each after a unit separator (U+001F). The shell's `box` (cli/native-app.ts)
// sees that tag and calls Hosts' method with the inputs read back as its
// parameters' types, and places the View it gives. The view is as wide as
// its box and, as Android's views don't say their height to the C layout,
// as high as the operation's input named `height` says (CSS px), else
// 240.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import { effectOfOperation, hostCName, hostOp, ownOperations } from "./hosts.ts";
import { HTML_V, INT_OPS, S } from "./std.ts";

export const VIEW_TAG = "ters-view", VIEW_SEP = "\u001f";

// The program with each such call written as its element; null when it
// has none. `answers(op)`: whether the platform's host answers it.
export function nativeViews(code: Code, names: Names, answers: (op: Id) => boolean): Code | null {
  const views = new Set(ownOperations(code).filter((op) => effectOfOperation(code, op) && hostOp(code, names, op).out.k === "view" && answers(op)));
  if (!views.size) return null;
  const k = new Lang(code);
  const nodes = { ...code.nodes };
  let any = false;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call" || !n.args) continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || !views.has(f.target)) continue;
    const op = f.target, h = hostOp(code, names, op), fields = (code.nodes[op] as NodeOf<"variant">).fields;
    // Each input as text, as the shell reads it back.
    const asText = (arg: Id, i: number): Id => {
      switch (h.ins[i].k) {
        case "int": return k.call(INT_OPS.show, arg);
        case "float": return k.call(S.show, arg);
        case "text": return arg;
        case "bool": return k.if(arg, k.lit("true"), k.lit("false"));
        default: throw new Error(`${h.name}'s ${names[fields[i]] ?? i} can't cross to an Android view yet`);
      }
    };
    // The inputs' texts, each named once, for the tag and the height.
    const hi = fields.findIndex((fid, i) => names[fid] === "height" && (h.ins[i].k === "int" || h.ins[i].k === "float"));
    const build = (texts: Id[]): Id => {
      let tag = k.lit(VIEW_TAG + VIEW_SEP + hostCName(op));
      for (const t of texts) tag = k.call(S.concat, tag, k.call(S.concat, k.lit(VIEW_SEP), k.x(t)));
      const height = hi >= 0 ? k.x(texts[hi]) : k.lit("240");
      const style = k.call(HTML_V.property, k.lit("style"), k.thunk(() => k.call(S.concat, k.lit("display: block; height: "), k.call(S.concat, height, k.lit("px")))));
      return k.call(HTML_V.element, tag, k.list(style), k.list());
    };
    const bind = (i: number, texts: Id[]): Id => (i === n.args!.length ? build(texts) : k.let(`input ${i}`, asText(n.args![i], i), (t) => bind(i + 1, [...texts, t])));
    const el = bind(0, []);
    Object.assign(nodes, k.code.nodes);
    nodes[n.id] = { ...nodes[el], id: n.id } as never;
    any = true;
  }
  return any ? { ...code, nodes } : null;
}
