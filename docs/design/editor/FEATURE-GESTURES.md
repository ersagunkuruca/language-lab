# Language features the editor can't make yet (design note, 2026-11-02, E199)

**Status (2026-11-02).** Ways built (E210), directions built (E210b). Private cases built (E209), after L165 made a program's own private case the program's to build.

REVIEW-2026-11-02b §3 found four things in the model that the editor
draws but no gesture makes: text (the DSL, `lab`) is the only way to write
them. This note says which belong in the editor, and how, so each can be one
row. The test for "belongs": would someone writing a program in the editor
from nothing need it, as they need inputs, cases and type parameters (E198)?

| feature | in the model | in the editor? | row |
|---|---|---|---|
| a private constructor (L79) | `variant.private` | **yes** | E209 |
| a definition as a way of an interface's operation, and its cost (WAYS.md) | `def.way`, `def.cost` | **yes** | E210 |
| a definition that computes another direction of a relation (POLAR.md, L97b) | `def.direction` | **yes, with ways** | E210 |
| a type kept apart from another of the same shape | `typedef.unique` | **no**: shown, not made | none |

## Private constructors: yes (E209)

A type whose values keep a rule (a set sorted with no item twice, a
fraction in lowest terms) is made from its functions, not its cases. That
is as much part of writing a data type as its fields are. Gesture: a
**Private** tick on a case's panel, beside *Answered later* on an
operation's: "Only this program's own definitions make it; everyone else
uses its functions. Taking it apart with a match is open to all." Ticking
is refused, with where, while code outside the program makes the case.
Within one program it changes nothing, so the tick says that too; it
matters once the program is shared (SHARING) or used as a library.

## Ways and their cost, and directions: yes (E210)

A way is an ordinary definition marked as one way of an interface's
operation (WAYS.md: "a law that also computes"); a direction is an
ordinary definition marked as another direction of a relation (POLAR.md).
Both are a definition plus one field, the same shape, so one gesture serves
both:

- On an interface operation's panel (E142's), **Ways of `differ`**: the
  ways there are, each with its cost, and **Add a way**, which makes a new
  definition of the operation's type, a hole for its body, marked `way` of
  that field. Its cost is a number field next to it (the default is the
  checker's, 1 + what it uses).
- On a relation's panel (a function with results, L128), **Directions**:
  the definitions that compute it another way round, and **Add a
  direction**, which asks which ports are given and makes a definition of
  those ports to the rest, marked `direction` of the relation.
- A definition that is a way or a direction says so at the top of its own
  panel, with the operation or relation it belongs to as a link, and a
  button to make it an ordinary definition again.

The checker already says what is wrong with one (nothing grounds, ports
that don't match), so the editor needs no checks of its own.

## `unique`: no gesture

`unique` keeps a type apart from another of the same shape when both are
hashed (Unison's `unique type`). In the editor a type gets its identity
from where it was made, and two programs' types meet only when published.
That's a library author's choice, made once in text, and nothing someone
writing a program would look for. The type's panel shows it when it is set
("kept apart from types of the same shape, as `name`"), so a program that
has one isn't puzzling; it is not offered as a tick.
