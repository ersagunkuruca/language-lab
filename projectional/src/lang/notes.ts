// One plain sentence or two for each builtin and each std type, for
// someone meeting the language for the first time. The modules carry their
// own (prelude-source.ts, vectors-source.ts, html-source.ts); these join
// them in LIBRARY.comments, and LIBRARY.md (library/reference.ts) is
// printed from all of them.

import type { Comments } from "../presentation.ts";

const n = "Float64";
export const NOTES: Comments = {
  // --- std types
  "std.bool": "true or false. `if c then a else b` is a match on a Bool.",
  "std.unit": "The type with one value, unit: what an action that only does something gives back.",
  "std.list": "A list: nil (empty), or cons(head, tail), an item in front of a list. [1, 2, 3] is how one is written.",
  "std.pair": "Two values together: pair(fst, snd).",
  "std.optional": "A value that may be missing: none, or some(value). The data form of Choice, for keeping an answer that may not be there.",
  "std.abort": "An effect: abort(reason) stops the computation with a reason. A match with an abort(reason) case catches it, and attempt keeps it as an Outcome.",
  "std.log": "An effect: log(line) is debugging output. It can run anywhere, even inside a search; when nothing handles it the line goes to standard error (in a page, the browser's console).",
  "std.random": "An effect: random() is a Float64 from 0 up to (not including) 1. seeded(seed, action) answers it with the same numbers every time; with nothing around it, the world's randomness answers.",
  "std.time": "An effect: now() is the time in milliseconds since 1970. In a page, a part that reads it is drawn again every frame.",
  "std.wait": "An effect: wait(milliseconds) pauses the program. On the command line only: a page can't wait.",
  "std.event": "What a page's handler is given when its event comes: the field's value and the key pressed.",
  "std.input": "Where a sound's samples come from: the microphone, or a recording at an address.",
  "std.attribute": "Something attached to a page element: a property (name and value), an on(event, then) handler, or a sound to play when it's clicked.",
  "std.html": "A page: elements with attributes and children, text, and parts that are drawn again when what they read changes.",
  "std.tableEntry": "One line of an algebra's multiplication table: times(left, right, gives) says left · right is gives, for two basis elements. table product multiplies by a list of them.",
  "std.rational": "An exact fraction, top/bottom, always in lowest terms. The same + − · < work on it. Make one with fraction(1, 3) or as fraction(n); its constructor ratio is private to the library, which keeps the rule.",
  "std.algebraic": "An exact real number that solves a polynomial equation with whole-number coefficients, like √2 (x² = 2) or the golden ratio (x² = x + 1). Held by that equation and which of its roots it is, so √2 · √2 is exactly 2 and < always answers. The same + − · < work on it. Make one with square root, root, or as algebraic; digits shows as many digits as you ask for (EXACT-REALS.md).",
  "std.complex": "A complex number re + im·i, a record of two Float64s. The same + − · work on it (· is the complex product); it has no <.",
  "std.order": "What compare answers: before, same or after.",
  "std.outcome": "The result of something that may have been refused: done(value) or refused(reason). The data form of Abort, for keeping it in a list or record.",
  "std.map": "A map from keys to values, kept sorted by key with no key twice. Build one with empty map, as map or put (its constructor map of is private to the library, which keeps the rule); read it with value at.",
  "std.set": "A set of items, kept sorted with none twice. Build one with empty set, as set or add item (its constructor set of is private to the library, which keeps the rule).",

  // --- numbers. add, subtract, multiply, negate and less than work on
  // every number type through the generic ones; the versions at one type
  // are what they turn into once the type is known.
  "builtin.arith.add": "a + b, at any Number: Int, Float64, Rational, Algebraic, Complex (and records of Float64s through the vectors module).",
  "builtin.arith.sub": "a − b, at any Number.",
  "builtin.arith.mul": "a · b, at any Number. At Complex it's the complex product.",
  "builtin.arith.neg": "−a, at any Number.",
  "builtin.arith.less": "a < b, at any Number with < (not Complex).",
  "builtin.add": `a + b for ${n}s: what the generic + is at ${n}.`,
  "builtin.sub": `a − b for ${n}s: what the generic − is at ${n}.`,
  "builtin.mul": `a · b for ${n}s: what the generic · is at ${n}.`,
  "builtin.neg": `−a for a ${n}: what the generic − is at ${n}.`,
  "builtin.less": `a < b for ${n}s: what the generic < is at ${n}.`,
  "builtin.div": "a ÷ b for Float64s (floating point, so 1 ÷ 3 is 0.333…; dividing by 0 gives infinity). For exact division use fractions.",
  "builtin.sqrt": "The square root.",
  "builtin.pow": "a to the power b.",
  "builtin.sin": "Sine of an angle in radians.",
  "builtin.cos": "Cosine of an angle in radians.",
  "builtin.tan": "Tangent of an angle in radians.",
  "builtin.atan2": "The angle of the point (x, y) from the x axis, in radians: atan2(y, x).",
  "builtin.exp": "e to the power x.",
  "builtin.log": "The natural logarithm (the debugging effect is Log, a different thing).",
  "builtin.abs": "The size of a Float64 without its sign.",
  "builtin.floor": "The Float64 rounded down to a whole one, still a Float64. whole part gives an Int.",
  "builtin.float32": "The nearest Float64 a GPU can hold (32-bit floating point).",
  "builtin.mod": "The remainder of a ÷ b, never negative when b is positive: mod(−1, 3) is 2.",
  "builtin.show": "A Float64 as text: show(2.5) is \"2.5\".",
  "builtin.range": "The Float64s 0, 1, … up to n − 1, as a list.",
  "builtin.int.add": "a + b for Ints: what the generic + is at Int. Ints never overflow.",
  "builtin.int.sub": "a − b for Ints: what the generic − is at Int.",
  "builtin.int.mul": "a · b for Ints: what the generic · is at Int.",
  "builtin.int.neg": "−a for an Int: what the generic − is at Int.",
  "builtin.int.abs": "The size of an Int without its sign.",
  "builtin.int.less": "a < b for Ints: what the generic < is at Int.",
  "builtin.int.quotient": "a ÷ b rounded down to a whole number. No answer (Choice) when b is 0.",
  "builtin.int.remainder": "What's left of a after quotient(a, b) times b; it has b's sign. No answer when b is 0.",
  "builtin.int.power": "a to the power b for Ints. No answer when b is negative.",
  "builtin.int.lowestTerms": "Both divided by their greatest common divisor, the second made positive: how a fraction is kept.",
  "builtin.int.show": "An Int as text.",
  "builtin.int.read": "The Int a text spells, like \"42\". No answer when it isn't one.",
  "builtin.int.toNumber": "The Int as a Float64.",
  "builtin.int.wholePart": "The Float64 rounded down, as an Int: whole part(2.7) is 2. No answer for infinity or not-a-number.",
  "builtin.int.range": "The Ints 0, 1, … up to n − 1, as a list.",
  "builtin.algebraic.add": "a + b for Algebraic numbers, exactly: what the generic + is at Algebraic.",
  "builtin.algebraic.sub": "a − b for Algebraic numbers, exactly: what the generic − is at Algebraic.",
  "builtin.algebraic.mul": "a · b for Algebraic numbers, exactly: √2 · √2 is 2. What the generic · is at Algebraic.",
  "builtin.algebraic.neg": "−a for an Algebraic number: what the generic − is at Algebraic.",
  "builtin.algebraic.less": "a < b for Algebraic numbers. It always answers: two different algebraic numbers can always be told apart.",
  "builtin.algebraic.divide": "a ÷ b exactly. No answer (Choice) when b is 0.",
  "builtin.algebraic.root": "The real k-th root: root(8, 3) is 2, root(2, 2) is √2. For an even k the positive one, and no answer (Choice) for a negative number.",
  "builtin.algebraic.sqrt": "The positive square root, exactly: square root(2) is √2, the root of x² − 2 between 1 and 2. No answer (Choice) for a negative number.",
  "builtin.algebraic.fraction": "top/bottom as an Algebraic number: what a literal at Algebraic becomes. Not offered: as algebraic is.",
  "builtin.algebraic.ofRational": "A fraction as an Algebraic number.",
  "builtin.algebraic.asFraction": "The fraction an Algebraic number is, when it is one: as fraction(√2 · √2) is 2. No answer (Choice) for √2.",
  "builtin.algebraic.digits": "The first n digits after the point, cut off, worked out exactly: digits(√2, 5) is \"1.41421\". As many as asked for.",
  "builtin.algebraic.toNumber": "The nearest Float64.",
  "builtin.algebraic.show": "An Algebraic number as text: 2 or 1/3 when it is a fraction, √2 or −√2 for those, else its first ten digits and an ellipsis.",

  // --- true and false, equality, order
  "builtin.equal": "Whether two values are the same: numbers, text, and data made of them. Functions can't be compared.",
  "builtin.and": "Both true.",
  "builtin.or": "Either true.",
  "builtin.not": "true becomes false and false true.",
  "builtin.compare": "How two values are ordered: before, same or after. Float64s by value, exactly (unlike equal, which lets two Float64s within about 1e-9 be equal), with NaN after every other Float64; text alphabetically; cases in the order their type lists them; then field by field. sort, maps and sets use it.",
  "builtin.showAny": "Any plain value as text, the way it would be written: show([1, 2]) is \"[1, 2]\".",

  // --- text
  "builtin.concat": "Two texts one after the other.",
  "builtin.text.length": "How many characters a text has.",
  "builtin.text.slice": "The characters from position from up to (not including) to, counting from 0.",
  "builtin.text.characters": "The text as a list of its characters.",
  "builtin.text.split": "The pieces of a text between each occurrence of a separator.",
  "builtin.text.joinAll": "The texts with a separator between each two.",
  "builtin.text.find": "Each position where part occurs in the text: several answers, or none (Choice).",
  "builtin.text.less": "Whether one text comes before another alphabetically (by character code).",
  "builtin.text.code": "The character's number (its Unicode code point). No answer unless the text is one character.",
  "builtin.text.fromCode": "The character with this number. No answer when there's none.",

  // --- searching: Choice
  "builtin.oneOf": "Any item of the list: a Choice with one answer per item. all, first or count decide what to do with them.",
  "builtin.fail": "No answer. In a search it drops this path.",
  "builtin.all": "Every answer a search gives, as a list. The search's Choice ends here.",
  "builtin.count": "How many answers a search gives.",
  "builtin.first": "The first answer a search gives, or the default when it gives none.",
  "builtin.optional": "The first answer as some(answer), or none.",
  "builtin.valueOf": "The value in some(value); no answer for none. optional run backwards.",
  "builtin.hence": "a hence b is a and b, read as \"b follows from a\": the solver uses b to find answers but doesn't count it as a separate condition.",
  "builtin.exists": "Whether some value makes the function true: the solver looks for one. Used in relations, where a value has no name outside.",
  "builtin.fuel": "Runs something that might not finish, allowing it n steps; if it hasn't finished by then, there's no answer. That turns Diverge into Choice.",

  // --- randomness
  "builtin.seeded": "Runs the action with its random() calls answered by a generator started from the seed: the same numbers every time for the same seed. The action's Random ends here.",

  // --- calculus and records of Float64s
  "builtin.derivative": "The slope of a function of one Float64, as a function. Where a slope can't be read there's no answer (Choice).",
  "builtin.gradient": "For a function of a record of Float64s (a point, a colour), the record of its slopes along each part.",
  "builtin.mapParts": "A function applied to each part of a record of Float64s: map parts(f, vec(x, y)) is vec(f(x), f(y)).",
  "builtin.zipParts": "A function applied to each pair of parts of two records of the same type.",
  "builtin.total": "The parts of a record of Float64s added up.",
  "builtin.set": "The record with one field changed and the others kept: set((p) => p.x, point, 3). The field can be a path, like (p) => p.home.city.",

  // --- the world
  "builtin.print": "Writes a line of text to the console.",
  "builtin.io.printError": "Writes a line to standard error.",
  "builtin.io.readInput": "The rest of what was typed into the program (standard input), as one text.",
  "builtin.io.readLine": "The next line typed in, or none at the end.",
  "builtin.io.readFile": "The text in a file. Aborts if it can't be read.",
  "builtin.io.writeFile": "Writes text to a file, replacing what was there.",
  "builtin.io.appendFile": "Adds text to the end of a file.",
  "builtin.io.fileExists": "Whether there's a file at this path.",
  "builtin.io.listFolder": "The names of the files in a folder.",
  "builtin.io.fetchText": "The text at a web address. Aborts if the request fails.",

  // --- cells: values that change, for pages
  "builtin.cells.cell": "A new cell holding a starting value: a value a page can change, and whose readers are redrawn when it does.",
  "builtin.cells.formula": "A cell whose value is computed from other cells, and kept up to date when they change.",
  "builtin.cells.each": "A cell holding f of each item of a list cell, where an item that stays keeps what f gave it.",
  "builtin.cells.read": "What a cell holds now. A page part that reads it is redrawn when it changes.",
  "builtin.cells.write": "Puts a new value in a cell. Only event handlers can write.",
};
