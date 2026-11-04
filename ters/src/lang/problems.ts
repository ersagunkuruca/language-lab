// The checker's problems as one table (BACKLOG L187, BLIND-SPOTS-2026-11-03
// §8): an id, what the message says (a pattern over the checker's text,
// which stays in infer.ts), the usual fix in a sentence, and, where the
// editor has one, the gesture that makes it. test/problems.test.ts holds
// the smallest program that shows each, so a message that can no longer
// be reached, or that two rows both claim, fails there.
//
// Influences: Elm's "Compiler Errors for Humans" (Evan Czaplicki, 2015)
// and Rust's error index (`rustc --explain`).

export interface Problem {
  id: string;
  says: RegExp;
  fix: string;
  // The editor gesture that fixes it, when there is one.
  gesture?: string;
}

export const PROBLEMS: Problem[] = [
  { id: "wrong-type", says: /^(?!.* takes \d+ inputs: given one).+ needs .+ here, got .+$/, fix: "Give it a value of the type it names, or change what it's given to that type (a conversion such as as float64, or show for a text)." },
  { id: "wrong-count", says: /^.+ takes \d+ inputs?, given \d+$/, fix: "Give it as many inputs as it takes: drop the extra ones, or fill the missing ones." },
  { id: "not-a-function", says: /^.+ is .+, not a function$/, fix: "Only a function can be called: use the value as it is, or call a function that takes it." },
  { id: "fraction-at-int", says: /a number with a fraction part can't be (an Int|one)$/, fix: "Write a whole number, or turn a Float64 into an Int with whole part (or floor first)." },
  { id: "missing-case", says: /^no case for .+$/, fix: "Add an arm for each case named. A match can have an otherwise arm for the rest; a handler handles every operation of its effect." },
  { id: "case-twice", says: /^.+ is handled twice$/, fix: "Keep one arm for that case and remove the other." },
  { id: "not-a-case", says: /^.+ is not a case of .+$/, fix: "Match only the cases of the value's type; the case named belongs to another type." },
  { id: "fields-bound", says: /^.+ has \d+ fields?, \d+ bound$/, fix: "Bind one name for each of the case's fields, in order." },
  { id: "recursive-value", says: /is defined in terms of itself; only a function can be recursive$/, fix: "Make it a function (of no inputs, or of what changes each time round), or give it a value that doesn't use itself." },
  { id: "out-of-scope", says: /has no value here: it is used outside the function or case that introduces it$/, fix: "Use the name only inside the function or arm that binds it, or pass its value in as an input." },
  { id: "acts-under-choice", says: /while a Choice is open.*so it would act on paths that are later abandoned/, fix: "Handle the Choice first, with first, all, count or optional, and act on what it gives.", gesture: "Select the search, Wrap in…, then pick first or all." },
  { id: "number-not-wanted", says: /^.+ needs .+ here, and a number isn't one$/, fix: "A number can't go there: give a value of the type it names (show turns a number into a text)." },
  { id: "one-tuple-or-inputs", says: /^.+ takes \d+ inputs: given one, it needs .+ here, got .+$/, fix: "Give each input on its own, or pass a function that takes one tuple where one tuple is wanted." },
  { id: "not-an-operation", says: /^.+ is not an operation of .+$/, fix: "Handle only the effect's own operations: another effect's go to a handler further out, so drop that arm or handle it there." },
  { id: "answer-not-one", says: /^the answer to .+ must be one value, and this may give several or none/, fix: "An operation is answered once: wrap the case's answer in first or optional.", gesture: "Select the answer, Wrap in…, then pick first." },
  { id: "no-implementation", says: /^.+ isn't .+, and has no .+ of its own: give it one, a definition of type .+$/, fix: "Give the type its own operations: an implementation of the interface named (Arithmetic for + − ·, Ordered for <).", gesture: "Click the Implement … button under the message." },
];

// The row a message belongs to, if one does.
export const problemOf = (message: string): Problem | undefined => PROBLEMS.find((p) => p.says.test(message));
