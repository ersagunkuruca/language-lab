# LOG w1

## Went well
- README -> LEARN -> GUIDE path was clear. GUIDE sec 3 told me the palette accepts typed values/short sums; I tried a whole expression `for each(range from(1, 16), (n) => print(show(n)))` and the palette parsed it ("the value typed"). Big time-saver.
- LIBRARY.md found `print`, `remainder`, `range from`, `show`, `first` quickly by grep.

## Entries
1. Driver: after reloading the page (persistent profile), the new program "Untitled 1" is reopened but no hole is selected, so the palette search box isn't there. Had to click the hole (`.x.hole` in Blocks text) first. 1 extra try. Papercut (automation-specific).
2. Filling main with `for each(range from(1, 16), (n) => print(if remainder(n, 15) = 0 then "FizzBuzz" else ... else show(n)))` refused. Status: "... doesn't fit here: nothing fits whichever for each or show is meant: for each takes 3 inputs, given 2; or main does Console while a Choice is open, so it would act on paths that are later abandoned: handle the Choice first (first, all, count or optional) and act on its result." The second half is a very good message (remainder has Choice because of /0). The first half ("for each takes 3 inputs, given 2") is a red herring from the other overload of for each. Also: pressing Enter while the palette says "Reading what's typed…" - unclear whether Enter waits. Slowdown.
3. Fixed entry 2 by wrapping the Choice in `first(() => <if-chain>, () => show(n))` (the type of `first` was in LIBRARY.md and in the palette). Accepted on try 2: "Filled with for each(...)". Type became `main : () -[Console]-> Unit`. The view shows it as `first(<body>, else show(n))`, so the typed lambda form and the displayed form differ - a newcomer copying the displayed form back might be confused (not tested). Papercut.
   - Note: `=` as equality in typed text was a guess from an example in LANGUAGE.md (`if question = "width" then ...`); LIBRARY lists `equal` but doesn't say which symbol to type. Worked first time.
4. Run main: worked first time, output below, "Ran compiled."
5. Save: Program tab > Save file downloaded `untitled-1.json` (no prompt for a title; the program stayed "Untitled 1" - I didn't rename it). Papercut.
6. Overall friction was low: one refusal, helpful message.

## Summary
Made a new program ("+ New program"), clicked main's hole, and typed the whole body as one expression in the palette search box, which the editor parses. The first try was refused because `remainder` has the Choice effect (division by 0) and you can't print while a Choice is open; the refusal said exactly that and named `first`/`optional` as the fix. Wrapping the if-chain in `first(..., () => show(n))` fixed it. Run main printed the right FizzBuzz 1..15. Saved with Program > Save file to /tmp/claude-0/op/w1/untitled-1.json. About 15 tool calls. The point of a structure editor (pick pieces) was barely used: typing the whole expression as text was the quickest route, and it's only mentioned in passing ("short sum, like x + 1") in GUIDE sec 3.

## Final program (Blocks view)
```
main : () -[Console]-> Unit
main() =
  ‹for each›(
    ‹range from›(1, 16),
    (n) =>
      print(
        first(
          if remainder(n, 15) = 0
          then "FizzBuzz"
          else if remainder(n, 3) = 0
          then "Fizz"
          else
            if remainder(n, 5) = 0 then "Buzz" else show(n)
          ,
          else show(n)
        )
      )
  )
```

## Output (Run main)
```
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
```
"Ran compiled."

## Top 5 frictions
1. `remainder` on Int has Choice (no answer at b = 0), so printing it forces a `first`/`optional` wrapper even for constant non-zero divisors. Fine once explained by the refusal, but surprising for FizzBuzz.
2. The refusal message starts with a red herring from the other `for each` overload ("for each takes 3 inputs, given 2") before the real cause.
3. The fact that the palette search accepts whole expressions is undersold (GUIDE sec 3 mentions only values and "a short sum"); the typed syntax (`=` for equality, `if/then/else`, `(n) => ...`) isn't documented as a syntax anywhere I looked; I guessed from examples.
4. The displayed form of `first(…, else show(n))` differs from what you type (`() => show(n)`), so the view isn't copy-pasteable back as input.
5. Automation papercut: after reload no hole is selected, so the palette isn't shown until you click the hole; Save file names the file after "Untitled 1" with no prompt.

## Verdict
Finished.
