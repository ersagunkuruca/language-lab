# crew

GAPS.md round 11's program (docs/reports/GAPS.md): a plan of tasks run by
a crew of workers in simulated minutes.

```
lab run compiler/gaps/crew plan.txt
```

A plan has one task per line, its minutes and what it waits for
(`test 6 after compile-core compile-ui`), and may say how many workers
there are (`workers 3`; 2 if it doesn't). `#` starts a comment. crew:

1. reads and checks the plan (whole numbers, no task twice, no unknown
   task, no cycle), and says which line is wrong;
2. sorts the tasks so each comes after what it waits for (Kahn's
   algorithm, the free tasks taken by name);
3. finds each task's earliest start and its tail with the critical path
   method's forward and backward passes, and prints the critical path and
   every task's slack;
4. runs the plan with the crew. **Each worker is a fiber**: a loop that
   asks for its next job, spends the minutes and says the task is done,
   through the `Work` effect, whose operations are answered later. The
   scheduler is written in the language too: `fiber` runs a worker until
   it performs, and hands back a `Step` with the rest of its run; the
   floor keeps the idle workers' rests and a timer for each spending one,
   and moves the clock to the next timer. Ready tasks are handed out by
   rank: the longest tail first, or by their line in the file;
5. prints the run's log, how busy each worker was, and a table of crews
   of 1 to n+2 workers, both ways of ranking, against the lower bound
   (the critical path, or the work shared out evenly).

Usage errors exit with 2, a bad plan with 1 and `crew: …` on stderr.

The program was generated once with the DSL (its build script is in the
project's files, `gaps-round11/build.ts`); `code.json` is the source.

## Credits

- The topological sort is A. B. Kahn's, "Topological sorting of large
  networks", *Communications of the ACM* 5(11), 1962.
- The forward and backward passes are the critical path method of James
  E. Kelley Jr. and Morgan R. Walker, "Critical-path planning and
  scheduling", Eastern Joint Computer Conference, 1959.
- Handing ready tasks out longest tail first is list scheduling with
  highest-level-first priorities: T. C. Hu, "Parallel sequencing and
  assembly line problems", *Operations Research* 9(6), 1961, and R. L.
  Graham, "Bounds for certain multiprocessing anomalies", *Bell System
  Technical Journal* 45(9), 1966.
- The fibers driven by a scheduler that resumes their rests follow the
  scheduler of Ters's own `later` tests (ters/test/later.test.ts), after
  the cooperative threads of effect handlers papers (Dolan et al.,
  "Concurrent system programming with effect handlers", TFP 2017).

The program, the plan and the ideal JavaScript are written fresh.
