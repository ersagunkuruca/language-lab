let depth = 0;
class K0 { constructor() { } get fields() { return []; } }
K0.prototype.tag = "std.list.nil"; K0.prototype.$c = 0;
class K1 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K1.prototype.tag = "std.list.cons"; K1.prototype.$c = 1;
class K2 { constructor() { } get fields() { return []; } }
K2.prototype.tag = "std.unit.unit";
class K3 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K3.prototype.tag = "box:std.list<5d87grkf2iv9a8luk2dldetnnh<>>";
class K4 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K4.prototype.tag = "n9sj0k5cqanfsbha7enj6li6ai"; K4.prototype.$c = 0;
class K5 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K5.prototype.tag = "8n22ghbsvkrbffe5oea0ph2dks";
class K6 { constructor(x0, x1, x2) { this.f0 = x0; this.f1 = x1; this.f2 = x2; } get fields() { return [this.f0, this.f1, this.f2]; } }
K6.prototype.tag = "hqti16ropeqavohrp46meql4a4"; K6.prototype.$c = 1;
class K7 { constructor() { } get fields() { return []; } }
K7.prototype.tag = "std.list<type.number<>>.frames.done"; K7.prototype.$c = 0;
class K8 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K8.prototype.tag = "std.list<type.number<>>.frames.frame"; K8.prototype.$c = 1;
class K9 { constructor() { } get fields() { return []; } }
K9.prototype.tag = "po7knn9d8k1ql4tu1t24phf6gi"; K9.prototype.$c = 0;
class K10 { constructor() { } get fields() { return []; } }
K10.prototype.tag = "t3s371rgvfks4e6tgel7toqm44"; K10.prototype.$c = 1;
class K11 { constructor() { } get fields() { return []; } }
K11.prototype.tag = "9b16jnlgmuno3soj08126738d0"; K11.prototype.$c = 2;
class K12 { constructor() { } get fields() { return []; } }
K12.prototype.tag = "un57f8inem1emu6nmkbiod0ktb"; K12.prototype.$c = 3;
class K13 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K13.prototype.tag = "9vmk3mm6sqm967g2ig29jj7ed4";
const c0 = new K0();
const c1 = new K1(50, c0);
const c2 = new K1(25, c1);
const c3 = new K1(10, c2);
const c4 = new K1(7, c3);
const c5 = new K1(3, c4);
const c6 = new K1(1, c5);
const c7 = R.closure(f17, []);
const c8 = ["std.list.nil","std.list.cons"];
const c9 = new K2();
const c10 = ["po7knn9d8k1ql4tu1t24phf6gi","t3s371rgvfks4e6tgel7toqm44","9b16jnlgmuno3soj08126738d0","un57f8inem1emu6nmkbiod0ktb"];
const c11 = new K1(false, c0);
const c12 = new K1(true, c11);
const c13 = new K7();
const c14 = ["std.list<type.number<>>.frames.done","std.list<type.number<>>.frames.frame"];
const c15 = ["n9sj0k5cqanfsbha7enj6li6ai","hqti16ropeqavohrp46meql4a4"];
const c16 = new K9();
const c17 = new K10();
const c18 = new K11();
const c19 = new K12();
const c20 = new K1(c19, c0);
const c21 = new K1(c18, c20);
const c22 = new K1(c17, c21);
const c23 = new K1(c16, c22);
const rt0 = R.rt("number.show", ["builtin.show",false]);
const w0 = R.worlds[0];
function f0() {
  let l0;
  l0 = c6;
  return f35(f2(l0, 765), c7);
}
function f1(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c8))) {
      case 0: {
        return c9;
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
function f2(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l8 = new K3(c0);
  const t2 = depth; let t0 = true;
  t1: try {
    l11 = f9(l0, R.closure(f22, [l8, l1]));
    if (l11 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f23((l8.f0 ?? l8.fields[0]), c0);
  } else {
    t3 = f23((l8.f0 ?? l8.fields[0]), c0);
  }
  return t3;
}
function f3(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18, l19, l20, l21, l22, l23, l24, l25;
  l2 = l0;
  switch ((l2.$c ?? R.caseOf(l2, c8))) {
    case 0: {
      return R.FAIL;
      l17 = l1;
      return R.ap(l17, undefined);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      l5 = l4;
      switch ((l5.$c ?? R.caseOf(l5, c8))) {
        case 0: {
          l18 = l1;
          return R.ap(l18, new K5(new K4(l3), l3));
        }
        case 1: {
          l6 = (l5.f0 ?? l5.fields[0]);
          l7 = (l5.f1 ?? l5.fields[1]);
          return f8(l0, R.closure(f27, [l1]));
        }
      }
    }
  }
}
function f4(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9;
  const t0 = f5(l0, l2, l4);
  if (t0 === R.FAIL) return R.FAIL;
  if (t0) {
    return new K5(new K6(l0, l1, l3), R.ck(f7(l0, l2, l4)));
  } else {
    return R.FAIL;
  }
}
function f5(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11;
  l3 = l0;
  switch ((l3.$c ?? R.caseOf(l3, c10))) {
    case 0: {
      return f6(l2, l1);
    }
    case 1: {
      let t0;
      if ((!((l2 - l2) === 0))) {
        t0 = R.stop(54, "38daqq62hpo5opbrhtbkau04ao", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t0 = l2;
      }
      let t1;
      if ((!((l1 - l1) === 0))) {
        t1 = R.stop(54, "38daqq62hpo5opbrhtbkau04ao", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t1 = l1;
      }
      return (t0 < t1);
    }
    case 2: {
      let t2;
      if ((!((l1 - l1) === 0))) {
        t2 = R.stop(70, "dj4adnboq559rkqtfc3tmsj2cd", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t2 = l1;
      }
      l4 = t2;
      let t3;
      if ((!((l2 - l2) === 0))) {
        t3 = R.stop(86, "9vafbpfnbnft1l3mcolhc9q6te", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t3 = l2;
      }
      l5 = t3;
      return ((!(l4 === 1)) && ((!(l5 === 1)) && f6(l2, l1)));
    }
    case 3: {
      let t4;
      if ((!((l2 - l2) === 0))) {
        t4 = R.stop(102, "h0h2hramo79jai1v29ii7c3cqh", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t4 = l2;
      }
      l6 = t4;
      let t5;
      if ((l2 === 0)) {
        return R.FAIL;
        t5 = undefined;
      } else {
        let t6;
        if ((!((l2 - l2) === 0))) {
          t6 = R.stop(118, "7jh7lcvk54mpg8d8hovd05l7vc", "8rmqgkplujolfkh0btsou4ba20", "valid");
        } else {
          t6 = l2;
        }
        t5 = R.mod(l1, t6);
      }
      l7 = t5;
      let t7;
      if ((!((l7 - l7) === 0))) {
        t7 = R.stop(134, "ojbt1ivih4j5kitp2k87i4upet", "8rmqgkplujolfkh0btsou4ba20", "valid");
      } else {
        t7 = l7;
      }
      l8 = t7;
      return ((!(l6 === 1)) && (l8 === 0));
    }
  }
}
function f6(l0, l1) {
  let l2, l3;
  let t0;
  if ((!((l0 - l0) === 0))) {
    t0 = R.stop(38, "@i6fegek8k300348mgag5spc82m:6", "@i6fegek8k300348mgag5spc82m", "at least");
  } else {
    t0 = l0;
  }
  let t1;
  if ((!((l1 - l1) === 0))) {
    t1 = R.stop(38, "@i6fegek8k300348mgag5spc82m:6", "@i6fegek8k300348mgag5spc82m", "at least");
  } else {
    t1 = l1;
  }
  return (!(t0 < t1));
}
function f7(l0, l1, l2) {
  let l3, l4, l5, l6;
  l3 = l0;
  switch ((l3.$c ?? R.caseOf(l3, c10))) {
    case 0: {
      return (l1 + l2);
    }
    case 1: {
      return (l1 - l2);
    }
    case 2: {
      return (l1 * l2);
    }
    case 3: {
      if ((l2 === 0)) {
        return R.FAIL;
      } else {
        let t0;
        if ((!((l2 - l2) === 0))) {
          t0 = R.stop(150, "6kf3pek37p4ri9ppi26qhbhkk0", "3ehdclkl9km555l20ld47u0a04", "combine");
        } else {
          t0 = l2;
        }
        return (l1 / t0);
      }
    }
  }
}
function f8(l0, l1) {
  if (depth > 1000) return R.drive(f8$h(l0, l1));
  depth++;
  const r = f8$b(l0, l1);
  depth--;
  return r;
}
function f8$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18;
  l2 = l0;
  switch ((l2.$c ?? R.caseOf(l2, c8))) {
    case 0: {
      return R.FAIL;
      l11 = l1;
      return R.ap(l11, undefined);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      l5 = l4;
      switch ((l5.$c ?? R.caseOf(l5, c8))) {
        case 0: {
          return R.FAIL;
          l12 = l1;
          return R.ap(l12, undefined);
        }
        case 1: {
          l6 = (l5.f0 ?? l5.fields[0]);
          l7 = (l5.f1 ?? l5.fields[1]);
          return f29(c12, l1, l3, l4);
        }
      }
    }
  }
}
function* f8$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16, l17, l18;
  l2 = l0;
  switch ((l2.$c ?? R.caseOf(l2, c8))) {
    case 0: {
      return R.FAIL;
      l11 = l1;
      return R.ap(l11, undefined);
    }
    case 1: {
      l3 = (l2.f0 ?? l2.fields[0]);
      l4 = (l2.f1 ?? l2.fields[1]);
      l5 = l4;
      switch ((l5.$c ?? R.caseOf(l5, c8))) {
        case 0: {
          return R.FAIL;
          l12 = l1;
          return R.ap(l12, undefined);
        }
        case 1: {
          l6 = (l5.f0 ?? l5.fields[0]);
          l7 = (l5.f1 ?? l5.fields[1]);
          return (yield [f29$h, [c12, l1, l3, l4]]);
        }
      }
    }
  }
}
function f9(l0, l1) {
  let l2, l3, l4;
  return f14(l0, R.closure(f30, [l1]));
}
function f10(l0, l1) {
  let l2, l3;
  return f11(l0, c13, l1);
}
function f11(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return f12(l1, c0, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K8(l0, l1);
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
  let l3, l4, l5, l6, l7, l8, l9, l10, l11;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c14))) {
    case 0: {
      l6 = l2;
      return R.ap(l6, l1);
    }
    case 1: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l7 = (l0.f1 ?? l0.fields[1]);
      l3 = l3;
      switch ((l3.$c ?? R.caseOf(l3, c8))) {
        case 1: {
          l4 = (l3.f0 ?? l3.fields[0]);
          l5 = (l3.f1 ?? l3.fields[1]);
          return f13(l4, l1, R.closure(f31, [l7, l2]));
        }
      }
    }
  }
}
function f13(l0, l1, l2) {
  if (depth > 1000) return R.drive(f13$h(l0, l1, l2));
  depth++;
  const r = f13$b(l0, l1, l2);
  depth--;
  return r;
}
function f13$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l3 = l1;
  switch ((l3.$c ?? R.caseOf(l3, c8))) {
    case 0: {
      l6 = l2;
      return R.ap(l6, new K1(l0, c0));
    }
    case 1: {
      l4 = (l3.f0 ?? l3.fields[0]);
      l5 = (l3.f1 ?? l3.fields[1]);
      return f33(c12, l2, l0, l1, l5, l4);
    }
  }
}
function* f13$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13;
  l3 = l1;
  switch ((l3.$c ?? R.caseOf(l3, c8))) {
    case 0: {
      l6 = l2;
      return R.ap(l6, new K1(l0, c0));
    }
    case 1: {
      l4 = (l3.f0 ?? l3.fields[0]);
      l5 = (l3.f1 ?? l3.fields[1]);
      return (yield [f33$h, [c12, l2, l0, l1, l5, l4]]);
    }
  }
}
function f14(l0, l1) {
  let l2, l3;
  return f15(l0, c13, l1);
}
function f15(l0, l1, l2) {
  let l3, l4, l5;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return f16(l1, c0, l2);
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K8(l0, l1);
        const t2 = l2;
        l0 = t0;
        l1 = t1;
        l2 = t2;
        continue;
      }
    }
  }
}
function f16(l0, l1, l2) {
  if (depth > 1000) return R.drive(f16$h(l0, l1, l2));
  depth++;
  const r = f16$b(l0, l1, l2);
  depth--;
  return r;
}
function f16$b(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c14))) {
    case 0: {
      l6 = l2;
      return R.ap(l6, l1);
    }
    case 1: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l7 = (l0.f1 ?? l0.fields[1]);
      l3 = l3;
      switch ((l3.$c ?? R.caseOf(l3, c8))) {
        case 1: {
          l4 = (l3.f0 ?? l3.fields[0]);
          l5 = (l3.f1 ?? l3.fields[1]);
          return f34(c12, l7, l4, l1, l2);
        }
      }
    }
  }
}
function* f16$h(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c14))) {
    case 0: {
      l6 = l2;
      return R.ap(l6, l1);
    }
    case 1: {
      l3 = (l0.f0 ?? l0.fields[0]);
      l7 = (l0.f1 ?? l0.fields[1]);
      l3 = l3;
      switch ((l3.$c ?? R.caseOf(l3, c8))) {
        case 1: {
          l4 = (l3.f0 ?? l3.fields[0]);
          l5 = (l3.f1 ?? l3.fields[1]);
          return (yield [f34$h, [c12, l7, l4, l1, l2]]);
        }
      }
    }
  }
}
function f17(l0, l1) {
  let l2, l3;
  return w0(f18(l1));
}
function f18(l0) {
  let l1;
  return f19(l0);
}
function f19(l0) {
  if (depth > 1000) return R.drive(f19$h(l0));
  depth++;
  const r = f19$b(l0);
  depth--;
  return r;
}
function f19$b(l0) {
  let l1, l2, l3, l4, l5;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c15))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      let t0;
      if ((!((l1 - l1) === 0))) {
        t0 = R.stop(166, "nqh2dembh2tvte889lt5r5g31e", "175teh2melp2gigif65lt4amte");
      } else {
        t0 = l1;
      }
      return rt0(t0);
    }
    case 1: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      l4 = (l0.f2 ?? l0.fields[2]);
      return ("(" + (f19((l0.f1 ?? l0.fields[1])) + (f20(l2) + (f19((l0.f2 ?? l0.fields[2])) + ")"))));
    }
  }
}
function* f19$h(l0) {
  let l1, l2, l3, l4, l5;
  l0 = l0;
  switch ((l0.$c ?? R.caseOf(l0, c15))) {
    case 0: {
      l1 = (l0.f0 ?? l0.fields[0]);
      let t0;
      if ((!((l1 - l1) === 0))) {
        t0 = R.stop(166, "nqh2dembh2tvte889lt5r5g31e", "175teh2melp2gigif65lt4amte");
      } else {
        t0 = l1;
      }
      return rt0(t0);
    }
    case 1: {
      l2 = (l0.f0 ?? l0.fields[0]);
      l3 = (l0.f1 ?? l0.fields[1]);
      l4 = (l0.f2 ?? l0.fields[2]);
      return ("(" + ((yield [f19$h, [(l0.f1 ?? l0.fields[1])]]) + (f20(l2) + ((yield [f19$h, [(l0.f2 ?? l0.fields[2])]]) + ")"))));
    }
  }
}
function f20(l0) {
  let l1, l2;
  l1 = l0;
  switch ((l1.$c ?? R.caseOf(l1, c10))) {
    case 0: {
      return " + ";
    }
    case 1: {
      return " − ";
    }
    case 2: {
      return " × ";
    }
    case 3: {
      return " ÷ ";
    }
  }
}
function f21(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l1;
  l8 = (l4.f0 ?? l4.fields[0]);
  l5 = (l4.f1 ?? l4.fields[1]);
  let t0;
  if ((!((l5 - l5) === 0))) {
    t0 = R.stop(22, "cv0ar9ma7qchum5p22m6120pbp", "mrstvdkf2opp0ua9uq4v6qi5qk", "solutions");
  } else {
    t0 = l5;
  }
  l6 = t0;
  let t1;
  if ((!((l3 - l3) === 0))) {
    t1 = R.stop(22, "cv0ar9ma7qchum5p22m6120pbp", "mrstvdkf2opp0ua9uq4v6qi5qk", "solutions");
  } else {
    t1 = l3;
  }
  l7 = t1;
  let t2;
  if ((l6 === l7)) {
    t2 = l8;
  } else {
    return R.FAIL;
    t2 = undefined;
  }
  l2.f0 = new K1(t2, (l2.f0 ?? l2.fields[0]));
  return R.FAIL;
}
function f22(l0, l1) {
  let l2, l3, l4, l5;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  return f3(l1, R.closure(f21, [l2, l3]));
}
function f23(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return l1;
      }
      case 1: {
        const t0 = (l0.f1 ?? l0.fields[1]);
        const t1 = new K1((l0.f0 ?? l0.fields[0]), l1);
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
function f24(l0, l1, l2, l3, l4, l5) {
  if (depth > 1000) return R.drive(f24$h(l0, l1, l2, l3, l4, l5));
  depth++;
  const r = f24$b(l0, l1, l2, l3, l4, l5);
  depth--;
  return r;
}
function f24$b(l0, l1, l2, l3, l4, l5) {
  let l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l6 = (l0.f0 ?? l0.fields[0]);
        l7 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          const t3 = f4(l6, l2, l3, l4, l5);
          if (t3 === R.FAIL) { t0 = false; break t1; }
          l9 = l1;
          l8 = R.ap(l9, t3);
          if (l8 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l8;
        } else {
          const t4 = l7;
          const t5 = l1;
          const t6 = l2;
          const t7 = l3;
          const t8 = l4;
          const t9 = l5;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          l3 = t7;
          l4 = t8;
          l5 = t9;
          continue;
        }
      }
    }
  }
}
function* f24$h(l0, l1, l2, l3, l4, l5) {
  let l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l6 = (l0.f0 ?? l0.fields[0]);
        l7 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          const t3 = f4(l6, l2, l3, l4, l5);
          if (t3 === R.FAIL) { t0 = false; break t1; }
          l9 = l1;
          l8 = R.ap(l9, t3);
          if (l8 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l8;
        } else {
          const t4 = l7;
          const t5 = l1;
          const t6 = l2;
          const t7 = l3;
          const t8 = l4;
          const t9 = l5;
          l0 = t4;
          l1 = t5;
          l2 = t6;
          l3 = t7;
          l4 = t8;
          l5 = t9;
          continue;
        }
      }
    }
  }
}
function f25(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l0.caps[2];
  l5 = l1;
  l6 = (l5.f0 ?? l5.fields[0]);
  l7 = (l5.f1 ?? l5.fields[1]);
  return f24(c23, l2, l3, l4, l6, l7);
}
function f26(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l1;
  l5 = (l4.f0 ?? l4.fields[0]);
  l6 = (l4.f1 ?? l4.fields[1]);
  return f3(l2, R.closure(f25, [l3, l5, l6]));
}
function f27(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  l2 = l0.caps[0];
  l3 = l1;
  l4 = (l3.f0 ?? l3.fields[0]);
  l5 = (l3.f1 ?? l3.fields[1]);
  return f3(l4, R.closure(f26, [l5, l2]));
}
function f28(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l1;
  l5 = (l4.f0 ?? l4.fields[0]);
  l6 = (l4.f1 ?? l4.fields[1]);
  l7 = l2;
  return R.ap(l7, new K13(new K1(l3, l5), l6));
}
function f29(l0, l1, l2, l3) {
  if (depth > 1000) return R.drive(f29$h(l0, l1, l2, l3));
  depth++;
  const r = f29$b(l0, l1, l2, l3);
  depth--;
  return r;
}
function f29$b(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l4 = (l0.f0 ?? l0.fields[0]);
        l5 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          if (l4) {
            l7 = l1;
            l6 = R.ap(l7, new K13(new K1(l2, c0), l3));
          } else {
            l6 = f8(l3, R.closure(f28, [l1, l2]));
          }
          if (l6 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l6;
        } else {
          const t3 = l5;
          const t4 = l1;
          const t5 = l2;
          const t6 = l3;
          l0 = t3;
          l1 = t4;
          l2 = t5;
          l3 = t6;
          continue;
        }
      }
    }
  }
}
function* f29$h(l0, l1, l2, l3) {
  let l4, l5, l6, l7, l8, l9, l10, l11;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l4 = (l0.f0 ?? l0.fields[0]);
        l5 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          if (l4) {
            l7 = l1;
            l6 = R.ap(l7, new K13(new K1(l2, c0), l3));
          } else {
            l6 = (yield [f8$h, [l3, R.closure(f28, [l1, l2])]]);
          }
          if (l6 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l6;
        } else {
          const t3 = l5;
          const t4 = l1;
          const t5 = l2;
          const t6 = l3;
          l0 = t3;
          l1 = t4;
          l2 = t5;
          l3 = t6;
          continue;
        }
      }
    }
  }
}
function f30(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  return f10(l1, l2);
}
function f31(l0, l1) {
  let l2, l3, l4, l5;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  return f12(l2, l1, l3);
}
function f32(l0, l1) {
  let l2, l3, l4, l5, l6;
  l2 = l0.caps[0];
  l3 = l0.caps[1];
  l4 = l2;
  return R.ap(l4, new K1(l3, l1));
}
function f33(l0, l1, l2, l3, l4, l5) {
  if (depth > 1000) return R.drive(f33$h(l0, l1, l2, l3, l4, l5));
  depth++;
  const r = f33$b(l0, l1, l2, l3, l4, l5);
  depth--;
  return r;
}
function f33$b(l0, l1, l2, l3, l4, l5) {
  let l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l6 = (l0.f0 ?? l0.fields[0]);
        l7 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          if (l6) {
            l9 = l1;
            l8 = R.ap(l9, new K1(l2, l3));
          } else {
            l8 = f13(l2, l4, R.closure(f32, [l1, l5]));
          }
          if (l8 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l8;
        } else {
          const t3 = l7;
          const t4 = l1;
          const t5 = l2;
          const t6 = l3;
          const t7 = l4;
          const t8 = l5;
          l0 = t3;
          l1 = t4;
          l2 = t5;
          l3 = t6;
          l4 = t7;
          l5 = t8;
          continue;
        }
      }
    }
  }
}
function* f33$h(l0, l1, l2, l3, l4, l5) {
  let l6, l7, l8, l9, l10, l11, l12, l13, l14, l15;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l6 = (l0.f0 ?? l0.fields[0]);
        l7 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          if (l6) {
            l9 = l1;
            l8 = R.ap(l9, new K1(l2, l3));
          } else {
            l8 = (yield [f13$h, [l2, l4, R.closure(f32, [l1, l5])]]);
          }
          if (l8 === R.FAIL) t0 = false;
        } catch (x) {
          if (x !== R.FAIL) throw x;
          depth = t2; t0 = false;
        }
        if (t0) {
          return l8;
        } else {
          const t3 = l7;
          const t4 = l1;
          const t5 = l2;
          const t6 = l3;
          const t7 = l4;
          const t8 = l5;
          l0 = t3;
          l1 = t4;
          l2 = t5;
          l3 = t6;
          l4 = t7;
          l5 = t8;
          continue;
        }
      }
    }
  }
}
function f34(l0, l1, l2, l3, l4) {
  if (depth > 1000) return R.drive(f34$h(l0, l1, l2, l3, l4));
  depth++;
  const r = f34$b(l0, l1, l2, l3, l4);
  depth--;
  return r;
}
function f34$b(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l5 = (l0.f0 ?? l0.fields[0]);
        l6 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          let t3;
          if (l5) {
            t3 = new K1(l2, l3);
          } else {
            t3 = l3;
          }
          l7 = f16(l1, t3, l4);
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
function* f34$h(l0, l1, l2, l3, l4) {
  let l5, l6, l7, l8, l9, l10, l11, l12;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c8))) {
      case 0: {
        return R.FAIL;
      }
      case 1: {
        l5 = (l0.f0 ?? l0.fields[0]);
        l6 = (l0.f1 ?? l0.fields[1]);
        const t2 = depth; let t0 = true;
        t1: try {
          let t3;
          if (l5) {
            t3 = new K1(l2, l3);
          } else {
            t3 = l3;
          }
          l7 = (yield [f16$h, [l1, t3, l4]]);
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
function f35(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8;
  for (;;) {
    l2 = l0;
    switch ((l2.$c ?? R.caseOf(l2, c8))) {
      case 0: {
        return c9;
      }
      case 1: {
        l3 = (l2.f0 ?? l2.fields[0]);
        l4 = (l2.f1 ?? l2.fields[1]);
        l6 = R.ck(f17(l1, l3));
        const t0 = l4;
        const t1 = l1;
        l0 = t0;
        l1 = t1;
        continue;
      }
    }
  }
}
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return R.ck(f3(...xs)); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return R.ck(f4(...xs)); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return R.ck(f5(...xs)); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return R.ck(f7(...xs)); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return R.ck(f8(...xs)); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return R.ck(f9(...xs)); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return R.ck(f10(...xs)); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return R.ck(f11(...xs)); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return R.ck(f12(...xs)); } finally { depth = d; } }, f13: (...xs) => { const d = depth; try { return R.ck(f13(...xs)); } finally { depth = d; } }, f14: (...xs) => { const d = depth; try { return R.ck(f14(...xs)); } finally { depth = d; } }, f15: (...xs) => { const d = depth; try { return R.ck(f15(...xs)); } finally { depth = d; } }, f16: (...xs) => { const d = depth; try { return R.ck(f16(...xs)); } finally { depth = d; } }, f17: (...xs) => { const d = depth; try { return R.ck(f17(...xs)); } finally { depth = d; } }, f18: (...xs) => { const d = depth; try { return f18(...xs); } finally { depth = d; } }, f19: (...xs) => { const d = depth; try { return f19(...xs); } finally { depth = d; } }, f20: (...xs) => { const d = depth; try { return f20(...xs); } finally { depth = d; } }, f21: (...xs) => { const d = depth; try { return R.ck(f21(...xs)); } finally { depth = d; } }, f22: (...xs) => { const d = depth; try { return R.ck(f22(...xs)); } finally { depth = d; } }, f23: (...xs) => { const d = depth; try { return f23(...xs); } finally { depth = d; } }, f24: (...xs) => { const d = depth; try { return R.ck(f24(...xs)); } finally { depth = d; } }, f25: (...xs) => { const d = depth; try { return R.ck(f25(...xs)); } finally { depth = d; } }, f26: (...xs) => { const d = depth; try { return R.ck(f26(...xs)); } finally { depth = d; } }, f27: (...xs) => { const d = depth; try { return R.ck(f27(...xs)); } finally { depth = d; } }, f28: (...xs) => { const d = depth; try { return R.ck(f28(...xs)); } finally { depth = d; } }, f29: (...xs) => { const d = depth; try { return R.ck(f29(...xs)); } finally { depth = d; } }, f30: (...xs) => { const d = depth; try { return R.ck(f30(...xs)); } finally { depth = d; } }, f31: (...xs) => { const d = depth; try { return R.ck(f31(...xs)); } finally { depth = d; } }, f32: (...xs) => { const d = depth; try { return R.ck(f32(...xs)); } finally { depth = d; } }, f33: (...xs) => { const d = depth; try { return R.ck(f33(...xs)); } finally { depth = d; } }, f34: (...xs) => { const d = depth; try { return R.ck(f34(...xs)); } finally { depth = d; } }, f35: (...xs) => { const d = depth; try { return f35(...xs); } finally { depth = d; } } };