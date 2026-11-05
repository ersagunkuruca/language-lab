let fuel = Infinity;
let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.unit.unit";
class K1 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K1.prototype.tag = "std.tuple2.tuple";
class K2 { constructor() { } get fields() { return []; } }
K2.prototype.tag = "std.list.nil"; K2.prototype.$c = 0;
class K3 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K3.prototype.tag = "std.list.cons"; K3.prototype.$c = 1;
class K4 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K4.prototype.tag = "box:std.list<type.number<>>";
const c0 = R.closure(f15, [], {"lambda":"f5c8d15c","binders":[],"bools":[]});
const c1 = ["std.list.nil","std.list.cons"];
const c2 = new K0();
const c3 = R.closure(f3, [], {"lambda":"f493042c","binders":[],"bools":[]});
const c4 = R.closure(f5, [], {"lambda":"e7be977b","binders":[],"bools":[]});
const c5 = R.closure(f7, [], {"lambda":"1b412a8e","binders":[],"bools":[]});
const c6 = R.closure(f9, [], {"lambda":"bd74851a","binders":[],"bools":[]});
const c7 = R.closure(f11, [], {"lambda":"e52d8e41","binders":[],"bools":[]});
const c8 = R.closure(f13, [], {"lambda":"087a3b53","binders":[],"bools":[]});
const c9 = new K2();
R.spending(() => --fuel >= 0);
const rt0 = R.rt("number.show", ["builtin.show",false]);
const rt1 = R.rt("derive:builtin.derivative");
const rt2 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// 312088c5: given out, solve for b59a6429 (numeric or periodic: the solver runs it)
const solve$$plan = $planned({"name":"312088c5","ports":["b59a6429","out"],"eqs":[{"lhs":{"k":"var","name":"out"},"rhs":{"k":"call","f":"sub","args":[{"k":"call","f":"sub","args":[{"k":"call","f":"mul","args":[{"k":"call","f":"mul","args":[{"k":"var","name":"b59a6429"},{"k":"var","name":"b59a6429"}]},{"k":"var","name":"b59a6429"}]},{"k":"var","name":"b59a6429"}]},{"k":"num","v":1}]},"law":false}],"vars":["b59a6429","out"]}, ["out"]);
function solve$(v1) {
return $solveRuntime(solve$$plan, { "out": v1 }, ["b59a6429"]);
}
return (...xs) => solve$(xs[0]);
}, true, "solving 312088c5 this way gives exactly one answer, and it gave none");
const rt3 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// 897d2a81: given out, solve for 48f9e767
const solve$$plan = $planned({"name":"897d2a81","ports":["48f9e767","out"],"eqs":[{"lhs":{"k":"var","name":"out"},"rhs":{"k":"call","f":"sub","args":[{"k":"call","f":"mul","args":[{"k":"var","name":"48f9e767"},{"k":"var","name":"48f9e767"}]},{"k":"num","v":2}]},"law":false}],"vars":["48f9e767","out"]}, ["out"]);
function solve$$direct(v1) {
const out = [], seen = new Set();
{
const v0 = Math.sqrt((v1 + 2));
if ($ok(v0)) {
const vals = [$clean(v0), $clean(v1)], key = $key(vals);
if (!seen.has(key)) { seen.add(key); out.push([vals[0]]); }
}
}
{
const v0 = (-Math.sqrt((v1 + 2)));
if ($ok(v0)) {
const vals = [$clean(v0), $clean(v1)], key = $key(vals);
if (!seen.has(key)) { seen.add(key); out.push([vals[0]]); }
}
}
return out;
}
function solve$(v1) {
return solve$$direct(v1) ?? $solveRuntime(solve$$plan, { "out": v1 }, ["48f9e767"]);
}
return (...xs) => solve$(xs[0]);
}, true, "solving 897d2a81 this way gives exactly one answer, and it gave none");
const w0 = R.worlds[0];
function f0() {
  let l0, l1;
  l0 = f26(f2(), c0);
  l1 = w0(("zeros of cubic: " + f18(f21())));
  return w0(("zeros of x² − 2: " + f18(f22())));
}
function f1(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c1))) {
      case 0: {
        return c2;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l5 = l1;
        l6 = R.ck(R.ap(l5, l3));
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
let f2$v;
function f2() { return f2$v ??= f2$w(); }
function f2$w() {
  return new K3(new K1("cubic", c3), new K3(new K1("wave", c4), new K3(new K1("kink", c5), new K3(new K1("bump", c6), new K3(new K1("parabola", c7), new K3(new K1("sinc", c8), c9))))));
}
function f3(l0, l1) {
  let l2, l3;
  return f4(l1);
}
function f4(l0) {
  let l1;
  return ((((l0 * l0) * l0) - l0) - 1);
}
function f5(l0, l1) {
  let l2, l3;
  return f6(l1);
}
function f6(l0) {
  let l1;
  return (Math.cos(l0) - l0);
}
function f7(l0, l1) {
  let l2, l3;
  return f8(l1);
}
function f8(l0) {
  let l1;
  let t0;
  if ((!((l0 - l0) === 0))) {
    t0 = R.stop(22, "c74a5428", "e3d12e0b", "kink");
  } else {
    t0 = l0;
  }
  if ((t0 < 0)) {
    return (-l0);
  } else {
    return (l0 * l0);
  }
}
function f9(l0, l1) {
  let l2, l3;
  return f10(l1);
}
function f10(l0) {
  let l1, l2;
  l1 = Math.sin(l0);
  return (l1 * l1);
}
function f11(l0, l1) {
  let l2, l3;
  return f12(l1);
}
function f12(l0) {
  let l1;
  return ((-2) + (l0 * l0));
}
function f13(l0, l1) {
  let l2, l3;
  return f14(l1);
}
function f14(l0) {
  let l1, l2;
  let t0;
  if ((!((l0 - l0) === 0))) {
    t0 = R.stop(38, "4535c735", "53e6fdde", "sinc");
  } else {
    t0 = l0;
  }
  l1 = t0;
  if ((l1 === 0)) {
    return R.FAIL;
  } else {
    if ((l0 === 0)) {
      return R.stop(48, "c4e2625a", "53e6fdde", "sinc");
    } else {
      let t1;
      if ((!((l0 - l0) === 0))) {
        t1 = R.stop(54, "c4e2625a", "53e6fdde", "sinc");
      } else {
        t1 = l0;
      }
      return (Math.sin(l0) / t1);
    }
  }
}
function f15(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
  l2 = (l1.f1 ?? l1.fields[1]);
  const t2 = depth; let t0 = true;
  t1: try {
    l3 = l2;
    l4 = R.ck(R.ap(l3, 2));
    let t3;
    if ((!((l4 - l4) === 0))) {
      t3 = R.stop(70, "6f43cb29", "f5c8d15c");
    } else {
      t3 = l4;
    }
    l5 = rt0(t3);
    if (l5 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t4;
  if (t0) {
    t4 = l5;
  } else {
    t4 = "none";
  }
  const t7 = depth; let t5 = true;
  t6: try {
    l6 = rt1(l2);
    l7 = R.ck(R.ap(l6, 2));
    let t8;
    if ((!((l7 - l7) === 0))) {
      t8 = R.stop(86, "a2555635", "f5c8d15c");
    } else {
      t8 = l7;
    }
    l8 = rt0(t8);
    if (l8 === R.FAIL) t5 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t7; t5 = false;
  }
  let t9;
  if (t5) {
    t9 = l8;
  } else {
    t9 = "none";
  }
  const t12 = depth; let t10 = true;
  t11: try {
    l9 = R.ck(f16(l2, 1));
    let t13;
    if ((!((l9 - l9) === 0))) {
      t13 = R.stop(134, "f634c732", "f5c8d15c");
    } else {
      t13 = l9;
    }
    l10 = rt0(t13);
    if (l10 === R.FAIL) t10 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t12; t10 = false;
  }
  let t14;
  if (t10) {
    t14 = l10;
  } else {
    t14 = "none found";
  }
  return w0((((((((l1.f0 ?? l1.fields[0]) + ": f(2) = ") + t4) + ", f′(2) = ") + t9) + ", root near 1: ") + t14));
}
function f16(l0, l1) {
  let l2, l3, l4, l5;
  const t3 = depth; const t0 = fuel;
  fuel = 100;
  let t2, t1 = false;
  try {
    t2 = R.ck(f17(l0, rt1(l0), l1));
  } catch (x) {
    if (x !== R.OUT) { fuel = t0; throw x; }
    depth = t3; t1 = true;
  }
  fuel = t0;
  if (t1) {
    return R.FAIL;
    t2 = undefined;
  }
  return t2;
}
function f17(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    if (--fuel < 0) throw R.OUT;
    l4 = l1;
    l5 = R.ck(R.ap(l4, l2));
    let t0;
    if ((l5 === 0)) {
      return R.FAIL;
      t0 = undefined;
    } else {
      l3 = l0;
      let t1;
      if ((!((l5 - l5) === 0))) {
        t1 = R.stop(102, "27121180", "c70cbe01", "newton");
      } else {
        t1 = l5;
      }
      t0 = (R.ck(R.ap(l3, l2)) / t1);
    }
    l6 = (l2 - t0);
    l7 = Math.abs((l6 - l2));
    let t2;
    if ((!((l7 - l7) === 0))) {
      t2 = R.stop(118, "1a374eed", "c70cbe01", "newton");
    } else {
      t2 = l7;
    }
    if ((t2 < 1e-12)) {
      return l6;
    } else {
      const t3 = l0;
      const t4 = l1;
      const t5 = l6;
      l0 = t3;
      l1 = t4;
      l2 = t5;
      continue;
    }
  }
}
function f18(l0) {
  let l1;
  return f19(l0, []);
}
function f19(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return f20(l1, "");
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = (l1.push(l0), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f20(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  for (;;) {
    l0 = l0;
    switch ((l0.length === 0 ? 0 : 1)) {
      case 0: {
        return l1;
      }
      case 1: {
        l2 = l0[l0.length - 1];
        l2 = l2;
        let t0;
        switch ((l2.$c ?? R.caseOf(l2, c1))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            l5 = l4;
            switch ((l5.$c ?? R.caseOf(l5, c1))) {
              case 0: {
                let t1;
                if ((!((l3 - l3) === 0))) {
                  t1 = R.stop(150, "@su0m8djlkg5cq4b68i0klesqia:14", "@su0m8djlkg5cq4b68i0klesqia:5");
                } else {
                  t1 = l3;
                }
                t0 = rt0(t1);
                break;
              }
              case 1: {
                let t2;
                if ((!((l3 - l3) === 0))) {
                  t2 = R.stop(166, "@su0m8djlkg5cq4b68i0klesqia:21", "@su0m8djlkg5cq4b68i0klesqia:5");
                } else {
                  t2 = l3;
                }
                t0 = ((rt0(t2) + " ") + l1);
                break;
              }
            }
            break;
          }
        }
        const t3 = (l0.pop(), l0);
        const t4 = t0;
        l0 = t3;
        l1 = t4;
        continue;
      }
    }
  }
}
let f21$v;
function f21() { return f21$v ??= f21$w(); }
function f21$w() {
  let l0, l1, l2, l3, l4, l5;
  l3 = new K4(c9);
  const t2 = depth; let t0 = true;
  t1: try {
    l5 = f23(rt2(0), l3);
    if (l5 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f24((l3.f0 ?? l3.fields[0]), c9);
  } else {
    t3 = f24((l3.f0 ?? l3.fields[0]), c9);
  }
  return t3;
}
let f22$v;
function f22() { return f22$v ??= f22$w(); }
function f22$w() {
  let l0, l1, l2, l3, l4, l5;
  l3 = new K4(c9);
  const t2 = depth; let t0 = true;
  t1: try {
    l5 = f25(rt3(0), l3);
    if (l5 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f24((l3.f0 ?? l3.fields[0]), c9);
  } else {
    t3 = f24((l3.f0 ?? l3.fields[0]), c9);
  }
  return t3;
}
function f23(l0, l1) {
  if (depth > 1000) return R.drive(f23$h(l0, l1));
  depth++;
  const r = f23$b(l0, l1);
  depth--;
  return r;
}
function f23$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l2 = (l0.f0 ?? l0.fields[0]);
        l3 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l5 = l2;
          l6 = (l5)[0];
          l1.f0 = new K3(l6, (l1.f0 ?? l1.fields[0]));
          l4 = R.FAIL;
          if (l4 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l4;
        } else {
          const t3 = l3;
          const t4 = l1;
          l0 = t3;
          l1 = t4;
          continue;
        }
      }
    }
  }
}
function* f23$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l2 = (l0.f0 ?? l0.fields[0]);
        l3 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l5 = l2;
          l6 = (l5)[0];
          l1.f0 = new K3(l6, (l1.f0 ?? l1.fields[0]));
          l4 = R.FAIL;
          if (l4 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l4;
        } else {
          const t3 = l3;
          const t4 = l1;
          l0 = t3;
          l1 = t4;
          continue;
        }
      }
    }
  }
}
function f24(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K3((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f25(l0, l1) {
  if (depth > 1000) return R.drive(f25$h(l0, l1));
  depth++;
  const r = f25$b(l0, l1);
  depth--;
  return r;
}
function f25$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l2 = (l0.f0 ?? l0.fields[0]);
        l3 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l5 = l2;
          l6 = (l5)[0];
          l1.f0 = new K3(l6, (l1.f0 ?? l1.fields[0]));
          l4 = R.FAIL;
          if (l4 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l4;
        } else {
          const t3 = l3;
          const t4 = l1;
          l0 = t3;
          l1 = t4;
          continue;
        }
      }
    }
  }
}
function* f25$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l2 = (l0.f0 ?? l0.fields[0]);
        l3 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l5 = l2;
          l6 = (l5)[0];
          l1.f0 = new K3(l6, (l1.f0 ?? l1.fields[0]));
          l4 = R.FAIL;
          if (l4 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l4;
        } else {
          const t3 = l3;
          const t4 = l1;
          l0 = t3;
          l1 = t4;
          continue;
        }
      }
    }
  }
}
function f26(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c1))) {
      case 0: {
        return c2;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l6 = R.ck(f15(l1, l3));
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return R.ck(f3(...xs)); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return R.ck(f4(...xs)); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return R.ck(f5(...xs)); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return R.ck(f6(...xs)); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return R.ck(f7(...xs)); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return R.ck(f8(...xs)); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return R.ck(f9(...xs)); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return R.ck(f10(...xs)); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return R.ck(f11(...xs)); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return R.ck(f12(...xs)); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return R.ck(f13(...xs)); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return R.ck(f14(...xs)); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return R.ck(f15(...xs)); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return R.ck(f17(...xs)); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return f18(...xs); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return f19(...xs); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return f20(...xs); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return f21(...xs); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return f22(...xs); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return R.ck(f23(...xs)); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return f24(...xs); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return R.ck(f25(...xs)); } finally { depth = d; } }, f26: (...xs) => { const d = depth; try { return f26(...xs); } finally { depth = d; } } };