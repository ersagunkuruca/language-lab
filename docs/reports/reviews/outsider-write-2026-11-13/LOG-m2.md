# LOG m2 (MCP route)

Task: Pythagorean triples c<=20 + Triple records with perimeter.

## Went well
- README -> LEARN -> LANGUAGE "Start here" explained Choice (one of / all / fail) clearly; LIBRARY had range from, print, show.
- `define` type with `first: "triple(a: Int, b: Int, c: Int)"` worked first try.

## 1. replace with multi-line steps inside a lambda hung (no answer)
- Trying: body of `triples` as a search.
- Call: replace at=<hole> text="all(() =>\n  a = one of(range from(1, 21))\n  b = ...\n  c = ...\n  if a * a + b * b == c * c then triple(a, b, c) else fail())"
- Happened: the MCP call never returned (>120 s, killed). No error, no output.
- Docs: MCP.md says replace takes "an expression written as view prints it" but never shows how a let/step inside a lambda is written, nor whether newlines are allowed. The `step` tool exists for steps.
- Severity: slowdown (a hang is worse than an error; can't tell if it's the parser, typechecker, or the search being evaluated).

## 2. `step` puts the new step in the wrong place / can't see earlier steps
- Body was: `a#jl8n = one of(range from(1, 21))` then hole `□#qma9`.
- Call: step at=qma9 name=b value="one of(range from(a + 1, 21))"
- Happened: "nothing is named a here; did you mean p, i?" (p, i are meaningless here). replace at the same qma9 *does* see a ("did you mean p, i, a?").
- Retry with empty value: step at=qma9 name=b value="" -> the step was inserted BEFORE `a = ...`, i.e. at the start of the body, not before the hole. So "before a part" means before the whole step chain containing it.
- MCP.md: "step(at, name, value): a step `name = value` before a part" - doesn't say how to put a step after an existing step.
- Severity: slowdown. Also `undo` only works inside one invocation, so I couldn't take it back.

## 3. replace with several step lines -> "a binder"
- Call: replace at=<body hole> text="a = one of(range from(1, 21))\nb = ...\nc = ...\nif ... then triple(a, b, c) else fail()"
- Happened: error text was just "a binder" (isError). No hint what's wrong (steps not allowed in replace text?).
- Severity: papercut/slowdown - message is unreadable.
  - Later found: the real cause was `==`. The view prints equality as `a · a + b · b = c · c`, and `equal(x, y)` is the library name. Writing `==` gave "a binder" with no mention of `==`. 1 more try once I used `equal(...)`. Severity: slowdown (the error didn't point at the operator).
- Workaround for #2: `step` at the definition (puts a step first) three times in reverse order (c, b, a) with empty values, then `replace` each hole. Worked.

## 4. eval of a bare definition name refused
- eval text="triples" -> "a name alone is listed already" (isError). Unclear: "listed" where? `defs` shows only the type, not the value. eval "all(pick triple())" worked and gave the 6 triples.
- Severity: papercut.

## 5. `for each` resolves to the html-module overload
- Call: step at=main name=_ value="for each(triples, (t) => print(...))"
- Happened: "for each takes 3 inputs, given 2" (isError). defs filter="for each" library=true shows two `for each` (List one with 2 inputs, html Cell one with 3), with no ids, so I could not pick the list one. The error doesn't mention the other overload.
- LIBRARY.md lists both under the same name; nothing says how to choose (the `as` parameter of replace is only for fields).
- Workaround (1 try): print one text: print(join all(map(triples, (t) => ...), "\n")). Severity: slowdown.

## Other notes
- `all(() => one of(...))`: the view printed it back as `all(one of(...))` - the `() =>` disappeared. GUIDE §6 shows `all(queens(6))`, so calls passed to all are thunked implicitly; that GUIDE section was the clearest help for Choice.
- Earlier hang (#1) may have been caused by the `==` too (same text as #3 but wrapped in a lambda); either way a hang with no answer instead of the "a binder" error.
- `step` value "" and then `replace` the hole is a reliable two-call pattern.
- Field access `t.a` and `show` on Int worked first try; `ters run` on the folder gives the same output as MCP `run`.

## Summary
Finished. Using the MCP server I defined a type `Triple = triple(a, b, c: Int)`, a search `pick triple` written with Choice (`one of` three times + `if ... then triple(a,b,c) else fail()`), `triples = all(pick triple())`, and `main` printing the triples and their perimeters. The concepts were easy thanks to LANGUAGE.md "Start here" and GUIDE §6. The time went on the text the tools accept: `==` is not equality (gave the meaningless error "a binder", and once a silent hang), `step` inserts at the front of the step chain so later steps can't use earlier ones, and an overloaded library name (`for each`) can't be disambiguated. ~25 tool calls.

## Final program (view)
```
      type Triple#mnbm
emn1    | triple(a#poe5: Int, b#48oe: Int, c#hrsu: Int)

      ‹pick triple›#j032 : () -[Choice]-> Triple
      ‹pick triple›#j032() =
dgos    a#83md = ‹one of›(‹range from›(1, 21))
06a1    b#oj2j = ‹one of›(‹range from›(a + 1, 21))
32t9    c#l5n9 = ‹one of›(‹range from›(b + 1, 21))
        if a · a + b · b = c · c then triple(a, b, c) else fail()

      triples#ee7j : List Triple
      triples#ee7j = all(‹pick triple›())

      main#mdt1 : () -[Console]-> Unit
      main#mdt1() =
ei68    print(‹join all›(map(triples, (t#ehv6) => ‹join all›([show(t.a), show(t.b), show(t.c)], " ")), "\n"))
        print(‹join all›(map(triples, (t#sbcu) => show(t.a + t.b + t.c)), "\n"))
```

## Output (MCP run and `ters run m2/prog`, identical)
```
3 4 5
5 12 13
6 8 10
8 15 17
9 12 15
12 16 20
12
30
24
40
36
48
exit 0
```

## Top 5 frictions
1. `replace` with a lambda + steps + `==` hung with no answer (>120 s) - blocker-feeling, had to kill it.
2. `==` gives "a binder" - error doesn't name the bad token; equality is `equal(...)`/printed `=`, not in MCP.md.
3. `step(at=<hole after a step>)` puts the step at the start of the chain, so it can't refer to earlier steps ("nothing is named a here; did you mean p, i?" - suggestions p, i are noise).
4. Overloaded `for each`: "takes 3 inputs, given 2" with no way to pick the List version.
5. `eval "triples"` -> "a name alone is listed already"; and `undo` doesn't survive across invocations, so a misplaced step had to be replaced by a hole and rebuilt.

## Verdict: finished.
