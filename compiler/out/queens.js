let depth = 0;
class K0 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K0.prototype.tag = "box:std.list<type.number<>>";
class K1 { constructor() { } get fields() { return []; } }
K1.prototype.tag = "std.list.nil"; K1.prototype.$c = 0;
class K2 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K2.prototype.tag = "box:int";
class K3 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K3.prototype.tag = "box:std.list<std.list<type.number<>>>";
class K4 { constructor() { } get fields() { return []; } }
K4.prototype.tag = "std.list<type.number<>>.frames.done"; K4.prototype.$c = 0;
class K5 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K5.prototype.tag = "std.list<type.number<>>.frames.frame"; K5.prototype.$c = 1;
class K6 { constructor() { } get fields() { return []; } }
K6.prototype.tag = "std.unit.unit";
class K7 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K7.prototype.tag = "std.list.cons"; K7.prototype.$c = 1;
const c0 = new K1();
const c1 = R.closure(f13, []);
const c2 = R.closure(f15, []);
const c3 = new K4();
const c4 = ["std.list.nil","std.list.cons"];
const c5 = ["std.list<type.number<>>.frames.done","std.list<type.number<>>.frames.frame"];
const c6 = R.closure(f10, []);
const c7 = new K6();
const rt0 = R.rt("int.show", ["builtin.int.show",false]);
const rt1 = R.rt("number.range", ["builtin.range",false]);
const rt2 = R.rt("number.show", ["builtin.show",false]);
const rt3 = R.rt("int.add", ["builtin.int.add",false]);
const w0 = R.worlds[0];
function f0() {
  let l0, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16;
  l7 = new K0(null);
  const t2 = depth; let t0 = true;
  t1: try {
    l9 = f4(8, R.closure(f16, [l7]));
    if (l9 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = (l7.f0 ?? l7.fields[0]);
  } else {
    t3 = c0;
  }
  l1 = w0(("first solution for 8: " + f1(t3)));
  l10 = new K2((0));
  const t6 = depth; let t4 = true;
  t5: try {
    l13 = f4(8, R.closure(f17, [l10]));
    if (l13 === R.FAIL) t4 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t6; t4 = false;
  }
  let t7;
  if (t4) {
    t7 = (l10.f0 ?? l10.fields[0]);
  } else {
    t7 = (l10.f0 ?? l10.fields[0]);
  }
  l3 = w0(("solutions for 8: " + rt0(t7)));
  l4 = w0("all solutions for 6:");
  l14 = new K3(c0);
  const t10 = depth; let t8 = true;
  t9: try {
    l16 = f4(6, R.closure(f18, [l14]));
    if (l16 === R.FAIL) t8 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t10; t8 = false;
  }
  let t11;
  if (t8) {
    t11 = f19((l14.f0 ?? l14.fields[0]), c0);
  } else {
    t11 = f19((l14.f0 ?? l14.fields[0]), c0);
  }
  l6 = f23(t11, c1);
  return w0(("even numbers below 10: " + f1(f24(rt1(10), c2))));
}
function f1(l0) {
  let l1;
  return f2(l0, c3);
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
        const t1 = new K5(l0, l1);
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
    switch ((l0.$c ?? R.caseOf(l0, c5))) {
      case 0: {
        return l1;
      }
      case 1: {
        l2 = (l0.f0 ?? l0.fields[0]);
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
                t0 = rt2(t1);
                break;
              }
              case 1: {
                let t2;
                if ((!((l3 - l3) === 0))) {
                  t2 = R.stop(38, "@su0m8djlkg5cq4b68i0klesqia:21", "@su0m8djlkg5cq4b68i0klesqia:5");
                } else {
                  t2 = l3;
                }
                t0 = ((rt2(t2) + " ") + l1);
                break;
              }
            }
            break;
          }
        }
        const t3 = (l0.f1 ?? l0.fields[1]);
        const t4 = t0;
        l0 = t3;
        l1 = t4;
        continue;
      }
    }
  }
}
function f4(l0, l1) {
  let l2, l3;
  let t0;
  if ((!((l0 - l0) === 0))) {
    t0 = R.stop(54, "bc9f2c71", "a0ba7fdb", "queens");
  } else {
    t0 = l0;
  }
  return f5(rt1(t0), c3, l0, l1);
}
function f5(l0, l1, l2, l3) {
  let l4, l5, l6, l7;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return f6(l1, c0, l2, l3);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K5(l0, l1);
        const t2 = l2;
        const t3 = l3;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        l3 = t3;
        continue;
      }
    }
  }
}
function f6(l0, l1, l2, l3) {
  if (depth > 1000) return R.drive(f6$h(l0, l1, l2, l3));
  depth++;
  const r = f6$b(l0, l1, l2, l3);
  depth--;
  return r;
}
function f6$b(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c5))) {
    case 0: {
      l8 = l3;
      return R.ap(l8, l1);
    }
    case 1: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l9 = (l0.f1 ?? l0.fields[1]);
      l4 = l4;
      switch ((l4.$c ?? R.caseOf(l4, c4))) {
        case 1: {
          l5 = (l4.f0 ?? l4.fields[0]);
          l6 = (l4.f1 ?? l4.fields[1]);
          let t0;
          if ((!((l2 - l2) === 0))) {
            t0 = R.stop(70, "76ddcbdd", "efabf91c");
          } else {
            t0 = l2;
          }
          return f20(rt1(t0), l9, l1, l2, l3);
        }
      }
    }
  }
}
function* f6$h(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c5))) {
    case 0: {
      l8 = l3;
      return R.ap(l8, l1);
    }
    case 1: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l9 = (l0.f1 ?? l0.fields[1]);
      l4 = l4;
      switch ((l4.$c ?? R.caseOf(l4, c4))) {
        case 1: {
          l5 = (l4.f0 ?? l4.fields[0]);
          l6 = (l4.f1 ?? l4.fields[1]);
          let t0;
          if ((!((l2 - l2) === 0))) {
            t0 = R.stop(70, "76ddcbdd", "efabf91c");
          } else {
            t0 = l2;
          }
          return (yield [f20$h, [rt1(t0), l9, l1, l2, l3]]);
        }
      }
    }
  }
}
function f7(l0, l1) {
  let l2, l3, l4;
  l2 = f8(l1, c3, l0);
  return l2(1);
}
function f8(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return f9(l1, c6, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K5(l0, l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f9(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c5))) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l3 = l3;
        let t0;
        switch ((l3.$c ?? R.caseOf(l3, c4))) {
          case 1: {
            l4 = (l3.f0 ?? l3.fields[0]);
            l5 = (l3.f1 ?? l3.fields[1]);
            t0 = R.closure(f11, [l4, l2, l1]);
            break;
          }
        }
        const t1 = (l0.f1 ?? l0.fields[1]);
        const t2 = t0;
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      }
    }
  }
}
function f10(l0, l1) {
  let l2, l3;
  return true;
}
function f11(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l0.caps[2];
  let t0;
  if ((!((l2 - l2) === 0))) {
    t0 = R.stop(86, "0610e718", "fe57102d");
  } else {
    t0 = l2;
  }
  l5 = t0;
  let t1;
  if ((!((l3 - l3) === 0))) {
    t1 = R.stop(86, "0610e718", "fe57102d");
  } else {
    t1 = l3;
  }
  l6 = t1;
  l7 = Math.abs((l2 - l3));
  let t2;
  if ((!((l7 - l7) === 0))) {
    t2 = R.stop(102, "c6cfb130", "fe57102d");
  } else {
    t2 = l7;
  }
  l8 = t2;
  let t3;
  if ((!((l1 - l1) === 0))) {
    t3 = R.stop(102, "c6cfb130", "fe57102d");
  } else {
    t3 = l1;
  }
  l9 = t3;
  l10 = l4;
  return (((!(l5 === l6)) && (!(l8 === l9))) && l10((l1 + 1)));
}
function f12(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c4))) {
      case 0: {
        return c7;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l5 = l1;
        l6 = l5(l3);
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f13(l0, l1) {
  let l2, l3;
  return w0(("  " + f1(l1)));
}
function f14(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K0(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f21(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f22((l5.f0 ?? l5.fields[0]), c0);
  } else {
    t3 = f22((l5.f0 ?? l5.fields[0]), c0);
  }
  return t3;
}
function f15(l0, l1) {
  let l2, l3, l4, l5;
  l2 = R.mod(l1, 2);
  let t0;
  if ((!((l2 - l2) === 0))) {
    t0 = R.stop(118, "7e57d593", "5c0d5a7a");
  } else {
    t0 = l2;
  }
  l3 = t0;
  return (l3 === 0);
}
function f16(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = l1;
  return true;
}
function f17(l0, l1) {
  let l2, l3, l4, l5;
  l2 = l0.caps[0];
  l3 = l1;
  l2.f0 = rt3((l2.f0 ?? l2.fields[0]), (1));
  return R.FAIL;
}
function f18(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = new K7(l1, (l2.f0 ?? l2.fields[0]));
  return R.FAIL;
}
function f19(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K7((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f20(l0, l1, l2, l3, l4) {
  if (depth > 1000) return R.drive(f20$h(l0, l1, l2, l3, l4));
  depth++;
  const r = f20$b(l0, l1, l2, l3, l4);
  depth--;
  return r;
}
function f20$b(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12, l13;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l5 = (l0.f0 ?? l0.fields[0]);
        l6 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l8 = l5;
          let t3;
          if (f7(l8, l2)) {
            t3 = new K7(l8, l2);
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l7 = f6(l1, t3, l3, l4);
          if (l7 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l7;
        } else {
          const t4 = l6;
          const t5 = l1;
          const t6 = l2;
          const t7 = l3;
          const t8 = l4;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          l3 = t7;
          l4 = t8;
          continue;
        }
      }
    }
  }
}
function* f20$h(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12, l13;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l5 = (l0.f0 ?? l0.fields[0]);
        l6 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          l8 = l5;
          let t3;
          if (f7(l8, l2)) {
            t3 = new K7(l8, l2);
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l7 = (yield [f6$h, [l1, t3, l3, l4]]);
          if (l7 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l7;
        } else {
          const t4 = l6;
          const t5 = l1;
          const t6 = l2;
          const t7 = l3;
          const t8 = l4;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          l3 = t7;
          l4 = t8;
          continue;
        }
      }
    }
  }
}
function f21(l0, l1, l2) {
  if (depth > 1000) return R.drive(f21$h(l0, l1, l2));
  depth++;
  const r = f21$b(l0, l1, l2);
  depth--;
  return r;
}
function f21$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
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
          l7 = l2;
          let t3;
          if (R.ck(R.ap(l7, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K7(t3, (l1.f0 ?? l1.fields[0]));
          l5 = R.FAIL;
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t4 = l4;
          const t5 = l1;
          const t6 = l2;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          continue;
        }
      }
    }
  }
}
function* f21$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
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
          l7 = l2;
          let t3;
          if (R.ck(R.ap(l7, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K7(t3, (l1.f0 ?? l1.fields[0]));
          l5 = R.FAIL;
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t4 = l4;
          const t5 = l1;
          const t6 = l2;
          l0 = t4;
          l1 = t5;
          l2 = t6;
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
        const t1 = new K7((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f23(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c4))) {
      case 0: {
        return c7;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l6 = f13(l1, l3);
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f24(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K0(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f25(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f22((l5.f0 ?? l5.fields[0]), c0);
  } else {
    t3 = f22((l5.f0 ?? l5.fields[0]), c0);
  }
  return t3;
}
function f25(l0, l1, l2) {
  if (depth > 1000) return R.drive(f25$h(l0, l1, l2));
  depth++;
  const r = f25$b(l0, l1, l2);
  depth--;
  return r;
}
function f25$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
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
          let t3;
          if (R.ck(f15(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K7(t3, (l1.f0 ?? l1.fields[0]));
          l5 = R.FAIL;
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t4 = l4;
          const t5 = l1;
          const t6 = l2;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          continue;
        }
      }
    }
  }
}
function* f25$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
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
          let t3;
          if (R.ck(f15(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K7(t3, (l1.f0 ?? l1.fields[0]));
          l5 = R.FAIL;
          if (l5 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l5;
        } else {
          const t4 = l4;
          const t5 = l1;
          const t6 = l2;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          continue;
        }
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return f3(...xs); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return R.ck(f4(...xs)); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return R.ck(f5(...xs)); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return R.ck(f6(...xs)); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return f8(...xs); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return f9(...xs); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return f10(...xs); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return f11(...xs); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return f13(...xs); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return f14(...xs); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return R.ck(f15(...xs)); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return R.ck(f17(...xs)); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return R.ck(f18(...xs)); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return f19(...xs); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return R.ck(f20(...xs)); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return R.ck(f21(...xs)); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return f22(...xs); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return f23(...xs); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return f24(...xs); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return R.ck(f25(...xs)); } finally { depth = d; } } };