# mini

This is GAPS.md round 21's program (docs/reports/GAPS.md): a little functional language read, typed and run, written in Ters.

```
ters run compiler/gaps/mini [programs]
```

The default is 200 generated programs. The same count always gives the same programs.

## How it goes

1. **Tokens.** A program's text becomes names, numbers, `->` and single marks.
2. **The parser.** Recursive descent: `let name = value in body`, `fun name -> body`, `if test then yes else no`, comparisons with `<` and `=`, sums, products, and a function given its inputs one after another.
3. **Types.** Hindley and Milner's inference by algorithm W (Luis Damas and Robin Milner, 1982): an unknown for each input, unification (J. A. Robinson, 1965) with the occurs check, and a let's value made a scheme over the unknowns nothing bound so far shares (let-polymorphism). A let may name itself, so a function bound by one may call itself.
4. **Running.** An interpreter with closures and environments (Peter Landin, 1964). A function bound by a let knows its own name.
5. **The report.** Fifteen programs of the corpus (factorial, Fibonacci of 20, compose, Church numerals, Ackermann, S K K, and some that are wrong), one generated program shown, and the generated ones tallied: how many were well typed, and what they gave added up.

The credits are also the program's own comment, shown in the editor's Program tab, and in docs/language/CREDITS.md.
