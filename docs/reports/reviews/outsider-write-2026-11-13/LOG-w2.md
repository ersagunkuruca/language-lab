# LOG w2

Driver: Playwright, persistent profile at /tmp/claude-0/op/w2/profile, one script per step (a long-lived eval server was refused by my sandbox, not by Ters).

## Went well
- README -> LEARN.md -> GUIDE.md ("hands-on guide") was a clear path. Guide sec. 3 said you can type "a short sum, like x + 1" into the palette.
- + New program -> "Untitled 1" with main. + New definition form (Name, Inputs) was obvious. Created `celsius to fahrenheit(celsius)`.
- Typed `celsius * 9 / 5 + 32` into the palette search ("1568 things fit here. Search...") and pressed Enter: "Filled with celsius * 9 / 5 + 32." Type became `(Float64) -> Float64`. First try.

## Papercut: input named `celsius` collides with library names
- After creating input `celsius`, the palette's "calls" group listed `celsius(□)`, `celsius(□, □)`, `celsius(□, □, □)` with types like `(a) -> b where a has <` -- the input (type `a` at that point) is offered as callable at several arities. Confusing for a moment (is there a library `celsius`?), but harmless. Severity: papercut.

## Went well: running forwards and backwards (Run pane)
- Run pane for a function lists ports with tick boxes (as GUIDE sec. 7 says). Typed 100 in `celsius` + Enter -> result `212`. First try.
- Ticked result, unticked celsius, typed 212 -> celsius `100`. First try.
- result -40 -> celsius `-40`. But: with a 2.5 s wait the pane still said "Looking for an answer... Stop"; with 10 s it showed -40. Slowdown only for my script; no indication of how long it would take. Papercut.
- Created `total price` with Inputs "net, rate" (comma-separated, as the placeholder said), typed `net * (1 + rate)` in palette -> `‹total price›(net, rate) = net · (1 + rate)`, type `(a, a) -> a where a is a Number`.
- Forward (net 200, rate 0.2) -> `240`. First try.

## BLOCKER-ish (worked around): backwards run of a Number-generic function crashes with a JS BigInt error
- Trying: run `total price` backwards: untick net, tick rate=0.2 and result=300.
- Happened: Run pane shows, in an orange box: "The number 1.2 cannot be converted to a BigInt because it is not an integer". Same with result `300.0`. net stays `?`.
- Docs: BACKWARDS.md has nothing about Number-generic types, Int vs Float64 or BigInt (grep for bigint / "is a Number" / Float64 found nothing relevant). GUIDE sec. 7 only shows Float64-typed examples. The message is a raw JavaScript exception, not a Ters message; it doesn't say which type was chosen or what to do.
- Why (my guess): the type `a where a is a Number` was inferred because the only literal was `1`; when solving backwards the solver apparently picked an integer (BigInt) representation for `a`, then 1 + 0.2 = 1.2 couldn't be stored.
- Fix (my own guess, 1 try): clicked the `1` literal in Blocks text, pressed Delete, typed `1.0` + Enter -> "Filled with 1.0." Type became `(Float64, Float64) -> Float64`. Backwards then gave net = `250`; forwards still 240. (Alternative I didn't try: Pin this type.)
- Note: forwards worked fine on the generic version, only backwards broke -- inconsistent. Also, `celsius * 9 / 5 + 32` got Float64 automatically (because of `/`, I assume), so the first function never hit this.
- Total tries: 3 (2 failing runs + the fix). Severity: slowdown for me, but a blocker for a newcomer who doesn't guess "make the literal a float".

## Papercut: tab named "Program" vs list heading "Programs"
- Save: the inspector tab "Program" isn't a role=button (my script's getByRole failed; matched by text instead). Trivial; an automation note, not a user issue. Then "Save file" downloaded `untitled-1.json` (format "projectional-program", version 2). The program title stays "Untitled 1" -- I didn't find/look for a rename for the program.

## Not done
- `main` is still an empty hole (`main() = □a`); the task didn't need it, runs were done from the Run pane per function.

---
## (1) Summary
Using only README -> LEARN -> GUIDE (sections 3, 7, 10), I created a new program in the web editor, added `celsius to fahrenheit` and `total price` by typing arithmetic into the palette, and ran both forwards and backwards from the Run pane by ticking/unticking ports. The editor experience was smooth: every edit worked first time and the guide described the gestures exactly. The one real problem was that `total price`, inferred as Number-generic `(a, a) -> a`, crashed when run backwards with a raw JavaScript "cannot be converted to a BigInt" error; no doc covers it. Changing the literal `1` to `1.0` made the function Float64 and the backwards run gave the right answer. Solving backwards can also take several seconds with only "Looking for an answer..." as feedback.

## (2) Final program (Blocks view)
```
main : () -> a
main() = □a

‹celsius to fahrenheit› : (Float64) -> Float64
‹celsius to fahrenheit›(celsius) = celsius · 9 / 5 + 32

‹total price› : (Float64, Float64) -> Float64
‹total price›(net, rate) = net · (1.0 + rate)
```
Saved file: /tmp/claude-0/op/w2/untitled-1.json

## (3) Output
- celsius to fahrenheit, forwards, celsius=100 -> result 212
- backwards, result=212 -> celsius 100
- backwards, result=-40 -> celsius -40
- total price, forwards, net=200 rate=0.2 -> result 240
- backwards, rate=0.2 result=300 -> net 250 (after the 1 -> 1.0 fix; before it: "The number 1.2 cannot be converted to a BigInt because it is not an integer")

## (4) Top frictions
1. Backwards run of a Number-generic function crashes with a raw JS BigInt error; forwards works; no doc explains it or the fix (use 1.0 / pin a Float64 type).
2. That error message is a host-language exception: it doesn't name a type, a node, or a fix.
3. Backwards solving can take several seconds ("Looking for an answer... Stop") with no progress hint; a quick check looks like a hang.
4. An input named `celsius` makes the palette offer `celsius(□)`, `celsius(□, □)`, `celsius(□, □, □)` as calls -- noisy and briefly confusing.
5. New program stays "Untitled 1" and keeps an empty `main` hole; the saved file is `untitled-1.json`. Minor.

## (5) Verdict
Finished (with one workaround outside the docs: `1` -> `1.0`).
