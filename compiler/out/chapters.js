let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.list.nil"; K0.prototype.$c = 0;
class K1 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K1.prototype.tag = "box:std.list<type.string<>>";
class K2 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K2.prototype.tag = "0mc116a0nj9n5g7uosr74es0sq";
class K3 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K3.prototype.tag = "std.list.cons"; K3.prototype.$c = 1;
class K4 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K4.prototype.tag = "r3tkmnarf64tumeu6n5m065kik";
class K5 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K5.prototype.tag = "std.optional.some"; K5.prototype.$c = 1;
class K6 { constructor() { } get fields() { return []; } }
K6.prototype.tag = "std.optional.none"; K6.prototype.$c = 0;
class K7 { constructor() { } get fields() { return []; } }
K7.prototype.tag = "std.unit.unit";
class K8 { constructor(x0, x1, x2, x3, x4) { this.f0 = x0; this.f1 = x1; this.f2 = x2; this.f3 = x3; this.f4 = x4; } get fields() { return [this.f0, this.f1, this.f2, this.f3, this.f4]; } }
K8.prototype.tag = "t9iqhjdous3r5gfajeltfunt5g";
const c0 = ["std.list.nil","std.list.cons"];
const c1 = new K0();
const c2 = R.closure(f5, []);
const c3 = R.closure(f11, []);
const c4 = R.closure(f21, []);
const c5 = new K4(c1, c1);
const c6 = new K6();
const c7 = ["std.optional.none","std.optional.some"];
const c8 = new K7();
const c9 = R.closure(f34, []);
const rt0 = R.rt("text.split", ["builtin.text.split",false]);
const rt1 = R.rt("int.show", ["builtin.int.show",false]);
const rt2 = R.rt("text.characters", ["builtin.text.characters",false]);
const rt3 = R.rt("text.joinAll", ["builtin.text.joinAll",false]);
const rt4 = R.rt("text.less", ["builtin.text.less",true]);
const rt5 = R.rt("text.code", ["builtin.text.code",false]);
const rt6 = R.rt("int.add", ["builtin.int.add",false]);
const rt7 = R.rt("text.fromCode", ["builtin.text.fromCode",false]);
const rt8 = R.rt("text.length", ["builtin.text.length",false]);
const rt9 = R.rt("text.slice", ["builtin.text.slice",false]);
const w0 = R.worlds[0];
const w1 = R.worlds[1];
const w2 = R.worlds[2];
const w3 = R.worlds[3];
const w4 = R.worlds[4];
function f0(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c0))) {
    case 0: {
      l2 = w0("usage: chapters book.md folder");
      return (2);
    }
    case 1: {
      l3 = (l1.f0 ?? l1.fields[0]);
      l4 = (l1.f1 ?? l1.fields[1]);
      l5 = l4;
      switch ((l5.$c ?? R.caseOf(l5, c0))) {
        case 0: {
          l6 = w0("usage: chapters book.md folder");
          return (2);
        }
        case 1: {
          l7 = (l5.f0 ?? l5.fields[0]);
          l8 = (l5.f1 ?? l5.fields[1]);
          const t1 = depth; let t0;
          try {
            l11 = R.ck(f1(l3, l7));
            t0 = (0);
          } catch (x) {
            if (!(x instanceof R.Aborted) || x.esc !== 0) throw x;
            depth = t1; l9 = x.reason;
            l12 = w0(("chapters: " + l9));
            t0 = (1);
          }
          return t0;
        }
      }
    }
  }
}
function f1(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l2 = f2(f25(rt0(w1(l0), "\n")), (1), c1);
  l3 = l2;
  switch ((l3.$c ?? R.caseOf(l3, c0))) {
    case 0: {
      return R.abort((l0 + " has no text"), 0);
    }
    case 1: {
      l4 = (l3.f0 ?? l3.fields[0]);
      l5 = (l3.f1 ?? l3.fields[1]);
      const t0 = f47(l2, R.closure(f30, [l1]));
      if (t0 === R.FAIL) return R.FAIL;
      l6 = t0;
      l7 = w2(((l1 + "/") + "contents.md"), f32(l2));
      return w3((((((("wrote " + rt1(f36(l2))) + " chapters and contents.md to ") + l1) + " (") + rt1(f38(l2))) + " words)"));
    }
  }
}
function f2(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9;
  return f43(l0, l1, l2, c1);
}
function f3(l0) {
  let l1, l2, l3;
  l1 = rt0(rt3(f48(rt2(l0), c2), ""), "-");
  l2 = rt3(f50(l1, c3), "-");
  if ((l2 === "")) {
    return "section";
  } else {
    return l2;
  }
}
function f4(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f45(l0, l1, c1);
}
function f5(l0, l1) {
  let l2, l3;
  return f6(l1);
}
function f6(l0) {
  let l1;
  if (((f7(l0, "a") && f8(l0, "z")) || ((f7(l0, "A") && f8(l0, "Z")) || (f7(l0, "0") && f8(l0, "9"))))) {
    return f9(l0);
  } else {
    return "-";
  }
}
function f7(l0, l1) {
  let l2, l3;
  return (!rt4(l0, l1));
}
function f8(l0, l1) {
  let l2, l3;
  return (!rt4(l1, l0));
}
function f9(l0) {
  let l1, l2;
  if ((f7(l0, "A") && f8(l0, "Z"))) {
    const t2 = depth; let t0 = true;
    t1: try {
      l1 = rt7(rt6(rt5(l0), (32)));
      if (l1 === R.FAIL) t0 = false;
    } catch (x) {
      if (x !== R.FAIL) throw x;
      depth = t2; t0 = false;
    }
    let t3;
    if (t0) {
      t3 = l1;
    } else {
      t3 = l0;
    }
    return t3;
  } else {
    return l0;
  }
}
function f10(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K1(c1);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f41(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  } else {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  }
  return t3;
}
function f11(l0, l1) {
  let l2, l3;
  return (!(l1 === ""));
}
function f12(l0) {
  let l1;
  if ((l0 < (10))) {
    return ("0" + rt1(l0));
  } else {
    return rt1(l0);
  }
}
function f13(l0, l1) {
  let l2, l3, l4;
  l2 = f14(l0, l1);
  if ((l2 === (0))) {
    return l0;
  } else {
    return ((l0 + "-") + rt1(rt6(l2, (1))));
  }
}
function f14(l0, l1) {
  let l2, l3;
  return f15(l1, (0), l0);
}
function f15(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        l4 = (l0.f0 ?? l0.fields[0]);
        l5 = (l0.f1 ?? l0.fields[1]);
        let t0;
        if ((l2 === l4)) {
          t0 = (1);
        } else {
          t0 = (0);
        }
        const t1 = (l0.f1 ?? l0.fields[1]);
        const t2 = rt6(l1, t0);
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      }
    }
  }
}
function f16(l0) {
  let l1;
  return f22(l0, []);
}
function f17(l0, l1) {
  let l2, l3, l4, l5, l6;
  return (0);
}
function f18(l0) {
  let l1;
  return f19(f52(rt0(l0, " "), c4));
}
function f19(l0) {
  let l1;
  return f20(l0, (0));
}
function f20(l0, l1) {
  let l2, l3, l4, l5, l6;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = rt6(l1, (1));
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f21(l0, l1) {
  let l2, l3;
  return (!(l1 === ""));
}
function f22(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f23(l1, (0));
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
function f23(l0, l1) {
  let l2, l3, l4, l5, l6;
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
        switch ((l2.$c ?? R.caseOf(l2, c0))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            t0 = rt6(f18(l3), l1);
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
function f24(l0) {
  let l1;
  return (((("# " + (l0.f0 ?? l0.fields[0])) + "\n") + rt3((l0.f1 ?? l0.fields[1]), "\n")) + "\n");
}
function f25(l0) {
  let l1, l2;
  l1 = R.ck(f26(l0, []));
  if (((0) < f16((l1.f0 ?? l1.fields[0])))) {
    return new K3(new K2("Preface", (l1.f0 ?? l1.fields[0])), (l1.f1 ?? l1.fields[1]));
  } else {
    return (l1.f1 ?? l1.fields[1]);
  }
}
function f26(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f27(l1, c5);
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
function f27(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
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
        switch ((l2.$c ?? R.caseOf(l2, c0))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            const t3 = depth; let t1 = true;
            t2: try {
              l7 = f28(l3);
              if (l7 === R.FAIL) t1 = false;
            } catch (x) {
              if (x !== R.FAIL) throw x;
              depth = t3; t1 = false;
            }
            let t4;
            if (t1) {
              t4 = new K5(l7);
            } else {
              t4 = c6;
            }
            l5 = t4;
            switch ((l5.$c ?? R.caseOf(l5, c7))) {
              case 0: {
                t0 = new K4(new K3(l3, (l1.f0 ?? l1.fields[0])), (l1.f1 ?? l1.fields[1]));
                break;
              }
              case 1: {
                l6 = (l5.f0 ?? l5.fields[0]);
                t0 = new K4(c1, new K3(new K2(l6, (l1.f0 ?? l1.fields[0])), (l1.f1 ?? l1.fields[1])));
                break;
              }
            }
            break;
          }
        }
        const t5 = (l0.pop(), l0);
        const t6 = t0;
        l0 = t5;
        l1 = t6;
        continue;
      }
    }
  }
}
function f28(l0) {
  let l1, l2;
  l1 = rt8(l0);
  if ((((1) < l1) && (rt9(l0, (0), (2)) === "# "))) {
    return rt9(l0, (2), l1);
  } else {
    return R.FAIL;
  }
}
function f29(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c0))) {
      case 0: {
        return c8;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l5 = l1;
        const t0 = R.ap(l5, l3);
        if (t0 === R.FAIL) return R.FAIL;
        l6 = t0;
        const t1 = l4;
        const t2 = l1;
        l0 = t1;
        l1 = t2;
        continue;
      }
    }
  }
}
function f30(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  return f31(l2, l1);
}
function f31(l0, l1) {
  let l2, l3, l4;
  l2 = w2(((l0 + "/") + (l1.f2 ?? l1.fields[2])), (l1.f4 ?? l1.fields[4]));
  return w4(((l0 + "/") + "chapters.log"), (((("wrote " + (l1.f2 ?? l1.fields[2])) + ": ") + (l1.f1 ?? l1.fields[1])) + "\n"));
}
function f32(l0) {
  let l1;
  return (("# Contents\n\n" + rt3(f54(l0, c9), "\n")) + "\n");
}
function f33(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f46(l0, l1, c1);
}
function f34(l0, l1) {
  let l2, l3;
  return f35(l1);
}
function f35(l0) {
  let l1;
  let t0;
  if (((l0.f3 ?? l0.fields[3]) === (1))) {
    t0 = " word";
  } else {
    t0 = " words";
  }
  return (((((((rt1((l0.f0 ?? l0.fields[0])) + ". [") + (l0.f1 ?? l0.fields[1])) + "](") + (l0.f2 ?? l0.fields[2])) + ") — ") + rt1((l0.f3 ?? l0.fields[3]))) + t0);
}
function f36(l0) {
  let l1;
  return f37(l0, (0));
}
function f37(l0, l1) {
  let l2, l3, l4, l5, l6;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = (l0.f0 ?? l0.fields[0]);
        l4 = (l0.f1 ?? l0.fields[1]);
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = rt6(l1, (1));
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f38(l0) {
  let l1;
  return f39(l0, []);
}
function f39(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f40(l1, (0));
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
function f40(l0, l1) {
  let l2, l3, l4, l5, l6;
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
        switch ((l2.$c ?? R.caseOf(l2, c0))) {
          case 1: {
            l3 = (l2.f0 ?? l2.fields[0]);
            l4 = (l2.f1 ?? l2.fields[1]);
            t0 = rt6((l3.f3 ?? l3.fields[3]), l1);
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
function f41(l0, l1, l2) {
  if (depth > 1000) return R.drive(f41$h(l0, l1, l2));
  depth++;
  const r = f41$b(l0, l1, l2);
  depth--;
  return r;
}
function f41$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function* f41$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function f42(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
function f43(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12;
  for (;;) {
    l4 = l0;
    switch ((l4.$c ?? R.caseOf(l4, c0))) {
      case 0: {
        return f44(l3, c1);
      }
      case 1: {
        l5 = (l4.f0 ?? l4.fields[0]);
        l6 = (l4.f1 ?? l4.fields[1]);
        l7 = f3((l5.f0 ?? l5.fields[0]));
        l8 = new K8(l1, (l5.f0 ?? l5.fields[0]), (((f12(l1) + "-") + f13(l7, l2)) + ".md"), f16((l5.f1 ?? l5.fields[1])), f24(l5));
        const t0 = l6;
        const t1 = rt6(l1, (1));
        const t2 = new K3(l7, l2);
        const t3 = new K3(l8, l3);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        l3 = t3;
        continue;
      }
    }
  }
}
function f44(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
function f45(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f42(l2, c1);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l6 = l1;
        l7 = l6(l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K3(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f46(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f42(l2, c1);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l6 = l1;
        l7 = l6(l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K3(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f47(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c0))) {
      case 0: {
        return c8;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        const t0 = f30(l1, l3);
        if (t0 === R.FAIL) return R.FAIL;
        l6 = t0;
        const t1 = l4;
        const t2 = l1;
        l0 = t1;
        l1 = t2;
        continue;
      }
    }
  }
}
function f48(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f49(l0, l1, c1);
}
function f49(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f42(l2, c1);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l7 = f5(l1, l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K3(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f50(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K1(c1);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f51(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  } else {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  }
  return t3;
}
function f51(l0, l1, l2) {
  if (depth > 1000) return R.drive(f51$h(l0, l1, l2));
  depth++;
  const r = f51$b(l0, l1, l2);
  depth--;
  return r;
}
function f51$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          if (R.ck(f11(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function* f51$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          if (R.ck(f11(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function f52(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K1(c1);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f53(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  } else {
    t3 = f42((l5.f0 ?? l5.fields[0]), c1);
  }
  return t3;
}
function f53(l0, l1, l2) {
  if (depth > 1000) return R.drive(f53$h(l0, l1, l2));
  depth++;
  const r = f53$b(l0, l1, l2);
  depth--;
  return r;
}
function f53$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          if (R.ck(f21(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function* f53$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
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
          if (R.ck(f21(l2, l6))) {
            t3 = l6;
          } else {
            { t0 = false; break t1; }
            t3 = undefined;
          }
          l1.f0 = new K3(t3, (l1.f0 ?? l1.fields[0]));
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
function f54(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f55(l0, l1, c1);
}
function f55(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f42(l2, c1);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l7 = f34(l1, l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K3(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return R.ck(f1(...xs)); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return f3(...xs); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return f4(...xs); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return f5(...xs); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return f8(...xs); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return f9(...xs); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return f10(...xs); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return R.ck(f11(...xs)); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return f13(...xs); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return f14(...xs); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return f15(...xs); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return f16(...xs); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return f17(...xs); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return f18(...xs); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return f19(...xs); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return f20(...xs); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return R.ck(f21(...xs)); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return f22(...xs); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return f23(...xs); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return f24(...xs); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return f25(...xs); } finally { depth = d; } }, f26: (...xs) => { const d = depth; try { return R.ck(f26(...xs)); } finally { depth = d; } }, f27: (...xs) => { const d = depth; try { return R.ck(f27(...xs)); } finally { depth = d; } }, f28: (...xs) => { const d = depth; try { return R.ck(f28(...xs)); } finally { depth = d; } }, f29: (...xs) => { const d = depth; try { return R.ck(f29(...xs)); } finally { depth = d; } }, f30: (...xs) => { const d = depth; try { return R.ck(f30(...xs)); } finally { depth = d; } }, f31: (...xs) => { const d = depth; try { return R.ck(f31(...xs)); } finally { depth = d; } }, f32: (...xs) => { const d = depth; try { return f32(...xs); } finally { depth = d; } }, f33: (...xs) => { const d = depth; try { return f33(...xs); } finally { depth = d; } }, f34: (...xs) => { const d = depth; try { return f34(...xs); } finally { depth = d; } }, f35: (...xs) => { const d = depth; try { return f35(...xs); } finally { depth = d; } }, f36: (...xs) => { const d = depth; try { return f36(...xs); } finally { depth = d; } }, f37: (...xs) => { const d = depth; try { return f37(...xs); } finally { depth = d; } }, f38: (...xs) => { const d = depth; try { return f38(...xs); } finally { depth = d; } }, f39: (...xs) => { const d = depth; try { return f39(...xs); } finally { depth = d; } }, f40: (...xs) => { const d = depth; try { return f40(...xs); } finally { depth = d; } }, f41: (...xs) => { const d = depth; try { return R.ck(f41(...xs)); } finally { depth = d; } }, f42: (...xs) => { const d = depth; try { return f42(...xs); } finally { depth = d; } }, f43: (...xs) => { const d = depth; try { return f43(...xs); } finally { depth = d; } }, f44: (...xs) => { const d = depth; try { return f44(...xs); } finally { depth = d; } }, f45: (...xs) => { const d = depth; try { return f45(...xs); } finally { depth = d; } }, f46: (...xs) => { const d = depth; try { return f46(...xs); } finally { depth = d; } }, f47: (...xs) => { const d = depth; try { return R.ck(f47(...xs)); } finally { depth = d; } }, f48: (...xs) => { const d = depth; try { return f48(...xs); } finally { depth = d; } }, f49: (...xs) => { const d = depth; try { return f49(...xs); } finally { depth = d; } }, f50: (...xs) => { const d = depth; try { return f50(...xs); } finally { depth = d; } }, f51: (...xs) => { const d = depth; try { return R.ck(f51(...xs)); } finally { depth = d; } }, f52: (...xs) => { const d = depth; try { return f52(...xs); } finally { depth = d; } }, f53: (...xs) => { const d = depth; try { return R.ck(f53(...xs)); } finally { depth = d; } }, f54: (...xs) => { const d = depth; try { return f54(...xs); } finally { depth = d; } }, f55: (...xs) => { const d = depth; try { return f55(...xs); } finally { depth = d; } } };