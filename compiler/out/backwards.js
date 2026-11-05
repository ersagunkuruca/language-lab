let fuel = Infinity;
let depth = 0;
class K0 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K0.prototype.tag = "box:text";
class K1 { constructor() { } get fields() { return []; } }
K1.prototype.tag = "std.list.nil"; K1.prototype.$c = 0;
class K2 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K2.prototype.tag = "std.list.cons"; K2.prototype.$c = 1;
class K3 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K3.prototype.tag = "box:std.list<type.number<>>";
class K4 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K4.prototype.tag = "box:std.list<type.string<>>";
class K5 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K5.prototype.tag = "box:f64";
class K6 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K6.prototype.tag = "box:std.list<std.list<type.number<>>>";
class K7 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K7.prototype.tag = "std.tuple2.tuple";
const c0 = new K1();
const c1 = new K2(9, c0);
const c2 = new K2(4, c1);
const c3 = R.closure(f15, [], {"lambda":"deff62dd","binders":[],"bools":[]});
const c4 = ["std.list.nil","std.list.cons"];
const c5 = R.closure(f13, [], {"lambda":"66369cc6","binders":[],"bools":[]});
R.spending(() => --fuel >= 0);
const rt0 = R.rt("number.show", ["builtin.show",false]);
const rt1 = R.rt("solveAll:a024521c");
const rt2 = R.moded(($no, $eq, $int, F, K) => {
// f5057927, run with its result known
function f5057927$mode0(p$0) {
const m$1 = K[0];
if (!p$0.startsWith(m$1)) return $no;
const m$2 = p$0.slice(m$1.length);
return m$2;
}
// f5057927, run backwards (semidet): its plan written out
function solve$(g0) {
const r = f5057927$mode0(g0);
return r === $no ? [] : [[r]];
}
function solve$$one(g0) {
return f5057927$mode0(g0);
}
return solve$;
}, [], ["hello, "], true, "solving f5057927 this way gives exactly one answer, and it gave none");
const rt3 = R.rt("solveAll:5387641d.use");
const rt4 = R.rt("solveAll:a26f67ce");
const rt5 = R.rt("solveAll:f0a9de91");
const rt6 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// 055b62ce: given 0c032c6a, out, solve for b7fdf2c1
const solve$$plan = $planned({"name":"055b62ce","ports":["0c032c6a","b7fdf2c1","out"],"eqs":[{"lhs":{"k":"var","name":"out"},"rhs":{"k":"call","f":"atan2","args":[{"k":"var","name":"b7fdf2c1"},{"k":"var","name":"0c032c6a"}]},"law":false}],"vars":["0c032c6a","b7fdf2c1","out"]}, ["0c032c6a","out"]);
function solve$$direct(v0, v2) {
const out = [];
{
const v1 = (v0 * Math.tan(v2));
if ($ok(v1) && (v0 * Math.cos(v2)) >= -1e-9) {
out.push([$clean(v1)]);
}
}
return out;
}
function solve$(v0, v2) {
return solve$$direct(v0, v2) ?? $solveRuntime(solve$$plan, { "0c032c6a": v0, "out": v2 }, ["b7fdf2c1"]);
}
function solve$$one(v0, v2) {
{
const v1 = (v0 * Math.tan(v2));
if ($ok(v1) && (v0 * Math.cos(v2)) >= -1e-9) {
return $clean(v1);
}
}
return $no;
}
return (...xs) => solve$(xs[0], xs[1]);
}, true, "solving 055b62ce this way gives exactly one answer, and it gave none");
const w0 = R.worlds[0];
function f0() {
  let l0, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25;
  l0 = w0(("magnitudes to(5) = " + f1(f4(5))));
  l1 = w0(("who was greeted(\"hello, Ada\") = " + f5("hello, Ada")));
  l2 = w0(("who was greeted(\"goodbye\") = " + f5("goodbye")));
  l3 = w0(("cuts(\"abc\") = " + f6(f9("abc"))));
  l14 = new K0("");
  const t2 = depth; let t0 = true;
  t1: try {
    l16 = f10("10 20 30", R.closure(f17, [l14]));
    if (l16 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = (l14.f0 ?? l14.fields[0]);
  } else {
    t3 = "unreadable";
  }
  l5 = w0(("read numbers(\"10 20 30\") = " + t3));
  l17 = new K0("");
  const t6 = depth; let t4 = true;
  t5: try {
    l19 = f10("10  20", R.closure(f18, [l17]));
    if (l19 === R.FAIL) t4 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t6; t4 = false;
  }
  let t7;
  if (t4) {
    t7 = (l17.f0 ?? l17.fields[0]);
  } else {
    t7 = "unreadable";
  }
  l7 = w0(("read numbers(\"10  20\") = " + t7));
  l8 = w0(("square roots of each([4, 9]) = " + f6(f31(f12(c2), c3))));
  l20 = new K0("");
  const t10 = depth; let t8 = true;
  t9: try {
    l22 = f16(2.356194490192345, (-2), R.closure(f19, [l20]));
    if (l22 === R.FAIL) t8 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t10; t8 = false;
  }
  let t11;
  if (t8) {
    t11 = (l20.f0 ?? l20.fields[0]);
  } else {
    t11 = "none";
  }
  l11 = w0(("height on the ray(3π/4, −2) = " + t11));
  l23 = new K0("");
  const t14 = depth; let t12 = true;
  t13: try {
    l25 = f16(2.356194490192345, 2, R.closure(f20, [l23]));
    if (l25 === R.FAIL) t12 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t14; t12 = false;
  }
  let t15;
  if (t12) {
    t15 = (l23.f0 ?? l23.fields[0]);
  } else {
    t15 = "none";
  }
  return w0(("height on the ray(3π/4, 2) = " + t15));
}
function f1(l0) {
  let l1;
  return f2(l0, []);
}
function f2(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return f3(l1, "");
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
function f3(l0, l1) {
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
        switch ((l2.$c ?? R.caseOf(l2, c4))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            l5 = l4;
            switch ((l5.$c ?? R.caseOf(l5, c4))) {
              case 0: {
                let t1;
                if ((!((l3 - l3) === 0))) {
                  t1 = R.stop(22, "@su0m8djlkg5cq4b68i0klesqia:14", "@su0m8djlkg5cq4b68i0klesqia:5");
                } else {
                  t1 = l3;
                }
                t0 = rt0(t1);
                break;
              }
              case 1: {
                let t2;
                if ((!((l3 - l3) === 0))) {
                  t2 = R.stop(38, "@su0m8djlkg5cq4b68i0klesqia:21", "@su0m8djlkg5cq4b68i0klesqia:5");
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
function f4(l0) {
  let l1, l2, l3, l4, l5, l6, l7;
  l4 = new K3(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l6 = f21(rt1(l0), l4);
    if (l6 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f22((l4.f0 ?? l4.fields[0]), c0);
  } else {
    t3 = f22((l4.f0 ?? l4.fields[0]), c0);
  }
  return t3;
}
function f5(l0) {
  let l1, l2, l3, l4, l5, l6, l7;
  l4 = new K0("");
  const t2 = depth; let t0 = true;
  t1: try {
    l6 = f23(rt2(l0), l4);
    if (l6 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = (l4.f0 ?? l4.fields[0]);
  } else {
    t3 = "nobody";
  }
  return t3;
}
function f6(l0) {
  let l1;
  return f7(l0, []);
}
function f7(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return f8(l1, "");
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
function f8(l0, l1) {
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
        switch ((l2.$c ?? R.caseOf(l2, c4))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            l5 = l4;
            switch ((l5.$c ?? R.caseOf(l5, c4))) {
              case 0: {
                t0 = l3;
                break;
              }
              case 1: {
                t0 = ((l3 + " ") + l1);
                break;
              }
            }
            break;
          }
        }
        const t1 = (l0.pop(), l0);
        const t2 = t0;
        l0 = t1;
        l1 = t2;
        continue;
      }
    }
  }
}
function f9(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9;
  l6 = new K4(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l8 = f24(rt3(l0), l6);
    if (l8 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f25((l6.f0 ?? l6.fields[0]), c0);
  } else {
    t3 = f25((l6.f0 ?? l6.fields[0]), c0);
  }
  return t3;
}
function f10(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
  l6 = new K5(fuel);
  const t2 = depth; let t0 = true;
  t1: try {
    const t6 = depth; const t3 = fuel;
    fuel = 10000;
    let t5, t4 = false;
    try {
      t5 = R.ck(f26(rt4(l0), l6, l1));
    } catch (x) {
      if (x !== R.OUT) { fuel = t3; throw x; }
      depth = t6; t4 = true;
    }
    fuel = t3;
    if (t4) {
      { t0 = false; break t1; }
      t5 = undefined;
    }
    l13 = t5;
    if (l13 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  if (t0) {
    const t7 = fuel;
    fuel = (l6.f0 ?? l6.fields[0]);
    l14 = t7;
    if (((l6.f0 ?? l6.fields[0]) < 0)) {
      return R.FAIL;
    } else {
      return l13;
    }
  } else {
    const t8 = fuel;
    fuel = (l6.f0 ?? l6.fields[0]);
    l15 = t8;
    return R.FAIL;
  }
}
function f11(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f30(l0, l1, c0);
}
function f12(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
  l6 = new K6(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = new K5(fuel);
    const t5 = depth; let t3 = true;
    t4: try {
      const t9 = depth; const t6 = fuel;
      fuel = 10000;
      let t8, t7 = false;
      try {
        t8 = R.ck(f27(rt5(c5, l0), l7, l6));
      } catch (x) {
        if (x !== R.OUT) { fuel = t6; throw x; }
        depth = t9; t7 = true;
      }
      fuel = t6;
      if (t7) {
        { t3 = false; break t4; }
        t8 = undefined;
      }
      l13 = t8;
      if (l13 === R.FAIL) t3 = false;
    } catch (x) {
      if (x !== R.FAIL) throw x;
      depth = t5; t3 = false;
    }
    if (t3) {
      const t10 = fuel;
      fuel = (l7.f0 ?? l7.fields[0]);
      l14 = t10;
      if (((l7.f0 ?? l7.fields[0]) < 0)) {
        l16 = R.FAIL;
      } else {
        l16 = l13;
      }
    } else {
      const t11 = fuel;
      fuel = (l7.f0 ?? l7.fields[0]);
      l15 = t11;
      l16 = R.FAIL;
    }
    if (l16 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t12;
  if (t0) {
    t12 = f28((l6.f0 ?? l6.fields[0]), c0);
  } else {
    t12 = f28((l6.f0 ?? l6.fields[0]), c0);
  }
  return t12;
}
function f13(l0, l1) {
  let l2, l3;
  return f14(l1);
}
function f14(l0) {
  let l1;
  return (l0 * l0);
}
function f15(l0, l1) {
  let l2, l3;
  return (("[" + f1(l1)) + "]");
}
function f16(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9;
  return f29(rt6(l1, l0), l2);
}
function f17(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = (("[" + f1(l1)) + "]");
  return true;
}
function f18(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = (("[" + f1(l1)) + "]");
  return true;
}
function f19(l0, l1) {
  let l2, l3, l4, l5;
  l2 = l0.caps[0];
  l3 = l1;
  let t0;
  if ((!((l3 - l3) === 0))) {
    t0 = R.stop(54, "649a3d07", "81acb745", "main");
  } else {
    t0 = l3;
  }
  l2.f0 = rt0(t0);
  return true;
}
function f20(l0, l1) {
  let l2, l3, l4, l5;
  l2 = l0.caps[0];
  l3 = l1;
  let t0;
  if ((!((l3 - l3) === 0))) {
    t0 = R.stop(70, "5202d561", "81acb745", "main");
  } else {
    t0 = l3;
  }
  l2.f0 = rt0(t0);
  return true;
}
function f21(l0, l1) {
  if (depth > 1000) return R.drive(f21$h(l0, l1));
  depth++;
  const r = f21$b(l0, l1);
  depth--;
  return r;
}
function f21$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l1.f0 = new K2(l6, (l1.f0 ?? l1.fields[0]));
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
function* f21$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l1.f0 = new K2(l6, (l1.f0 ?? l1.fields[0]));
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
function f22(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K2((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
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
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l1.f0 = l6;
          l4 = true;
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
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l1.f0 = l6;
          l4 = true;
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
  if (depth > 1000) return R.drive(f24$h(l0, l1));
  depth++;
  const r = f24$b(l0, l1);
  depth--;
  return r;
}
function f24$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l7 = (l5)[1];
          l8 = new K7(l6, l7);
          l1.f0 = new K2((((l8.f0 ?? l8.fields[0]) + "|") + (l8.f1 ?? l8.fields[1])), (l1.f0 ?? l1.fields[0]));
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
function* f24$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l7 = (l5)[1];
          l8 = new K7(l6, l7);
          l1.f0 = new K2((((l8.f0 ?? l8.fields[0]) + "|") + (l8.f1 ?? l8.fields[1])), (l1.f0 ?? l1.fields[0]));
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
function f25(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K2((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f26(l0, l1, l2) {
  if (depth > 1000) return R.drive(f26$h(l0, l1, l2));
  depth++;
  const r = f26$b(l0, l1, l2);
  depth--;
  return r;
}
function f26$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l6 = l3;
          l7 = (l6)[0];
          l8 = l7;
          if (((l1.f0 ?? l1.fields[0]) < 0)) {
            l5 = R.FAIL;
          } else {
            const t3 = fuel;
            fuel = (l1.f0 ?? l1.fields[0]);
            l10 = t3;
            const t6 = depth; let t4 = true;
            t5: try {
              l9 = l2;
              l11 = R.ap(l9, l8);
              if (l11 === R.FAIL) t4 = false;
            } catch (x) {
              if (x !== R.FAIL && x !== R.OUT) throw x;
              depth = t6; t4 = false;
            }
            if (t4) {
              const t7 = fuel;
              fuel = l10;
              l1.f0 = t7;
              l5 = l11;
            } else {
              const t8 = fuel;
              fuel = l10;
              l1.f0 = t8;
              l5 = R.FAIL;
            }
          }
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t9 = l4;
          const t10 = l1;
          const t11 = l2;
          l0 = t9;
          l1 = t10;
          l2 = t11;
          continue;
        }
      }
    }
  }
}
function* f26$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l6 = l3;
          l7 = (l6)[0];
          l8 = l7;
          if (((l1.f0 ?? l1.fields[0]) < 0)) {
            l5 = R.FAIL;
          } else {
            const t3 = fuel;
            fuel = (l1.f0 ?? l1.fields[0]);
            l10 = t3;
            const t6 = depth; let t4 = true;
            t5: try {
              l9 = l2;
              l11 = R.ap(l9, l8);
              if (l11 === R.FAIL) t4 = false;
            } catch (x) {
              if (x !== R.FAIL && x !== R.OUT) throw x;
              depth = t6; t4 = false;
            }
            if (t4) {
              const t7 = fuel;
              fuel = l10;
              l1.f0 = t7;
              l5 = l11;
            } else {
              const t8 = fuel;
              fuel = l10;
              l1.f0 = t8;
              l5 = R.FAIL;
            }
          }
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t9 = l4;
          const t10 = l1;
          const t11 = l2;
          l0 = t9;
          l1 = t10;
          l2 = t11;
          continue;
        }
      }
    }
  }
}
function f27(l0, l1, l2) {
  if (depth > 1000) return R.drive(f27$h(l0, l1, l2));
  depth++;
  const r = f27$b(l0, l1, l2);
  depth--;
  return r;
}
function f27$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l6 = l3;
          l7 = (l6)[0];
          l8 = l7;
          if (((l1.f0 ?? l1.fields[0]) < 0)) {
            l5 = R.FAIL;
          } else {
            const t3 = fuel;
            fuel = (l1.f0 ?? l1.fields[0]);
            l9 = t3;
            const t6 = depth; let t4 = true;
            t5: try {
              l2.f0 = new K2(l8, (l2.f0 ?? l2.fields[0]));
              l10 = R.FAIL;
              if (l10 === R.FAIL) t4 = false;
            } catch (x) {
              if (x !== R.FAIL && x !== R.OUT) throw x;
              depth = t6; t4 = false;
            }
            if (t4) {
              const t7 = fuel;
              fuel = l9;
              l1.f0 = t7;
              l5 = l10;
            } else {
              const t8 = fuel;
              fuel = l9;
              l1.f0 = t8;
              l5 = R.FAIL;
            }
          }
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t9 = l4;
          const t10 = l1;
          const t11 = l2;
          l0 = t9;
          l1 = t10;
          l2 = t11;
          continue;
        }
      }
    }
  }
}
function* f27$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l6 = l3;
          l7 = (l6)[0];
          l8 = l7;
          if (((l1.f0 ?? l1.fields[0]) < 0)) {
            l5 = R.FAIL;
          } else {
            const t3 = fuel;
            fuel = (l1.f0 ?? l1.fields[0]);
            l9 = t3;
            const t6 = depth; let t4 = true;
            t5: try {
              l2.f0 = new K2(l8, (l2.f0 ?? l2.fields[0]));
              l10 = R.FAIL;
              if (l10 === R.FAIL) t4 = false;
            } catch (x) {
              if (x !== R.FAIL && x !== R.OUT) throw x;
              depth = t6; t4 = false;
            }
            if (t4) {
              const t7 = fuel;
              fuel = l9;
              l1.f0 = t7;
              l5 = l10;
            } else {
              const t8 = fuel;
              fuel = l9;
              l1.f0 = t8;
              l5 = R.FAIL;
            }
          }
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t9 = l4;
          const t10 = l1;
          const t11 = l2;
          l0 = t9;
          l1 = t10;
          l2 = t11;
          continue;
        }
      }
    }
  }
}
function f28(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K2((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f29(l0, l1) {
  if (depth > 1000) return R.drive(f29$h(l0, l1));
  depth++;
  const r = f29$b(l0, l1);
  depth--;
  return r;
}
function f29$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l7 = l1;
          l4 = R.ap(l7, l6);
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
function* f29$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
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
          l7 = l1;
          l4 = R.ap(l7, l6);
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
function f30(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c4))) {
      case 0: {
        return f25(l2, c0);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l6 = l1;
        l7 = l6(l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K2(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f31(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f32(l0, l1, c0);
}
function f32(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c4))) {
      case 0: {
        return f25(l2, c0);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l7 = f15(l1, l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K2(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return f3(...xs); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return f4(...xs); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return f5(...xs); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return f8(...xs); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return f9(...xs); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return R.ck(f10(...xs)); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return f11(...xs); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return R.ck(f13(...xs)); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return f14(...xs); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return f15(...xs); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return R.ck(f17(...xs)); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return R.ck(f18(...xs)); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return R.ck(f19(...xs)); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return R.ck(f20(...xs)); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return R.ck(f21(...xs)); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return f22(...xs); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return R.ck(f23(...xs)); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return R.ck(f24(...xs)); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return f25(...xs); } finally { depth = d; } }, f26: (...xs) => { const d = depth; try { return R.ck(f26(...xs)); } finally { depth = d; } }, f27: (...xs) => { const d = depth; try { return R.ck(f27(...xs)); } finally { depth = d; } }, f28: (...xs) => { const d = depth; try { return f28(...xs); } finally { depth = d; } }, f29: (...xs) => { const d = depth; try { return R.ck(f29(...xs)); } finally { depth = d; } }, f30: (...xs) => { const d = depth; try { return f30(...xs); } finally { depth = d; } }, f31: (...xs) => { const d = depth; try { return f31(...xs); } finally { depth = d; } }, f32: (...xs) => { const d = depth; try { return f32(...xs); } finally { depth = d; } } };