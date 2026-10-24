# The library

Everything a program can use without writing it, by topic: its type and what it does. Printed by `node library/reference.ts` from the notes in src/lang/notes.ts and the modules' comments; LANGUAGE.md explains the ideas.

How to read a type: `(Number, Number) -> Number` takes two Numbers and gives one. Effects go in the arrow: `() -[Random]-> Number` takes nothing, may draw random numbers, and gives a Number. A small letter (`a`, `b`) is any type, the same one wherever the letter appears in that type; `List a` is a list of anything. A name with no arrow (`i : Complex`) is a value.

## Numbers

There are four kinds of number. Int is a whole number of any size. Number is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Complex is re + im·i. One + − · < works on all of them, and the checker works out which kind you mean. Each literal has one kind: 3 is a Number unless it is written as an Int, a fraction like 1/2, or a Complex. Kinds never mix by themselves: as number turns an Int into a Number, whole part goes back, and as fraction and as complex turn into the others. The versions "at Number" and "at Int" are what the one + turns into once the kind is known, so the palette offers the one +.

- **add** : `(a, a) -> a`. a + b, at any number type: Int, Number, Rational, Complex (and records of Numbers through the vectors module).
- **subtract** : `(a, a) -> a`. a − b, at any number type.
- **multiply** : `(a, a) -> a`. a · b, at any number type. At Complex it's the complex product.
- **negate** : `(a) -> a`. −a, at any number type.
- **less than** : `(a, a) -> Bool`. a < b, at any ordered number type (not Complex).
- **at most** : `(a, a) -> Bool`. a ≤ b: not b < a.
- **more than** : `(a, a) -> Bool`. a > b: b < a.
- **at least** : `(a, a) -> Bool`. a ≥ b: not a < b.
- **smaller** : `(a, a) -> a`. The smaller of two numbers (min); a shader's min.
- **larger** : `(a, a) -> a`. The larger of two numbers (max); a shader's max.
- **divide** : `(Number, Number) -> Number`. a ÷ b for Numbers (floating point, so 1 ÷ 3 is 0.333…; dividing by 0 gives infinity). For exact division use fractions.
- **sqrt** : `(Number) -> Number`. The square root.
- **power** : `(Number, Number) -> Number`. a to the power b.
- **sin** : `(Number) -> Number`. Sine of an angle in radians.
- **cos** : `(Number) -> Number`. Cosine of an angle in radians.
- **tan** : `(Number) -> Number`. Tangent of an angle in radians.
- **atan2** : `(Number, Number) -> Number`. The angle of the point (x, y) from the x axis, in radians: atan2(y, x).
- **exp** : `(Number) -> Number`. e to the power x.
- **log** : `(Number) -> Number`. The natural logarithm (the debugging effect is Log, a different thing).
- **abs** : `(Number) -> Number`. The size of a Number without its sign.
- **floor** : `(Number) -> Number`. The Number rounded down to a whole one, still a Number. whole part gives an Int.
- **mod** : `(Number, Number) -> Number`. The remainder of a ÷ b, never negative when b is positive: mod(−1, 3) is 2.
- **round to Float32** : `(Number) -> Number`. The nearest Number a GPU can hold (32-bit floating point).
- **show** : `(Number) -> Text`. A Number as text: show(2.5) is "2.5".
- **range** : `(Number) -> List Number`. The Numbers 0, 1, … up to n − 1, as a list.
- **quotient** : `(Int, Int) -[Choice]-> Int`. a ÷ b rounded down to a whole number. No answer (Choice) when b is 0.
- **remainder** : `(Int, Int) -[Choice]-> Int`. What's left of a after quotient(a, b) times b; it has b's sign. No answer when b is 0.
- **power** : `(Int, Int) -[Choice]-> Int`. a to the power b for Ints. No answer when b is negative.
- **lowest terms** : `(Int, Int) -> Pair Int Int`. Both divided by their greatest common divisor, the second made positive: how a fraction is kept.
- **read whole number** : `(Text) -[Choice]-> Int`. The Int a text spells, like "42". No answer when it isn't one.
- **as number** : `(Int) -> Number`. The Int as a Number.
- **whole part** : `(Number) -[Choice]-> Int`. The Number rounded down, as an Int: whole part(2.7) is 2. No answer for infinity or not-a-number.
- **abs** : `(Int) -> Int`. The size of an Int without its sign.
- **show** : `(Int) -> Text`. An Int as text.
- **range** : `(Int) -> List Int`. The Ints 0, 1, … up to n − 1, as a list.
- **Rational** (type). An exact fraction, top/bottom, always in lowest terms. The same + − · < work on it. Make one with fraction(1, 3) or as fraction(n).
- **fraction** : `(Int, Int) -[Choice]-> Rational`. top/bottom, exactly, in lowest terms (Euclid's algorithm, textbook); no answer when bottom is 0.
- **as fraction** : `(Int) -> Rational`. The whole number n as a fraction, n/1.
- **divide fractions** : `(Rational, Rational) -[Choice]-> Rational`. a ÷ b for fractions, exactly; no answer when b is 0.
- **show fraction** : `(Rational) -> Text`. A fraction as 3/4, or 3 when it is whole.
- **fraction as number** : `(Rational) -> Number`. The nearest Number.
- **Complex** (type). A complex number re + im·i, a record of two Numbers. The same + − · work on it (· is the complex product); it has no <.
- **as complex** : `(Number) -> Complex`. The Number x as a complex number, x + 0i.
- **i** : `Complex`. i, the square root of −1: i · i is −1.
- **complex conjugate** : `(Complex) -> Complex`. a − bi for a + bi: the same point mirrored across the real line. z · conjugate(z) is |z|².
- **modulus** : `(Complex) -> Number`. |z|, how far z is from 0 (the vectors module's magnitude says the same).
- **angle of** : `(Complex) -> Number`. The angle from the positive real line to z, in radians, between −π and π (atan2).
- **polar** : `(Number, Number) -> Complex`. The complex number size away from 0 at this angle: size·(cos angle + i sin angle).
- **divide complex** : `(Complex, Complex) -[Choice]-> Complex`. z ÷ w for complex numbers; no answer when w is 0.
- **complex exp** : `(Complex) -> Complex`. e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.
- **show complex** : `(Complex) -> Text`. A complex number as 3 + 4i or 3 − 4i.
- **add** : `(Number, Number) -> Number`. a + b for Numbers: what the generic + is at Number.
- **subtract** : `(Number, Number) -> Number`. a − b for Numbers: what the generic − is at Number.
- **multiply** : `(Number, Number) -> Number`. a · b for Numbers: what the generic · is at Number.
- **negate** : `(Number) -> Number`. −a for a Number: what the generic − is at Number.
- **less than** : `(Number, Number) -> Bool`. a < b for Numbers: what the generic < is at Number.
- **add** : `(Int, Int) -> Int`. a + b for Ints: what the generic + is at Int. Ints never overflow.
- **subtract** : `(Int, Int) -> Int`. a − b for Ints: what the generic − is at Int.
- **multiply** : `(Int, Int) -> Int`. a · b for Ints: what the generic · is at Int.
- **negate** : `(Int) -> Int`. −a for an Int: what the generic − is at Int.
- **less than** : `(Int, Int) -> Bool`. a < b for Ints: what the generic < is at Int.

## True and false, sameness and order

- **Bool** (type). true or false. `if c then a else b` is a match on a Bool.
- **and** : `(Bool, Bool) -> Bool`. Both true.
- **or** : `(Bool, Bool) -> Bool`. Either true.
- **not** : `(Bool) -> Bool`. true becomes false and false true.
- **equal** : `(a, a) -> Bool`. Whether two values are the same: numbers, text, and data made of them. Functions can't be compared.
- **compare** : `(a, a) -> Order`. How two values are ordered: before, same or after. Numbers by value, text alphabetically, cases in the order their type lists them, then field by field. sort uses it.
- **Order** (type). What compare answers: before, same or after.
- **show** : `(a) -> Text`. Any plain value as text, the way it would be written: show([1, 2]) is "[1, 2]".

## Text

Text is a string of characters. Positions count from 0.

- **join text** : `(Text, Text) -> Text`. Two texts one after the other.
- **length** : `(Text) -> Int`. How many characters a text has.
- **slice** : `(Text, Int, Int) -> Text`. The characters from position from up to (not including) to, counting from 0.
- **characters** : `(Text) -> List Text`. The text as a list of its characters.
- **split** : `(Text, Text) -> List Text`. The pieces of a text between each occurrence of a separator.
- **join all** : `(List Text, Text) -> Text`. The texts with a separator between each two.
- **find** : `(Text, Text) -[Choice]-> Int`. Each position where part occurs in the text: several answers, or none (Choice).
- **comes before** : `(Text, Text) -> Bool`. Whether one text comes before another alphabetically (by character code).
- **character code** : `(Text) -[Choice]-> Int`. The character's number (its Unicode code point). No answer unless the text is one character.
- **character** : `(Int) -[Choice]-> Text`. The character with this number. No answer when there's none.
- **not after** : `(Text, Text) -> Bool`. Text a ≤ b: a comes before b or is b.
- **comes after** : `(Text, Text) -> Bool`. Text a > b: b comes before a.
- **not before** : `(Text, Text) -> Bool`. Text a ≥ b: b comes before a or is a.

## Lists and pairs

A list is written [1, 2, 3]. There are no loops: map, keep and for each go through a list, and fold (a construct, not a function) walks any data.

- **List** (type). A list: nil (empty), or cons(head, tail), an item in front of a list. [1, 2, 3] is how one is written.
- **Pair** (type). Two values together: pair(fst, snd).
- **Unit** (type). The type with one value, unit: what an action that only does something gives back.
- **map** : `(List a, (a) -[e]-> b) -[e]-> List b`. The list of f(item) for each item, in the same order.
- **for each** : `(List a, (a) -[e]-> b) -[e]-> Unit`. Runs the action on each item of the list in turn, for what it does (prints, writes a cell).
- **keep** : `(List a, (a) -[Choice]-> Bool) -> List a`. filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.
- **length** : `(List a) -> Int`. How many items the list has.
- **sum** : `(List Number) -> Number`. The Numbers of the list added up; 0 for an empty list.
- **append** : `(List a, List a) -> List a`. The items of the first list, then the items of the second.
- **reverse** : `(List a) -> List a`. The list back to front.
- **sort** : `(List a) -> List a`. The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.
- **show numbers** : `(List Number) -> Text`. A fold that prints. Run backwards it unfolds, so it parses.

## Maps and sets

A map is kept sorted by key, so two maps with the same entries are equal and print the same, whatever order they were built in.

- **Map** (type). A map from keys to values, kept sorted by key with no key twice. Build one with as map or put; read it with value at.
- **empty map** : `Map a b`. The map with no entries.
- **as map** : `(List (Pair a b)) -> Map a b`. The map of a list of pair(key, value); when a key comes twice, the later pair wins. Keys are kept in compare's order, so a map has one spelling and folds go in key order (Haskell's Data.Map, Rust's BTreeMap).
- **put** : `(Map a b, a, b) -> Map a b`. The map with key holding value, in place of what it held.
- **value at** : `(Map a b, a) -[Choice]-> b`. What key holds; no answer when the map hasn't got it, so first(value at(m, k), else d) gives a default.
- **remove key** : `(Map a b, a) -> Map a b`. The map without key.
- **has key** : `(Map a b, a) -> Bool`. Whether the map holds key.
- **merge maps** : `(Map a b, Map a b) -> Map a b`. The entries of both maps; where both hold a key, the second's value wins.
- **keys of** : `(Map a b) -> List a`. The keys, in order.
- **values of** : `(Map a b) -> List b`. The values, in the order of their keys.
- **entries of** : `(Map a b) -> List (Pair a b)`. The entries as pair(key, value), in key order.
- **map size** : `(Map a b) -> Int`. How many keys the map holds.
- **Set** (type). A set of items, kept sorted with none twice. Build one with as set or add item.
- **empty set** : `Set a`. The set with no items.
- **as set** : `(List a) -> Set a`. The set of a list's items: in compare's order, each once.
- **add item** : `(Set a, a) -> Set a`. The set with item in it.
- **remove item** : `(Set a, a) -> Set a`. The set without item.
- **has item** : `(Set a, a) -> Bool`. Whether the set has item.
- **set union** : `(Set a, Set a) -> Set a`. The items in either set.
- **set intersection** : `(Set a, Set a) -> Set a`. The items in both sets.
- **set difference** : `(Set a, Set a) -> Set a`. The items of the first set that aren't in the second.
- **items of** : `(Set a) -> List a`. The items, in order.
- **set size** : `(Set a) -> Int`. How many items the set has.

## Searching: Choice

A computation with the Choice effect may have no answer, one, or several, like a search. one of picks any item, fail drops a path, and all, first, count and optional decide what to do with the answers, which ends the Choice. A function that may have no answer (value at, find, divide fractions) has Choice too, so first(() => value at(m, k), () => 0) gives a default.

- **one of** : `(List a) -[Choice]-> a`. Any item of the list: a Choice with one answer per item. all, first or count decide what to do with them.
- **fail** : `() -[Choice]-> a`. No answer. In a search it drops this path.
- **all** : `(() -[Choice, e]-> a) -[e]-> List a`. Every answer a search gives, as a list. The search's Choice ends here.
- **first** : `(() -[Choice]-> a, () -[e]-> a) -[e]-> a`. The first answer a search gives, or the default when it gives none.
- **count** : `(() -[Choice, e]-> a) -[e]-> Number`. How many answers a search gives.
- **optional** : `(() -[Choice, e]-> a) -[e]-> Optional a`. The first answer as some(answer), or none.
- **value of** : `(Optional a) -[Choice]-> a`. The value in some(value); no answer for none. optional run backwards.
- **Optional** (type). A value that may be missing: none, or some(value). The data form of Choice, for keeping an answer that may not be there.
- **with fuel** : `(Number, () -[Diverge, e]-> a) -[Choice, e]-> a`. Runs something that might not finish, allowing it n steps; if it hasn't finished by then, there's no answer. That turns Diverge into Choice.
- **hence** : `(Bool, Bool) -> Bool`. a hence b is a and b, read as "b follows from a": the solver uses b to find answers but doesn't count it as a separate condition.
- **for some** : `((a) -[e]-> Bool) -[e]-> Bool`. Whether some value makes the function true: the solver looks for one. Used in relations, where a value has no name outside.
- **inverse** : `((a) -[e]-> b, b) -[Choice, Diverge, e]-> a`. The x that f takes to y: f run backwards, for any function value f. Several answers are a Choice, as with solve; a function that acts (prints, writes a cell) is refused when it's run.
- **conjugate** : `((a) -[Choice, Diverge, e]-> b, (b) -[Choice, Diverge, e]-> b) -> (a) -[Choice, Diverge, e]-> a`. g done in f's space: f, then g, then f run backwards (f⁻¹ ∘ g ∘ f). An edit in linear light, a turn about a point, a filter on one band of a signal.

## When something goes wrong: Abort and Outcome

abort(reason) stops with a reason, and its type says so (Abort). attempt catches it as data.

- **Abort** (type). An effect: abort(reason) stops the computation with a reason. A match with an abort(reason) case catches it, and attempt keeps it as an Outcome.
- **Outcome** (type). The result of something that may have been refused: done(value) or refused(reason). The data form of Abort, for keeping it in a list or record.
- **attempt** : `(() -[Abort, e]-> a) -[e]-> Outcome a`. The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).
- **value or abort** : `(Outcome a) -[Abort]-> a`. The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.

## Effects from outside the program

Each of these puts its effect in the type of every function that uses it, so `die : () -[Random]-> Number` says die draws random numbers. Something around it handles the effect: seeded handles Random, a page's button handles what its handler does, and what nothing handles, the world answers when the program runs.

- **Random** (type). An effect: random() is a Number from 0 up to (not including) 1. seeded(seed, action) answers it with the same numbers every time; with nothing around it, the world's randomness answers.
- **seeded** : `(Number, () -[Random, e]-> a) -[e]-> a`. Runs the action with its random() calls answered by a generator started from the seed: the same numbers every time for the same seed. The action's Random ends here.
- **Time** (type). An effect: now() is the time in milliseconds since 1970. In a page, a part that reads it is drawn again every frame.
- **Wait** (type). An effect: wait(milliseconds) pauses the program. On the command line only: a page can't wait.
- **Log** (type). An effect: log(line) is debugging output. It can run anywhere, even inside a search; when nothing handles it the line goes to standard error (in a page, the browser's console).
- **print** : `(Text) -[Console]-> Unit`. Writes a line of text to the console.
- **print error** : `(Text) -[Console]-> Unit`. Writes a line to standard error.
- **read input** : `() -[Console, Abort]-> Text`. The rest of what was typed into the program (standard input), as one text.
- **read line** : `() -[Console, Abort]-> Optional Text`. The next line typed in, or none at the end.
- **read file** : `(Text) -[Files, Abort]-> Text`. The text in a file. Aborts if it can't be read.
- **write file** : `(Text, Text) -[Files, Abort]-> Unit`. Writes text to a file, replacing what was there.
- **add to file** : `(Text, Text) -[Files, Abort]-> Unit`. Adds text to the end of a file.
- **file exists** : `(Text) -[Files]-> Bool`. Whether there's a file at this path.
- **list folder** : `(Text) -[Files, Abort]-> List Text`. The names of the files in a folder.
- **fetch text** : `(Text) -[Network, Abort]-> Text`. The text at a web address. Aborts if the request fails.

## Cells and pages

A page is a value of type Html that main returns. Cells hold what changes; a part of the page that reads a cell is drawn again when the cell changes, and a button's handler writes cells.

- **cell** : `(a) -[Cells]-> Cell a`. A new cell holding a starting value: a value a page can change, and whose readers are redrawn when it does.
- **read** : `(Cell a) -[Cells, Diverge]-> a`. What a cell holds now. A page part that reads it is redrawn when it changes.
- **write** : `(Cell a, a) -[Update]-> Unit`. Puts a new value in a cell. Only event handlers can write.
- **formula** : `(() -[Cells, Diverge]-> a) -[Cells]-> Cell a`. A cell whose value is computed from other cells, and kept up to date when they change.
- **each** : `(Cell (List a), (a) -[Cells, Diverge]-> b) -[Cells]-> Cell (List b)`. A cell holding f of each item of a list cell, where an item that stays keeps what f gave it.
- **Html** (type). A page: elements with attributes and children, text, and parts that are drawn again when what they read changes.
- **Attribute** (type). Something attached to a page element: a property (name and value), an on(event, then) handler, or a sound to play when it's clicked.
- **Event** (type). What a page's handler is given when its event comes: the field's value and the key pressed.
- **Input** (type). Where a sound's samples come from: the microphone, or a recording at an address.
- **div** : `(List Html) -> Html` (html module). A div with these children. To give it attributes, wrap it: styled, classed, with.
- **span** : `(List Html) -> Html` (html module). A span element with these children: a run of text inside a line.
- **p** : `(List Html) -> Html` (html module). A p element with these children: a paragraph.
- **h1** : `(List Html) -> Html` (html module). A h1 element with these children: the biggest heading.
- **h2** : `(List Html) -> Html` (html module). A h2 element with these children: a second-level heading.
- **section** : `(List Html) -> Html` (html module). A section element with these children: a part of the page.
- **footer** : `(List Html) -> Html` (html module). A footer element with these children: the page's foot.
- **label** : `(List Html) -> Html` (html module). A label element with these children: a label for a field.
- **ul** : `(List Html) -> Html` (html module). A ul element with these children: a list with bullets, whose items are li.
- **li** : `(List Html) -> Html` (html module). A li element with these children: one item of a list.
- **strong** : `(List Html) -> Html` (html module). A strong element with these children: important text, usually bold.
- **tag** : `(Text, List Html) -> Html` (html module). An element with these children, for a tag that has no function of its own here (main, nav, table, …). Each tag a function, as in Elm's Html module (prior art).
- **words** : `(Text) -> Html` (html module). Text that doesn't change. Text that does is text(() => …), which the page runs again when what it reads changes.
- **button** : `(Text, (Event) -[Cells, Console, Diverge, Files, Network, Update, Abort, Log, Random, Time]-> Unit) -> Html` (html module). A button with this label that runs then when it's clicked.
- **input** : `(List Attribute) -> Html` (html module). An input field: it has attributes and no children.
- **attribute** : `(Text, Text) -> Attribute` (html module). An attribute whose value doesn't change.
- **with** : `(List Attribute, Html) -> Html` (html module). The same element with these attributes added after its own. Text and parts have no attributes, so they come back as they are.
- **styled** : `(Text, Html) -> Html` (html module). The same element with this inline style (CSS declarations, such as color: #777; margin: 0).
- **named** : `(Text, Html) -> Html` (html module). The same element with this id.
- **classed** : `(Text, Html) -> Html` (html module). The same element in this class, for a style sheet's rules to select.
- **for each** : `(Cell (List a), (a) -[Cells, Diverge]-> b, (List b) -[Cells, Diverge, Network, Log, Time]-> Html) -[Cells]-> Html` (html module). The items of a cell's list, each drawn by row and all put inside (ul, div, …). An item still there when the list changes keeps its row as it was; only new items get one. Solid's <For> (prior art).
- **rule** : `(Text, Text) -> Text` (html module). A style sheet rule: a selector and its declarations. A style sheet is a list of these, so it shows rule by rule instead of as one long text.
- **media** : `(Text, List Text) -> Text` (html module). Rules that apply only when the query holds, such as (prefers-color-scheme: dark).
- **style sheet** : `(List Text) -> Html` (html module). A style element holding these rules.
- **px** : `(a) -> Text` (html module). A length in pixels, from a Number or an Int.
- **joined** : `(List Text, Text) -> Text` (html module). The texts with between between each two of them.

## Points, colours and slopes

A record whose fields are all Numbers (a point, a direction, a colour) can be worked on part by part, and the vectors module is written that way.

- **map parts** : `((Number) -> Number, a) -> a`. A function applied to each part of a record of Numbers: map parts(f, vec(x, y)) is vec(f(x), f(y)).
- **zip parts** : `((Number, Number) -> Number, a, a) -> a`. A function applied to each pair of parts of two records of the same type.
- **total** : `(a) -> Number`. The parts of a record of Numbers added up.
- **set** : `((a) -> b, a, b) -> a`. The record with one field changed and the others kept: set((p) => p.x, point, 3). The field can be a path, like (p) => p.home.city.
- **derivative** : `((Number) -[e]-> Number) -> (Number) -[Choice, e]-> Number`. The slope of a function of one Number, as a function. Where a slope can't be read there's no answer (Choice).
- **gradient** : `((a) -[e]-> Number) -> (a) -[Choice, e]-> a`. For a function of a record of Numbers (a point, a colour), the record of its slopes along each part.
- **plus** : `(a, a) -> a` (vectors module). a + b: the one + works part by part on points, directions, colours, or any record whose fields are all Numbers; plus is its old name, kept for a release. This module's operations and their names follow the built-in functions of GLSL and WGSL (influence), which a shader compiles them to.
- **minus** : `(a, a) -> a` (vectors module). a − b: the old name of −, kept for a release. The direction from b to a.
- **times** : `(a, a) -> a` (vectors module). a · b: the old name of ·, kept for a release. A colour tinted by another.
- **scale** : `(Number, a) -> a` (vectors module). Every part of v times by: a direction made longer, a colour made brighter.
- **dot** : `(a, a) -> Number` (vectors module). The parts' products added up: how much a and b point the same way.
- **magnitude** : `(a) -> Number` (vectors module). How long v is: √(v · v).
- **distance** : `(a, a) -> Number` (vectors module). How far a is from b.
- **unit** : `(a) -> a` (vectors module). v scaled to length 1 (normalize on a GPU).
- **mix** : `(a, a, Number) -> a` (vectors module). a when amount is 0, b when it is 1, and in between, part by part.
- **clamp** : `(a, Number, Number) -> a` (vectors module). Every part of v kept between low and high.
- **reflect** : `(a, a) -> a` (vectors module). A ray going this direction, bounced off a surface facing normal (normal of length 1).
