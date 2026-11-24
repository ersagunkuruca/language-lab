#!/usr/bin/env python3
# C327c2, measured by hand (ALLOCATIONS-2026-11-24.md): flock's `merge
# sorted` on WebAssembly with its two views held as locals (buffer, start,
# length) instead of a $arr struct a step. Input: `ters wasi
# compiler/gaps/flock` disassembled by binaryen's wasm-dis to flock.wat,
# and the merge's function cut out to g223.wat (function and type numbers
# are binaryen's for that build); output flock-v.wat, for wasm-as.
src=open('flock.wat').read()
f=open('g223.wat').read()
g=f
def r(a,b,n=None):
    global g
    c=g.count(a)
    assert c>0 and (n is None or c==n),(c,a)
    g=g.replace(a,b)
# locals
r("  (local $3 eqref)\n","  (local $b0 (ref null $135))\n  (local $s0 i32)\n  (local $n0 i32)\n  (local $b1 (ref null $135))\n  (local $s1 i32)\n  (local $n1 i32)\n  (local $3 eqref)\n",1)
unpack="".join(f"  (local.set $b{k} (struct.get $136 0 (local.get ${k})))\n  (local.set $s{k} (struct.get $136 1 (local.get ${k})))\n  (local.set $n{k} (struct.get $136 2 (local.get ${k})))\n" for k in (0,1))
r("  (loop $label (result (ref null $136))\n", unpack+"  (loop $label (result (ref null $136))\n",1)
for k in (0,1):
    g=re.sub(r"\(struct\.get \$136 2\s*\(local\.get \$%d\)\s*\)"%k, f"(local.get $n{k})", g)
    g=re.sub(r"\(call \$549\s*\(local\.get \$%d\)\s*\)"%k, f"(tuple.make 2 (call $firstb (local.get $b{k}) (local.get $s{k})) (i32.const 0))", g)
# rest calls
r("""     (local.set $4
      (call $550
       (local.get $0)
      )
     )""","""     (struct.set $135 3 (local.get $b0) (i32.const 1))""",1)
r("""       (local.set $6
        (call $550
         (local.get $1)
        )
       )""","""       (struct.set $135 3 (local.get $b1) (i32.const 1))""",1)
# block: $0 stays, $1 := rest $1
r("""            (local.set $scratch_15
             (local.get $0)
            )""","""            (local.set $scratch_15
             (ref.null none)
            )""",1)
r("""              (local.set $scratch_14
               (local.get $6)
              )""","""              (local.set $s1 (i32.add (local.get $s1) (i32.const 1)))
              (local.set $n1 (i32.sub (local.get $n1) (i32.const 1)))
              (local.set $scratch_14
               (ref.null none)
              )""",1)
for a,b in (("17","16"),("19","18")):
    r(f"""           (local.set $scratch_{a}
            (local.get $4)
           )""" if a=="17" else f"""          (local.set $scratch_{a}
           (local.get $4)
          )""", (f"""           (local.set $s0 (i32.add (local.get $s0) (i32.const 1)))
           (local.set $n0 (i32.sub (local.get $n0) (i32.const 1)))
           (local.set $scratch_{a}
            (ref.null none)
           )""" if a=="17" else f"""          (local.set $s0 (i32.add (local.get $s0) (i32.const 1)))
          (local.set $n0 (i32.sub (local.get $n0) (i32.const 1)))
          (local.set $scratch_{a}
           (ref.null none)
          )"""),1)
# return calls
for k in (0,1):
    r(f"(return_call $224\n" , "(return_call $224\n")
g=re.sub(r"\(return_call \$224\s*\(local\.get \$(\d)\)", lambda m: f"(return_call $224 (struct.new $136 (local.get $b{m.group(1)}) (local.get $s{m.group(1)}) (local.get $n{m.group(1)}))", g)
# the "local.set $0/$1 (block ... scratch)" assignments now set dummy null views; fine since $0/$1 aren't read later in loop
first = """ (func $firstb (param $b (ref null $135)) (param $i i32) (result eqref)
  (if (result eqref) (ref.is_null (struct.get $135 4 (local.get $b)))
   (then (array.get $134 (struct.get $135 0 (local.get $b)) (local.get $i)))
   (else (ref.i31 (array.get_u $0 (struct.get $135 4 (local.get $b)) (local.get $i))))))
"""
assert src.count(f)==1
src=src.replace(f, g+first)
open('flock-v.wat','w').write(src)
print("ok")
