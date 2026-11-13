# A run's world log in bounded memory

*Status 2026-11-13: design, for row I239; I239a (§1), I239b (§2) and I239c's engine (§3, page.ts `steps`) built. Ersagun: "it's still a memory
hole" (thread "Decide the saved program format", 2026-11-13).*

A run is kept by keeping what the world answered it (worldlog.ts, L186):
given the same answers, the program does the same again. Today the log
keeps every answer from the start of the run, and nothing ever leaves it.

## Where the memory goes

- **A page in the editor** (pagePanel.ts `page.log`). This log is always
  on. It holds every handler event and every world answer, from the
  moment the page starts until it is replaced.
- **A page's animation is the bulk.** An element that hears `frame` logs
  one `event` entry per browser frame:
  `{op: "event", args: ["frame", value, key, x, y, seconds, path]}`. That
  is an object and two arrays per frame, about 200 bytes. At 60 frames a
  second, tumble running for an hour holds about 216,000 of them, around
  40 MB, plus one entry for each `random` draw.
- **A compiled page** keeps the same log when opened with `?ters-log`
  (core-page.ts). It is opt-in, but just as unbounded.
- **A main run** (Run panel, `ters run`) logs one run, which ends. A main
  that loops on the world forever grows its log too.

## What changes

### 1. Each effect says how it is recorded

The log stays one ordered list. What it costs depends on what an answer
needs to be given again:

- **Random: one seed for the run.** The evaluator's world draws from our
  own generator (random.ts `seededGenerator`), seeded once from the world.
  The seed is logged once as `randomSeed`, never the draws. Compiled
  native and WebAssembly runs already do this (C136, C172c);
  `replaying` already reads it. (Built for a page's log, the evaluator's
  and the compiled one's. A main's run still logs each draw, since the Run
  panel steps by answer and the run ends; §4 bounds it.)
- **The clock: once per frame, as the difference from the last reading.**
  A frame event already carries the seconds since the frame before. The
  seconds of a run of consecutive frames heard by the same element are
  kept in one entry, in a Float64Array chunk, so a frame costs 8 bytes.
  The difference is exact, because each frame time is the previous one
  plus what is logged.
- **Everything else as today:** a read line, a file, a fetch's arrival, a
  click with its path. These are few and come from a person or the
  network.

This alone takes tumble's hour from about 40 MB to about 2 MB. That is
smaller, but still a log that only grows.

### 2. The log is a window, with snapshots

The page's log is kept as segments of N seconds (10 by default). Each
segment starts with a snapshot of the page:

- the value of every cell, kept by reference (values are immutable, so a
  snapshot costs one map entry per cell and shares the rest);
- the random generator's state (four 32-bit words);
- the time of the last frame.

Once the log holds more than M segments (30 by default, about 5 minutes),
the oldest segment and its snapshot are dropped. Memory is then at most M
snapshots and M segments, whatever the run's length. The window's length
is a setting, not a constant, and the Run panel says how far back it
reaches.

Prior art: rr's checkpoints (replay from the nearest checkpoint, not from
the start) and Redux DevTools' `maxAge` (actions past the age are folded
into the oldest kept state).

### 3. Replay and step-back go as far back as the window

- **Step back to a moment:** restore the nearest snapshot at or before
  it, then give the segment's entries forward up to that moment. A frame
  is the unit.
- **Replay from the start of the window:** the same, from the oldest
  snapshot.
- **A run shorter than the window** still replays from its real start,
  as today.
- **The log saved to a file** (pagePanel `saveLog`) holds the window,
  starting from its oldest snapshot.
  - Cells holding data are saved as shown values, read back the way
    `examples.json` reads saved inputs.
  - A cell holding a function can't be written out. In that case the save
    says so, and offers the log from the start only while the run is
    still inside its first window.

### 4. Main runs

A main run's state lives on the evaluator's stack, and the stack can't be
taken as a snapshot. A main's log is kept whole, but compact as in §1.
Past a cap (8 MB by default) it stops logging and says so: "this run's
answers passed 8 MB; replay and step-back need a shorter run". This keeps
memory bounded honestly, rather than by dropping answers a replay would
need.

## Steps

1. **I239a, compact recording.**
   - The evaluator's world draws from a seeded generator and logs one
     `randomSeed`.
   - Frame events are kept as chunks of seconds.
   - `replaying` reads both.
   - Example: tumble running 10 simulated minutes logs under 100 KB.
2. **I239b, the window.**
   - The page's log is kept as segments with snapshots (cells, generator,
     last frame), and the oldest are dropped past M.
   - Example: tumble running a simulated hour keeps its log and
     snapshots under a fixed size.
3. **I239c, step back in the window.**
   - In the page panel: pause, step back and step on by frame, from a
     snapshot.
   - Saving the log saves the window.
   - Example: in tumble, step back 3 seconds and see the board as it
     was.
4. **I239d, main runs' cap and the compiled page's `?ters-log`** use the
   same window rules.
