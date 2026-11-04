# A page that waits (C40 design, 2026-11-03)

**Decided** (Ersagun, 2026-11-04): (A) and (i). **Built** in the evaluator
(C40i): steps 1 to 3 and the test (ters/test/page-waits.test.ts). Step 4
**built** on the core IR (`lab build-web --core`), not as a generator
but with C137c22's continuations: a handler's type with Wait or Await
takes the rest of its run last (scalar.ts FType `waits`), and the world's
wait keeps that rest in its Pending, so html.ts lands the stretch and runs
the rest later as the evaluator's does (core-rt.ts `worldFn`; test
compiler/test/page-waits-core.test.ts). Not yet: compile.ts's pages (its
own way out, C137d), a main that waits on the core IR, and a wait inside
a search or `with fuel`, which are refused by name.

C40's last open piece: an event handler on a page that waits, as in
"click Save → show *saving…* → wait for the timer or the server → show
*saved*". Programs on the command line can do this already. There, `wait`
and `await` of a timer, a fetch or `any of(…)` are answered by the world
(#958), and compiled JavaScript runs a waiting definition as a generator
(ANSWERED-LATER.md step 2). A page can't. Its handler row, PAGE_HANDLER in
std.ts, has no `Wait` and no `Await`, and the browser's world refuses
`wait` ("a page can't wait; read now() in a part to animate"). The one
exception is `fetch text`. It throws Pending: the evaluator keeps the
handler's machine and goes on when the reply lands (L59,
`Pending.resume`), and compiled JS takes the handler back and runs it
again from the start.

The code isn't the hard part. The runtime pieces are mostly there, and
the open part is what a page *means* while a handler waits. That part is
Ersagun's to decide.

## The two questions

**Q1. What does the page show while a handler waits?** A handler today is
one step that can be taken back (cells.ts `attempt`). Nothing it writes
shows until it ends, and if it aborts, nothing it wrote stays.

- **(A) Each stretch shows as it ends.** The writes before a wait land,
  and the page draws them. The handler goes on when the wait is answered,
  and its next stretch is again one step that can be taken back. *saving…*
  shows. An abort after a wait takes back only the stretch it happened
  in. This is what an `async` handler does in a browser, in React and in
  Solid.
- **(B) Nothing shows until the handler ends.** The whole handler stays
  one step, kept aside while it waits. Simple to explain, but *saving…*
  can't be written, and the page looks frozen for the whole wait.
- **(C) Keep pages from waiting** (today), and point to `now()` in a view
  and to `fetch text`'s Pending. A page that saves to a server has no way
  to say "saving".

**Q2. A second event while the first handler waits?** For example, two
clicks on Save, 100 ms apart, with a 500 ms wait.

- **(i) Both run, taking turns at their waits.** Each event is a branch of
  one page-wide `together` (L71), so it is the language's own meaning of
  concurrency. A program that wants "the latest wins" writes it with
  `race`, or keeps a counter in a cell.
- **(ii) Queued, one per handler.** The second runs when the first ends.
  Safer for writes, but a slow wait blocks the button.
- **(iii) The latest wins.** The earlier one is dropped where it waits
  (RxJS's switchMap). A parked branch is a value, so dropping it is just
  forgetting it. But a default that silently drops work surprises people.

Views stay as they are: a view that waits keeps showing what it showed
until its answer comes (browser.ts, React's Suspense, Solid's
createResource).

## Recommendation: (A) and (i)

(A) is the only one that lets a page say what it is doing. It also keeps
the "one step that can be taken back" rule a handler has today: the step
just becomes the stretch between waits. (i) is not a new rule for pages.
It is `together`, which the language already has, with the page's events
as its branches. That fits Ersagun's "effects are the right base for
concurrency".

## Steps (after the decision)

1. **Language lane, std.ts:** add `Wait` and `Await` to PAGE_HANDLER.
   This is "a change to these two lines", as the comment there says, plus
   the note under Q1 for SPEC.md.
2. **The browser's world answers them** (browser.ts). A timer is a cell
   written by `setTimeout`, read before throwing Pending, the way a fetch
   is now. `wait(ms)` is `await(start timer(ms))`. `start fetch` runs in
   the background, which is L150b for the page.
3. **The evaluator** (html.ts): a handler's Pending lands the stretch
   before it (`attempt` commits), and `resume` runs the next stretch in an
   attempt of its own. Today a Pending takes back the whole run, so this is
   the change that makes (A).
4. **Compiled, on the core IR** (core-js.ts, core-page.ts): a handler whose
   row holds `Await` is printed as a generator (the copies C137c18 makes
   for deep recursion already drive one: `R.drive`). The page runtime runs
   each stretch in `cells.attempt` and goes on when the ticket is ready.
   compile.ts gets no new work, since C137 retires it.
5. **Test:** a page with Save (*saving…*, a 500 ms timer, *saved*), on the
   evaluator and the core IR, with a test clock, and with two clicks to
   check (i).

Prior art: async event handlers in the DOM, React's transitions and
Suspense, Solid's createResource, Elm's commands (Elm answers Q1 with (A)
by giving the update function back a command). Taking turns at waits is
Concurrent ML's, and the L71 `together` it's built on credits OCaml 5 and
Koka.
