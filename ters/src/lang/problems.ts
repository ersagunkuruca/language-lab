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
  { id: "wrong-type", says: /^(?!.* takes \d+ inputs: given one).+ needs .+ here, got .+$|^(.+: )?expected .+, got .+$/, fix: "Give it a value of the type it names, or change what it's given to that type (a conversion such as as float64, or show for a text)." },
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
  { id: "no-implementation", says: /(^.+ isn't .+, and has no .+ of its own|^a number written where .+ goes needs .+'s own from fraction, since it isn't a record of Float64s|^.+ has no .+): give it one, a definition of type .+$/, fix: "Give the type its own operations: an implementation of the interface named (Arithmetic for + − ·, Ordered for <, Literal for a number written where it goes).", gesture: "Click the Implement … button under the message." },
  { id: "fields-type-unknown", says: /^fields (mapped|listed) needs (the value's data type|the fields' type) known here/, fix: "Use it where the value's type is known: in a definition whose input has a type of its own (pin it), not one that takes any value." },
  { id: "json-type-unknown", says: /^(json of|from json) writes the value by its type, and /, fix: "Give it a value whose type is known there, or use it where the type wanted is known (a definition's pinned type); a function or an effect has no spelling." },
  { id: "private-to-library", says: /^.+ is private to the library, which keeps /, fix: "Make the value with the library's own functions, the ones the message names: they keep the rule the private case would let you break (a Rational in lowest terms, a file open only while its body runs)." },
  { id: "unhandled-effect", says: /performs .+, which nothing here handles$/, fix: "Handle the effect around it with a handler for its operations, or make the definition a function (of no inputs) so whoever calls it handles it." },
  { id: "no-cases", says: /^a case analysis needs at least one case$/, fix: "Add an arm for one of the value's cases, or an otherwise arm." },
  { id: "not-a-number", says: /^(.+: )?.+ isn't a Number \(Int, Rational, Float64, Fixed, Complex, or one case whose fields are all Float64s\)$/, fix: "Only a number goes there, something + − · work on: give it one, or make every part that must agree with it (the other arms, the other side) the same type." },
  { id: "functions-in-data", says: /(works only on plain data \(no functions inside\), and this has functions in it|has functions in it, and only plain data can be used here)$/, fix: "Functions can't be compared or written out: compare or keep the data they were made from (a name, a case) instead of the function." },
  { id: "no-port", says: /^.+ has no port .+$/, fix: "Give or ask only the ports the function has: its inputs, and out for what it gives." },
  { id: "needs-more-ports", says: /^.+ needs \d+ more known ports? to be solved this way$/, fix: "Give more of its ports a value (an input, or out), so the rest can be found from them." },
  { id: "not-backwards", says: /(^[^ ]+ can't be run backwards|, and a function that acts can't be run backwards)$/, fix: "Solve a function written from relations and with no effects: a value can't be run backwards, and an action (print, read) would act once per guess, so call it forwards instead." },
  { id: "field-of-one-case", says: /^.+ belongs to one case of .+; use a match to reach it, or say in the other cases that their field is the same one$/, fix: "Match on the value and read the field in the arm of the case that has it, or give every case the field (a shared field) so it can be read from any of them." },
  { id: "not-folded", says: /^.+ is not recursive, so it has no folded value$/, fix: "Only a field that holds the type itself (a list's rest, a tree's branches) has a folded value: name a result only for those, or use a match." },
  { id: "effect-folded", says: /^.+ is an effect; its operations are handled with a match, not folded$/, fix: "Handle the effect with a handler, whose cases match its operations, instead of a fold." },
  { id: "too-many-results", says: /^a function gives at most \d+ results$/, fix: "Give at most 8 results: put the others together in a type with one case, and give that." },
  { id: "results-not-predicate", says: /^.+ has results, so it is (a function of its ports|a predicate over its ports \(it gives true or false\), not .+)$/, fix: "A definition with results is a relation over its ports: write it as a function of all of them that says whether they agree (true or false), or take its results off and let it give its value." },
  { id: "takes-itself", says: /^.+ can't take itself as an input in its own field .+: through it, a function could call itself without recursion and never end$/, fix: "A field may hold a function that gives the type, not one that takes it: give the function the parts it reads instead, or keep the function outside the type." },
  { id: "not-an-effect", says: /^.+ is not an effect$/, fix: "Name only effects among what a function type may do (an effect, or a row its type takes): a type of values goes in its inputs or result instead." },
  { id: "one-row-parameter", says: /^a function type in data can take one row parameter, not .+$/, fix: "Let the function type take one row parameter, and put the effects the others stood for in that one row." },
  { id: "case-never-runs", says: /^every case is already handled, so this one can never run$/, fix: "Remove the otherwise arm: the arms before it already cover every case of the type." },
  { id: "needs-otherwise", says: /^a choice by value needs a case for every other value$/, fix: "Add an otherwise arm for the values no case names: no list of numbers or texts is all of them." },
  { id: "one-implementation", says: /^.+ and .+ are both .+: a type has one implementation of an interface, so keep one$/, fix: "Keep one of the two definitions and delete the other, or give the other a different type; a program that wants a second way calls it by its own name." },
  { id: "int-divide", says: /^Int has no divide: /, fix: "Divide Ints with quotient and remainder, or make them a Float64 (as float64) or a fraction (as fraction) first." },
  { id: "value-case-not-value", says: /^this match chooses by value, so each case is a value: a number or a text$/, fix: "Write each case as a number or a text the value is compared with; to choose by a value's case (true, some, a case of your type) match on its cases instead." },
  { id: "release-given-something", says: /^a release is given nothing: release → …$/, fix: "Take the names off the release arm: it runs on every exit, with nothing to be given." },
  { id: "release-acts", says: /^a release runs on every exit, so it may only log: this one performs .+$/, fix: "Let the release only log (or close a file the library keeps open); do anything else after the handler, or in its normal finish." },
  { id: "resumed-twice", says: /^this resumes the rest of .+ a second time: the rest runs once, so resume it on one path only$/, fix: "Resume the rest once on each path: keep the value the first resume gives and use it, instead of resuming again." },
  { id: "finish-not-function", says: /^a handler's normal finish is a function written in place, given the computation's value: done\(x\) → …$/, fix: "Write the handler's otherwise arm as a function of the computation's value, done(x) → …, or take it off to give that value as it is." },
  { id: "later-case-chooses", says: /^this case may give several answers or none, so it could resume the rest of .+ more than once: handle the Choice here/, fix: "The rest of the computation runs once: wrap the search in the case in first or optional, and resume the rest with the one answer it gives.", gesture: "Select the search, Wrap in…, then pick first." },
  { id: "release-lets-choice", says: /^a handler with a release can't let a Choice through, since a search could leave it and come back after the release/, fix: "Handle the Choice inside the handler, around the search (first, all, count or optional), so nothing comes back after the release has run.", gesture: "Select the search, Wrap in…, then pick first or all." },
  { id: "embedding-open", says: /^.+ is an embedding, so both its types are known ones: .+ leaves one open$/, fix: "Pin the embedding's map to the two types it goes between (an input of a known type, a result of another), so it can be found where one is given for the other." },
  { id: "embedding-not-record", says: /^.+ is an embedding, so it is written as the record itself: embedding\(map: …\)$/, fix: "Write the definition as embedding(map: …) directly, with the map in place, not computed or passed through a let." },
  { id: "embedding-itself", says: /^.+ embeds .+ in itself: an embedding goes from one type into another$/, fix: "An embedding goes between two different types: a map from a type to itself is a plain function, so take embedding off and call it by its name." },
  { id: "embedding-twice", says: /^.+ and .+ both embed .+ in .+: a type goes into another one way, so keep one/, fix: "Keep one embedding for the pair: delete this one, or take embedding off it and call it by its name where you want that way." },
  { id: "implementation-not-record", says: /^.+ is an implementation of .+, so it is written as the record itself: .+\(…\) with each operation$/, fix: "Write the implementation as the interface's record directly, with each operation in place, not computed or passed through a let." },
  { id: "set-not-field", says: /^set needs a field here, a path of fields such as /, fix: "Give set the field to change, (p) ↦ p.address.city, or a function that reads the record only through its fields; a function that ignores the record has nothing to set." },
  { id: "path-not-field", says: /^path needs a field here, a path of fields such as /, fix: "Give path a function that reads fields one after another, (t) ↦ t.address.city, or (t) ↦ t for the whole." },
  { id: "results-unreachable", says: /^.+'s results can't all be found from .+: .+$/, fix: "Write the relation so each result is found from the other ports: an equation for it (b = a + 1) rather than a test such as <, which has many answers or none." },
  { id: "effect-as-type", says: /^.+ is an effect, not a type of values$/, fix: "An effect names what a function may do, not a value: put it among a function type's effects, (…) -[Ask]-> …, or use a type of values here." },
  { id: "interface-shape", says: /^.+ is an interface: it takes one type and has one case, its operations$/, fix: "Give the interface one type parameter and one case whose fields are its operations; a second type goes in the operations' own types." },
  { id: "operation-not-function", says: /^.+ is an operation of the interface .+, so its type is a function$/, fix: "Give the operation a function type over the interface's type, (a) -> Float64; a constant is a function of no inputs, () -> a." },
  { id: "fraction-literal", says: /^.+ isn't a fraction: write a whole number, or top\/bottom with the bottom not 0$/, fix: "Write the fraction as top/bottom with whole numbers and a bottom that isn't 0, such as 3/4, or a whole number." },
  { id: "number-literal", says: /^.+ isn't a number$/, fix: "Write a number here, such as 2 or 0.5." },
  { id: "type-as-value", says: /^.+ is a type, not a value$/, fix: "A type says what values look like and can't be used as one: use one of its cases, or a value of that type." },
];

// The row a message belongs to, if one does.
export const problemOf = (message: string): Problem | undefined => PROBLEMS.find((p) => p.says.test(message));
