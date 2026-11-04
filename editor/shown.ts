// Values as the program shows them (L205c): a value of a type with a Shown
// implementation reads through its own `show`, as `show any` and lab
// test's accepted answers do (run.ts showerFor). Making the runner that
// runs those takes a few hundred ms on a big program, so it is made only
// when a value holds such a type, once per check of the code.
import type { Code } from "../ters/src/model.ts";
import type { Names } from "../ters/src/presentation.ts";
import type { Info } from "../ters/src/lang/infer.ts";
import { showerFor, showValue, type Value } from "../ters/src/lang/run.ts";
import { shownImplementations } from "../ters/src/lang/std.ts";

type Shower = (v: Value, asNumber?: boolean) => string;
const kept = new WeakMap<Info, { code: Code; names: Names; show: Shower }>();

export function shower(code: Code, info: Info, names: Names): Shower {
  const was = kept.get(info);
  if (was && was.code === code && was.names === names) return was.show;
  const showns = shownImplementations(info);
  let full: Shower | null = null;
  // Does the value hold one of those types anywhere?
  const holds = (v: Value, depth = 0): boolean => {
    if (typeof v !== "object" || v === null || !("tag" in v) || depth > 64) return false;
    if (showns.has(info.owner.get(v.tag) ?? "")) return true;
    return v.fields.some((x) => holds(x as Value, depth + 1));
  };
  const show: Shower = (v, asNumber = false) => (showns.size && holds(v) ? (full ??= showerFor(code, info, names))(v, asNumber) : showValue(v, code, names, asNumber));
  kept.set(info, { code, names, show });
  return show;
}
