# The library

Everything a program can use without writing it, by topic: its type and what it does. Printed by `node library/reference.ts` from the notes in src/lang/notes.ts and the modules' comments; LANGUAGE.md explains the ideas.

How to read a type: `(Float64, Float64) -> Float64` takes two Float64s and gives one. Effects go in the arrow: `() -[Random]-> Float64` takes nothing, may draw random numbers, and gives a Float64. A small letter (`a`, `b`) is any type, the same one wherever the letter appears in that type; `List a` is a list of anything. A name with no arrow (`i : Complex`) is a value.

## Numbers

There are six kinds of number. Int is a whole number of any size. Float64 is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Algebraic is an exact root of a polynomial, like √2, so √2 · √2 is exactly 2. Complex is re + im·i. Fixed counts steps of 2⁻³², the same bits on every machine. One + − · < works on all of them, and the checker works out which kind you mean. Together they are the Numbers, and a type says "where a is a Number" when any of them will do. A plain literal is some Number too: 3 is an Int where an Int is needed and a Float64 where a Float64 is, 0.5 can be anything but an Int. One that nothing fixes is an Int when it is whole and a Float64 when it isn't, so 2 + 3 alone is exact. Values never mix by themselves: as float64 turns an Int into a Float64, whole part goes back, and as fraction and as complex turn into the others. The versions "at Float64" and "at Int" are what the one + turns into once the kind is known, so the palette offers the one +. A type of your own joins the one + − · −x with a definition of type Arithmetic T, and the one < with one of type Ordered T.

