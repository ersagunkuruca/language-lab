# A run's world log in bounded memory

*Status 2026-11-13: design, for row I239; I239a (§1), I239b (§2), I239c's engine (§3, page.ts `steps`) and I239d's cap (§4) and I239f (§5, the compiled page's snapshots) built; the page panel's buttons are the Editor lane's. Ersagun: "it's still a memory
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
  is an object and two arrays per frame. Measured on bounce (I254, below),
  one such entry holds about 320 bytes of the heap (66 as JSON). At 60
  frames a second an hour is 216,000 of them, about 69 MB, plus one entry
  for each `random` draw. (The pages that hear `frame` are agent, bounce
  and spacetime. Tumble, which this note first used, animates with CSS
  and logs only its taps.)
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

This alone takes bounce's hour from about 69 MB to about 1.7 MB (8 bytes
a frame in memory; about 20 as JSON). That is smaller, but still a log
that only grows.

### 2. The log is a window, with snapshots

The page's log is kept as segments of N seconds (10 by default). Each
segment starts with a snapshot of the page:

- the value of every cell, kept by reference (values are immutable, so a
  snapshot costs one map entry per cell and shares the rest);
- the random generator's state (four 32-bit words);
- the time of the last frame.

Once the log holds more than M segments (30 by default, about 5 minutes),
the oldest segment and its snapshot are dropped. On bounce that is 18,000
frames, about 144 KB, and 30 snapshots of its cells (kept by reference). Memory is then at most M
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

### 5. The compiled page in the editor

The editor's preview swaps the compiled page in for the interpreted one
within seconds, handing over what was done on it (cells.ts handOver). So
the compiled page keeps its log as a window too, by the same rules, each
snapshot its cells' values in the order they were made (the order
handOver uses) and the generator's state. Its first snapshot is taken
after the handover, where its part of the log starts.

Pause stops the compiled page and builds the interpreted page from those
snapshots (page.ts showPage `stepFrom`). It takes up each snapshot whose
cells it can carry to its own cells at the same places: plain data, or a
cell unchanged since it was made. One holding a function made since is
left out, and a step goes from the snapshot before it. The page is shown
at the log's last event, steps back and on from there, and goes on
interpreted.

## Steps

1. **I239a, compact recording.**
   - The evaluator's world draws from a seeded generator and logs one
     `randomSeed`.
   - Frame events are kept as chunks of seconds.
   - `replaying` reads both.
   - Example: bounce running 10 simulated minutes logs under 100 KB.
2. **I239b, the window.**
   - The page's log is kept as segments with snapshots (cells, generator,
     last frame), and the oldest are dropped past M.
   - Example: bounce running a simulated hour keeps its log and
     snapshots under a fixed size.
3. **I239c, step back in the window.**
   - In the page panel: pause, step back and step on by frame, from a
     snapshot.
   - Saving the log saves the window.
   - Example: in bounce, step back 3 seconds and see the balls as they
     were.
4. **I239d, main runs' cap and the compiled page's `?ters-log`** use the
   same window rules.
5. **I239f, the compiled page's snapshots** (§5): Pause and step in the
   editor after the compiled page takes over.

## Measured (I254, 2026-11-13)

Bounce in Node with a fake document, its frames driven at 60 a second of
simulated time (each frame about 20 ms of evaluation, so a simulated
minute takes about a minute):

| | per frame | an hour |
|---|---|---|
| one `event` entry a frame, before I239a | 320 bytes of heap, 66 as JSON | about 69 MB |
| a run of seconds (I239a) | 8 bytes, about 20 as JSON | about 1.7 MB |
| the window, 10 s × 30 segments (I239b) | | about 144 KB of frames, and 30 snapshots |

With a window of 10 s × 3, a simulated minute kept 3 snapshots and the
last 30 seconds' 1,800 frames, the older entries dropped.
