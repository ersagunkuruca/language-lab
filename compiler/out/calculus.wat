(module
  (import "Math" "sin" (func $Math.sin (param f64) (result f64)))
  (import "Math" "cos" (func $Math.cos (param f64) (result f64)))
  ;; cubic
  (func $cubic0 (export "cubic") (param $p0 f64) (result f64)
    local.get $p0
    local.get $p0
    f64.mul
    local.get $p0
    f64.mul
    local.get $p0
    f64.sub
    f64.const 1
    f64.sub)
  ;; wave
  (func $wave1 (export "wave") (param $p0 f64) (result f64)
    local.get $p0
    call $Math.cos
    local.get $p0
    f64.sub)
  ;; kink
  (func $kink2 (export "kink") (param $p0 f64) (result f64)
    local.get $p0
    f64.const 0
    f64.lt
    (if (result f64)
      (then
        local.get $p0
        f64.neg)
      (else
        local.get $p0
        local.get $p0
        f64.mul)))
  ;; bump
  (func $bump3 (export "bump") (param $p0 f64) (result f64) (local $l1 f64)
    local.get $p0
    call $Math.sin
    local.set $l1
    local.get $l1
    local.get $l1
    f64.mul)
  ;; x² − 2
  (func $x_24 (export "x² − 2") (param $p0 f64) (result f64)
    local.get $p0
    local.get $p0
    f64.mul
    f64.const 2
    f64.sub)
  ;; cubic′
  (func $cubic_5 (export "cubic′") (param $p0 f64) (result f64)
    local.get $p0
    local.get $p0
    local.get $p0
    f64.add
    f64.mul
    local.get $p0
    local.get $p0
    f64.mul
    f64.add
    f64.const 1
    f64.sub)
  ;; wave′
  (func $wave_6 (export "wave′") (param $p0 f64) (result f64)
    local.get $p0
    call $Math.sin
    f64.neg
    f64.const 1
    f64.sub)
  ;; kink′
  (func $kink_7 (export "kink′") (param $p0 f64) (result f64)
    local.get $p0
    f64.const 0
    f64.lt
    (if (result f64)
      (then
        f64.const -1)
      (else
        local.get $p0
        local.get $p0
        f64.add)))
  ;; bump′
  (func $bump_8 (export "bump′") (param $p0 f64) (result f64) (local $l1 f64) (local $l2 f64)
    local.get $p0
    call $Math.sin
    local.set $l1
    local.get $p0
    call $Math.cos
    local.set $l2
    local.get $l1
    local.get $l2
    f64.mul
    local.get $l1
    local.get $l2
    f64.mul
    f64.add)
)
