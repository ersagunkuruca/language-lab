# Property spike with Ephyra (not wired into CI)

A trial of [Ephyra](https://github.com/datadog-labs/ephyra) (Alperen Keleş
and others at Datadog, MIT), a Rust property-based testing library, on ters.

- `int-agree/`: a Rust test crate. It generates Int expressions (+, -, *,
  quotient, remainder; small numbers and the 63/64-bit edges) with its own
  shrinker, and checks that `ters run` (the evaluator) and `ters compile`
  (JavaScript) print the same; `NATIVE=1` checks `ters native` (C) too.
- `worker.ts`: one long-lived Node process the Rust side talks to by JSON
  lines; it builds each case through the MCP tools and runs the engines.

    cd ters/props/int-agree
    EPHYRA_TESTS=20 cargo test --release -- --nocapture
    FAKE_BUG=1 EPHYRA_TESTS=40 EPHYRA_SEED=5 cargo test --release -- --nocapture

Each case costs about 4.5 s (8 s with C), nearly all of it spawning
`ters run` and `ters compile`. Credit: Ephyra is the library, used as is.
