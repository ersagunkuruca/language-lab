# break

A pool break played out event by event (GAPS.md round 12). Sixteen balls
on an eight-foot table: fifteen racked in a triangle, the cue ball hit
along the table. The balls roll in straight lines and slow by rolling
friction. The program finds the next thing to happen, moves every ball to
it, applies it and logs it, until nothing more happens. Four things can
happen next: two balls meet (an elastic collision of equal balls), a
ball banks off a cushion (it keeps 80% of its speed into it), a ball
drops into one of six pockets, or a ball comes to rest. main plays three
breaks and prints each log, how it ended, and checks on the end (no
overlaps, nothing off the cloth, nothing still rolling).

When a ball touches something is a relation: `gap at(obstacle, ball, t)`
is the gap t seconds on, and `first touch` is the same relation read the
other way, the first t at which the gap is down to a given one. Both are
fields of the `Toucher` interface (POLAR.md, L120d).
- A cushion gives `first touch` in closed form, the smaller root of
  s·t − f·t²/2 = d.
- A pocket and another ball leave it to the way `first touch by
  advancing`, conservative advancement: two rolling balls meet when a
  quartic in t is 0. The compiler takes whichever costs less (WAYS.md).

It was written through the Ters MCP server's tools (`ters mcp`). Its
types, the interface and the way's mark were made with the DSL first,
since the MCP can't write them yet (GAPS.md round 12).

```
$ ters run compiler/gaps/break
Break at 6.0 m/s, the cue ball 1.0 cm off the line:
0.178 s  the cue ball meets 1
…
47 events in 6.108 s; pocketed: 11, 15.
Checks: 0 overlapping, 0 off the cloth, 0 still rolling.
…
```

Credits (printed by main too):
- Conservative advancement is Brian Mirtich's, *Impulse-based Dynamic
  Simulation of Rigid Body Systems* (PhD thesis, 1996) (prior art).
- Simulating colliding discs event by event, always to the next
  collision, is Berni Alder and Thomas Wainwright's ("Studies in
  Molecular Dynamics", 1959), made fast by Boris Lubachevsky ("How to
  simulate billiards and similar systems", 1991) (prior art).
- The program, its table and its numbers are our own.
