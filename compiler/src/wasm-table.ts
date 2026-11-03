// std's Table and Hash set on WebAssembly (C63j, IN-PLACE.md "Step 2 on
// WebAssembly and C"): the runtime functions for one table type, written
// here because their bodies depend on its key, value and entries types, as
// c.ts `tableC` writes C's. Open addressing with linear probing, keys,
// values and each slot's state (0 empty, 1 full, 2 removed) in three
// arrays of a store. WebAssembly has no counts to tell a table has one
// holder, so every put or remove makes a new newest version and the one
// it was given becomes the change back to it (Baker's shallow binding, as
// std.ts's Table): a map with one holder only ever reads its newest
// version, so each change is constant; reading an older one first undoes
// the changes between (`reroot`). Keys are Ints, Texts, or tuples and
// records of them, hashed, compared and ordered part by part; entries come
// out in compare's order, so the meaning is the sorted Map.
// Prior art: Knuth's linear probing (TAOCP vol. 3, 6.4); Fowler, Noll and
// Vo's FNV hash; Baker, "Shallow binding makes functional arrays fast"
// (1991), as Conchon and Filliâtre's persistent arrays (2007).
//
// Type names in the bodies: $tbl (a version: cur, next, key, had, old),
// $tstore (st, ks, vs, n, used), $tst, $tkeys, $tvals, $tpath (the
// versions walked while rerooting); `k0`… the key's records, `pair` an
// entry, `pkey` an entry's key where it isn't the table's (an empty map
// nothing is put in), in RtFn.types.

import { isRecord, type DType, type LType, type RType, type TType } from "./scalar.ts";
import type { RtFn, VT } from "./wasm-rt.ts";

export const TABLE_RT = /^table\.(\w+)\.t(\d+)(?:\.e(\d+))?$/;

// The parts of a key in order, each an Int or a Text, and the steps from
// the key to it (`struct.get $k0 1`).
// A Float64 key is one nothing fixes (an empty map nothing is put in):
// none is ever made.
function leaves(t: LType, types: Record<string, LType>, steps: string[] = []): ["int" | "text" | "f64", string[]][] {
  if (t === "int" || t === "text" || t === "f64") return [[t, steps]];
  const r = t as RType;
  let name = Object.keys(types).find((n) => types[n] === r);
  if (!name) { name = `k${Object.keys(types).length}`; types[name] = r; }
  return r.fields.flatMap((f, j) => leaves(f.t, types, [...steps, `struct.get $${name} ${j}`]));
}

// A value of type t nothing reads.
function zero(t: LType, types: Record<string, LType>, name: string): string {
  if (t === "f64") return "f64.const 0";
  if (t === "i32") return "i32.const 0";
  if (t === "int") return "i32.const 0\nref.i31";
  if (t === "text") return "ref.null $bytes";
  types[name] = t;
  return `ref.null $${name}`;
}


