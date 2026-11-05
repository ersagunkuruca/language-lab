let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.list.nil"; K0.prototype.$c = 0;
class K1 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K1.prototype.tag = "sp3nhthm2f80ipu3diun4hkjbs";
class K2 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K2.prototype.tag = "sob4uovkjgvtl08hmomq2g7s9j"; K2.prototype.$c = 1;
class K3 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K3.prototype.tag = "kmk1ml3mjcugl6ajl18l35hpak";
class K4 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K4.prototype.tag = "std.list.cons"; K4.prototype.$c = 1;
class K5 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K5.prototype.tag = "heiprc4fnbobd3nei81ji3c5lj"; K5.prototype.$c = 2;
class K6 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K6.prototype.tag = "box:std.list<hb4002r311qtknph13f1uvibbe<>>";
class K7 { constructor() { } get fields() { return []; } }
K7.prototype.tag = "b3oi8ad6i9snrm47e6s1e9o39j"; K7.prototype.$c = 3;
class K8 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K8.prototype.tag = "7ooirerkrpa7v4m513os3u35u2"; K8.prototype.$c = 0;
class K9 { constructor() { } get fields() { return []; } }
K9.prototype.tag = "std.optional.none"; K9.prototype.$c = 0;
class K10 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K10.prototype.tag = "std.optional.some"; K10.prototype.$c = 1;
class K11 { constructor(x0, x1, x2) { this.f0 = x0; this.f1 = x1; this.f2 = x2; } get fields() { return [this.f0, this.f1, this.f2]; } }
K11.prototype.tag = "19jsd7mt75bqquaai00k4s88ij"; K11.prototype.$c = 3;
class K12 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K12.prototype.tag = "std.tuple2.tuple";
class K13 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K13.prototype.tag = "c8qnc3q04fv6qolvnrj06fkj6q"; K13.prototype.$c = 0;
class K14 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K14.prototype.tag = "j31hdqrhpj1eirec5fra54ushl"; K14.prototype.$c = 1;
class K15 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K15.prototype.tag = "jigh5f3fhrtjctpdqe548tedql"; K15.prototype.$c = 2;
const c0 = new K0();
const c1 = new K1(c0, (0));
const c2 = ["std.list.nil","std.list.cons"];
const c3 = new K2("let");
const c4 = ["7ooirerkrpa7v4m513os3u35u2","sob4uovkjgvtl08hmomq2g7s9j","heiprc4fnbobd3nei81ji3c5lj","b3oi8ad6i9snrm47e6s1e9o39j"];
const c5 = new K5("?");
const c6 = R.closure(f11, []);
const c7 = new K7();
const c8 = ["c8qnc3q04fv6qolvnrj06fkj6q","j31hdqrhpj1eirec5fra54ushl","jigh5f3fhrtjctpdqe548tedql","19jsd7mt75bqquaai00k4s88ij"];
const c9 = ["std.optional.none","std.optional.some"];
const c10 = new K9();
const c11 = R.closure(f25, []);
const c12 = R.closure(f32, []);
const c13 = R.closure(f29, []);
const c14 = R.closure(f31, []);
const rt0 = R.rt("text.split", ["builtin.text.split",false]);
const rt1 = R.rt("int.add", ["builtin.int.add",false]);
const rt2 = R.rt("int.show", ["builtin.int.show",false]);
const rt3 = R.rt("text.find", ["builtin.text.find",false]);
const rt4 = R.rt("text.length", ["builtin.text.length",false]);
const rt5 = R.rt("text.slice", ["builtin.text.slice",false]);
const rt6 = R.rt("text.size");
const rt7 = R.rt("text.before");
const rt8 = R.rt("text.bytes");
const rt9 = R.rt("text.less", ["builtin.text.less",true]);
const rt10 = R.rt("int.neg", ["builtin.int.neg",false]);
const rt11 = R.rt("int.sub", ["builtin.int.sub",false]);
const rt12 = R.rt("int.mul", ["builtin.int.mul",false]);
const rt13 = R.rt("int.quotient", ["builtin.int.quotient",false]);
const rt14 = R.rt("int.remainder", ["builtin.int.remainder",false]);
const rt15 = R.rt("int.power", ["builtin.int.power",false]);
const rt16 = R.rt("int.read", ["builtin.int.read",false]);
const rt17 = R.rt("text.characters", ["builtin.text.characters",false]);
const w0 = R.worlds[0];
const w1 = R.worlds[1];
const w2 = R.worlds[2];
function f0() {
  let l0, l1, l2, l3;
  l0 = f1(rt0(w0(), "\n"), (1), c1);
  l1 = l0;
  l2 = (l1.f0 ?? l1.fields[0]);
  l3 = (l1.f1 ?? l1.fields[1]);
  if (((0) < l3)) {
    return (1);
  } else {
    return (0);
  }
}
function f1(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14;
  for (;;) {
    l3 = l0;
    switch ((l3.$c ?? R.caseOf(l3, c2))) {
      case 0: {
        return l2;
      }
      case 1: {
        l4 = (l3.f0 ?? l3.fields[0]);
        l5 = (l3.f1 ?? l3.fields[1]);
        l6 = l2;
        l7 = (l6.f0 ?? l6.fields[0]);
        l8 = (l6.f1 ?? l6.fields[1]);
        const t1 = depth; let t0;
        try {
          t0 = new K1(R.ck(f2(l4, l7)), l8);
        } catch (x) {
          if (!(x instanceof R.Aborted) || x.esc !== 0) throw x;
          depth = t1; l9 = x.reason;
          l11 = w1(((("calc: line " + rt2(l1)) + ": ") + l9));
          t0 = new K1(l7, rt1(l8, (1)));
        }
        const t2 = l5;
        const t3 = rt1(l1, (1));
        const t4 = t0;
        l0 = t2;
        l1 = t3;
        l2 = t4;
        continue;
      }
    }
  }
}
function f2(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19;
  l2 = f3(l0);
  l3 = l2;
  switch ((l3.$c ?? R.caseOf(l3, c2))) {
    case 0: {
      return l1;
    }
    case 1: {
      l4 = (l3.f0 ?? l3.fields[0]);
      l5 = (l3.f1 ?? l3.fields[1]);
      if (f12(l4, c3)) {
        l6 = l5;
        switch ((l6.$c ?? R.caseOf(l6, c2))) {
          case 0: {
            return R.abort(("let needs a name, got " + f13(l5)), 0);
          }
          case 1: {
            l7 = (l6.f0 ?? l6.fields[0]);
            l8 = (l6.f1 ?? l6.fields[1]);
            l9 = l7;
            switch ((l9.$c ?? R.caseOf(l9, c4))) {
              case 0: {
                return R.abort(("let needs a name, got " + f13(l5)), 0);
              }
              case 1: {
                l10 = (l9.f0 ?? l9.fields[0]);
                l11 = R.ck(f37("=", l8));
                const t2 = depth; let t0 = true;
                t1: try {
                  l12 = rt3(l0, "=");
                  if (l12 === R.FAIL) t0 = false;
                } catch (x) {
                  if (x !== R.FAIL) throw x;
                  depth = t2; t0 = false;
                }
                let t3;
                if (t0) {
                  t3 = l12;
                } else {
                  t3 = (0);
                }
                const t4 = f18(rt5(l0, rt1(t3, (1)), rt4(l0)));
                if (t4 === R.FAIL) return R.FAIL;
                const t5 = f14(t4, l1);
                if (t5 === R.FAIL) return R.FAIL;
                l13 = t5;
                l14 = w2(((l10 + " = ") + rt2(l13)));
                return new K4(new K3(l10, l13), l1);
              }
              case 2: {
                return R.abort(("let needs a name, got " + f13(l5)), 0);
              }
              case 3: {
                return R.abort(("let needs a name, got " + f13(l5)), 0);
              }
            }
          }
        }
      } else {
        if (f12(l4, c5)) {
          const t8 = depth; let t6 = true;
          t7: try {
            l15 = rt3(l0, "?");
            if (l15 === R.FAIL) t6 = false;
          } catch (x) {
            if (x !== R.FAIL) throw x;
            depth = t8; t6 = false;
          }
          let t9;
          if (t6) {
            t9 = l15;
          } else {
            t9 = (0);
          }
          l16 = w2(f38(R.ck(f18(rt5(l0, rt1(t9, (1)), rt4(l0))))));
          return l1;
        } else {
          l17 = w2(rt2(R.ck(f14(R.ck(f18(l0)), l1))));
          return l1;
        }
      }
    }
  }
}
function f3(l0) {
  let l1, l2;
  l1 = l0;
  return f42(f5(l1, rt6(l1), c0), c6);
}
function f4(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K6(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f40(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f41((l5.f0 ?? l5.fields[0]), c0);
  } else {
    t3 = f41((l5.f0 ?? l5.fields[0]), c0);
  }
  return t3;
}
function f5(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20;
  for (;;) {
    if ((!l1)) {
      return l2;
    } else {
      l3 = rt7(l0, l1);
      l4 = rt8(l0, l3, l1);
      let t0;
      if (f6(l4)) {
        t0 = new K4(c7, l2);
      } else {
        if (f7(l4)) {
          l5 = l2;
          switch ((l5.$c ?? R.caseOf(l5, c2))) {
            case 0: {
              t0 = new K4(new K8(l4), l2);
              break;
            }
            case 1: {
              l6 = (l5.f0 ?? l5.fields[0]);
              l7 = (l5.f1 ?? l5.fields[1]);
              l8 = l6;
              switch ((l8.$c ?? R.caseOf(l8, c4))) {
                case 0: {
                  l9 = (l8.f0 ?? l8.fields[0]);
                  t0 = new K4(new K8((l4 + l9)), l7);
                  break;
                }
                case 1: {
                  l10 = (l8.f0 ?? l8.fields[0]);
                  t0 = new K4(new K8(l4), l2);
                  break;
                }
                case 2: {
                  l11 = (l8.f0 ?? l8.fields[0]);
                  t0 = new K4(new K8(l4), l2);
                  break;
                }
                case 3: {
                  t0 = new K4(new K8(l4), l2);
                  break;
                }
              }
              break;
            }
          }
        } else {
          if (f10(l4)) {
            l12 = l2;
            switch ((l12.$c ?? R.caseOf(l12, c2))) {
              case 0: {
                t0 = new K4(new K2(l4), l2);
                break;
              }
              case 1: {
                l13 = (l12.f0 ?? l12.fields[0]);
                l14 = (l12.f1 ?? l12.fields[1]);
                l15 = l13;
                switch ((l15.$c ?? R.caseOf(l15, c4))) {
                  case 0: {
                    l16 = (l15.f0 ?? l15.fields[0]);
                    t0 = new K4(new K2((l4 + l16)), l14);
                    break;
                  }
                  case 1: {
                    l17 = (l15.f0 ?? l15.fields[0]);
                    t0 = new K4(new K2((l4 + l17)), l14);
                    break;
                  }
                  case 2: {
                    t0 = new K4(new K2(l4), l2);
                    break;
                  }
                  case 3: {
                    t0 = new K4(new K2(l4), l2);
                    break;
                  }
                }
                break;
              }
            }
          } else {
            t0 = new K4(new K5(l4), l2);
          }
        }
      }
      const t1 = l0;
      const t2 = l3;
      const t3 = t0;
      l0 = t1;
      l1 = t2;
      l2 = t3;
      continue;
    }
  }
}
function f6(l0) {
  let l1;
  return ((l0 === " ") || ((l0 === "\t") || (l0 === "\r")));
}
function f7(l0) {
  let l1;
  return (f8(l0, "0") && f9(l0, "9"));
}
function f8(l0, l1) {
  let l2, l3;
  return (!rt9(l0, l1));
}
function f9(l0, l1) {
  let l2, l3;
  return (!rt9(l1, l0));
}
function f10(l0) {
  let l1;
  return ((f8(l0, "a") && f9(l0, "z")) || ((f8(l0, "A") && f9(l0, "Z")) || (l0 === "_")));
}
function f11(l0, l1) {
  let l2, l3;
  return (!f12(l1, c7));
}
function f12(l0, l1) {
  let l2, l3;
  if (((l0.$c ?? R.caseOf(l0, c4)) === (l1.$c ?? R.caseOf(l1, c4)))) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c4))) {
      case 0: {
        return ((l0.f0 ?? l0.fields[0]) === (l1.f0 ?? l1.fields[0]));
      }
      case 1: {
        return ((l0.f0 ?? l0.fields[0]) === (l1.f0 ?? l1.fields[0]));
      }
      case 2: {
        return ((l0.f0 ?? l0.fields[0]) === (l1.f0 ?? l1.fields[0]));
      }
      case 3: {
        return true;
      }
    }
  } else {
    return false;
  }
}
function f13(l0) {
  let l1, l2, l3, l4, l5, l6, l7, l8;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c2))) {
    case 0: {
      return "the end of the line";
    }
    case 1: {
      l2 = (l1.f0 ?? l1.fields[0]);
      l3 = (l1.f1 ?? l1.fields[1]);
      l4 = l2;
      switch ((l4.$c ?? R.caseOf(l4, c4))) {
        case 0: {
          l5 = (l4.f0 ?? l4.fields[0]);
          return l5;
        }
        case 1: {
          l6 = (l4.f0 ?? l4.fields[0]);
          return l6;
        }
        case 2: {
          l7 = (l4.f0 ?? l4.fields[0]);
          return (("“" + l7) + "”");
        }
        case 3: {
          return "a gap";
        }
      }
    }
  }
}
function f14(l0, l1) {
  let l2, l3;
  return f15(l0, l1);
}
function f15(l0, l1) {
  if (depth > 1000) return R.drive(f15$h(l0, l1));
  depth++;
  const r = f15$b(l0, l1);
  depth--;
  return r;
}
function f15$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c8))) {
    case 0: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 1: {
      l3 = (l0.f0 ?? l0.fields[0]);
      return f16(l1, l3);
    }
    case 2: {
      l4 = (l0.f0 ?? l0.fields[0]);
      return rt10(R.ck(f15((l0.f0 ?? l0.fields[0]), l1)));
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      l7 = (l0.f2 ?? l0.fields[2]);
      const t0 = f15((l0.f1 ?? l0.fields[1]), l1);
      if (t0 === R.FAIL) return R.FAIL;
      return f17(l5, t0, R.ck(f15((l0.f2 ?? l0.fields[2]), l1)));
    }
  }
}
function* f15$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c8))) {
    case 0: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 1: {
      l3 = (l0.f0 ?? l0.fields[0]);
      return f16(l1, l3);
    }
    case 2: {
      l4 = (l0.f0 ?? l0.fields[0]);
      return rt10(R.ck((yield [f15$h, [(l0.f0 ?? l0.fields[0]), l1]])));
    }
    case 3: {
      l5 = (l0.f0 ?? l0.fields[0]);
      l6 = (l0.f1 ?? l0.fields[1]);
      l7 = (l0.f2 ?? l0.fields[2]);
      const t0 = (yield [f15$h, [(l0.f1 ?? l0.fields[1]), l1]]);
      if (t0 === R.FAIL) return R.FAIL;
      return f17(l5, t0, R.ck((yield [f15$h, [(l0.f2 ?? l0.fields[2]), l1]])));
    }
  }
}
function f16(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c2))) {
      case 0: {
        return R.abort(("unknown name " + l1), 0);
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l5 = l3;
        l6 = (l5.f0 ?? l5.fields[0]);
        l7 = (l5.f1 ?? l5.fields[1]);
        if ((l6 === l1)) {
          return l7;
        } else {
          const t0 = l4;
          const t1 = l1;
          l0 = t0;
          l1 = t1;
          continue;
        }
      }
    }
  }
}
function f17(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8;
  if ((l0 === "+")) {
    return rt1(l1, l2);
  } else {
    if ((l0 === "-")) {
      return rt11(l1, l2);
    } else {
      if ((l0 === "*")) {
        return rt12(l1, l2);
      } else {
        if ((l0 === "/")) {
          const t2 = depth; let t0 = true;
          t1: try {
            l3 = rt13(l1, l2);
            if (l3 === R.FAIL) t0 = false;
          } catch (x) {
            if (x !== R.FAIL) throw x;
            depth = t2; t0 = false;
          }
          if (t0) {
            return l3;
          } else {
            return R.abort("division by zero", 0);
          }
        } else {
          if ((l0 === "%")) {
            const t5 = depth; let t3 = true;
            t4: try {
              l4 = rt14(l1, l2);
              if (l4 === R.FAIL) t3 = false;
            } catch (x) {
              if (x !== R.FAIL) throw x;
              depth = t5; t3 = false;
            }
            if (t3) {
              return l4;
            } else {
              return R.abort("remainder of division by zero", 0);
            }
          } else {
            if ((l0 === "^")) {
              const t8 = depth; let t6 = true;
              t7: try {
                l5 = rt15(l1, l2);
                if (l5 === R.FAIL) t6 = false;
              } catch (x) {
                if (x !== R.FAIL) throw x;
                depth = t8; t6 = false;
              }
              if (t6) {
                return l5;
              } else {
                return R.abort("negative power", 0);
              }
            } else {
              return R.abort(("unknown operator " + l0), 0);
            }
          }
        }
      }
    }
  }
}
function f18(l0) {
  let l1, l2;
  const t2 = depth; let t0 = true;
  t1: try {
    l1 = f19(f34(l0));
    if (l1 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  if (t0) {
    return l1;
  } else {
    return R.abort(("not an expression: " + l0), 0);
  }
}
function f19(l0) {
  let l1, l2, l3;
  const t0 = f20(l0, (0));
  if (t0 === R.FAIL) return R.FAIL;
  l1 = t0;
  switch ((l1.$c ?? R.caseOf(l1, c9))) {
    case 0: {
      return R.FAIL;
    }
    case 1: {
      l2 = (l1.f0 ?? l1.fields[0]);
      return l2;
    }
  }
}
function f20(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  const t0 = f21(l0, (0), l1, l1);
  if (t0 === R.FAIL) return R.FAIL;
  l2 = t0;
  switch ((l2.$c ?? R.caseOf(l2, c9))) {
    case 0: {
      return c10;
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = l3;
      l5 = (l4.f0 ?? l4.fields[0]);
      l6 = (l4.f1 ?? l4.fields[1]);
      if ((l5 === rt4(l0))) {
        return new K10(l6);
      } else {
        return c10;
      }
    }
  }
}
function f21(l0, l1, l2, l3) {
  if (depth > 1000) return R.drive(f21$h(l0, l1, l2, l3));
  depth++;
  const r = f21$b(l0, l1, l2, l3);
  depth--;
  return r;
}
function f21$b(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12;
  const t0 = f27(l0, l1, l2, l3);
  if (t0 === R.FAIL) return R.FAIL;
  l4 = t0;
  switch ((l4.$c ?? R.caseOf(l4, c9))) {
    case 0: {
      return c10;
    }
    case 1: {
      l5 = (l4.f0 ?? l4.fields[0]);
      l6 = l5;
      l7 = (l6.f0 ?? l6.fields[0]);
      l8 = (l6.f1 ?? l6.fields[1]);
      return f22(l0, l7, l8, l2, l3);
    }
  }
}
function* f21$h(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12;
  const t0 = (yield [f27$h, [l0, l1, l2, l3]]);
  if (t0 === R.FAIL) return R.FAIL;
  l4 = t0;
  switch ((l4.$c ?? R.caseOf(l4, c9))) {
    case 0: {
      return c10;
    }
    case 1: {
      l5 = (l4.f0 ?? l4.fields[0]);
      l6 = l5;
      l7 = (l6.f0 ?? l6.fields[0]);
      l8 = (l6.f1 ?? l6.fields[1]);
      return (yield [f22$h, [l0, l7, l8, l2, l3]]);
    }
  }
}
function f22(l0, l1, l2, l3, l4) {
  if (depth > 1000) return R.drive(f22$h(l0, l1, l2, l3, l4));
  depth++;
  const r = f22$b(l0, l1, l2, l3, l4);
  depth--;
  return r;
}
function f22$b(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59, l60, l61, l62, l63, l64, l65, l66, l67, l68, l69, l70, l71, l72, l73, l74, l75, l76, l77, l78, l79, l80, l81, l82, l83, l84;
  l7 = f23(l0, l1);
  let t0;
  if ((rt5(l0, l7, rt1(l7, (1))) === "+")) {
    l8 = "+";
    const t1 = f26(l8);
    if (t1 === R.FAIL) return R.FAIL;
    l9 = t1;
    l10 = l8;
    let t2;
    if ((l10 === "^")) {
      t2 = (1);
    } else {
      t2 = (0);
    }
    l11 = t2;
    if ((l9 < l3)) {
      t0 = c10;
    } else {
      l12 = f23(l0, l1);
      if ((rt5(l0, l12, rt1(l12, rt4(l8))) === l8)) {
        l13 = rt1(l12, rt4(l8));
        l14 = f23(l0, l13);
        const t3 = f21(l0, l14, rt11(rt1(l9, (1)), l11), l4);
        if (t3 === R.FAIL) return R.FAIL;
        l15 = t3;
        switch ((l15.$c ?? R.caseOf(l15, c9))) {
          case 0: {
            t0 = c10;
            break;
          }
          case 1: {
            l16 = (l15.f0 ?? l15.fields[0]);
            l17 = l16;
            l18 = (l17.f0 ?? l17.fields[0]);
            l19 = (l17.f1 ?? l17.fields[1]);
            t0 = R.ck(f22(l0, l18, new K11(l8, l2, l19), l3, l4));
            break;
          }
        }
      } else {
        t0 = c10;
      }
    }
  } else {
    if ((rt5(l0, l7, rt1(l7, (1))) === "-")) {
      l20 = "-";
      const t4 = f26(l20);
      if (t4 === R.FAIL) return R.FAIL;
      l21 = t4;
      l22 = l20;
      let t5;
      if ((l22 === "^")) {
        t5 = (1);
      } else {
        t5 = (0);
      }
      l23 = t5;
      if ((l21 < l3)) {
        t0 = c10;
      } else {
        l24 = f23(l0, l1);
        if ((rt5(l0, l24, rt1(l24, rt4(l20))) === l20)) {
          l25 = rt1(l24, rt4(l20));
          l26 = f23(l0, l25);
          const t6 = f21(l0, l26, rt11(rt1(l21, (1)), l23), l4);
          if (t6 === R.FAIL) return R.FAIL;
          l27 = t6;
          switch ((l27.$c ?? R.caseOf(l27, c9))) {
            case 0: {
              t0 = c10;
              break;
            }
            case 1: {
              l28 = (l27.f0 ?? l27.fields[0]);
              l29 = l28;
              l30 = (l29.f0 ?? l29.fields[0]);
              l31 = (l29.f1 ?? l29.fields[1]);
              t0 = R.ck(f22(l0, l30, new K11(l20, l2, l31), l3, l4));
              break;
            }
          }
        } else {
          t0 = c10;
        }
      }
    } else {
      if ((rt5(l0, l7, rt1(l7, (1))) === "*")) {
        l32 = "*";
        const t7 = f26(l32);
        if (t7 === R.FAIL) return R.FAIL;
        l33 = t7;
        l34 = l32;
        let t8;
        if ((l34 === "^")) {
          t8 = (1);
        } else {
          t8 = (0);
        }
        l35 = t8;
        if ((l33 < l3)) {
          t0 = c10;
        } else {
          l36 = f23(l0, l1);
          if ((rt5(l0, l36, rt1(l36, rt4(l32))) === l32)) {
            l37 = rt1(l36, rt4(l32));
            l38 = f23(l0, l37);
            const t9 = f21(l0, l38, rt11(rt1(l33, (1)), l35), l4);
            if (t9 === R.FAIL) return R.FAIL;
            l39 = t9;
            switch ((l39.$c ?? R.caseOf(l39, c9))) {
              case 0: {
                t0 = c10;
                break;
              }
              case 1: {
                l40 = (l39.f0 ?? l39.fields[0]);
                l41 = l40;
                l42 = (l41.f0 ?? l41.fields[0]);
                l43 = (l41.f1 ?? l41.fields[1]);
                t0 = R.ck(f22(l0, l42, new K11(l32, l2, l43), l3, l4));
                break;
              }
            }
          } else {
            t0 = c10;
          }
        }
      } else {
        if ((rt5(l0, l7, rt1(l7, (1))) === "/")) {
          l44 = "/";
          const t10 = f26(l44);
          if (t10 === R.FAIL) return R.FAIL;
          l45 = t10;
          l46 = l44;
          let t11;
          if ((l46 === "^")) {
            t11 = (1);
          } else {
            t11 = (0);
          }
          l47 = t11;
          if ((l45 < l3)) {
            t0 = c10;
          } else {
            l48 = f23(l0, l1);
            if ((rt5(l0, l48, rt1(l48, rt4(l44))) === l44)) {
              l49 = rt1(l48, rt4(l44));
              l50 = f23(l0, l49);
              const t12 = f21(l0, l50, rt11(rt1(l45, (1)), l47), l4);
              if (t12 === R.FAIL) return R.FAIL;
              l51 = t12;
              switch ((l51.$c ?? R.caseOf(l51, c9))) {
                case 0: {
                  t0 = c10;
                  break;
                }
                case 1: {
                  l52 = (l51.f0 ?? l51.fields[0]);
                  l53 = l52;
                  l54 = (l53.f0 ?? l53.fields[0]);
                  l55 = (l53.f1 ?? l53.fields[1]);
                  t0 = R.ck(f22(l0, l54, new K11(l44, l2, l55), l3, l4));
                  break;
                }
              }
            } else {
              t0 = c10;
            }
          }
        } else {
          if ((rt5(l0, l7, rt1(l7, (1))) === "%")) {
            l56 = "%";
            const t13 = f26(l56);
            if (t13 === R.FAIL) return R.FAIL;
            l57 = t13;
            l58 = l56;
            let t14;
            if ((l58 === "^")) {
              t14 = (1);
            } else {
              t14 = (0);
            }
            l59 = t14;
            if ((l57 < l3)) {
              t0 = c10;
            } else {
              l60 = f23(l0, l1);
              if ((rt5(l0, l60, rt1(l60, rt4(l56))) === l56)) {
                l61 = rt1(l60, rt4(l56));
                l62 = f23(l0, l61);
                const t15 = f21(l0, l62, rt11(rt1(l57, (1)), l59), l4);
                if (t15 === R.FAIL) return R.FAIL;
                l63 = t15;
                switch ((l63.$c ?? R.caseOf(l63, c9))) {
                  case 0: {
                    t0 = c10;
                    break;
                  }
                  case 1: {
                    l64 = (l63.f0 ?? l63.fields[0]);
                    l65 = l64;
                    l66 = (l65.f0 ?? l65.fields[0]);
                    l67 = (l65.f1 ?? l65.fields[1]);
                    t0 = R.ck(f22(l0, l66, new K11(l56, l2, l67), l3, l4));
                    break;
                  }
                }
              } else {
                t0 = c10;
              }
            }
          } else {
            if ((rt5(l0, l7, rt1(l7, (1))) === "^")) {
              l68 = "^";
              const t16 = f26(l68);
              if (t16 === R.FAIL) return R.FAIL;
              l69 = t16;
              l70 = l68;
              let t17;
              if ((l70 === "^")) {
                t17 = (1);
              } else {
                t17 = (0);
              }
              l71 = t17;
              if ((l69 < l3)) {
                t0 = c10;
              } else {
                l72 = f23(l0, l1);
                if ((rt5(l0, l72, rt1(l72, rt4(l68))) === l68)) {
                  l73 = rt1(l72, rt4(l68));
                  l74 = f23(l0, l73);
                  const t18 = f21(l0, l74, rt11(rt1(l69, (1)), l71), l4);
                  if (t18 === R.FAIL) return R.FAIL;
                  l75 = t18;
                  switch ((l75.$c ?? R.caseOf(l75, c9))) {
                    case 0: {
                      t0 = c10;
                      break;
                    }
                    case 1: {
                      l76 = (l75.f0 ?? l75.fields[0]);
                      l77 = l76;
                      l78 = (l77.f0 ?? l77.fields[0]);
                      l79 = (l77.f1 ?? l77.fields[1]);
                      t0 = R.ck(f22(l0, l78, new K11(l68, l2, l79), l3, l4));
                      break;
                    }
                  }
                } else {
                  t0 = c10;
                }
              }
            } else {
              t0 = c10;
            }
          }
        }
      }
    }
  }
  l5 = t0;
  switch ((l5.$c ?? R.caseOf(l5, c9))) {
    case 0: {
      return new K10(new K12(l1, l2));
    }
    case 1: {
      l6 = (l5.f0 ?? l5.fields[0]);
      return new K10(l6);
    }
  }
}
function* f22$h(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33, l34, l35, l36, l37, l38, l39, l40, l41, l42, l43, l44, l45, l46, l47, l48, l49, l50, l51, l52, l53, l54, l55, l56, l57, l58, l59, l60, l61, l62, l63, l64, l65, l66, l67, l68, l69, l70, l71, l72, l73, l74, l75, l76, l77, l78, l79, l80, l81, l82, l83, l84;
  l7 = f23(l0, l1);
  let t0;
  if ((rt5(l0, l7, rt1(l7, (1))) === "+")) {
    l8 = "+";
    const t1 = f26(l8);
    if (t1 === R.FAIL) return R.FAIL;
    l9 = t1;
    l10 = l8;
    let t2;
    if ((l10 === "^")) {
      t2 = (1);
    } else {
      t2 = (0);
    }
    l11 = t2;
    if ((l9 < l3)) {
      t0 = c10;
    } else {
      l12 = f23(l0, l1);
      if ((rt5(l0, l12, rt1(l12, rt4(l8))) === l8)) {
        l13 = rt1(l12, rt4(l8));
        l14 = f23(l0, l13);
        const t3 = (yield [f21$h, [l0, l14, rt11(rt1(l9, (1)), l11), l4]]);
        if (t3 === R.FAIL) return R.FAIL;
        l15 = t3;
        switch ((l15.$c ?? R.caseOf(l15, c9))) {
          case 0: {
            t0 = c10;
            break;
          }
          case 1: {
            l16 = (l15.f0 ?? l15.fields[0]);
            l17 = l16;
            l18 = (l17.f0 ?? l17.fields[0]);
            l19 = (l17.f1 ?? l17.fields[1]);
            t0 = R.ck((yield [f22$h, [l0, l18, new K11(l8, l2, l19), l3, l4]]));
            break;
          }
        }
      } else {
        t0 = c10;
      }
    }
  } else {
    if ((rt5(l0, l7, rt1(l7, (1))) === "-")) {
      l20 = "-";
      const t4 = f26(l20);
      if (t4 === R.FAIL) return R.FAIL;
      l21 = t4;
      l22 = l20;
      let t5;
      if ((l22 === "^")) {
        t5 = (1);
      } else {
        t5 = (0);
      }
      l23 = t5;
      if ((l21 < l3)) {
        t0 = c10;
      } else {
        l24 = f23(l0, l1);
        if ((rt5(l0, l24, rt1(l24, rt4(l20))) === l20)) {
          l25 = rt1(l24, rt4(l20));
          l26 = f23(l0, l25);
          const t6 = (yield [f21$h, [l0, l26, rt11(rt1(l21, (1)), l23), l4]]);
          if (t6 === R.FAIL) return R.FAIL;
          l27 = t6;
          switch ((l27.$c ?? R.caseOf(l27, c9))) {
            case 0: {
              t0 = c10;
              break;
            }
            case 1: {
              l28 = (l27.f0 ?? l27.fields[0]);
              l29 = l28;
              l30 = (l29.f0 ?? l29.fields[0]);
              l31 = (l29.f1 ?? l29.fields[1]);
              t0 = R.ck((yield [f22$h, [l0, l30, new K11(l20, l2, l31), l3, l4]]));
              break;
            }
          }
        } else {
          t0 = c10;
        }
      }
    } else {
      if ((rt5(l0, l7, rt1(l7, (1))) === "*")) {
        l32 = "*";
        const t7 = f26(l32);
        if (t7 === R.FAIL) return R.FAIL;
        l33 = t7;
        l34 = l32;
        let t8;
        if ((l34 === "^")) {
          t8 = (1);
        } else {
          t8 = (0);
        }
        l35 = t8;
        if ((l33 < l3)) {
          t0 = c10;
        } else {
          l36 = f23(l0, l1);
          if ((rt5(l0, l36, rt1(l36, rt4(l32))) === l32)) {
            l37 = rt1(l36, rt4(l32));
            l38 = f23(l0, l37);
            const t9 = (yield [f21$h, [l0, l38, rt11(rt1(l33, (1)), l35), l4]]);
            if (t9 === R.FAIL) return R.FAIL;
            l39 = t9;
            switch ((l39.$c ?? R.caseOf(l39, c9))) {
              case 0: {
                t0 = c10;
                break;
              }
              case 1: {
                l40 = (l39.f0 ?? l39.fields[0]);
                l41 = l40;
                l42 = (l41.f0 ?? l41.fields[0]);
                l43 = (l41.f1 ?? l41.fields[1]);
                t0 = R.ck((yield [f22$h, [l0, l42, new K11(l32, l2, l43), l3, l4]]));
                break;
              }
            }
          } else {
            t0 = c10;
          }
        }
      } else {
        if ((rt5(l0, l7, rt1(l7, (1))) === "/")) {
          l44 = "/";
          const t10 = f26(l44);
          if (t10 === R.FAIL) return R.FAIL;
          l45 = t10;
          l46 = l44;
          let t11;
          if ((l46 === "^")) {
            t11 = (1);
          } else {
            t11 = (0);
          }
          l47 = t11;
          if ((l45 < l3)) {
            t0 = c10;
          } else {
            l48 = f23(l0, l1);
            if ((rt5(l0, l48, rt1(l48, rt4(l44))) === l44)) {
              l49 = rt1(l48, rt4(l44));
              l50 = f23(l0, l49);
              const t12 = (yield [f21$h, [l0, l50, rt11(rt1(l45, (1)), l47), l4]]);
              if (t12 === R.FAIL) return R.FAIL;
              l51 = t12;
              switch ((l51.$c ?? R.caseOf(l51, c9))) {
                case 0: {
                  t0 = c10;
                  break;
                }
                case 1: {
                  l52 = (l51.f0 ?? l51.fields[0]);
                  l53 = l52;
                  l54 = (l53.f0 ?? l53.fields[0]);
                  l55 = (l53.f1 ?? l53.fields[1]);
                  t0 = R.ck((yield [f22$h, [l0, l54, new K11(l44, l2, l55), l3, l4]]));
                  break;
                }
              }
            } else {
              t0 = c10;
            }
          }
        } else {
          if ((rt5(l0, l7, rt1(l7, (1))) === "%")) {
            l56 = "%";
            const t13 = f26(l56);
            if (t13 === R.FAIL) return R.FAIL;
            l57 = t13;
            l58 = l56;
            let t14;
            if ((l58 === "^")) {
              t14 = (1);
            } else {
              t14 = (0);
            }
            l59 = t14;
            if ((l57 < l3)) {
              t0 = c10;
            } else {
              l60 = f23(l0, l1);
              if ((rt5(l0, l60, rt1(l60, rt4(l56))) === l56)) {
                l61 = rt1(l60, rt4(l56));
                l62 = f23(l0, l61);
                const t15 = (yield [f21$h, [l0, l62, rt11(rt1(l57, (1)), l59), l4]]);
                if (t15 === R.FAIL) return R.FAIL;
                l63 = t15;
                switch ((l63.$c ?? R.caseOf(l63, c9))) {
                  case 0: {
                    t0 = c10;
                    break;
                  }
                  case 1: {
                    l64 = (l63.f0 ?? l63.fields[0]);
                    l65 = l64;
                    l66 = (l65.f0 ?? l65.fields[0]);
                    l67 = (l65.f1 ?? l65.fields[1]);
                    t0 = R.ck((yield [f22$h, [l0, l66, new K11(l56, l2, l67), l3, l4]]));
                    break;
                  }
                }
              } else {
                t0 = c10;
              }
            }
          } else {
            if ((rt5(l0, l7, rt1(l7, (1))) === "^")) {
              l68 = "^";
              const t16 = f26(l68);
              if (t16 === R.FAIL) return R.FAIL;
              l69 = t16;
              l70 = l68;
              let t17;
              if ((l70 === "^")) {
                t17 = (1);
              } else {
                t17 = (0);
              }
              l71 = t17;
              if ((l69 < l3)) {
                t0 = c10;
              } else {
                l72 = f23(l0, l1);
                if ((rt5(l0, l72, rt1(l72, rt4(l68))) === l68)) {
                  l73 = rt1(l72, rt4(l68));
                  l74 = f23(l0, l73);
                  const t18 = (yield [f21$h, [l0, l74, rt11(rt1(l69, (1)), l71), l4]]);
                  if (t18 === R.FAIL) return R.FAIL;
                  l75 = t18;
                  switch ((l75.$c ?? R.caseOf(l75, c9))) {
                    case 0: {
                      t0 = c10;
                      break;
                    }
                    case 1: {
                      l76 = (l75.f0 ?? l75.fields[0]);
                      l77 = l76;
                      l78 = (l77.f0 ?? l77.fields[0]);
                      l79 = (l77.f1 ?? l77.fields[1]);
                      t0 = R.ck((yield [f22$h, [l0, l78, new K11(l68, l2, l79), l3, l4]]));
                      break;
                    }
                  }
                } else {
                  t0 = c10;
                }
              }
            } else {
              t0 = c10;
            }
          }
        }
      }
    }
  }
  l5 = t0;
  switch ((l5.$c ?? R.caseOf(l5, c9))) {
    case 0: {
      return new K10(new K12(l1, l2));
    }
    case 1: {
      l6 = (l5.f0 ?? l5.fields[0]);
      return new K10(l6);
    }
  }
}
function f23(l0, l1) {
  let l2, l3;
  return R.ck(f44(l0, l1, c11));
}
function f24(l0, l1, l2) {
  let l3, l4, l5, l6;
  for (;;) {
    if ((l1 < rt4(l0))) {
      l3 = l2;
      const t0 = R.ap(l3, rt5(l0, l1, rt1(l1, (1))));
      if (t0 === R.FAIL) return R.FAIL;
      if (t0) {
        const t1 = l0;
        const t2 = rt1(l1, (1));
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f25(l0, l1) {
  let l2, l3;
  return (l1 === " ");
}
function f26(l0) {
  let l1, l2;
  l1 = l0;
  if ((l1 === "+")) {
    return (1);
  } else {
    if ((l1 === "-")) {
      return (1);
    } else {
      if ((l1 === "*")) {
        return (2);
      } else {
        if ((l1 === "/")) {
          return (2);
        } else {
          if ((l1 === "%")) {
            return (2);
          } else {
            if ((l1 === "^")) {
              return (4);
            } else {
              return R.FAIL;
            }
          }
        }
      }
    }
  }
}
function f27(l0, l1, l2, l3) {
  if (depth > 1000) return R.drive(f27$h(l0, l1, l2, l3));
  depth++;
  const r = f27$b(l0, l1, l2, l3);
  depth--;
  return r;
}
function f27$b(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33;
  let t0;
  if (false) {
    t0 = c10;
  } else {
    l25 = c10;
    switch ((l25.$c ?? R.caseOf(l25, c9))) {
      case 0: {
        let t1;
        if ((rt5(l0, l1, rt1(l1, (1))) === "-")) {
          t1 = rt1(l1, (1));
        } else {
          t1 = l1;
        }
        l26 = t1;
        const t2 = f45(l0, l26, c12);
        if (t2 === R.FAIL) return R.FAIL;
        l27 = t2;
        if ((l26 < l27)) {
          l28 = rt16(rt5(l0, l1, l27));
          if ((l28 < (0))) {
            t0 = c10;
          } else {
            t0 = new K10(new K12(l27, new K13(l28)));
          }
        } else {
          t0 = c10;
        }
        break;
      }
      case 1: {
        l29 = (l25.f0 ?? l25.fields[0]);
        t0 = new K10(l29);
        break;
      }
    }
  }
  l4 = t0;
  switch ((l4.$c ?? R.caseOf(l4, c9))) {
    case 0: {
      let t3;
      if (false) {
        t3 = c10;
      } else {
        const t4 = f46(l0, l1, c13);
        if (t4 === R.FAIL) return R.FAIL;
        l22 = t4;
        l23 = rt5(l0, l1, l22);
        if ((f10(rt5(l23, (0), (1))) && R.ck(f47(rt17(l23), c14)))) {
          t3 = new K10(new K12(l22, new K14(l23)));
        } else {
          t3 = c10;
        }
      }
      l20 = t3;
      let t5;
      switch ((l20.$c ?? R.caseOf(l20, c9))) {
        case 0: {
          t5 = c10;
          break;
        }
        case 1: {
          l21 = (l20.f0 ?? l20.fields[0]);
          t5 = new K10(l21);
          break;
        }
      }
      l5 = t5;
      switch ((l5.$c ?? R.caseOf(l5, c9))) {
        case 0: {
          let t6;
          if (((3) < l2)) {
            t6 = c10;
          } else {
            if ((rt5(l0, l1, rt1(l1, (1))) === "-")) {
              l13 = rt1(l1, (1));
              const t7 = f21(l0, l13, (3), l3);
              if (t7 === R.FAIL) return R.FAIL;
              l14 = t7;
              switch ((l14.$c ?? R.caseOf(l14, c9))) {
                case 0: {
                  t6 = c10;
                  break;
                }
                case 1: {
                  l15 = (l14.f0 ?? l14.fields[0]);
                  l16 = l15;
                  l17 = (l16.f0 ?? l16.fields[0]);
                  l18 = (l16.f1 ?? l16.fields[1]);
                  t6 = new K10(new K12(l17, new K15(l18)));
                  break;
                }
              }
            } else {
              t6 = c10;
            }
          }
          l6 = t6;
          switch ((l6.$c ?? R.caseOf(l6, c9))) {
            case 0: {
              if ((rt5(l0, l1, rt1(l1, (1))) === "(")) {
                const t8 = f21(l0, rt1(l1, (1)), l3, l3);
                if (t8 === R.FAIL) return R.FAIL;
                l7 = t8;
                switch ((l7.$c ?? R.caseOf(l7, c9))) {
                  case 0: {
                    return c10;
                  }
                  case 1: {
                    l8 = (l7.f0 ?? l7.fields[0]);
                    l9 = l8;
                    l10 = (l9.f0 ?? l9.fields[0]);
                    l11 = (l9.f1 ?? l9.fields[1]);
                    if ((rt5(l0, l10, rt1(l10, (1))) === ")")) {
                      return new K10(new K12(rt1(l10, (1)), l11));
                    } else {
                      return c10;
                    }
                  }
                }
              } else {
                return c10;
              }
            }
            case 1: {
              l12 = (l6.f0 ?? l6.fields[0]);
              return new K10(l12);
            }
          }
        }
        case 1: {
          l19 = (l5.f0 ?? l5.fields[0]);
          return new K10(l19);
        }
      }
    }
    case 1: {
      l24 = (l4.f0 ?? l4.fields[0]);
      return new K10(l24);
    }
  }
}
function* f27$h(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25, l26, l27, l28, l29, l30, l31, l32, l33;
  let t0;
  if (false) {
    t0 = c10;
  } else {
    l25 = c10;
    switch ((l25.$c ?? R.caseOf(l25, c9))) {
      case 0: {
        let t1;
        if ((rt5(l0, l1, rt1(l1, (1))) === "-")) {
          t1 = rt1(l1, (1));
        } else {
          t1 = l1;
        }
        l26 = t1;
        const t2 = f45(l0, l26, c12);
        if (t2 === R.FAIL) return R.FAIL;
        l27 = t2;
        if ((l26 < l27)) {
          l28 = rt16(rt5(l0, l1, l27));
          if ((l28 < (0))) {
            t0 = c10;
          } else {
            t0 = new K10(new K12(l27, new K13(l28)));
          }
        } else {
          t0 = c10;
        }
        break;
      }
      case 1: {
        l29 = (l25.f0 ?? l25.fields[0]);
        t0 = new K10(l29);
        break;
      }
    }
  }
  l4 = t0;
  switch ((l4.$c ?? R.caseOf(l4, c9))) {
    case 0: {
      let t3;
      if (false) {
        t3 = c10;
      } else {
        const t4 = f46(l0, l1, c13);
        if (t4 === R.FAIL) return R.FAIL;
        l22 = t4;
        l23 = rt5(l0, l1, l22);
        if ((f10(rt5(l23, (0), (1))) && R.ck(f47(rt17(l23), c14)))) {
          t3 = new K10(new K12(l22, new K14(l23)));
        } else {
          t3 = c10;
        }
      }
      l20 = t3;
      let t5;
      switch ((l20.$c ?? R.caseOf(l20, c9))) {
        case 0: {
          t5 = c10;
          break;
        }
        case 1: {
          l21 = (l20.f0 ?? l20.fields[0]);
          t5 = new K10(l21);
          break;
        }
      }
      l5 = t5;
      switch ((l5.$c ?? R.caseOf(l5, c9))) {
        case 0: {
          let t6;
          if (((3) < l2)) {
            t6 = c10;
          } else {
            if ((rt5(l0, l1, rt1(l1, (1))) === "-")) {
              l13 = rt1(l1, (1));
              const t7 = (yield [f21$h, [l0, l13, (3), l3]]);
              if (t7 === R.FAIL) return R.FAIL;
              l14 = t7;
              switch ((l14.$c ?? R.caseOf(l14, c9))) {
                case 0: {
                  t6 = c10;
                  break;
                }
                case 1: {
                  l15 = (l14.f0 ?? l14.fields[0]);
                  l16 = l15;
                  l17 = (l16.f0 ?? l16.fields[0]);
                  l18 = (l16.f1 ?? l16.fields[1]);
                  t6 = new K10(new K12(l17, new K15(l18)));
                  break;
                }
              }
            } else {
              t6 = c10;
            }
          }
          l6 = t6;
          switch ((l6.$c ?? R.caseOf(l6, c9))) {
            case 0: {
              if ((rt5(l0, l1, rt1(l1, (1))) === "(")) {
                const t8 = (yield [f21$h, [l0, rt1(l1, (1)), l3, l3]]);
                if (t8 === R.FAIL) return R.FAIL;
                l7 = t8;
                switch ((l7.$c ?? R.caseOf(l7, c9))) {
                  case 0: {
                    return c10;
                  }
                  case 1: {
                    l8 = (l7.f0 ?? l7.fields[0]);
                    l9 = l8;
                    l10 = (l9.f0 ?? l9.fields[0]);
                    l11 = (l9.f1 ?? l9.fields[1]);
                    if ((rt5(l0, l10, rt1(l10, (1))) === ")")) {
                      return new K10(new K12(rt1(l10, (1)), l11));
                    } else {
                      return c10;
                    }
                  }
                }
              } else {
                return c10;
              }
            }
            case 1: {
              l12 = (l6.f0 ?? l6.fields[0]);
              return new K10(l12);
            }
          }
        }
        case 1: {
          l19 = (l5.f0 ?? l5.fields[0]);
          return new K10(l19);
        }
      }
    }
    case 1: {
      l24 = (l4.f0 ?? l4.fields[0]);
      return new K10(l24);
    }
  }
}
function f28(l0, l1, l2) {
  let l3, l4, l5, l6;
  for (;;) {
    if ((l1 < rt4(l0))) {
      l3 = l2;
      const t0 = R.ap(l3, rt5(l0, l1, rt1(l1, (1))));
      if (t0 === R.FAIL) return R.FAIL;
      if (t0) {
        const t1 = l0;
        const t2 = rt1(l1, (1));
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f29(l0, l1) {
  let l2, l3;
  return (f10(l1) || f7(l1));
}
function f30(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c2))) {
      case 0: {
        return true;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l5 = l1;
        const t0 = R.ap(l5, l3);
        if (t0 === R.FAIL) return R.FAIL;
        if (t0) {
          const t1 = l4;
          const t2 = l1;
          l0 = t1;
          l1 = t2;
          continue;
        } else {
          return false;
        }
      }
    }
  }
}
function f31(l0, l1) {
  let l2, l3;
  return (f10(l1) || f7(l1));
}
function f32(l0, l1) {
  let l2, l3;
  return f33(l1);
}
function f33(l0) {
  let l1;
  return ((rt4(l0) === (1)) && ((!rt9(l0, "0")) && (!rt9("9", l0))));
}
function f34(l0) {
  let l1, l2;
  l1 = R.ck(f35(l0, (0)));
  return rt5(l0, l1, f36(l0, l1, rt4(l0)));
}
function f35(l0, l1) {
  let l2, l3;
  for (;;) {
    if ((l1 < rt4(l0))) {
      if ((rt5(l0, l1, rt1(l1, (1))) === " ")) {
        const t0 = l0;
        const t1 = rt1(l1, (1));
        l0 = t0;
        l1 = t1;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f36(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    if ((l1 < l2)) {
      if ((rt5(l0, rt11(l2, (1)), l2) === " ")) {
        const t0 = l0;
        const t1 = l1;
        const t2 = rt11(l2, (1));
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      } else {
        return l2;
      }
    } else {
      return l2;
    }
  }
}
function f37(l0, l1) {
  let l2, l3, l4, l5, l6;
  l2 = l1;
  switch ((l2.$c ?? R.caseOf(l2, c2))) {
    case 0: {
      return R.abort(((("expected “" + l0) + "”, got ") + f13(l1)), 0);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      if (f12(l3, new K5(l0))) {
        return l4;
      } else {
        return R.abort(((("expected “" + l0) + "”, got ") + f13(l1)), 0);
      }
    }
  }
}
function f38(l0) {
  let l1;
  return f39(l0);
}
function f39(l0) {
  if (depth > 1000) return R.drive(f39$h(l0));
  depth++;
  const r = f39$b(l0);
  depth--;
  return r;
}
function f39$b(l0) {
  let l1, l2, l3, l4, l5, l6, l7;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c8))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return rt2(l1);
    }
    case 1: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      return (("(-" + f39((l0.f0 ?? l0.fields[0]))) + ")");
    }
    case 3: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l5 = (l0.f1 ?? l0.fields[1]);
      l6 = (l0.f2 ?? l0.fields[2]);
      return (((((("(" + f39((l0.f1 ?? l0.fields[1]))) + " ") + l4) + " ") + f39((l0.f2 ?? l0.fields[2]))) + ")");
    }
  }
}
function* f39$h(l0) {
  let l1, l2, l3, l4, l5, l6, l7;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c8))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      return rt2(l1);
    }
    case 1: {
      l2 = (l0.f0 ?? l0.fields[0]);
      return l2;
    }
    case 2: {
      l3 = (l0.f0 ?? l0.fields[0]);
      return (("(-" + (yield [f39$h, [(l0.f0 ?? l0.fields[0])]])) + ")");
    }
    case 3: {
      l4 = (l0.f0 ?? l0.fields[0]);
      l5 = (l0.f1 ?? l0.fields[1]);
      l6 = (l0.f2 ?? l0.fields[2]);
      return (((((("(" + (yield [f39$h, [(l0.f1 ?? l0.fields[1])]])) + " ") + l4) + " ") + (yield [f39$h, [(l0.f2 ?? l0.fields[2])]])) + ")");
    }
  }
}
function f40(l0, l1, l2) {
  if (depth > 1000) return R.drive(f40$h(l0, l1, l2));
  depth++;
  const r = f40$b(l0, l1, l2);
  depth--;
  return r;
}
function f40$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c2))) {
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
          l1.f0 = new K4(t3, (l1.f0 ?? l1.fields[0]));
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
function* f40$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c2))) {
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
          l1.f0 = new K4(t3, (l1.f0 ?? l1.fields[0]));
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
function f41(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c2))) {
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
function f42(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l5 = new K6(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l7 = f43(l0, l5, l1);
    if (l7 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f41((l5.f0 ?? l5.fields[0]), c0);
  } else {
    t3 = f41((l5.f0 ?? l5.fields[0]), c0);
  }
  return t3;
}
function f43(l0, l1, l2) {
  if (depth > 1000) return R.drive(f43$h(l0, l1, l2));
  depth++;
  const r = f43$b(l0, l1, l2);
  depth--;
  return r;
}
function f43$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c2))) {
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
          l1.f0 = new K4(t3, (l1.f0 ?? l1.fields[0]));
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
function* f43$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c2))) {
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
          l1.f0 = new K4(t3, (l1.f0 ?? l1.fields[0]));
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
function f44(l0, l1, l2) {
  let l3, l4, l5, l6;
  for (;;) {
    if ((l1 < rt4(l0))) {
      const t0 = f25(l2, rt5(l0, l1, rt1(l1, (1))));
      if (t0 === R.FAIL) return R.FAIL;
      if (t0) {
        const t1 = l0;
        const t2 = rt1(l1, (1));
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f45(l0, l1, l2) {
  let l3, l4, l5, l6;
  for (;;) {
    if ((l1 < rt4(l0))) {
      const t0 = f32(l2, rt5(l0, l1, rt1(l1, (1))));
      if (t0 === R.FAIL) return R.FAIL;
      if (t0) {
        const t1 = l0;
        const t2 = rt1(l1, (1));
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f46(l0, l1, l2) {
  let l3, l4, l5, l6;
  for (;;) {
    if ((l1 < rt4(l0))) {
      const t0 = f29(l2, rt5(l0, l1, rt1(l1, (1))));
      if (t0 === R.FAIL) return R.FAIL;
      if (t0) {
        const t1 = l0;
        const t2 = rt1(l1, (1));
        const t3 = l2;
        l0 = t1;
        l1 = t2;
        l2 = t3;
        continue;
      } else {
        return l1;
      }
    } else {
      return l1;
    }
  }
}
function f47(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c2))) {
      case 0: {
        return true;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        const t0 = f31(l1, l3);
        if (t0 === R.FAIL) return R.FAIL;
        if (t0) {
          const t1 = l4;
          const t2 = l1;
          l0 = t1;
          l1 = t2;
          continue;
        } else {
          return false;
        }
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return R.ck(f0(...xs)); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return R.ck(f2(...xs)); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return f3(...xs); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return f4(...xs); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return f5(...xs); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return f8(...xs); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return f9(...xs); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return f10(...xs); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return R.ck(f11(...xs)); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return f13(...xs); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return R.ck(f14(...xs)); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return R.ck(f15(...xs)); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return R.ck(f17(...xs)); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return R.ck(f18(...xs)); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return R.ck(f19(...xs)); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return R.ck(f20(...xs)); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return R.ck(f21(...xs)); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return R.ck(f22(...xs)); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return f23(...xs); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return R.ck(f24(...xs)); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return R.ck(f25(...xs)); } finally { depth = d; } }, f26: (...xs) => { const d = depth; try { return R.ck(f26(...xs)); } finally { depth = d; } }, f27: (...xs) => { const d = depth; try { return R.ck(f27(...xs)); } finally { depth = d; } }, f28: (...xs) => { const d = depth; try { return R.ck(f28(...xs)); } finally { depth = d; } }, f29: (...xs) => { const d = depth; try { return R.ck(f29(...xs)); } finally { depth = d; } }, f30: (...xs) => { const d = depth; try { return R.ck(f30(...xs)); } finally { depth = d; } }, f31: (...xs) => { const d = depth; try { return R.ck(f31(...xs)); } finally { depth = d; } }, f32: (...xs) => { const d = depth; try { return R.ck(f32(...xs)); } finally { depth = d; } }, f33: (...xs) => { const d = depth; try { return R.ck(f33(...xs)); } finally { depth = d; } }, f34: (...xs) => { const d = depth; try { return f34(...xs); } finally { depth = d; } }, f35: (...xs) => { const d = depth; try { return R.ck(f35(...xs)); } finally { depth = d; } }, f36: (...xs) => { const d = depth; try { return f36(...xs); } finally { depth = d; } }, f37: (...xs) => { const d = depth; try { return R.ck(f37(...xs)); } finally { depth = d; } }, f38: (...xs) => { const d = depth; try { return f38(...xs); } finally { depth = d; } }, f39: (...xs) => { const d = depth; try { return f39(...xs); } finally { depth = d; } }, f40: (...xs) => { const d = depth; try { return R.ck(f40(...xs)); } finally { depth = d; } }, f41: (...xs) => { const d = depth; try { return f41(...xs); } finally { depth = d; } }, f42: (...xs) => { const d = depth; try { return f42(...xs); } finally { depth = d; } }, f43: (...xs) => { const d = depth; try { return R.ck(f43(...xs)); } finally { depth = d; } }, f44: (...xs) => { const d = depth; try { return R.ck(f44(...xs)); } finally { depth = d; } }, f45: (...xs) => { const d = depth; try { return R.ck(f45(...xs)); } finally { depth = d; } }, f46: (...xs) => { const d = depth; try { return R.ck(f46(...xs)); } finally { depth = d; } }, f47: (...xs) => { const d = depth; try { return R.ck(f47(...xs)); } finally { depth = d; } } };