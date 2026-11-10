# fibonacci

The nth Fibonacci number, worked out the slow way: `fib(n − 1) + fib(n − 2)`.

    ters run examples/fibonacci 20
    ters compile examples/fibonacci -o fibonacci.mjs && node fibonacci.mjs 38

The argument is n (30 when there is none). Each call of `fib` makes two
more, which only compute and need nothing from each other. The checker
sees that (pure-branches.ts `parallelHalves`), so the compiled program may
run them on other cores, with nothing written to say so (C61 e,
compiler/src/branches-rt.ts `bothPure`). The first time it meets the two
calls, it unfolds the first few levels of calls on the main thread until
there are a few dozen. To unfold a call, it runs the call until it meets
its own two calls. The calls at the bottom are shared out on worker
threads, and the levels above are worked out again from their answers. It
is the same number as running it in turn.

Measured 2026-11-10 on 4 cores, n = 38: 2.3 s before the change, 2.1 s in
turn with it (TERS_WORKERS=0), and 0.9 s with three workers.

Natively (`ters native examples/fibonacci -o fibonacci`, C61e3, compiler/src/c.ts
`dcC`), the second of the two calls is pushed where any of the pool's
threads may take it, and the first is made here. Then the second is waited
for, or made here if no thread took it. This goes down the first eight
levels; below that, the calls are made as written. Measured on 4 cores, n = 38:
0.41 s before the change, 0.5 s in turn with it (TERS_WORKERS=0), and
0.15 s with three threads.