export function tableRt(name: string, tables: TType[]): RtFn {
  const m = TABLE_RT.exec(name);
  if (!m) throw new Error(`no table function ${name}`);
  const [, op, ti, ei] = m, i = Number(ti), t = tables[i];
  const fn = (x: string) => `table.${x}.t${i}`;
  const types: Record<string, LType> = {};
  const ks = leaves(t.keyT, types), kinds = new Set(ks.map(([k]) => k));
  const base = { name, table: i, types, native: true as const };
  // st, ks, vs of the store in $m.
  const S = (f: number) => `local.get $m\nstruct.get $tstore ${f}`;
  // m.n or m.used += d.
  const bump = (f: number, d: number) => `local.get $m\n${S(f)}\ni32.const ${d}\ni32.add\nstruct.set $tstore ${f}`;
  // Find k (a local) in $m: $j the slot, $f whether it was there.
  const find = (k: string) => `local.get $m\nlocal.get $${k}\ncall $${fn("find")}\nlocal.tee $r\ni32.const 31\ni32.shr_u\nlocal.set $f\nlocal.get $r\ni32.const 2147483647\ni32.and\nlocal.set $j`;
  const slots: [string, VT][] = [["m", "tstore"], ["r", "i32"], ["f", "i32"], ["j", "i32"]];
  switch (op) {
    case "hash": {
      // FNV-1a over the parts: an Int's bits (a huge one, a constant), a
      // Text's bytes; then mixed, since the slot is its low bits.
      const body = ["i32.const -2128831035", "local.set $h"];
      for (const [kind, steps] of ks) {
        body.push("local.get $k", ...steps);
        if (kind === "int") body.push("local.set $li", "local.get $li", "ref.test $huge", "if i32", "i32.const 40503", "else", "local.get $li", "call $int.small", "local.tee $v", "local.get $v", "i64.const 32", "i64.shr_u", "i64.xor", "i32.wrap_i64", "end", "local.get $h", "i32.xor", "i32.const 16777619", "i32.mul", "local.set $h");
        else if (kind === "f64") body.push("i64.reinterpret_f64", "local.tee $v", "local.get $v", "i64.const 32", "i64.shr_u", "i64.xor", "i32.wrap_i64", "local.get $h", "i32.xor", "i32.const 16777619", "i32.mul", "local.set $h");
        else body.push("local.set $lt", "i32.const 0", "local.set $i", "block void", "loop void", "local.get $i", "local.get $lt", "array.len", "i32.ge_u", "br_if 1", "local.get $h", "local.get $lt", "local.get $i", "array.get_u $bytes", "i32.xor", "i32.const 16777619", "i32.mul", "local.set $h", "local.get $i", "i32.const 1", "i32.add", "local.set $i", "br 0", "end", "end");
      }
      body.push("local.get $h", "local.get $h", "i32.const 16", "i32.shr_u", "i32.xor", "i32.const -2048144789", "i32.mul", "local.tee $h", "local.get $h", "i32.const 13", "i32.shr_u", "i32.xor");
      return { ...base, params: [["k", "key"]], result: "i32", locals: [["h", "i32"], ...(kinds.has("int") ? [["li", "int"]] as [string, VT][] : []), ...(kinds.has("int") || kinds.has("f64") ? [["v", "i64"]] as [string, VT][] : []), ...(kinds.has("text") ? [["lt", "text"], ["i", "i32"]] as [string, VT][] : [])], uses: kinds.has("int") ? ["int.small"] : [], body: body.join("\n") };
    }
    case "eq": {
      const body = ks.flatMap(([kind, steps], n) => ["local.get $a", ...steps, "local.get $b", ...steps, kind === "f64" ? "f64.eq" : `call $${kind}.equal`, ...(n ? ["i32.and"] : [])]);
      return { ...base, params: [["a", "key"], ["b", "key"]], result: "i32", locals: [], uses: [...kinds].filter((k) => k !== "f64").map((k) => `${k}.equal`), body: body.join("\n") };
    }
    case "cmp": {
      // compare's order, part by part: −1, 0 or 1.
      const less = (kind: string) => (kind === "f64" ? "f64.lt" : `call $${kind}.less`);
      const body = ks.flatMap(([kind, steps]) => ["local.get $a", ...steps, "local.get $b", ...steps, less(kind), "if void", "i32.const -1", "return", "end", "local.get $b", ...steps, "local.get $a", ...steps, less(kind), "if void", "i32.const 1", "return", "end"]);
      return { ...base, params: [["a", "key"], ["b", "key"]], result: "i32", locals: [], uses: [...kinds].filter((k) => k !== "f64").map((k) => `${k}.less`), body: [...body, "i32.const 0"].join("\n") };
    }
    case "store":
      return { ...base, params: [["cap", "i32"]], result: "tstore", locals: [], uses: [], body: "local.get $cap\narray.new_default $tst\nlocal.get $cap\narray.new_default $tkeys\nlocal.get $cap\narray.new_default $tvals\ni32.const 0\ni32.const 0\nstruct.new $tstore" };
    case "find":
      // The slot holding k, its top bit set, or the free one where it
      // would go (a removed one first).
      return {
        ...base, params: [["m", "tstore"], ["k", "key"]], result: "i32", locals: [["mask", "i32"], ["j", "i32"], ["free", "i32"], ["x", "i32"]], uses: [fn("hash"), fn("eq")],
        body: `${S(0)}
array.len
i32.const 1
i32.sub
local.set $mask
local.get $k
call $${fn("hash")}
local.get $mask
i32.and
local.set $j
i32.const -1
local.set $free
block void
loop void
  ${S(0)}
  local.get $j
  array.get $tst
  local.tee $x
  i32.eqz
  if void
    local.get $free
    i32.const -1
    i32.ne
    if void
      local.get $free
      return
    end
    local.get $j
    return
  end
  local.get $x
  i32.const 2
  i32.eq
  if void
    local.get $free
    i32.const -1
    i32.eq
    if void
      local.get $j
      local.set $free
    end
  else
    ${S(1)}
    local.get $j
    array.get $tkeys
    local.get $k
    call $${fn("eq")}
    if void
      local.get $j
      i32.const -2147483648
      i32.or
      return
    end
  end
  local.get $j
  i32.const 1
  i32.add
  local.get $mask
  i32.and
  local.set $j
  br 0
end
end
unreachable`,
      };
    case "grow":
      // Room for one more, at most 3/4 used: the full slots moved into
      // twice the room (or the same, when removed ones took it).
      return {
        ...base, params: [["m", "tstore"]], result: "void", locals: [["cap", "i32"], ["old", "i32"], ["ost", "tst"], ["oks", "tkeys"], ["ovs", "tvals"], ["j", "i32"], ["at", "i32"]], uses: [fn("find")],
        body: `${S(4)}
i32.const 1
i32.add
i32.const 4
i32.mul
${S(0)}
array.len
local.tee $old
i32.const 3
i32.mul
i32.le_u
if void
  return
end
${S(3)}
i32.const 1
i32.add
i32.const 2
i32.mul
local.get $old
i32.gt_u
if i32
  local.get $old
  i32.const 2
  i32.mul
else
  local.get $old
end
local.set $cap
${S(0)}
local.set $ost
${S(1)}
local.set $oks
${S(2)}
local.set $ovs
local.get $m
local.get $cap
array.new_default $tst
struct.set $tstore 0
local.get $m
local.get $cap
array.new_default $tkeys
struct.set $tstore 1
local.get $m
local.get $cap
array.new_default $tvals
struct.set $tstore 2
local.get $m
${S(3)}
struct.set $tstore 4
block void
loop void
  local.get $j
  local.get $old
  i32.ge_u
  br_if 1
  local.get $ost
  local.get $j
  array.get $tst
  i32.const 1
  i32.eq
  if void
    local.get $m
    local.get $oks
    local.get $j
    array.get $tkeys
    call $${fn("find")}
    i32.const 2147483647
    i32.and
    local.set $at
    ${S(0)}
    local.get $at
    i32.const 1
    array.set $tst
    ${S(1)}
    local.get $at
    local.get $oks
    local.get $j
    array.get $tkeys
    array.set $tkeys
    ${S(2)}
    local.get $at
    local.get $ovs
    local.get $j
    array.get $tvals
    array.set $tvals
  end
  local.get $j
  i32.const 1
  i32.add
  local.set $j
  br 0
end
end`,
      };
    case "reroot":
      // Make t the newest version: undo, from the newest back, each change
      // between it and t, each undone one becoming the change that redoes it.
      return {
        ...base, params: [["t", "table"]], result: "void", locals: [["n", "i32"], ["path", "tpath"], ["np", "tpath"], ["x", "table"], ["y", "table"], ...slots, ["old", "value"], ["z", "value"], ["zk", "key"]], uses: [fn("grow"), fn("find")],
        body: `local.get $t
struct.get $tbl 0
ref.is_null
i32.eqz
if void
  return
end
i32.const 16
array.new_default $tpath
local.set $path
local.get $t
local.set $x
block void
loop void
  local.get $x
  struct.get $tbl 0
  ref.is_null
  i32.eqz
  br_if 1
  local.get $n
  local.get $path
  array.len
  i32.eq
  if void
    local.get $n
    i32.const 2
    i32.mul
    array.new_default $tpath
    local.tee $np
    i32.const 0
    local.get $path
    i32.const 0
    local.get $n
    array.copy $tpath $tpath
    local.get $np
    local.set $path
  end
  local.get $path
  local.get $n
  local.get $x
  array.set $tpath
  local.get $n
  i32.const 1
  i32.add
  local.set $n
  local.get $x
  struct.get $tbl 1
  local.set $x
  br 0
end
end
block void
loop void
  local.get $n
  i32.eqz
  br_if 1
  local.get $n
  i32.const 1
  i32.sub
  local.set $n
  local.get $path
  local.get $n
  array.get $tpath
  local.set $y
  local.get $x
  struct.get $tbl 0
  local.set $m
  local.get $m
  call $${fn("grow")}
  local.get $y
  struct.get $tbl 2
  local.set $zk
  ${find("zk")}
  local.get $z
  local.set $old
  local.get $f
  if void
    ${S(2)}
    local.get $j
    array.get $tvals
    local.set $old
  end
  local.get $y
  struct.get $tbl 3
  if void
    local.get $f
    i32.eqz
    if void
      ${S(0)}
      local.get $j
      array.get $tst
      i32.eqz
      if void
        ${bump(4, 1)}
      end
      ${S(0)}
      local.get $j
      i32.const 1
      array.set $tst
      ${S(1)}
      local.get $j
      local.get $zk
      array.set $tkeys
      ${bump(3, 1)}
    end
    ${S(2)}
    local.get $j
    local.get $y
    struct.get $tbl 4
    array.set $tvals
  else
    local.get $f
    if void
      ${S(0)}
      local.get $j
      i32.const 2
      array.set $tst
      ${S(2)}
      local.get $j
      local.get $z
      array.set $tvals
      ${bump(3, -1)}
    end
  end
  local.get $x
  ref.null $tstore
  struct.set $tbl 0
  local.get $x
  local.get $y
  struct.set $tbl 1
  local.get $x
  local.get $zk
  struct.set $tbl 2
  local.get $x
  local.get $f
  struct.set $tbl 3
  local.get $x
  local.get $old
  struct.set $tbl 4
  local.get $y
  local.get $m
  struct.set $tbl 0
  local.get $y
  ref.null $tbl
  struct.set $tbl 1
  local.get $y
  local.set $x
  br 0
end
end`,
      };
    case "change":
      // A put (set) or remove: a new newest version, c the change back to it.
      return {
        ...base, params: [["c", "table"], ["k", "key"], ["set", "i32"], ["v", "value"]], result: "table", locals: [...slots, ["nv", "table"], ["old", "value"], ["z", "value"], ["zk", "key"]], uses: [fn("reroot"), fn("grow"), fn("find")],
        body: `local.get $c
call $${fn("reroot")}
local.get $c
struct.get $tbl 0
local.set $m
local.get $set
if void
  local.get $m
  call $${fn("grow")}
end
${find("k")}
local.get $set
i32.eqz
local.get $f
i32.eqz
i32.and
if void
  local.get $c
  return
end
local.get $f
if void
  ${S(2)}
  local.get $j
  array.get $tvals
  local.set $old
end
local.get $set
if void
  local.get $f
  i32.eqz
  if void
    ${S(0)}
    local.get $j
    array.get $tst
    i32.eqz
    if void
      ${bump(4, 1)}
    end
    ${S(0)}
    local.get $j
    i32.const 1
    array.set $tst
    ${S(1)}
    local.get $j
    local.get $k
    array.set $tkeys
    ${bump(3, 1)}
  end
  ${S(2)}
  local.get $j
  local.get $v
  array.set $tvals
else
  ${S(0)}
  local.get $j
  i32.const 2
  array.set $tst
  ${S(2)}
  local.get $j
  local.get $z
  array.set $tvals
  ${bump(3, -1)}
end
local.get $m
ref.null $tbl
local.get $zk
i32.const 0
local.get $z
struct.new $tbl
local.set $nv
local.get $c
ref.null $tstore
struct.set $tbl 0
local.get $c
local.get $nv
struct.set $tbl 1
local.get $c
local.get $k
struct.set $tbl 2
local.get $c
local.get $f
struct.set $tbl 3
local.get $c
local.get $old
struct.set $tbl 4
local.get $nv`,
      };
    case "empty":
      return { ...base, params: [], result: "table", locals: [["z", "value"], ["zk", "key"]], uses: [fn("store")], body: `i32.const 8\ncall $${fn("store")}\nref.null $tbl\nlocal.get $zk\ni32.const 0\nlocal.get $z\nstruct.new $tbl` };
    case "put":
      return { ...base, params: [["t", "table"], ["k", "key"], ["v", "value"]], result: "table", locals: [], uses: [fn("change")], body: `local.get $t\nlocal.get $k\ni32.const 1\nlocal.get $v\ncall $${fn("change")}` };
    case "remove":
      return { ...base, params: [["t", "table"], ["k", "key"]], result: "table", locals: [["z", "value"]], uses: [fn("change")], body: `local.get $t\nlocal.get $k\ni32.const 0\nlocal.get $z\ncall $${fn("change")}` };
    case "has":
      return { ...base, params: [["t", "table"], ["k", "key"]], result: "i32", locals: [], uses: [fn("reroot"), fn("find")], body: `local.get $t\ncall $${fn("reroot")}\nlocal.get $t\nstruct.get $tbl 0\nlocal.get $k\ncall $${fn("find")}\ni32.const 31\ni32.shr_u` };
    case "size":
      return { ...base, params: [["t", "table"]], result: "int", locals: [], uses: [fn("reroot"), "int.of"], body: `local.get $t\ncall $${fn("reroot")}\nlocal.get $t\nstruct.get $tbl 0\nstruct.get $tstore 3\ni64.extend_i32_u\ncall $int.of` };
    case "at":
      // No answer for a key it doesn't have.
      return {
        ...base, params: [["t", "table"], ["k", "key"]], result: "value", locals: [...slots, ["z", "value"]], uses: [fn("reroot"), fn("find")], partial: true,
        body: `local.get $t\ncall $${fn("reroot")}\nlocal.get $t\nstruct.get $tbl 0\nlocal.set $m\n${find("k")}\nlocal.get $f\ni32.eqz\nif void\n  local.get $z\n  i32.const 1\n  return\nend\n${S(2)}\nlocal.get $j\narray.get $tvals\ni32.const 0`,
      };
    case "entries": {
      // The full slots sorted by their keys (a merge sort, bottom up, on
      // their places), then the list built from the end: a set's items
      // are its keys, a map's entries pairs.
      const d: DType = t.entries[Number(ei)], tag = d.cases.findIndex((c) => c.fields.length > 0), head = d.cases[tag].fields.findIndex((x) => x.t !== d);
      if (tag !== 1 || head !== 0) throw new Error(`table entries: ${d.name} isn't a list`);
      const item = d.cases[tag].fields[head].t;
      const same = (x: LType) => x === t.keyT || (isRecord(x) && isRecord(t.keyT) && x.key === t.keyT.key);
      const key = (x: LType) => (same(x) ? "local.get $ks\nlocal.get $p\narray.get $tkeys" : zero(x, types, "pkey"));
      let made: string;
      if (t.set) made = key(item);
      else { types.pair = item; made = `${key((item as RType).fields[0].t)}\nlocal.get $m\nstruct.get $tstore 2\nlocal.get $p\narray.get $tvals\nstruct.new $pair`; }
      return {
        ...base, list: d.key, params: [["t", "table"]], result: "list", uses: [fn("reroot"), fn("cmp")],
        locals: [["m", "tstore"], ["a", "tst"], ["b", "tst"], ["c", "tst"], ["ks", "tkeys"], ["n", "i32"], ["j", "i32"], ["w", "i32"], ["lo", "i32"], ["mid", "i32"], ["hi", "i32"], ["p", "i32"], ["q", "i32"], ["o", "i32"], ["acc", "list"]],
        body: `local.get $t
call $${fn("reroot")}
local.get $t
struct.get $tbl 0
local.tee $m
struct.get $tstore 1
local.set $ks
${S(3)}
local.tee $n
array.new_default $tst
local.set $a
local.get $n
array.new_default $tst
local.set $b
block void
loop void
  local.get $j
  ${S(0)}
  array.len
  i32.ge_u
  br_if 1
  ${S(0)}
  local.get $j
  array.get $tst
  i32.const 1
  i32.eq
  if void
    local.get $a
    local.get $o
    local.get $j
    array.set $tst
    local.get $o
    i32.const 1
    i32.add
    local.set $o
  end
  local.get $j
  i32.const 1
  i32.add
  local.set $j
  br 0
end
end
i32.const 1
local.set $w
block void
loop void
  local.get $w
  local.get $n
  i32.ge_u
  br_if 1
  i32.const 0
  local.set $lo
  block void
  loop void
    local.get $lo
    local.get $n
    i32.ge_u
    br_if 1
    local.get $lo
    local.get $w
    i32.add
    local.tee $mid
    local.get $n
    local.get $mid
    local.get $n
    i32.lt_u
    select
    local.set $mid
    local.get $mid
    local.get $w
    i32.add
    local.tee $hi
    local.get $n
    local.get $hi
    local.get $n
    i32.lt_u
    select
    local.set $hi
    local.get $lo
    local.tee $p
    local.set $o
    local.get $mid
    local.set $q
    block void
    loop void
      local.get $o
      local.get $hi
      i32.ge_u
      br_if 1
      local.get $b
      local.get $o
      local.get $q
      local.get $hi
      i32.lt_u
      if i32
        local.get $p
        local.get $mid
        i32.ge_u
        if i32
          i32.const 1
        else
          local.get $ks
          local.get $a
          local.get $q
          array.get $tst
          array.get $tkeys
          local.get $ks
          local.get $a
          local.get $p
          array.get $tst
          array.get $tkeys
          call $${fn("cmp")}
          i32.const 0
          i32.lt_s
        end
      else
        i32.const 0
      end
      if i32
        local.get $a
        local.get $q
        array.get $tst
        local.get $q
        i32.const 1
        i32.add
        local.set $q
      else
        local.get $a
        local.get $p
        array.get $tst
        local.get $p
        i32.const 1
        i32.add
        local.set $p
      end
      array.set $tst
      local.get $o
      i32.const 1
      i32.add
      local.set $o
      br 0
    end
    end
    local.get $hi
    local.set $lo
    br 0
  end
  end
  local.get $a
  local.set $c
  local.get $b
  local.set $a
  local.get $c
  local.set $b
  local.get $w
  i32.const 1
  i32.shl
  local.set $w
  br 0
end
end
i32.const 0
struct.new $list.nil
local.set $acc
block void
loop void
  local.get $n
  i32.eqz
  br_if 1
  local.get $n
  i32.const 1
  i32.sub
  local.set $n
  local.get $a
  local.get $n
  array.get $tst
  local.set $p
  i32.const 1
  ${made}
  local.get $acc
  struct.new $list.cons
  local.set $acc
  br 0
end
end
local.get $acc`,
      };
    }
  }
  throw new Error(`no table function ${name}`);
}
