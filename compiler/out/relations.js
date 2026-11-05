let depth = 0;
class K0 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K0.prototype.tag = "std.tuple2.tuple";
class K1 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K1.prototype.tag = "box:std.tuple2<type.number<>,type.number<>>";
class K2 { constructor() { } get fields() { return []; } }
K2.prototype.tag = "std.list.nil"; K2.prototype.$c = 0;
class K3 { constructor(x0) { this.f0 = x0; } get fields() { return [this.f0]; } }
K3.prototype.tag = "box:std.list<type.number<>>";
class K4 { constructor(x0, x1) { this.f0 = x0; this.f1 = x1; } get fields() { return [this.f0, this.f1]; } }
K4.prototype.tag = "std.list.cons"; K4.prototype.$c = 1;
const c0 = new K0(0, 0);
const c1 = ["std.list.nil","std.list.cons"];
const c2 = new K2();
const rt0 = R.rt("number.show", ["builtin.show",false]);
const rt1 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// mgcebnp7roc7m4l0tscmiltsi1: given 0rk5fs3t58pfj9mn3i8a31kjsd, 1dutrs6g5io90n9fc7od483ujp, solve for 095ehaelth31d6t4po8v3nas3h, ni08ovt7psg5j62ntu8o8rgila
const solve$$plan = $planned({"name":"mgcebnp7roc7m4l0tscmiltsi1","ports":["095ehaelth31d6t4po8v3nas3h","ni08ovt7psg5j62ntu8o8rgila","0rk5fs3t58pfj9mn3i8a31kjsd","1dutrs6g5io90n9fc7od483ujp"],"eqs":[{"lhs":{"k":"call","f":"add","args":[{"k":"var","name":"095ehaelth31d6t4po8v3nas3h"},{"k":"var","name":"ni08ovt7psg5j62ntu8o8rgila"}]},"rhs":{"k":"var","name":"0rk5fs3t58pfj9mn3i8a31kjsd"},"law":false},{"lhs":{"k":"call","f":"sub","args":[{"k":"var","name":"095ehaelth31d6t4po8v3nas3h"},{"k":"var","name":"ni08ovt7psg5j62ntu8o8rgila"}]},"rhs":{"k":"var","name":"1dutrs6g5io90n9fc7od483ujp"},"law":false}],"vars":["095ehaelth31d6t4po8v3nas3h","ni08ovt7psg5j62ntu8o8rgila","0rk5fs3t58pfj9mn3i8a31kjsd","1dutrs6g5io90n9fc7od483ujp"]}, ["0rk5fs3t58pfj9mn3i8a31kjsd","1dutrs6g5io90n9fc7od483ujp"]);
function solve$$direct(v2, v3) {
const out = [];
{
const v0 = ((v2 + v3) / 2); const v1 = ((v2 - v3) / 2);
if ($ok(v0) && $ok(v1)) {
out.push([$clean(v0), $clean(v1)]);
}
}
return out;
}
function solve$(v2, v3) {
return solve$$direct(v2, v3) ?? $solveRuntime(solve$$plan, { "0rk5fs3t58pfj9mn3i8a31kjsd": v2, "1dutrs6g5io90n9fc7od483ujp": v3 }, ["095ehaelth31d6t4po8v3nas3h","ni08ovt7psg5j62ntu8o8rgila"]);
}
function solve$$one(v2, v3) {
{
const v0 = ((v2 + v3) / 2); const v1 = ((v2 - v3) / 2);
if ($ok(v0) && $ok(v1)) {
return [$clean(v0), $clean(v1)];
}
}
return $no;
}
return (...xs) => solve$(xs[0], xs[1]);
}, false, "solving mgcebnp7roc7m4l0tscmiltsi1 this way gives exactly one answer, and it gave none");
const rt2 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// add: given 0, out, solve for 1
const solve$$plan = $planned({"name":"add","ports":["0","1","out"],"eqs":[{"lhs":{"k":"var","name":"out"},"rhs":{"k":"call","f":"add","args":[{"k":"var","name":"0"},{"k":"var","name":"1"}]},"law":false}],"vars":["0","1","out"]}, ["0","out"]);
function solve$$direct(v0, v2) {
const out = [];
{
const v1 = (v2 - v0);
if ($ok(v1)) {
out.push([$clean(v1)]);
}
}
return out;
}
function solve$(v0, v2) {
return solve$$direct(v0, v2) ?? $solveRuntime(solve$$plan, { "0": v0, "out": v2 }, ["1"]);
}
function solve$$one(v0, v2) {
{
const v1 = (v2 - v0);
if ($ok(v1)) {
return $clean(v1);
}
}
return $no;
}
return (...xs) => solve$(xs[0], xs[1]);
}, false, "solving builtin.add this way gives exactly one answer, and it gave none");
const rt3 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// c5p1l9o2i5uqv9fviacg7f3oi8: given q6gesv3t1uqirsn909g16ra93b, hs6e667etss8e73h3d2ncp8d2u, solve for r2d5a98729i0dd55i1nhjiq5u3, rnpp4m4bcs4ndqmuaff9tmcapb (numeric or periodic: the solver runs it)
const solve$$plan = $planned({"name":"c5p1l9o2i5uqv9fviacg7f3oi8","ports":["q6gesv3t1uqirsn909g16ra93b","hs6e667etss8e73h3d2ncp8d2u","r2d5a98729i0dd55i1nhjiq5u3","rnpp4m4bcs4ndqmuaff9tmcapb"],"eqs":[{"lhs":{"k":"var","name":"q6gesv3t1uqirsn909g16ra93b"},"rhs":{"k":"call","f":"mul","args":[{"k":"var","name":"r2d5a98729i0dd55i1nhjiq5u3"},{"k":"call","f":"cos","args":[{"k":"var","name":"rnpp4m4bcs4ndqmuaff9tmcapb"}]}]},"law":false},{"lhs":{"k":"var","name":"hs6e667etss8e73h3d2ncp8d2u"},"rhs":{"k":"call","f":"mul","args":[{"k":"var","name":"r2d5a98729i0dd55i1nhjiq5u3"},{"k":"call","f":"sin","args":[{"k":"var","name":"rnpp4m4bcs4ndqmuaff9tmcapb"}]}]},"law":false},{"lhs":{"k":"call","f":"add","args":[{"k":"call","f":"mul","args":[{"k":"var","name":"q6gesv3t1uqirsn909g16ra93b"},{"k":"var","name":"q6gesv3t1uqirsn909g16ra93b"}]},{"k":"call","f":"mul","args":[{"k":"var","name":"hs6e667etss8e73h3d2ncp8d2u"},{"k":"var","name":"hs6e667etss8e73h3d2ncp8d2u"}]}]},"rhs":{"k":"call","f":"mul","args":[{"k":"var","name":"r2d5a98729i0dd55i1nhjiq5u3"},{"k":"var","name":"r2d5a98729i0dd55i1nhjiq5u3"}]},"law":true}],"vars":["q6gesv3t1uqirsn909g16ra93b","hs6e667etss8e73h3d2ncp8d2u","r2d5a98729i0dd55i1nhjiq5u3","rnpp4m4bcs4ndqmuaff9tmcapb"]}, ["q6gesv3t1uqirsn909g16ra93b","hs6e667etss8e73h3d2ncp8d2u"]);
function solve$(v0, v1) {
return $solveRuntime(solve$$plan, { "q6gesv3t1uqirsn909g16ra93b": v0, "hs6e667etss8e73h3d2ncp8d2u": v1 }, ["r2d5a98729i0dd55i1nhjiq5u3","rnpp4m4bcs4ndqmuaff9tmcapb"]);
}
return (...xs) => solve$(xs[0], xs[1]);
}, true, "solving c5p1l9o2i5uqv9fviacg7f3oi8 this way gives exactly one answer, and it gave none");
const rt4 = R.planned(({ $planned, $solveRuntime, $ok, $clean, $key, $close, $FN }) => {
// f6ppmvr0qioeqiacol3p8cg5oc: given out, solve for 9qipivft4m49m4o7cihrqifit2
const solve$$plan = $planned({"name":"f6ppmvr0qioeqiacol3p8cg5oc","ports":["9qipivft4m49m4o7cihrqifit2","out"],"eqs":[{"lhs":{"k":"var","name":"out"},"rhs":{"k":"call","f":"mul","args":[{"k":"var","name":"9qipivft4m49m4o7cihrqifit2"},{"k":"var","name":"9qipivft4m49m4o7cihrqifit2"}]},"law":false}],"vars":["9qipivft4m49m4o7cihrqifit2","out"]}, ["out"]);
function solve$$direct(v1) {
const out = [], seen = new Set();
{
const v0 = Math.sqrt(v1);
if ($ok(v0)) {
const vals = [$clean(v0), $clean(v1)], key = $key(vals);
if (!seen.has(key)) { seen.add(key); out.push([vals[0]]); }
}
}
{
const v0 = (-Math.sqrt(v1));
if ($ok(v0)) {
const vals = [$clean(v0), $clean(v1)], key = $key(vals);
if (!seen.has(key)) { seen.add(key); out.push([vals[0]]); }
}
}
return out;
}
function solve$(v1) {
return solve$$direct(v1) ?? $solveRuntime(solve$$plan, { "out": v1 }, ["9qipivft4m49m4o7cihrqifit2"]);
}
return (...xs) => solve$(xs[0]);
}, true, "solving f6ppmvr0qioeqiacol3p8cg5oc this way gives exactly one answer, and it gave none");
const w0 = R.worlds[0];
function f0() {
  let l0, l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14, l15, l16;
  const r0 = f1(10, 4);
  l0 = (r0.f0 ?? r0.fields[0]);
  let t0;
  if ((!((l0 - l0) === 0))) {
    t0 = R.stop(22, "995lsgdo4ata006t7r57318efu", "enaqcbhup47mdfq7kgvcp33l6v", "main");
  } else {
    t0 = l0;
  }
  const r1 = f1(10, 4);
  l1 = (r1.f1 ?? r1.fields[1]);
  let t1;
  if ((!((l1 - l1) === 0))) {
    t1 = R.stop(38, "c90up8rbg6kbbp59sc01jgm5in", "enaqcbhup47mdfq7kgvcp33l6v", "main");
  } else {
    t1 = l1;
  }
  l2 = w0(("split(10, 4) = " + ((rt0(t0) + ", ") + rt0(t1))));
  l3 = f2(3, 10);
  let t2;
  if ((!((l3 - l3) === 0))) {
    t2 = R.stop(54, "9lpdjuv8hcbn1bltlte5iltug2", "enaqcbhup47mdfq7kgvcp33l6v", "main");
  } else {
    t2 = l3;
  }
  l4 = w0(("missing addend(3, 10) = " + rt0(t2)));
  l11 = new K1(new K0(0, 0));
  const t5 = depth; let t3 = true;
  t4: try {
    l13 = f3(0, 2, R.closure(f8, [l11]));
    if (l13 === R.FAIL) t3 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t5; t3 = false;
  }
  let t6;
  if (t3) {
    t6 = (l11.f0 ?? l11.fields[0]);
  } else {
    t6 = c0;
  }
  l6 = (t6.f0 ?? t6.fields[0]);
  let t7;
  if ((!((l6 - l6) === 0))) {
    t7 = R.stop(70, "1cgmin86t7s81p06fas79kll52", "enaqcbhup47mdfq7kgvcp33l6v", "main");
  } else {
    t7 = l6;
  }
  l14 = new K1(new K0(0, 0));
  const t10 = depth; let t8 = true;
  t9: try {
    l16 = f3(0, 2, R.closure(f9, [l14]));
    if (l16 === R.FAIL) t8 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t10; t8 = false;
  }
  let t11;
  if (t8) {
    t11 = (l14.f0 ?? l14.fields[0]);
  } else {
    t11 = c0;
  }
  l8 = (t11.f1 ?? t11.fields[1]);
  let t12;
  if ((!((l8 - l8) === 0))) {
    t12 = R.stop(86, "n3vlcibcqapv0uv06phqe1jqfi", "enaqcbhup47mdfq7kgvcp33l6v", "main");
  } else {
    t12 = l8;
  }
  l9 = w0(("to polar(0, 2), canonical = " + ((rt0(t7) + ", ") + rt0(t12))));
  l10 = w0(("square roots(9) = " + f4(f7(9))));
  return w0((("square roots(−1) = [" + f4(f7((-1)))) + "]"));
}
function f1(l0, l1) {
  let l2, l3, l4, l5, l6, l7;
  l2 = rt1(l0, l1, true);
  l3 = (l2)[0];
  l4 = (l2)[1];
  l5 = new K0(l3, l4);
  return new K0((l5.f0 ?? l5.fields[0]), (l5.f1 ?? l5.fields[1]));
}
function f2(l0, l1) {
  let l2, l3, l4, l5;
  l2 = rt2(l0, l1);
  l3 = (l2)[0];
  return l3;
}
function f3(l0, l1, l2) {
  let l3, l4, l5, l6, l7, l8, l9, l10, l11;
  return f10(rt3(l0, l1, true), l2);
}
function f4(l0) {
  let l1;
  return f5(l0, []);
}
function f5(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
      case 0: {
        return f6(l1, "");
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
function f6(l0, l1) {
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
                  t1 = R.stop(102, "@su0m8djlkg5cq4b68i0klesqia:14", "@su0m8djlkg5cq4b68i0klesqia:5");
                } else {
                  t1 = l3;
                }
                t0 = rt0(t1);
                break;
              }
              case 1: {
                let t2;
                if ((!((l3 - l3) === 0))) {
                  t2 = R.stop(118, "@su0m8djlkg5cq4b68i0klesqia:21", "@su0m8djlkg5cq4b68i0klesqia:5");
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
function f7(l0) {
  let l1, l2, l3, l4, l5, l6, l7;
  l4 = new K3(c2);
  const t2 = depth; let t0 = true;
  t1: try {
    l6 = f11(rt4(l0), l4);
    if (l6 === R.FAIL) t0 = false;
  } catch (x) {
    if (x !== R.FAIL) throw x;
    depth = t2; t0 = false;
  }
  let t3;
  if (t0) {
    t3 = f12((l4.f0 ?? l4.fields[0]), c2);
  } else {
    t3 = f12((l4.f0 ?? l4.fields[0]), c2);
  }
  return t3;
}
function f8(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = l1;
  return true;
}
function f9(l0, l1) {
  let l2, l3, l4;
  l2 = l0.caps[0];
  l2.f0 = l1;
  return true;
}
function f10(l0, l1) {
  if (depth > 1000) return R.drive(f10$h(l0, l1));
  depth++;
  const r = f10$b(l0, l1);
  depth--;
  return r;
}
function f10$b(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
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
          l7 = (l5)[1];
          l8 = new K0(l6, l7);
          l9 = l1;
          l4 = R.ap(l9, new K0((l8.f0 ?? l8.fields[0]), (l8.f1 ?? l8.fields[1])));
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
function* f10$h(l0, l1) {
  let l2, l3, l4, l5, l6, l7, l8, l9, l10, l11;
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
          l7 = (l5)[1];
          l8 = new K0(l6, l7);
          l9 = l1;
          l4 = R.ap(l9, new K0((l8.f0 ?? l8.fields[0]), (l8.f1 ?? l8.fields[1])));
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
function f11(l0, l1) {
  if (depth > 1000) return R.drive(f11$h(l0, l1));
  depth++;
  const r = f11$b(l0, l1);
  depth--;
  return r;
}
function f11$b(l0, l1) {
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
          l1.f0 = new K4(l6, (l1.f0 ?? l1.fields[0]));
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
function* f11$h(l0, l1) {
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
          l1.f0 = new K4(l6, (l1.f0 ?? l1.fields[0]));
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
function f12(l0, l1) {
  let l2, l3;
  for (;;) {
    l0 = l0;
    switch ((l0.$c ?? R.caseOf(l0, c1))) {
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
return { f0: (...xs) => { const d = depth; try { return f0(...xs); } finally { depth = d; } }, f1: (...xs) => { const d = depth; try { return f1(...xs); } finally { depth = d; } }, f2: (...xs) => { const d = depth; try { return f2(...xs); } finally { depth = d; } }, f3: (...xs) => { const d = depth; try { return R.ck(f3(...xs)); } finally { depth = d; } }, f4: (...xs) => { const d = depth; try { return f4(...xs); } finally { depth = d; } }, f5: (...xs) => { const d = depth; try { return f5(...xs); } finally { depth = d; } }, f6: (...xs) => { const d = depth; try { return f6(...xs); } finally { depth = d; } }, f7: (...xs) => { const d = depth; try { return f7(...xs); } finally { depth = d; } }, f8: (...xs) => { const d = depth; try { return R.ck(f8(...xs)); } finally { depth = d; } }, f9: (...xs) => { const d = depth; try { return R.ck(f9(...xs)); } finally { depth = d; } }, f10: (...xs) => { const d = depth; try { return R.ck(f10(...xs)); } finally { depth = d; } }, f11: (...xs) => { const d = depth; try { return R.ck(f11(...xs)); } finally { depth = d; } }, f12: (...xs) => { const d = depth; try { return f12(...xs); } finally { depth = d; } } };