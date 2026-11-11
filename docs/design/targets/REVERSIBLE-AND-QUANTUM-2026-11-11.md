# Reversible and quantum computing, and what they mean for Ters

**Status (2026-11-11).** Design note only; nothing built. Written after a
discussion with Ersagun (thread "Explore reversible and quantum computing
for Ters"). He chose to keep the note and one someday row, C210. Not part
of the current goals (stable references, free lists, multithreading).

Ersagun's questions: why must quantum gates be invertible? Energy cost comes
from losing information, so could invertible computation cost almost
nothing? Is any of this relevant for Ters, can we compile for quantum
computers, and can we lower a computer's power use?

## 1. Why quantum computation has to be invertible

A closed quantum system changes by a unitary transformation U. A unitary
keeps the angle between any two states, so two states that start
different stay exactly as different: nothing merges. That is why U always
has an inverse, U† (its conjugate transpose), which is the same steps run
backwards in reverse order.

An irreversible gate such as AND sends 01 and 10 to the same output. The
"which one was it" bit can't vanish: physics pushes it into the
surroundings, and that is the same as the surroundings *measuring* the
qubits. Measurement destroys interference, which is where every quantum
speedup comes from. So: every step is reversible except measurement, the
one place where information is thrown away on purpose.

## 2. Landauer and Bennett

- **Landauer's principle** (Rolf Landauer, 1961): erasing one bit gives off
  at least kT·ln 2 of heat, about 3×10⁻²¹ J at room temperature. Only
  erasure has this floor; a reversible step has none in principle.
- **Bennett's trick** (Charles Bennett, 1973): any computation can be made
  reversible without erasing. Run f with scratch bits, copy the answer out
  (a CNOT, itself reversible), then run f backwards so the scratch bits
  return to zero. The price is time and space, not energy.
- In quantum code the "uncompute" half is required, not a nicety: scratch
  left behind is entangled with the answer and spoils interference just as
  a measurement would. Silq does it for the programmer; Q# has
  `within … apply` blocks for it.

## 3. Power on real hardware: honestly, no

A CMOS chip spends about 10⁴ to 10⁶ times Landauer's limit per operation,
on charging wires and on leakage, not on erasing bits. Reversible
*software* on ordinary chips saves nothing. Only adiabatic or reversible
*circuits* could change this, and those are research chips today.

What does cut a program's energy on today's machines is doing less work
and, most of all, moving less data: one DRAM read costs on the order of
100 adds. That is what Ters is already doing by default: flat structs,
columns, arrays changed in place, work spread over cores that then sleep
(STABLE-REFERENCES.md, COLUMNS.md, IN-PLACE.md). That is the real energy
lever, and it needs no new language.

## 4. What Ters already has

- Every node runs backwards (BACKWARDS.md), and mode analysis (MODES.md,
  Mercury's determinism categories) proves when a direction has exactly
  one answer (`det`). The compiler writes det modes as plain functions
  (C195).
- **A function that is `det` both ways is a bijection**: reversible in the
  logical sense. Constructors taken apart, whole-number add, subtract and
  negate, and an `if` checked on the way back are the same shapes as
  Janus's reversible statements (`+=`, `-=`, `if … fi` with an exit
  assertion).

Two limits:

- Ters's general "backwards" is a **search** (Choice, failure, miniKanren
  streams). A search throws failed branches away all the time, so it is
  the opposite of reversible computing. Only the det-both-ways part
  counts.
- **Float64 `+` is not reversible**: rounding merges inputs. Neither are
  `floor`, `mod` or `round to Float32` (BACKWARDS.md lists them as
  forward-only).

## 5. A reversible subset, if we ever want one

Inferred, never declared (no hints, as with every representation choice):
a function is reversible when both of its directions are `det` with no
search and every step undoes locally. The pieces:

- fixed-width whole numbers with wraparound (`+` and `−` mod 2ⁿ, xor,
  rotate, swap); multiply only by an odd constant;
- constructors and matches, with the arm chosen backwards by a check on
  the result (Janus's exit assertion);
- folds over a shape known in advance (a fixed-length array or tuple);
- **automatic uncompute**: a let whose value is used and then no longer
  needed is cleaned by running its definition backwards (Bennett), as Silq
  does for `qfree` code.

Uses besides quantum: stepping a program backwards in the editor's run log
without storing snapshots (L186's world log), and undo for any change that
is a bijection.

## 6. A quantum target (C210, someday)

**Classical part: small and clean.** Take a det-both-ways function over
fixed-width Ints, print Toffoli/CNOT/X gates as OpenQASM 3, and add the
uncompute step automatically. That gives *oracles*, the classical pieces a
quantum algorithm calls (Grover's predicate, Shor's modular
exponentiation). It can be checked with no quantum hardware: a reversible
circuit on basis states is a permutation, so the evaluator and a tiny
simulator must agree on every input of a few bits.

**Quantum part: a new layer of the language, not a target.** Ters has a
close match: `Choice` is already "many answers at once". Give each answer
a complex amplitude, and let equal answers add (or cancel) instead of
being listed twice, and you have quantum semantics; measurement is an
effect, the only irreversible one. `for some(f)` over n bits is exactly
the problem Grover's algorithm solves in about √(2ⁿ) tries instead of 2ⁿ.
It would run on simulators and small, noisy machines only, so it waits
until the goals above are done and Ersagun asks for it.

## Credits

| What | Label | Who and where |
|---|---|---|
| Erasing a bit costs at least kT·ln 2 | Prior art | Rolf Landauer, "Irreversibility and heat generation in the computing process", IBM J. Res. Dev. 5(3), 1961 |
| Compute, copy, uncompute | Prior art | Charles H. Bennett, "Logical reversibility of computation", IBM J. Res. Dev. 17(6), 1973 |
| Reversible gates | Prior art | Tommaso Toffoli, "Reversible computing", ICALP 1980; Edward Fredkin and Tommaso Toffoli, "Conservative logic", 1982 |
| A reversible language | Prior art | Janus: Christopher Lutz and Howard Derby, 1982; formalized by Tetsuo Yokoyama and Robert Glück, PEPM 2007 |
| Automatic uncompute in a quantum language | Influence | Silq: Benjamin Bichsel, Maximilian Baader, Timon Gehr and Martin Vechev, PLDI 2020 |
| Scoped compute/uncompute blocks | Prior art | Q# (Microsoft), `within … apply` |
| The circuit format a target would print | Prior art | OpenQASM 3: Andrew Cross and others, ACM Trans. Quantum Computing 3(3), 2022 |
| A search over n bits in √(2ⁿ) steps | Prior art | Lov Grover, "A fast quantum mechanical algorithm for database search", STOC 1996 |
