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
