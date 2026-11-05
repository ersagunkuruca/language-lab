let fuel = Infinity;
let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.unit.unit";
class K1 { constructor() { } get fields() { return []; } }
K1.prototype.tag = "2de4e5d2"; K1.prototype.$c = 1;
class K2 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K2.prototype.tag = "24d4c71f"; K2.prototype.$c = 4;
class K3 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K3.prototype.tag = "6bce4e58"; K3.prototype.$c = 0;
class K4 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K4.prototype.tag = "f2da4c50"; K4.prototype.$c = 3;
class K5 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K5.prototype.tag = "9a6512de"; K5.prototype.$c = 8;
class K6 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K6.prototype.tag = "563662e0"; K6.prototype.$c = 6;
class K7 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K7.prototype.tag = "a9186a8d"; K7.prototype.$c = 7;
class K8 { constructor() { } get fields() { return []; } }
K8.prototype.tag = "std.list.nil"; K8.prototype.$c = 0;
class K9 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K9.prototype.tag = "std.list.cons"; K9.prototype.$c = 1;
class K10 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K10.prototype.tag = "std.tuple2.tuple";
class K11 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K11.prototype.tag = "b50d2f46"; K11.prototype.$c = 2;
class K12 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K12.prototype.tag = "af14d535"; K12.prototype.$c = 5;
const c0 = R.closure(f3, []);
const c1 = ["std.list.nil","std.list.cons"];
const c2 = new K0();
const c3 = new K1();
const c4 = new K2(c3, c3);
const c5 = new K3(2);
const c6 = new K4(c4, c5);
const c7 = new K5(c3);
const c8 = new K4(c7, c3);
const c9 = new K2(c4, c3);
const c10 = new K4(c9, c3);
const c11 = new K3(1);
const c12 = new K4(c10, c11);
const c13 = new K6(c11, c3);
const c14 = new K7(c3);
const c15 = new K4(c3, c3);
const c16 = new K6(c14, c15);
const c17 = new K8();
const c18 = new K9(c16, c17);
const c19 = new K9(c13, c18);
const c20 = new K9(c12, c19);
const c21 = new K9(c8, c20);
const c22 = new K9(c6, c21);
const c23 = ["6bce4e58","2de4e5d2","b50d2f46","f2da4c50","24d4c71f","af14d535","563662e0","a9186a8d","9a6512de"];
const c24 = new K10("x", 9);
const c25 = new K3(0);
R.spending(() => --fuel >= 0);
const rt0 = R.rt("number.show", ["builtin.show",false]);
const w0 = R.worlds[0];
function f0() {
  return f17(f2(), c0);
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
let f2$v;
function f2() { return f2$v ??= f2$w(); }
function f2$w() {
  return c22;
}
function f3(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
  l2 = w0(("f(x)  = " + f4(l1)));
  l3 = w0(("f′(x) = " + f4(f7(f11(l1)))));
  const t2 = depth; let t0 = true;
  t1: try {
    l4 = R.ck(f13(l1, 2));
    let t3;
    if ((!((l4 - l4) === 0))) {
      t3 = R.stop(118, "51d166d7", "61269272");
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
    t4 = "undefined";
  }
  l6 = w0(("f(2)  = " + t4));
  const t7 = depth; let t5 = true;
  t6: try {
    l7 = R.ck(f15(l1, 1));
    let t8;
    if ((!((l7 - l7) === 0))) {
      t8 = R.stop(166, "fa25a5e3", "61269272");
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
    t9 = "none found";
  }
  l9 = w0(("root near 1: " + t9));
  return w0("");
}
function f4(l0) {
  let l1;
  const r0 = f5(l0);
  return (r0.f0 ?? r0.fields[0]);
}
function f5(l0) {
  if (depth > 1000) return R.drive(f5$h(l0));
  depth++;
  const r = f5$b(l0);
  depth--;
  return r;
}
function f5$b(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      let t0;
      if ((!((l1 - l1) === 0))) {
        t0 = R.stop(22, "94b08831", "944754e0");
      } else {
        t0 = l1;
      }
      if ((t0 < 0)) {
        l2 = (-l1);
        let t1;
        if ((!((l2 - l2) === 0))) {
          t1 = R.stop(38, "355a185c", "944754e0");
        } else {
          t1 = l2;
        }
        return new K10(("−" + rt0(t1)), 3);
      } else {
        let t2;
        if ((!((l1 - l1) === 0))) {
          t2 = R.stop(54, "e370c750", "944754e0");
        } else {
          t2 = l1;
        }
        return new K10(rt0(t2), 9);
      }
    }
    case 1: {
      return c24;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l4 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6(f5((l0.f0 ?? l0.fields[0])), 1) + " + ") + f6(f5((l0.f1 ?? l0.fields[1])), 1)), 1);
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6(f5((l0.f0 ?? l0.fields[0])), 1) + " − ") + f6(f5((l0.f1 ?? l0.fields[1])), 2)), 1);
    }
    case 4: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6(f5((l0.f0 ?? l0.fields[0])), 2) + "·") + f6(f5((l0.f1 ?? l0.fields[1])), 3)), 2);
    }
    case 5: {
      l9 = (l0.f0 ?? l0.fields[0]);
      return new K10(("−" + f6(f5((l0.f0 ?? l0.fields[0])), 3)), 3);
    }
    case 6: {
      l10 = (l0.f0 ?? l0.fields[0]);
      l11 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6(f5((l0.f0 ?? l0.fields[0])), 2) + " / ") + f6(f5((l0.f1 ?? l0.fields[1])), 3)), 2);
    }
    case 7: {
      l12 = (l0.f0 ?? l0.fields[0]);
      const r1 = f5((l0.f0 ?? l0.fields[0]));
      return new K10((("sin(" + (r1.f0 ?? r1.fields[0])) + ")"), 9);
    }
    case 8: {
      l13 = (l0.f0 ?? l0.fields[0]);
      const r2 = f5((l0.f0 ?? l0.fields[0]));
      return new K10((("cos(" + (r2.f0 ?? r2.fields[0])) + ")"), 9);
    }
  }
}
function* f5$h(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      let t0;
      if ((!((l1 - l1) === 0))) {
        t0 = R.stop(22, "94b08831", "944754e0");
      } else {
        t0 = l1;
      }
      if ((t0 < 0)) {
        l2 = (-l1);
        let t1;
        if ((!((l2 - l2) === 0))) {
          t1 = R.stop(38, "355a185c", "944754e0");
        } else {
          t1 = l2;
        }
        return new K10(("−" + rt0(t1)), 3);
      } else {
        let t2;
        if ((!((l1 - l1) === 0))) {
          t2 = R.stop(54, "e370c750", "944754e0");
        } else {
          t2 = l1;
        }
        return new K10(rt0(t2), 9);
      }
    }
    case 1: {
      return c24;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l4 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6((yield [f5$h, [(l0.f0 ?? l0.fields[0])]]), 1) + " + ") + f6((yield [f5$h, [(l0.f1 ?? l0.fields[1])]]), 1)), 1);
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6((yield [f5$h, [(l0.f0 ?? l0.fields[0])]]), 1) + " − ") + f6((yield [f5$h, [(l0.f1 ?? l0.fields[1])]]), 2)), 1);
    }
    case 4: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6((yield [f5$h, [(l0.f0 ?? l0.fields[0])]]), 2) + "·") + f6((yield [f5$h, [(l0.f1 ?? l0.fields[1])]]), 3)), 2);
    }
    case 5: {
      l9 = (l0.f0 ?? l0.fields[0]);
      return new K10(("−" + f6((yield [f5$h, [(l0.f0 ?? l0.fields[0])]]), 3)), 3);
    }
    case 6: {
      l10 = (l0.f0 ?? l0.fields[0]);
      l11 = (l0.f1 ?? l0.fields[1]);
      return new K10(((f6((yield [f5$h, [(l0.f0 ?? l0.fields[0])]]), 2) + " / ") + f6((yield [f5$h, [(l0.f1 ?? l0.fields[1])]]), 3)), 2);
    }
    case 7: {
      l12 = (l0.f0 ?? l0.fields[0]);
      const r3 = (yield [f5$h, [(l0.f0 ?? l0.fields[0])]]);
      return new K10((("sin(" + (r3.f0 ?? r3.fields[0])) + ")"), 9);
    }
    case 8: {
      l13 = (l0.f0 ?? l0.fields[0]);
      const r4 = (yield [f5$h, [(l0.f0 ?? l0.fields[0])]]);
      return new K10((("cos(" + (r4.f0 ?? r4.fields[0])) + ")"), 9);
    }
  }
}
function f6(l0, l1) {
  let l2, l3, l4;
  l2 = (l0.f1 ?? l0.fields[1]);
  let t0;
  if ((!((l2 - l2) === 0))) {
    t0 = R.stop(70, "01f00cac", "2b4b3281", "parenthesize");
  } else {
    t0 = l2;
  }
  let t1;
  if ((!((l1 - l1) === 0))) {
    t1 = R.stop(70, "01f00cac", "2b4b3281", "parenthesize");
  } else {
    t1 = l1;
  }
  if ((t0 < t1)) {
    return (("(" + (l0.f0 ?? l0.fields[0])) + ")");
  } else {
    return (l0.f0 ?? l0.fields[0]);
  }
}
function f7(l0) {
  let l1;
  return R.ck(f8(l0));
}
function f8(l0) {
  if (depth > 1000) return R.drive(f8$h(l0));
  depth++;
  const r = f8$b(l0);
  depth--;
  return r;
}
function f8$b(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return new K3(l1);
    }
    case 1: {
      return c3;
    }
    case 2: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      const t0 = f8((l0.f0 ?? l0.fields[0]));
      if (t0 === R.FAIL) return R.FAIL;
      l4 = t0;
      const t1 = f8((l0.f1 ?? l0.fields[1]));
      if (t1 === R.FAIL) return R.FAIL;
      l5 = t1;
      const t4 = depth; let t2 = true;
      t3: try {
        l6 = new K3((R.ck(f9(l4)) + R.ck(f9(l5))));
        if (l6 === R.FAIL) t2 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t4; t2 = false;
      }
      if (t2) {
        return l6;
      } else {
        if (f10(l4, c25)) {
          return l5;
        } else {
          if (f10(l5, c25)) {
            return l4;
          } else {
            return new K11(l4, l5);
          }
        }
      }
    }
    case 3: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      const t5 = f8((l0.f0 ?? l0.fields[0]));
      if (t5 === R.FAIL) return R.FAIL;
      l9 = t5;
      const t6 = f8((l0.f1 ?? l0.fields[1]));
      if (t6 === R.FAIL) return R.FAIL;
      l10 = t6;
      const t9 = depth; let t7 = true;
      t8: try {
        l11 = new K3((R.ck(f9(l9)) - R.ck(f9(l10))));
        if (l11 === R.FAIL) t7 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t9; t7 = false;
      }
      if (t7) {
        return l11;
      } else {
        if (f10(l10, c25)) {
          return l9;
        } else {
          if (f10(l9, c25)) {
            return new K12(l10);
          } else {
            return new K4(l9, l10);
          }
        }
      }
    }
    case 4: {
      l12 = (l0.f0 ?? l0.fields[0]);
      l13 = (l0.f1 ?? l0.fields[1]);
      const t10 = f8((l0.f0 ?? l0.fields[0]));
      if (t10 === R.FAIL) return R.FAIL;
      l14 = t10;
      const t11 = f8((l0.f1 ?? l0.fields[1]));
      if (t11 === R.FAIL) return R.FAIL;
      l15 = t11;
      const t14 = depth; let t12 = true;
      t13: try {
        l16 = new K3((R.ck(f9(l14)) * R.ck(f9(l15))));
        if (l16 === R.FAIL) t12 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t14; t12 = false;
      }
      if (t12) {
        return l16;
      } else {
        if ((f10(l14, c25) || f10(l15, c25))) {
          return c25;
        } else {
          if (f10(l14, c11)) {
            return l15;
          } else {
            if (f10(l15, c11)) {
              return l14;
            } else {
              return new K2(l14, l15);
            }
          }
        }
      }
    }
    case 5: {
      l17 = (l0.f0 ?? l0.fields[0]);
      const t15 = f8((l0.f0 ?? l0.fields[0]));
      if (t15 === R.FAIL) return R.FAIL;
      l18 = t15;
      const t18 = depth; let t16 = true;
      t17: try {
        l19 = new K3((-R.ck(f9(l18))));
        if (l19 === R.FAIL) t16 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t18; t16 = false;
      }
      if (t16) {
        return l19;
      } else {
        l20 = l18;
        switch ((l20.$c ?? R.caseOf(l20, c23))) {
          case 0: {
            return new K12(l18);
          }
          case 1: {
            return new K12(l18);
          }
          case 2: {
            return new K12(l18);
          }
          case 3: {
            return new K12(l18);
          }
          case 4: {
            return new K12(l18);
          }
          case 5: {
            l21 = (l20.f0 ?? l20.fields[0]);
            return l21;
          }
          case 6: {
            return new K12(l18);
          }
          case 7: {
            return new K12(l18);
          }
          case 8: {
            return new K12(l18);
          }
        }
      }
    }
    case 6: {
      l22 = (l0.f0 ?? l0.fields[0]);
      l23 = (l0.f1 ?? l0.fields[1]);
      const t19 = f8((l0.f0 ?? l0.fields[0]));
      if (t19 === R.FAIL) return R.FAIL;
      l24 = t19;
      const t20 = f8((l0.f1 ?? l0.fields[1]));
      if (t20 === R.FAIL) return R.FAIL;
      l25 = t20;
      if (f10(l25, c11)) {
        return l24;
      } else {
        return new K6(l24, l25);
      }
    }
    case 7: {
      l26 = (l0.f0 ?? l0.fields[0]);
      return new K7(R.ck(f8((l0.f0 ?? l0.fields[0]))));
    }
    case 8: {
      l27 = (l0.f0 ?? l0.fields[0]);
      return new K5(R.ck(f8((l0.f0 ?? l0.fields[0]))));
    }
  }
}
function* f8$h(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return new K3(l1);
    }
    case 1: {
      return c3;
    }
    case 2: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      const t0 = (yield [f8$h, [(l0.f0 ?? l0.fields[0])]]);
      if (t0 === R.FAIL) return R.FAIL;
      l4 = t0;
      const t1 = (yield [f8$h, [(l0.f1 ?? l0.fields[1])]]);
      if (t1 === R.FAIL) return R.FAIL;
      l5 = t1;
      const t4 = depth; let t2 = true;
      t3: try {
        l6 = new K3((R.ck(f9(l4)) + R.ck(f9(l5))));
        if (l6 === R.FAIL) t2 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t4; t2 = false;
      }
      if (t2) {
        return l6;
      } else {
        if (f10(l4, c25)) {
          return l5;
        } else {
          if (f10(l5, c25)) {
            return l4;
          } else {
            return new K11(l4, l5);
          }
        }
      }
    }
    case 3: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      const t5 = (yield [f8$h, [(l0.f0 ?? l0.fields[0])]]);
      if (t5 === R.FAIL) return R.FAIL;
      l9 = t5;
      const t6 = (yield [f8$h, [(l0.f1 ?? l0.fields[1])]]);
      if (t6 === R.FAIL) return R.FAIL;
      l10 = t6;
      const t9 = depth; let t7 = true;
      t8: try {
        l11 = new K3((R.ck(f9(l9)) - R.ck(f9(l10))));
        if (l11 === R.FAIL) t7 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t9; t7 = false;
      }
      if (t7) {
        return l11;
      } else {
        if (f10(l10, c25)) {
          return l9;
        } else {
          if (f10(l9, c25)) {
            return new K12(l10);
          } else {
            return new K4(l9, l10);
          }
        }
      }
    }
    case 4: {
      l12 = (l0.f0 ?? l0.fields[0]);
      l13 = (l0.f1 ?? l0.fields[1]);
      const t10 = (yield [f8$h, [(l0.f0 ?? l0.fields[0])]]);
      if (t10 === R.FAIL) return R.FAIL;
      l14 = t10;
      const t11 = (yield [f8$h, [(l0.f1 ?? l0.fields[1])]]);
      if (t11 === R.FAIL) return R.FAIL;
      l15 = t11;
      const t14 = depth; let t12 = true;
      t13: try {
        l16 = new K3((R.ck(f9(l14)) * R.ck(f9(l15))));
        if (l16 === R.FAIL) t12 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t14; t12 = false;
      }
      if (t12) {
        return l16;
      } else {
        if ((f10(l14, c25) || f10(l15, c25))) {
          return c25;
        } else {
          if (f10(l14, c11)) {
            return l15;
          } else {
            if (f10(l15, c11)) {
              return l14;
            } else {
              return new K2(l14, l15);
            }
          }
        }
      }
    }
    case 5: {
      l17 = (l0.f0 ?? l0.fields[0]);
      const t15 = (yield [f8$h, [(l0.f0 ?? l0.fields[0])]]);
      if (t15 === R.FAIL) return R.FAIL;
      l18 = t15;
      const t18 = depth; let t16 = true;
      t17: try {
        l19 = new K3((-R.ck(f9(l18))));
        if (l19 === R.FAIL) t16 = false;
      } catch (x) {
        if (x !== R.FAIL) throw x;
        depth = t18; t16 = false;
      }
      if (t16) {
        return l19;
      } else {
        l20 = l18;
        switch ((l20.$c ?? R.caseOf(l20, c23))) {
          case 0: {
            return new K12(l18);
          }
          case 1: {
            return new K12(l18);
          }
          case 2: {
            return new K12(l18);
          }
          case 3: {
            return new K12(l18);
          }
          case 4: {
            return new K12(l18);
          }
          case 5: {
            l21 = (l20.f0 ?? l20.fields[0]);
            return l21;
          }
          case 6: {
            return new K12(l18);
          }
          case 7: {
            return new K12(l18);
          }
          case 8: {
            return new K12(l18);
          }
        }
      }
    }
    case 6: {
      l22 = (l0.f0 ?? l0.fields[0]);
      l23 = (l0.f1 ?? l0.fields[1]);
      const t19 = (yield [f8$h, [(l0.f0 ?? l0.fields[0])]]);
      if (t19 === R.FAIL) return R.FAIL;
      l24 = t19;
      const t20 = (yield [f8$h, [(l0.f1 ?? l0.fields[1])]]);
      if (t20 === R.FAIL) return R.FAIL;
      l25 = t20;
      if (f10(l25, c11)) {
        return l24;
      } else {
        return new K6(l24, l25);
      }
    }
    case 7: {
      l26 = (l0.f0 ?? l0.fields[0]);
      return new K7(R.ck((yield [f8$h, [(l0.f0 ?? l0.fields[0])]])));
    }
    case 8: {
      l27 = (l0.f0 ?? l0.fields[0]);
      return new K5(R.ck((yield [f8$h, [(l0.f0 ?? l0.fields[0])]])));
    }
  }
}
function f9(l0) {
  let l1, l2, l3;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c23))) {
    case 0: {
      l2 = (l1.f0 ?? l1.fields[0]);
      return l2;
    }
    case 1: {
      return R.FAIL;
    }
    case 2: {
      return R.FAIL;
    }
    case 3: {
      return R.FAIL;
    }
    case 4: {
      return R.FAIL;
    }
    case 5: {
      return R.FAIL;
    }
    case 6: {
      return R.FAIL;
    }
    case 7: {
      return R.FAIL;
    }
    case 8: {
      return R.FAIL;
    }
  }
}
function f10(l0, l1) {
  if (depth > 1000) return R.drive(f10$h(l0, l1));
  depth++;
  const r = f10$b(l0, l1);
  depth--;
  return r;
}
function f10$b(l0, l1) {
  let l2, l3;
  for (;;) {
    if (((l0.$c ?? R.caseOf(l0, c23)) === (l1.$c ?? R.caseOf(l1, c23)))) {
      l0 = l0;
      switch ((l0.$c ?? R.caseOf(l0, c23))) {
        case 0: {
          return ((l0.f0 ?? l0.fields[0]) === (l1.f0 ?? l1.fields[0]));
        }
        case 1: {
          return true;
        }
        case 2: {
          if (f10((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]))) {
            const t0 = (l0.f1 ?? l0.fields[1]);
            const t1 = (l1.f1 ?? l1.fields[1]);
            l0 = t0;
            l1 = t1;
            continue;
          } else {
            return false;
          }
        }
        case 3: {
          if (f10((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]))) {
            const t2 = (l0.f1 ?? l0.fields[1]);
            const t3 = (l1.f1 ?? l1.fields[1]);
            l0 = t2;
            l1 = t3;
            continue;
          } else {
            return false;
          }
        }
        case 4: {
          if (f10((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]))) {
            const t4 = (l0.f1 ?? l0.fields[1]);
            const t5 = (l1.f1 ?? l1.fields[1]);
            l0 = t4;
            l1 = t5;
            continue;
          } else {
            return false;
          }
        }
        case 5: {
          const t6 = (l0.f0 ?? l0.fields[0]);
          const t7 = (l1.f0 ?? l1.fields[0]);
          l0 = t6;
          l1 = t7;
          continue;
        }
        case 6: {
          if (f10((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]))) {
            const t8 = (l0.f1 ?? l0.fields[1]);
            const t9 = (l1.f1 ?? l1.fields[1]);
            l0 = t8;
            l1 = t9;
            continue;
          } else {
            return false;
          }
        }
        case 7: {
          const t10 = (l0.f0 ?? l0.fields[0]);
          const t11 = (l1.f0 ?? l1.fields[0]);
          l0 = t10;
          l1 = t11;
          continue;
        }
        case 8: {
          const t12 = (l0.f0 ?? l0.fields[0]);
          const t13 = (l1.f0 ?? l1.fields[0]);
          l0 = t12;
          l1 = t13;
          continue;
        }
      }
    } else {
      return false;
    }
  }
}
function* f10$h(l0, l1) {
  let l2, l3;
  for (;;) {
    if (((l0.$c ?? R.caseOf(l0, c23)) === (l1.$c ?? R.caseOf(l1, c23)))) {
      l0 = l0;
      switch ((l0.$c ?? R.caseOf(l0, c23))) {
        case 0: {
          return ((l0.f0 ?? l0.fields[0]) === (l1.f0 ?? l1.fields[0]));
        }
        case 1: {
          return true;
        }
        case 2: {
          if ((yield [f10$h, [(l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0])]])) {
            const t0 = (l0.f1 ?? l0.fields[1]);
            const t1 = (l1.f1 ?? l1.fields[1]);
            l0 = t0;
            l1 = t1;
            continue;
          } else {
            return false;
          }
        }
        case 3: {
          if ((yield [f10$h, [(l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0])]])) {
            const t2 = (l0.f1 ?? l0.fields[1]);
            const t3 = (l1.f1 ?? l1.fields[1]);
            l0 = t2;
            l1 = t3;
            continue;
          } else {
            return false;
          }
        }
        case 4: {
          if ((yield [f10$h, [(l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0])]])) {
            const t4 = (l0.f1 ?? l0.fields[1]);
            const t5 = (l1.f1 ?? l1.fields[1]);
            l0 = t4;
            l1 = t5;
            continue;
          } else {
            return false;
          }
        }
        case 5: {
          const t6 = (l0.f0 ?? l0.fields[0]);
          const t7 = (l1.f0 ?? l1.fields[0]);
          l0 = t6;
          l1 = t7;
          continue;
        }
        case 6: {
          if ((yield [f10$h, [(l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0])]])) {
            const t8 = (l0.f1 ?? l0.fields[1]);
            const t9 = (l1.f1 ?? l1.fields[1]);
            l0 = t8;
            l1 = t9;
            continue;
          } else {
            return false;
          }
        }
        case 7: {
          const t10 = (l0.f0 ?? l0.fields[0]);
          const t11 = (l1.f0 ?? l1.fields[0]);
          l0 = t10;
          l1 = t11;
          continue;
        }
        case 8: {
          const t12 = (l0.f0 ?? l0.fields[0]);
          const t13 = (l1.f0 ?? l1.fields[0]);
          l0 = t12;
          l1 = t13;
          continue;
        }
      }
    } else {
      return false;
    }
  }
}
function f11(l0) {
  let l1;
  return f12(l0);
}
function f12(l0) {
  if (depth > 1000) return R.drive(f12$h(l0));
  depth++;
  const r = f12$b(l0);
  depth--;
  return r;
}
function f12$b(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return c25;
    }
    case 1: {
      return c11;
    }
    case 2: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      return new K11(f12((l0.f0 ?? l0.fields[0])), f12((l0.f1 ?? l0.fields[1])));
    }
    case 3: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l5 = (l0.f1 ?? l0.fields[1]);
      return new K4(f12((l0.f0 ?? l0.fields[0])), f12((l0.f1 ?? l0.fields[1])));
    }
    case 4: {
      l6 = (l0.f0 ?? l0.fields[0]);
      l7 = (l0.f1 ?? l0.fields[1]);
      return new K11(new K2(f12((l0.f0 ?? l0.fields[0])), l7), new K2(l6, f12((l0.f1 ?? l0.fields[1]))));
    }
    case 5: {
      l8 = (l0.f0 ?? l0.fields[0]);
      return new K12(f12((l0.f0 ?? l0.fields[0])));
    }
    case 6: {
      l9 = (l0.f0 ?? l0.fields[0]);
      l10 = (l0.f1 ?? l0.fields[1]);
      return new K6(new K4(new K2(f12((l0.f0 ?? l0.fields[0])), l10), new K2(l9, f12((l0.f1 ?? l0.fields[1])))), new K2(l10, l10));
    }
    case 7: {
      l11 = (l0.f0 ?? l0.fields[0]);
      return new K2(new K5(l11), f12((l0.f0 ?? l0.fields[0])));
    }
    case 8: {
      l12 = (l0.f0 ?? l0.fields[0]);
      return new K12(new K2(new K7(l12), f12((l0.f0 ?? l0.fields[0]))));
    }
  }
}
function* f12$h(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return c25;
    }
    case 1: {
      return c11;
    }
    case 2: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      return new K11((yield [f12$h, [(l0.f0 ?? l0.fields[0])]]), (yield [f12$h, [(l0.f1 ?? l0.fields[1])]]));
    }
    case 3: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l5 = (l0.f1 ?? l0.fields[1]);
      return new K4((yield [f12$h, [(l0.f0 ?? l0.fields[0])]]), (yield [f12$h, [(l0.f1 ?? l0.fields[1])]]));
    }
    case 4: {
      l6 = (l0.f0 ?? l0.fields[0]);
      l7 = (l0.f1 ?? l0.fields[1]);
      return new K11(new K2((yield [f12$h, [(l0.f0 ?? l0.fields[0])]]), l7), new K2(l6, (yield [f12$h, [(l0.f1 ?? l0.fields[1])]])));
    }
    case 5: {
      l8 = (l0.f0 ?? l0.fields[0]);
      return new K12((yield [f12$h, [(l0.f0 ?? l0.fields[0])]]));
    }
    case 6: {
      l9 = (l0.f0 ?? l0.fields[0]);
      l10 = (l0.f1 ?? l0.fields[1]);
      return new K6(new K4(new K2((yield [f12$h, [(l0.f0 ?? l0.fields[0])]]), l10), new K2(l9, (yield [f12$h, [(l0.f1 ?? l0.fields[1])]]))), new K2(l10, l10));
    }
    case 7: {
      l11 = (l0.f0 ?? l0.fields[0]);
      return new K2(new K5(l11), (yield [f12$h, [(l0.f0 ?? l0.fields[0])]]));
    }
    case 8: {
      l12 = (l0.f0 ?? l0.fields[0]);
      return new K12(new K2(new K7(l12), (yield [f12$h, [(l0.f0 ?? l0.fields[0])]])));
    }
  }
}
function f13(l0, l1) {
  let l2, l3;
  return f14(l0, l1);
}
function f14(l0, l1) {
  if (depth > 1000) return R.drive(f14$h(l0, l1));
  depth++;
  const r = f14$b(l0, l1);
  depth--;
  return r;
}
function f14$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 1: {
      return l1;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l4 = (l0.f1 ?? l0.fields[1]);
      return (R.ck(f14((l0.f0 ?? l0.fields[0]), l1)) + R.ck(f14((l0.f1 ?? l0.fields[1]), l1)));
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      return (R.ck(f14((l0.f0 ?? l0.fields[0]), l1)) - R.ck(f14((l0.f1 ?? l0.fields[1]), l1)));
    }
    case 4: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      return (R.ck(f14((l0.f0 ?? l0.fields[0]), l1)) * R.ck(f14((l0.f1 ?? l0.fields[1]), l1)));
    }
    case 5: {
      l9 = (l0.f0 ?? l0.fields[0]);
      return (-R.ck(f14((l0.f0 ?? l0.fields[0]), l1)));
    }
    case 6: {
      l10 = (l0.f0 ?? l0.fields[0]);
      l11 = (l0.f1 ?? l0.fields[1]);
      const t0 = f14((l0.f1 ?? l0.fields[1]), l1);
      if (t0 === R.FAIL) return R.FAIL;
      l12 = t0;
      let t1;
      if ((!((l12 - l12) === 0))) {
        t1 = R.stop(86, "ffc8133f", "6e64d13b");
      } else {
        t1 = l12;
      }
      l13 = t1;
      if ((l13 === 0)) {
        return R.FAIL;
      } else {
        if ((l12 === 0)) {
          return R.stop(96, "d00ed05f", "6e64d13b");
        } else {
          let t2;
          if ((!((l12 - l12) === 0))) {
            t2 = R.stop(102, "d00ed05f", "6e64d13b");
          } else {
            t2 = l12;
          }
          return (R.ck(f14((l0.f0 ?? l0.fields[0]), l1)) / t2);
        }
      }
    }
    case 7: {
      l14 = (l0.f0 ?? l0.fields[0]);
      return Math.sin(R.ck(f14((l0.f0 ?? l0.fields[0]), l1)));
    }
    case 8: {
      l15 = (l0.f0 ?? l0.fields[0]);
      return Math.cos(R.ck(f14((l0.f0 ?? l0.fields[0]), l1)));
    }
  }
}
function* f14$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c23))) {
    case 0: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 1: {
      return l1;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l4 = (l0.f1 ?? l0.fields[1]);
      return (R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])) + R.ck((yield [f14$h, [(l0.f1 ?? l0.fields[1]), l1]])));
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      return (R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])) - R.ck((yield [f14$h, [(l0.f1 ?? l0.fields[1]), l1]])));
    }
    case 4: {
      l7 = (l0.f0 ?? l0.fields[0]);
      l8 = (l0.f1 ?? l0.fields[1]);
      return (R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])) * R.ck((yield [f14$h, [(l0.f1 ?? l0.fields[1]), l1]])));
    }
    case 5: {
      l9 = (l0.f0 ?? l0.fields[0]);
      return (-R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])));
    }
    case 6: {
      l10 = (l0.f0 ?? l0.fields[0]);
      l11 = (l0.f1 ?? l0.fields[1]);
      const t0 = (yield [f14$h, [(l0.f1 ?? l0.fields[1]), l1]]);
      if (t0 === R.FAIL) return R.FAIL;
      l12 = t0;
      let t1;
      if ((!((l12 - l12) === 0))) {
        t1 = R.stop(86, "ffc8133f", "6e64d13b");
      } else {
        t1 = l12;
      }
      l13 = t1;
      if ((l13 === 0)) {
        return R.FAIL;
      } else {
        if ((l12 === 0)) {
          return R.stop(96, "d00ed05f", "6e64d13b");
        } else {
          let t2;
          if ((!((l12 - l12) === 0))) {
            t2 = R.stop(102, "d00ed05f", "6e64d13b");
          } else {
            t2 = l12;
          }
          return (R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])) / t2);
        }
      }
    }
    case 7: {
      l14 = (l0.f0 ?? l0.fields[0]);
      return Math.sin(R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])));
    }
    case 8: {
      l15 = (l0.f0 ?? l0.fields[0]);
      return Math.cos(R.ck((yield [f14$h, [(l0.f0 ?? l0.fields[0]), l1]])));
    }
  }
}
function f15(l0, l1) {
  let l2, l3, l4, l5;
  const t3 = depth; const t0 = fuel;
  fuel = 100;
  let t2, t1 = false;
  try {
    t2 = R.ck(f16(l0, f7(f11(l0)), l1));
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
function f16(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    if (--fuel < 0) throw R.OUT;
    l3 = R.ck(f13(l1, l2));
    let t0;
    if ((l3 === 0)) {
      return R.FAIL;
      t0 = undefined;
    } else {
      let t1;
      if ((!((l3 - l3) === 0))) {
        t1 = R.stop(134, "d1927711", "6fa9e6e9", "newton");
      } else {
        t1 = l3;
      }
      t0 = (R.ck(f13(l0, l2)) / t1);
    }
    l4 = (l2 - t0);
    l5 = Math.abs((l4 - l2));
    let t2;
    if ((!((l5 - l5) === 0))) {
      t2 = R.stop(150, "2db4387d", "6fa9e6e9", "newton");
    } else {
      t2 = l5;
    }
    if ((t2 < 1e-12)) {
      return l4;
    } else {
      const t3 = l0;
      const t4 = l1;
      const t5 = l4;
      l0 = t3;
      l1 = t4;
      l2 = t5;
      continue;
    }
  }
}
function f17(l0, l1) {
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
        l6 = f3(l1, l3);
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return f3(...xs); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return f4(...xs); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return f5(...xs); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return R.ck(f8(...xs)); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return R.ck(f9(...xs)); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return f10(...xs); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return f11(...xs); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return R.ck(f13(...xs)); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return R.ck(f14(...xs)); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return R.ck(f15(...xs)); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return f17(...xs); } finally { depth = d; } } };