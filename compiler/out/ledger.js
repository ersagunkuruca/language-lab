let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.list.nil"; K0.prototype.$c = 0;
class K1 { constructor() { } get fields() { return []; } }
K1.prototype.tag = "std.optional.none"; K1.prototype.$c = 0;
class K2 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K2.prototype.tag = "std.optional.some"; K2.prototype.$c = 1;
class K3 { constructor(x0, x1, x2, x3) { this.f0 = x0; this.f1 = x1; this.f2 = x2; this.f3 = x3; } get fields() { return [this.f0, this.f1, this.f2, this.f3]; } }
K3.prototype.tag = "v41jb3h0fmcdac3trtjv0f6m7h";
class K4 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K4.prototype.tag = "std.list.cons"; K4.prototype.$c = 1;
class K5 { constructor(x0, x1, x2) { this.f0 = x0; this.f1 = x1; this.f2 = x2; } get fields() { return [this.f0, this.f1, this.f2]; } }
K5.prototype.tag = "0cmru7kiupd2o5escfsqvnedu3";
const c0 = ["std.list.nil","std.list.cons"];
const c1 = R.closure(f8, []);
const c2 = new K0();
const c3 = ["std.optional.none","std.optional.some"];
const c4 = new K1();
const rt0 = R.rt("text.split", ["builtin.text.split",false]);
const rt1 = R.rt("int.show", ["builtin.int.show",false]);
const rt2 = R.rt("text.joinAll", ["builtin.text.joinAll",false]);
const rt3 = R.rt("text.fromCode", ["builtin.text.fromCode",false]);
const rt4 = R.rt("text.length", ["builtin.text.length",false]);
const rt5 = R.rt("int.sub", ["builtin.int.sub",false]);
const rt6 = R.rt("int.range", ["builtin.int.range",false]);
const rt7 = R.rt("int.abs", ["builtin.int.abs",false]);
const rt8 = R.rt("text.slice", ["builtin.text.slice",false]);
const rt9 = R.rt("text.less", ["builtin.text.less",true]);
const rt10 = R.rt("int.add", ["builtin.int.add",false]);
const rt11 = R.rt("int.read", ["builtin.int.read",false]);
const w0 = R.worlds[0];
const w1 = R.worlds[1];
const w2 = R.worlds[2];
function f0(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8, l9;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c0))) {
    case 0: {
      return f1();
    }
    case 1: {
      l2 = (l1.f0 ?? l1.fields[0]);
      l3 = (l1.f1 ?? l1.fields[1]);
      l4 = l3;
      switch ((l4.$c ?? R.caseOf(l4, c0))) {
        case 0: {
          let t0;
          try {
            t0 = R.ck(f2(l2));
          } catch (x) {
            if (!(x instanceof R.Aborted) || x.esc !== 0) throw x;
            l5 = x.reason;
            t0 = f49(l5);
          }
          return t0;
        }
        case 1: {
          l7 = (l4.f0 ?? l4.fields[0]);
          l8 = (l4.f1 ?? l4.fields[1]);
          return f1();
        }
      }
    }
  }
}
function f1() {
  let l0;
  l0 = w0("usage: ledger file.csv");
  return (2);
}
function f2(l0) {
  let l1, l2;
  const t0 = f44(rt0(w1(l0), f6()), (1));
  if (t0 === R.FAIL) return R.FAIL;
  const t1 = f3(t0, l0);
  if (t1 === R.FAIL) return R.FAIL;
  l1 = t1;
  return (0);
}
function f3(l0, l1) {
  let l2, l3, l4, l5, l6;
  l2 = l0;
  switch ((l2.$c ?? R.caseOf(l2, c0))) {
    case 0: {
      return R.abort((l1 + " has no entries"), 0);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      return w2(f4(l0));
    }
  }
}
function f4(l0) {
  let l1;
  return ((((((((((((f5("By account", f21(f27(l0), false)) + f6()) + f6()) + f5("By month", f21(f31(l0), true))) + f6()) + f6()) + f35(f36(l0))) + f6()) + "total: ") + f16(f39(l0))) + " in ") + rt1(f42(l0))) + " entries");
}
function f5(l0, l1) {
  let l2, l3;
  return ((l0 + f6()) + rt2(f57(l1, c1), f6()));
}
let f6$v;
function f6() { return f6$v ??= f6$w(); }
function f6$w() {
  let l0;
  let t0 = true;
  t1: try {
    l0 = rt3((10));
    if (l0 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    t0 = false;
  }
  let t2;
  if (t0) {
    t2 = l0;
  } else {
    t2 = "";
  }
  return t2;
}
function f7(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f50(l0, l1, c2);
}
function f8(l0, l1) {
  let l2, l3;
  return f9(l1);
}
function f9(l0) {
  let l1;
  return (((f10((l0.f0 ?? l0.fields[0]), (14)) + f13(f16((l0.f1 ?? l0.fields[1])), (12))) + " × ") + rt1((l0.f2 ?? l0.fields[2])));
}
function f10(l0, l1) {
  let l2, l3;
  return f11(rt6(rt5(l1, rt4(l0))), [], l0);
}
function f11(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f12(l1, l2, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = (l1.push(l0), l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f12(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.length === 0 ? 0 : 1)) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = l0[l0.length - 1];
        l3 = l3;
        let t0;
        switch ((l3.$c ?? R.caseOf(l3, c0))) {
          case 1: {
            l4 = (l3.f0 ?? l3.fields[0]);
            l5 = (l3.f1 ?? l3.fields[1]);
            t0 = (l1 + " ");
            break;
          }
        }
        const t1 = (l0.pop(), l0);
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
function f13(l0, l1) {
  let l2, l3;
  return f14(rt6(rt5(l1, rt4(l0))), [], l0);
}
function f14(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f15(l1, l2, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = (l1.push(l0), l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f15(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.length === 0 ? 0 : 1)) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = l0[l0.length - 1];
        l3 = l3;
        let t0;
        switch ((l3.$c ?? R.caseOf(l3, c0))) {
          case 1: {
            l4 = (l3.f0 ?? l3.fields[0]);
            l5 = (l3.f1 ?? l3.fields[1]);
            t0 = (" " + l1);
            break;
          }
        }
        const t1 = (l0.pop(), l0);
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
function f16(l0) {
  let l1;
  let t0;
  if ((l0 < (0))) {
    t0 = "-";
  } else {
    t0 = "";
  }
  return (t0 + f17(f18(rt1(rt7(l0)), (3))));
}
function f17(l0) {
  let l1;
  return ((rt8(l0, (0), rt5(rt4(l0), (2))) + ".") + rt8(l0, rt5(rt4(l0), (2)), rt4(l0)));
}
function f18(l0, l1) {
  let l2, l3;
  return f19(rt6(rt5(l1, rt4(l0))), [], l0);
}
function f19(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f20(l1, l2, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = (l1.push(l0), l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f20(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.length === 0 ? 0 : 1)) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = l0[l0.length - 1];
        l3 = l3;
        let t0;
        switch ((l3.$c ?? R.caseOf(l3, c0))) {
          case 1: {
            l4 = (l3.f0 ?? l3.fields[0]);
            l5 = (l3.f1 ?? l3.fields[1]);
            t0 = ("0" + l1);
            break;
          }
        }
        const t1 = (l0.pop(), l0);
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
function f21(l0, l1) {
  let l2, l3;
  return f22(l0, [], l1);
}
function f22(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f23(l1, c2, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = (l1.push(l0), l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f23(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  for (;;) {
    l0 = l0;
    switch ((l0.length === 0 ? 0 : 1)) {
      case 0: {
        return l1;
      }
      case 1: {
        l3 = l0[l0.length - 1];
        l3 = l3;
        let t0;
        switch ((l3.$c ?? R.caseOf(l3, c0))) {
          case 1: {
            l4 = (l3.f0 ?? l3.fields[0]);
            l5 = (l3.f1 ?? l3.fields[1]);
            t0 = f24(l4, l1, l2);
            break;
          }
        }
        const t1 = (l0.pop(), l0);
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
function f24(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  return f52(l0, l1, l2, c2);
}
function f25(l0, l1, l2) {
  let l3, l4, l5;
  if (l2) {
    return rt9((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]));
  } else {
    return f26(l0, l1);
  }
}
function f26(l0, l1) {
  let l2, l3;
  return (((l1.f1 ?? l1.fields[1]) < (l0.f1 ?? l0.fields[1])) || (((l0.f1 ?? l0.fields[1]) === (l1.f1 ?? l1.fields[1])) && rt9((l0.f0 ?? l0.fields[0]), (l1.f0 ?? l1.fields[0]))));
}
function f27(l0) {
  let l1;
  return f28(l0, []);
}
function f28(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f29(l1, c2);
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
function f29(l0, l1) {
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
            t0 = f30(l1, (l3.f1 ?? l3.fields[1]), (l3.f2 ?? l3.fields[2]));
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
function f30(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  return f54(l0, l1, l2, c2);
}
function f31(l0) {
  let l1;
  return f32(l0, []);
}
function f32(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f33(l1, c2);
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
function f33(l0, l1) {
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
            t0 = f30(l1, f34(l3), (l3.f2 ?? l3.fields[2]));
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
function f34(l0) {
  let l1;
  return rt8((l0.f0 ?? l0.fields[0]), (0), (7));
}
function f35(l0) {
  let l1, l2, l3;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c3))) {
    case 0: {
      return "no entries";
    }
    case 1: {
      l2 = (l1.f0 ?? l1.fields[0]);
      return ((((("smallest: " + f16((l2.f2 ?? l2.fields[2]))) + " on ") + (l2.f0 ?? l2.fields[0])) + ", ") + (l2.f3 ?? l2.fields[3]));
    }
  }
}
function f36(l0) {
  let l1;
  return f37(l0, []);
}
function f37(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f38(l1, c4);
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
function f38(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
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
            l5 = l1;
            switch ((l5.$c ?? R.caseOf(l5, c3))) {
              case 0: {
                t0 = new K2(l3);
                break;
              }
              case 1: {
                l6 = (l5.f0 ?? l5.fields[0]);
                if (((l6.f2 ?? l6.fields[2]) < (l3.f2 ?? l3.fields[2]))) {
                  t0 = new K2(l6);
                } else {
                  t0 = new K2(l3);
                }
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
function f39(l0) {
  let l1;
  return f40(l0, []);
}
function f40(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return f41(l1, (0));
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
function f41(l0, l1) {
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
            t0 = rt10((l3.f2 ?? l3.fields[2]), l1);
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
function f42(l0) {
  let l1;
  return f43(l0, (0));
}
function f43(l0, l1) {
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
        const t1 = rt10(l1, (1));
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f44(l0, l1) {
  let l2, l3, l4, l5, l6;
  return f55(l0, l1, c2);
}
function f45(l0) {
  let l1;
  return ((l0 === "") || (rt8(l0, (0), (1)) === "#"));
}
function f46(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18;
  l2 = rt0(l0, ",");
  switch ((l2.$c ?? R.caseOf(l2, c0))) {
    case 0: {
      return f47(l1);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      l5 = l4;
      switch ((l5.$c ?? R.caseOf(l5, c0))) {
        case 0: {
          return f47(l1);
        }
        case 1: {
          l6 = (l5.f0 ?? l5.fields[0]);
          l7 = (l5.f1 ?? l5.fields[1]);
          l8 = l7;
          switch ((l8.$c ?? R.caseOf(l8, c0))) {
            case 0: {
              return f47(l1);
            }
            case 1: {
              l9 = (l8.f0 ?? l8.fields[0]);
              l10 = (l8.f1 ?? l8.fields[1]);
              l11 = l10;
              switch ((l11.$c ?? R.caseOf(l11, c0))) {
                case 0: {
                  return f47(l1);
                }
                case 1: {
                  l12 = (l11.f0 ?? l11.fields[0]);
                  l13 = (l11.f1 ?? l11.fields[1]);
                  l14 = l13;
                  switch ((l14.$c ?? R.caseOf(l14, c0))) {
                    case 0: {
                      return new K3(l3, l6, R.ck(f48(l9, l1)), l12);
                    }
                    case 1: {
                      l15 = (l14.f0 ?? l14.fields[0]);
                      l16 = (l14.f1 ?? l14.fields[1]);
                      return f47(l1);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
function f47(l0) {
  let l1;
  return R.abort((("line " + rt1(l0)) + ": expected date,account,cents,memo"), 0);
}
function f48(l0, l1) {
  let l2, l3, l4;
  let t0 = true;
  t1: try {
    l2 = rt11(l0);
    if (l2 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    t0 = false;
  }
  if (t0) {
    return l2;
  } else {
    return R.abort((("line " + rt1(l1)) + ": the amount isn't a whole number of cents"), 0);
  }
}
function f49(l0) {
  let l1, l2;
  l1 = w0(("ledger: " + l0));
  return (1);
}
function f50(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f51(l2, c2);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l6 = l1;
        l7 = l6(l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K4(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f51(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K4((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f52(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11;
  for (;;) {
    l4 = l1;
    switch ((l4.$c ?? R.caseOf(l4, c0))) {
      case 0: {
        return f53(l3, new K4(l0, c2));
      }
      case 1: {
        l5 = (l4.f0 ?? l4.fields[0]);
        l6 = (l4.f1 ?? l4.fields[1]);
        if (f25(l0, l5, l2)) {
          return f53(l3, new K4(l0, l1));
        } else {
          l7 = l5;
          const t0 = l0;
          const t1 = l6;
          const t2 = l2;
          const t3 = new K4(l7, l3);
          l0 = t0;
          l1 = t1;
          l2 = t2;
          l3 = t3;
          continue;
        }
      }
    }
  }
}
function f53(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K4((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f54(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11;
  for (;;) {
    l4 = l0;
    switch ((l4.$c ?? R.caseOf(l4, c0))) {
      case 0: {
        return f53(l3, new K4(new K5(l1, l2, (1)), c2));
      }
      case 1: {
        l5 = (l4.f0 ?? l4.fields[0]);
        l6 = (l4.f1 ?? l4.fields[1]);
        if (((l5.f0 ?? l5.fields[0]) === l1)) {
          return f53(l3, new K4(new K5(l1, rt10((l5.f1 ?? l5.fields[1]), l2), rt10((l5.f2 ?? l5.fields[2]), (1))), l6));
        } else {
          l7 = l5;
          const t0 = l6;
          const t1 = l1;
          const t2 = l2;
          const t3 = new K4(l7, l3);
          l0 = t0;
          l1 = t1;
          l2 = t2;
          l3 = t3;
          continue;
        }
      }
    }
  }
}
function f55(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f56(l2, c2);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        if (f45(l4)) {
          const t0 = l5;
          const t1 = rt10(l1, (1));
          const t2 = l2;
          l0 = t0;
          l1 = t1;
          l2 = t2;
          continue;
        } else {
          const t3 = f46(l4, l1);
          if (t3 === R.FAIL) return R.FAIL;
          l6 = t3;
          const t4 = l5;
          const t5 = rt10(l1, (1));
          const t6 = new K4(l6, l2);
          l0 = t4;
          l1 = t5;
          l2 = t6;
          continue;
        }
      }
    }
  }
}
function f56(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c0))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K4((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f57(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  return f58(l0, l1, c2);
}
function f58(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c0))) {
      case 0: {
        return f51(l2, c2);
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l7 = f8(l1, l4);
        const t0 = l5;
        const t1 = l1;
        const t2 = new K4(l7, l2);
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
return { f0, f1, f2: (...xs) => R.ck(f2(...xs)), f3: (...xs) => R.ck(f3(...xs)), f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39, f40, f41, f42, f43, f44: (...xs) => R.ck(f44(...xs)), f45, f46: (...xs) => R.ck(f46(...xs)), f47: (...xs) => R.ck(f47(...xs)), f48: (...xs) => R.ck(f48(...xs)), f49, f50, f51, f52, f53, f54, f55: (...xs) => R.ck(f55(...xs)), f56, f57, f58 };