- **add** : `(a, a) -> a`. a + b, at any Number: Int, Float64, Rational, Algebraic, Complex (and records of Float64s through the vectors module).
- **subtract** : `(a, a) -> a`. a − b, at any Number.
- **multiply** : `(a, a) -> a`. a · b, at any Number. At Complex it's the complex product.
- **negate** : `(a) -> a`. −a, at any Number.
- **less than** : `(a, a) -> Bool`. a < b, at any Number with < (not Complex).
- **Arithmetic** (type). An interface: the one + − · and −x, for any type that implements them. Float64, Int, Rational, Complex, Dual and Algebraic implement it in the prelude; a type of your own joins with a definition of type Arithmetic T, written arithmetic(its +, its −, its ·, its −x). A record of numbers without one gets them part by part. Resolved before the program runs, so it costs nothing (INTERFACES.md).
- **Ordered** (type). An interface: the one <, for any type that implements it. The prelude's at most, smaller, sort and the rest then work on that type too. A type of your own joins with a definition of type Ordered T, written ordered(its <).
- **at most** : `(a, a) -> Bool`. a ≤ b: not b < a.
- **more than** : `(a, a) -> Bool`. a > b: b < a.
- **at least** : `(a, a) -> Bool`. a ≥ b: not a < b.
- **smaller** : `(a, a) -> a`. The smaller of two numbers (min); a shader's min.
- **larger** : `(a, a) -> a`. The larger of two numbers (max); a shader's max.
- **Trig** (type). An interface: sin, cos, tan, exp and log, for any type that implements them. An implementation is a definition of type Trig T, written trig(its sin, its cos, …); Float64's is the builtins. A use is resolved to the type's own function before the program runs, so it costs nothing (INTERFACES.md).
- **sin** : `(a) -> a where a has Trig`. Sine of an angle in radians, at any type with Trig (Float64 now; dual numbers next).
- **cos** : `(a) -> a where a has Trig`. Cosine of an angle in radians, at any type with Trig.
- **tan** : `(a) -> a where a has Trig`. Tangent of an angle in radians, at any type with Trig.
- **exp** : `(a) -> a where a has Trig`. e to the power x, at any type with Trig.
- **log** : `(a) -> a where a has Trig`. The natural logarithm, at any type with Trig (the debugging effect is Log, a different thing).
- **divide** : `(Float64, Float64) -> Float64`. a ÷ b for Float64s (floating point, so 1 ÷ 3 is 0.333…; dividing by 0 gives infinity). For exact division use fractions.
- **sqrt** : `(Float64) -> Float64`. The square root.
- **power** : `(Float64, Float64) -> Float64`. a to the power b.
- **atan2** : `(Float64, Float64) -> Float64`. The angle of the point (x, y) from the x axis, in radians: atan2(y, x).
- **abs** : `(Float64) -> Float64`. The size of a Float64 without its sign.
- **floor** : `(Float64) -> Float64`. The Float64 rounded down to a whole one, still a Float64. whole part gives an Int.
- **mod** : `(Float64, Float64) -> Float64`. The remainder of a ÷ b, never negative when b is positive: mod(−1, 3) is 2.
- **round to Float32** : `(Float64) -> Float64`. The nearest Float64 a GPU can hold (32-bit floating point).
- **show** : `(Float64) -> Text`. A Float64 as text: show(2.5) is "2.5".
- **range** : `(Float64) -> List Float64`. The Float64s 0, 1, … up to n − 1, as a list.
- **quotient** : `(Int, Int) -[Choice]-> Int`. a ÷ b rounded down to a whole number. No answer (Choice) when b is 0.
- **remainder** : `(Int, Int) -[Choice]-> Int`. What's left of a after quotient(a, b) times b; it has b's sign. No answer when b is 0.
- **power** : `(Int, Int) -[Choice]-> Int`. a to the power b for Ints. No answer when b is negative.
- **lowest terms** : `(Int, Int) -> Pair Int Int`. Both divided by their greatest common divisor, the second made positive: how a fraction is kept.
- **read whole number** : `(Text) -[Choice]-> Int`. The Int a text spells, like "42". No answer when it isn't one.
- **as float64** : `(Int) -> Float64`. The Int as a Float64.
- **whole part** : `(Float64) -[Choice]-> Int`. The Float64 rounded down, as an Int: whole part(2.7) is 2. No answer for infinity or not-a-number.
- **abs** : `(Int) -> Int`. The size of an Int without its sign.
- **shifted down** : `(Int, Int) -> Int`. floor(a / 2ⁿ): a shifted down n places, rounded towards −∞, so shifted down(−1, 1) is −1. A negative n shifts up. Fixed's · uses it.
- **show** : `(Int) -> Text`. An Int as text.
- **range** : `(Int) -> List Int`. The Ints 0, 1, … up to n − 1, as a list.
- **Rational** (type). An exact fraction, top/bottom, always in lowest terms. The same + − · < work on it. Make one with fraction(1, 3) or as fraction(n); its constructor ratio is private to the library, which keeps the rule.
- **fraction** : `(Int, Int) -[Choice]-> Rational`. top/bottom, exactly, in lowest terms (Euclid's algorithm, textbook); no answer when bottom is 0.
- **as fraction** : `(Int) -> Rational`. The whole number n as a fraction, n/1.
- **divide fractions** : `(Rational, Rational) -[Choice]-> Rational`. a ÷ b for fractions, exactly; no answer when b is 0.
- **show fraction** : `(Rational) -> Text`. A fraction as 3/4, or 3 when it is whole.
- **fraction as float64** : `(Rational) -> Float64`. The nearest Float64.
- **Complex** (type). A complex number re + im·i, a record of two Float64s. The same + − · work on it (· is the complex product); it has no <.
- **as complex** : `(Float64) -> Complex`. The Float64 x as a complex number, x + 0i.
- **i** : `Complex`. i, the square root of −1: i · i is −1.
- **complex conjugate** : `(Complex) -> Complex`. a − bi for a + bi: the same point mirrored across the real line. z · conjugate(z) is |z|².
- **modulus** : `(Complex) -> Float64`. |z|, how far z is from 0 (the vectors module's magnitude says the same).
- **angle of** : `(Complex) -> Float64`. The angle from the positive real line to z, in radians, between −π and π (atan2).
- **polar** : `(Float64, Float64) -> Complex`. The complex number size away from 0 at this angle: size·(cos angle + i sin angle).
- **divide complex** : `(Complex, Complex) -[Choice]-> Complex`. z ÷ w for complex numbers; no answer when w is 0.
- **complex exp** : `(Complex) -> Complex`. e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.
- **show complex** : `(Complex) -> Text`. A complex number as 3 + 4i or 3 − 4i.
- **table product** : `(List (Table entry a), a, a) -> a`. a · b in an algebra given by its multiplication table: each line says what two basis elements multiply to, as times(i, i, −1). Complex numbers, dual numbers and quaternions are each one table (ALGEBRA-TABLES.md).
- **complex table** : `List (Table entry Complex)`. Complex's multiplication table: 1 · 1 = 1, 1 · i = i, i · 1 = i, i · i = −1. table product(complex table, z, w) is z · w.
- **clifford table** : `(List Float64, List a) -> List (Table entry a)`. The multiplication table of a Clifford algebra, for table product: its basis vectors square to `squares` (1, −1 or 0 each; Cl(p, q, r) is p ones, q minus ones, r zeros), and `basis` is your record type's basis elements in the order 1, e₁, e₂, e₁e₂, e₃, e₁e₃, e₂e₃, e₁e₂e₃, … . clifford table([−1], …) is the complex numbers, [0] the dual numbers, [1] the split-complex ones, [−1, −1] the quaternions (i = e₁, j = e₂, k = e₁e₂), [1, 1, 1] Cl(3, 0) and [1, 1, 1, 0] projective geometric algebra (ALGEBRA-TABLES.md).
- **clifford reverse** : `(List a, List b, b) -> b`. x̃, the reverse of x in the Clifford algebra clifford table(squares, basis) makes: each blade's vectors in the opposite order, so e₁₂ becomes −e₁₂ and vectors stay. A rotor R turns a vector v into R · v · R̃. In Cl(3, 0) the rotor that turns by θ in the e₁e₂ plane is cos(θ/2) − sin(θ/2)e₁₂, and the rotors 1, e₂₃, e₁₃, e₁₂ multiply as the quaternions do.
- **Table entry** (type). One line of an algebra's multiplication table: times(left, right, gives) says left · right is gives, for two basis elements. table product multiplies by a list of them.
- **Fixed** (type). A fixed-point number: an Int counting steps of 2⁻³², so 1.5 is fixed(6442450944). The same + − · < work on it, with · rounded down to a step, and the answer has the same bits on every machine. A step is 2⁻³² anywhere, so a position far from the origin keeps its precision (FIXED-POINT.md).
- **as fixed** : `(Int) -> Fixed`. A whole number as a Fixed, exactly.
- **fixed as float64** : `(Fixed) -> Float64`. A Fixed as the nearest Float64, for drawing or printing. Past 2⁵³ steps (about 2 million) it drops the last bits; the Fixed keeps them.
- **show fixed** : `(Fixed) -> Text`. A Fixed as text: the shortest decimal that reads back to the same steps, so 0.1 shows as 0.1 and every step shows differently.
- **divide fixed** : `(Fixed, Fixed) -[Choice]-> Fixed`. a ÷ b for Fixed, rounded down to a step; no answer when b is 0.
- **Dual** (type). A dual number, value + slope·ε where ε · ε is 0: a record of two Float64s. The same + − · work on it, · by the product rule, and sin, cos, tan, exp and log by the chain rule, so a function given dual(x, 1) gives back its value and its slope at x. slope by duals does that for you (forward-mode automatic differentiation). No <.
- **slope by duals** : `((Dual) -[e]-> Dual, Float64) -[e]-> Float64`. f′(x), worked out by giving f the dual number x + 1ε and reading the slope of what comes back (forward-mode automatic differentiation). f must work on duals: write it with the generic + − · and Trig. derivative(f) gives the same number by differentiating f's code.
- **divide duals** : `(Dual, Dual) -[Choice]-> Dual`. x ÷ y for dual numbers, the quotient rule; no answer when y's value is 0.
- **show dual** : `(Dual) -> Text`. A dual number as 3 + 2ε.
- **dual table** : `List (Table entry Dual)`. Dual numbers' multiplication table: 1 · 1 = 1, 1 · ε = ε, ε · 1 = ε, and ε · ε = 0, which needs no line. table product(dual table, x, y) is x · y.
- **Algebraic** (type). An exact real number that solves a polynomial equation with whole-number coefficients, like √2 (x² = 2) or the golden ratio (x² = x + 1). Held by that equation and which of its roots it is, so √2 · √2 is exactly 2 and < always answers. The same + − · < work on it. Make one with square root, root, or as algebraic; digits shows as many digits as you ask for (EXACT-REALS.md).
- **square root** : `(Algebraic) -[Choice]-> Algebraic`. The positive square root, exactly: square root(2) is √2, the root of x² − 2 between 1 and 2. No answer (Choice) for a negative number.
- **root** : `(Algebraic, Int) -[Choice]-> Algebraic`. The real k-th root: root(8, 3) is 2, root(2, 2) is √2. For an even k the positive one, and no answer (Choice) for a negative number.
- **divide** : `(Algebraic, Algebraic) -[Choice]-> Algebraic`. a ÷ b exactly. No answer (Choice) when b is 0.
- **as algebraic** : `(Rational) -> Algebraic`. A fraction as an Algebraic number.
- **as fraction** : `(Algebraic) -[Choice]-> Rational`. The fraction an Algebraic number is, when it is one: as fraction(√2 · √2) is 2. No answer (Choice) for √2.
- **digits** : `(Algebraic, Int) -> Text`. The first n digits after the point, cut off, worked out exactly: digits(√2, 5) is "1.41421". As many as asked for.
- **as float64** : `(Algebraic) -> Float64`. The nearest Float64.
- **show** : `(Algebraic) -> Text`. An Algebraic number as text: 2 or 1/3 when it is a fraction, √2 or −√2 for those, else its first ten digits and an ellipsis.
- **sin** : `(Float64) -> Float64`. Sine of a Float64 angle in radians: what Trig's sin is at Float64. Not offered on its own: sin is.
- **cos** : `(Float64) -> Float64`. Cosine of a Float64 angle in radians: what Trig's cos is at Float64. Not offered on its own: cos is.
- **tan** : `(Float64) -> Float64`. Tangent of a Float64 angle in radians: what Trig's tan is at Float64. Not offered on its own: tan is.
- **exp** : `(Float64) -> Float64`. e to the power x, for a Float64: what Trig's exp is at Float64. Not offered on its own: exp is.
- **log** : `(Float64) -> Float64`. The natural logarithm of a Float64 (the debugging effect is Log, a different thing): what Trig's log is at Float64. Not offered on its own: log is.
- **add** : `(Float64, Float64) -> Float64`. a + b for Float64s: what the generic + is at Float64.
- **subtract** : `(Float64, Float64) -> Float64`. a − b for Float64s: what the generic − is at Float64.
- **multiply** : `(Float64, Float64) -> Float64`. a · b for Float64s: what the generic · is at Float64.
- **negate** : `(Float64) -> Float64`. −a for a Float64: what the generic − is at Float64.
- **less than** : `(Float64, Float64) -> Bool`. a < b for Float64s: what the generic < is at Float64.
- **add** : `(Int, Int) -> Int`. a + b for Ints: what the generic + is at Int. Ints never overflow.
- **subtract** : `(Int, Int) -> Int`. a − b for Ints: what the generic − is at Int.
- **multiply** : `(Int, Int) -> Int`. a · b for Ints: what the generic · is at Int.
- **negate** : `(Int) -> Int`. −a for an Int: what the generic − is at Int.
- **less than** : `(Int, Int) -> Bool`. a < b for Ints: what the generic < is at Int.
- **add** : `(Algebraic, Algebraic) -> Algebraic`. a + b for Algebraic numbers, exactly: what the generic + is at Algebraic.
- **subtract** : `(Algebraic, Algebraic) -> Algebraic`. a − b for Algebraic numbers, exactly: what the generic − is at Algebraic.
- **multiply** : `(Algebraic, Algebraic) -> Algebraic`. a · b for Algebraic numbers, exactly: √2 · √2 is 2. What the generic · is at Algebraic.
- **negate** : `(Algebraic) -> Algebraic`. −a for an Algebraic number: what the generic − is at Algebraic.
- **less than** : `(Algebraic, Algebraic) -> Bool`. a < b for Algebraic numbers. It always answers: two different algebraic numbers can always be told apart.
- **algebraic fraction** : `(Int, Int) -> Algebraic`. top/bottom as an Algebraic number: what a literal at Algebraic becomes. Not offered: as algebraic is.

## True and false, sameness and order

- **Bool** (type). true or false. `if c then a else b` is a match on a Bool.
- **and** : `(Bool, Bool) -> Bool`. Both true.
- **or** : `(Bool, Bool) -> Bool`. Either true.
- **not** : `(Bool) -> Bool`. true becomes false and false true.
- **equal** : `(a, a) -> Bool`. Whether two values are the same: numbers, text, and data made of them. Functions can't be compared.
- **compare** : `(a, a) -> Order`. How two values are ordered: before, same or after. Float64s by value, exactly (unlike equal, which lets two Float64s within about 1e-9 be equal), with NaN after every other Float64; text alphabetically; cases in the order their type lists them; then field by field. sort, maps and sets use it.
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
- **sum** : `(List Float64) -> Float64`. The Float64s of the list added up; 0 for an empty list.
- **append** : `(List a, List a) -> List a`. The items of the first list, then the items of the second.
- **reverse** : `(List a) -> List a`. The list back to front.
- **sort** : `(List a) -> List a`. The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.
- **show numbers** : `(List Float64) -> Text`. A fold that prints. Run backwards it unfolds, so it parses.

## Maps and sets

A map is kept sorted by key in compare's order, so two maps with the same entries are equal and print the same, whatever order they were built in. Keys are exact: two Float64 keys are one key only when they are the same Float64.

- **Map** (type). A map from keys to values, kept sorted by key with no key twice. Build one with empty map, as map or put (its constructor map of is private to the library, which keeps the rule); read it with value at.
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
- **Set** (type). A set of items, kept sorted with none twice. Build one with empty set, as set or add item (its constructor set of is private to the library, which keeps the rule).
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
- **count** : `(() -[Choice, e]-> a) -[e]-> Float64`. How many answers a search gives.
- **optional** : `(() -[Choice, e]-> a) -[e]-> Optional a`. The first answer as some(answer), or none.
- **value of** : `(Optional a) -[Choice]-> a`. The value in some(value); no answer for none. optional run backwards.
- **Optional** (type). A value that may be missing: none, or some(value). The data form of Choice, for keeping an answer that may not be there.
- **with fuel** : `(Float64, () -[Diverge, e]-> a) -[Choice, e]-> a`. Runs something that might not finish, allowing it n steps; if it hasn't finished by then, there's no answer. That turns Diverge into Choice.
- **hence** : `(Bool, Bool) -> Bool`. a hence b is a and b, read as "b follows from a": the solver uses b to find answers but doesn't count it as a separate condition.
- **for some** : `((a) -[e]-> Bool) -[e]-> Bool`. Whether some value makes the function true: the solver looks for one. Used in relations, where a value has no name outside.
- **inverse** : `((a) -[e]-> b, b) -[Choice, Diverge, e]-> a`. The x that f takes to y: f run backwards, for any function value f. Several answers are a Choice, as with solve; a function that acts (prints, writes a cell) is refused when it's run.
- **conjugate** : `((a) -[Choice, Diverge, e]-> b, (b) -[Choice, Diverge, e]-> b) -> (a) -[Choice, Diverge, e]-> a`. g done in f's space: f, then g, then f run backwards (f⁻¹ ∘ g ∘ f). An edit in linear light, a turn about a point, a filter on one band of a signal.

## Functions of functions

A function takes all its inputs at once, as f(a, b). curry makes one that takes them one at a time, for when that is wanted, and partially gives a function its first input ahead of the rest.

- **curry** : `((a, b) -[e]-> c) -> (a) -> (b) -[e]-> c`. f, taking its two inputs one at a time: curry(f)(a)(b) is f(a, b). Functions take all their inputs at once; this is for when one at a time is wanted.
- **uncurry** : `((a) -[e]-> (b) -[e]-> c) -> (a, b) -[e]-> c`. The other way: a function that takes a and gives back a function of b, made into one function of (a, b).
- **partially** : `((a, b) -[e]-> c, a) -> (b) -[e]-> c`. f with its first input given: partially(f, a)(b) is f(a, b). map(xs, partially(add, 1)) adds 1 to each.
- **flip** : `((a, b) -[e]-> c) -> (b, a) -[e]-> c`. f with its two inputs swapped: flip(f)(a, b) is f(b, a).

## When something goes wrong: Abort and Outcome

abort(reason) stops with a reason, and its type says so (Abort). attempt catches it as data.

- **Abort** (type). An effect: abort(reason) stops the computation with a reason. A match with an abort(reason) case catches it, and attempt keeps it as an Outcome.
- **Outcome** (type). The result of something that may have been refused: done(value) or refused(reason). The data form of Abort, for keeping it in a list or record.
- **attempt** : `(() -[Abort, e]-> a) -[e]-> Outcome a`. The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).
- **value or abort** : `(Outcome a) -[Abort]-> a`. The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.

## Effects from outside the program

Each of these puts its effect in the type of every function that uses it, so `die : () -[Random]-> Float64` says die draws random numbers. Something around it handles the effect: seeded handles Random, a page's button handles what its handler does, and what nothing handles, the world answers when the program runs.

- **Random** (type). An effect: random() is a Float64 from 0 up to (not including) 1. seeded(seed, action) answers it with the same numbers every time; with nothing around it, the world's randomness answers.
- **seeded** : `(Float64, () -[Random, e]-> a) -[e]-> a`. Runs the action with its random() calls answered by a generator started from the seed: the same numbers every time for the same seed. The action's Random ends here.
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
- **px** : `(a) -> Text` (html module). A length in pixels, from a Float64 or an Int.
- **joined** : `(List Text, Text) -> Text` (html module). The texts with between between each two of them.

## Points, colours and slopes

A record whose fields are all Float64s (a point, a direction, a colour) can be worked on part by part, and the vectors module is written that way.

- **map parts** : `((Float64) -> Float64, a) -> a`. A function applied to each part of a record of Float64s: map parts(f, vec(x, y)) is vec(f(x), f(y)).
- **zip parts** : `((Float64, Float64) -> Float64, a, a) -> a`. A function applied to each pair of parts of two records of the same type.
- **total** : `(a) -> Float64`. The parts of a record of Float64s added up.
- **set** : `((a) -> b, a, b) -> a`. The record with one field changed and the others kept: set((p) => p.x, point, 3). The field can be a path, like (p) => p.home.city.
- **derivative** : `((Float64) -[e]-> Float64) -> (Float64) -[Choice, e]-> Float64`. The slope of a function of one Float64, as a function. Where a slope can't be read there's no answer (Choice).
- **gradient** : `((a) -[e]-> Float64) -> (a) -[Choice, e]-> a`. For a function of a record of Float64s (a point, a colour), the record of its slopes along each part.
- **plus** : `(a, a) -> a` (vectors module). a + b: the one + works part by part on points, directions, colours, or any record whose fields are all Float64s; plus is its old name, kept for a release. This module's operations and their names follow the built-in functions of GLSL and WGSL (influence), which a shader compiles them to.
- **minus** : `(a, a) -> a` (vectors module). a − b: the old name of −, kept for a release. The direction from b to a.
- **times** : `(a, a) -> a` (vectors module). a · b: the old name of ·, kept for a release. A colour tinted by another.
- **scale** : `(Float64, a) -> a` (vectors module). Every part of v times by: a direction made longer, a colour made brighter.
- **dot** : `(a, a) -> Float64` (vectors module). The parts' products added up: how much a and b point the same way.
- **magnitude** : `(a) -> Float64` (vectors module). How long v is: √(v · v).
- **distance** : `(a, a) -> Float64` (vectors module). How far a is from b.
- **unit** : `(a) -> a` (vectors module). v scaled to length 1 (normalize on a GPU).
- **mix** : `(a, a, Float64) -> a` (vectors module). a when amount is 0, b when it is 1, and in between, part by part.
- **clamp** : `(a, Float64, Float64) -> a` (vectors module). Every part of v kept between low and high.
- **reflect** : `(a, a) -> a` (vectors module). A ray going this direction, bounced off a surface facing normal (normal of length 1).
