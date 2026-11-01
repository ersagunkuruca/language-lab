# The library

Everything a program can use without writing it, by topic: its type and what it does. Printed by `node library/reference.ts` from the notes in src/lang/notes.ts and the modules' comments; LANGUAGE.md explains the ideas.

How to read a type: `(Float64, Float64) -> Float64` takes two Float64s and gives one. Effects go in the arrow: `() -[Random]-> Float64` takes nothing, may draw random numbers, and gives a Float64. A small letter (`a`, `b`) is any type, the same one wherever the letter appears in that type; `List a` is a list of anything. A name with no arrow (`i : Complex`) is a value.

## Numbers

There are six kinds of number. Int is a whole number of any size. Float64 is a floating-point number, like most languages' (0.1 + 0.2 isn't exactly 0.3). Rational is an exact fraction. Algebraic is an exact root of a polynomial, like √2, so √2 · √2 is exactly 2. Complex is re + im·i. Fixed counts steps of 2⁻³², the same bits on every machine. Mat2, Mat3 and Mat4 are small matrices, with · the matrix product. One + − · < works on all of them, and the checker works out which kind you mean. Together they are the Numbers, and a type says "where a is a Number" when any of them will do. A plain literal is some Number too: 3 is an Int where an Int is needed and a Float64 where a Float64 is, 0.5 can be anything but an Int. One that nothing fixes is an Int when it is whole and a Float64 when it isn't, so 2 + 3 alone is exact. Values never mix by themselves: as float64 turns an Int into a Float64, whole part goes back, and as fraction and as complex turn into the others. The versions "at Float64" and "at Int" are what the one + turns into once the kind is known, so the palette offers the one +. A type of your own joins the one + − · −x with a definition of type Arithmetic T, and the one < with one of type Ordered T.

- **add** : `(a, a) -> a`. a + b, at any Number: Int, Float64, Rational, Algebraic, Complex (and records of Float64s through the vectors module).
- **subtract** : `(a, a) -> a`. a − b, at any Number.
- **multiply** : `(a, a) -> a`. a · b, at any Number. At Complex it's the complex product.
- **negate** : `(a) -> a`. −a, at any Number.
- **less than** : `(a, a) -> Bool`. a < b, at any Number with < (not Complex).
- **Arithmetic** (type). An interface: the one + − · and −x, for any type that implements them. Float64, Int, Rational, Complex, Dual and Algebraic implement it in the prelude; a type of your own joins with a definition of type Arithmetic T, written arithmetic(its +, its −, its ·, its −x). A record of numbers without one gets them part by part. Resolved before the program runs, so it costs nothing (INTERFACES.md).
- **Ordered** (type). An interface: the one <, for any type that implements it. The prelude's at most, smaller, sort and the rest then work on that type too. A type of your own joins with a definition of type Ordered T, written ordered(its <).
- **by its ways** : `a`. In an implementation, a field left to the interface's ways: the compiler puts in the cheapest way that ends in a field the implementation gives. Trig at your type can give sin and leave cos by its ways, or the other way round (WAYS.md).
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
- **divide** : `(Float64, Float64) -[Choice]-> Float64`. a ÷ b for Float64s (floating point, so 1 ÷ 3 is 0.333…; dividing by 0 gives infinity). For exact division use fractions.
- **sqrt** : `(Float64) -[Choice]-> Float64`. The square root.
- **power** : `(Float64, Float64) -[Choice]-> Float64`. a to the power b.
- **atan2** : `(Float64, Float64) -> Float64`. The angle of the point (x, y) from the x axis, in radians: atan2(y, x).
- **abs** : `(Float64) -> Float64`. The size of a Float64 without its sign.
- **floor** : `(Float64) -> Float64`. The Float64 rounded down to a whole one, still a Float64. whole part gives an Int.
- **mod** : `(Float64, Float64) -[Choice]-> Float64`. The remainder of a ÷ b, never negative when b is positive: mod(−1, 3) is 2.
- **round to Float32** : `(Float64) -> Float64`. The nearest Float64 a GPU can hold (32-bit floating point).
- **show** : `(Float64) -> Text`. A Float64 as text: show(2.5) is "2.5".
- **range** : `(Float64) -> List Float64`. The Float64s 0, 1, … up to n − 1, as a list.
- **show decimals** : `(Float64, Float64) -> Text`. x as text with `places` digits after the point, rounded half away from 0 and keeping trailing zeros: show decimals(2.5, 3) is "2.500", show decimals(-0.0004, 3) is "0.000". For when show's up to nine places would jump about.
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
- **from polar** : `(Float64, Float64) -> Complex`. The complex number size away from 0 at this angle: size·(cos angle + i sin angle).
- **divide complex** : `(Complex, Complex) -[Choice]-> Complex`. z ÷ w for complex numbers; no answer when w is 0.
- **complex exp** : `(Complex) -> Complex`. e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.
- **complex sqrt** : `(Complex) -> Complex`. √z for a complex number, the root with a real part of 0 or more: complex sqrt(−4) is 2i. Float64's sqrt has no answer below 0; this one always has.
- **complex log** : `(Complex) -[Choice]-> Complex`. log z for a complex number: log|z| + i·(its angle, between −π and π). complex log(−1) is iπ. No answer at 0.
- **complex power** : `(Complex, Complex) -[Choice]-> Complex`. z to the power w, e^(w · log z), the principal value: complex power(−8, 1/3) is 1 + 1.732i. 0 to a power with a real part above 0 is 0; to any other, no answer.
- **complex asin** : `(Complex) -> Complex`. asin z for a complex number, the principal value: complex asin(2) is π/2 + 1.317i. Float64's asin has no answer outside −1 to 1; this one always has.
- **complex acos** : `(Complex) -> Complex`. acos z for a complex number, the principal value: complex acos(2) is −1.317i. Float64's acos has no answer outside −1 to 1; this one always has.
- **show complex** : `(Complex) -> Text`. A complex number as 3 + 4i or 3 − 4i.
- **table product** : `(List (Table entry a), a, a) -> a`. a · b in an algebra given by its multiplication table: each line says what two basis elements multiply to, as times(i, i, −1). Complex numbers, dual numbers and quaternions are each one table (ALGEBRA-TABLES.md).
- **complex table** : `List (Table entry Complex)`. Complex's multiplication table: 1 · 1 = 1, 1 · i = i, i · 1 = i, i · i = −1. table product(complex table, z, w) is z · w.
- **clifford table** : `(List Float64, List a) -> List (Table entry a)`. The multiplication table of a Clifford algebra, for table product: its basis vectors square to `squares` (1, −1 or 0 each; Cl(p, q, r) is p ones, q minus ones, r zeros), and `basis` is your record type's basis elements in the order 1, e₁, e₂, e₁e₂, e₃, e₁e₃, e₂e₃, e₁e₂e₃, … . clifford table([−1], …) is the complex numbers, [0] the dual numbers, [1] the split-complex ones, [−1, −1] the quaternions (i = e₁, j = e₂, k = e₁e₂), [1, 1, 1] Cl(3, 0) and [1, 1, 1, 0] projective geometric algebra (ALGEBRA-TABLES.md).
- **clifford algebra** : `(List Float64, List a) -> Algebra a`. A Clifford algebra, built once: its basis vectors square to `squares` (1, −1 or 0 each) and `basis` is your record type's basis elements, in clifford table's order. It holds the multiplication table, so clifford sandwich, reflect, exp and the others take it and don't build a table on every call. Make it once, as a definition: pga = clifford algebra([1, 1, 1, 0], basis).
- **clifford product** : `(Algebra a, a, a) -> a`. a · b, the geometric product in the algebra (clifford algebra makes one): table product with the algebra's table.
- **clifford reverse** : `(Algebra a, a) -> a`. x̃, the reverse of x in the algebra (clifford algebra makes one): each blade's vectors in the opposite order, so e₁₂ becomes −e₁₂ and vectors stay. A rotor R turns a vector v into R · v · R̃. In Cl(3, 0) the rotor that turns by θ in the e₁e₂ plane is cos(θ/2) − sin(θ/2)e₁₂, and the rotors 1, e₂₃, e₁₃, e₁₂ multiply as the quaternions do.
- **clifford versor inverse** : `(Algebra a, a) -[Choice]-> a`. v⁻¹ for a versor v, ṽ / (v ṽ): a non-null vector's, a rotor's, a motor's or a blade's, for which v ṽ is a number. No answer when v ṽ isn't a number (v isn't a versor, such as 1 + e₁) or is 0 (a null vector such as e₀ in projective geometric algebra). clifford versor inverse(algebra, 2e₁) is ½e₁.
- **clifford sandwich** : `(Algebra a, a, a) -> a`. r · x · r̃ in the algebra (clifford algebra makes one): how a rotor or a motor moves x. In Cl(3, 0) a rotor turns vectors; in projective geometric algebra ([1, 1, 1, 0]) a motor turns and moves points, and two motors compose by their product.
- **clifford reflect** : `(Algebra a, a, a) -[Choice]-> a`. n̂ · x · n⁻¹: x reflected in the plane (in n dimensions, the hyperplane) that is perpendicular to the vector n. In projective geometric algebra, n is a plane and x a point, which comes back with weight −1, the same point.
- **clifford project** : `(Algebra a, a, a) -[Choice]-> a`. The part of the vector x that lies in the blade b, ½(x − b̂ x b⁻¹): onto a line when b is a vector, onto a plane when b is a bivector such as e₁e₂. b must not be null (b b̃ ≠ 0).
- **clifford exp** : `(Algebra a, a) -> a`. e^b for a bivector b whose square is a number: a rotor when b² < 0, 1 + b when b² = 0 (a translator in projective geometric algebra) and cosh/sinh when b² > 0. The rotor turning by θ in the plane B with B² = −1 is clifford exp(algebra, −θ/2 · B). When b² isn't a number (a field with E·B ≠ 0, a screw motion), it sums the series instead, by scaling and squaring.
- **clifford outer** : `(Algebra a, a, a) -> a`. a ∧ b, the outer product in the algebra (clifford algebra makes one): e_A ∧ e_B is e_A e_B when the blades share no vector, else 0. Two vectors span a plane (e₁ ∧ e₂ = e₁₂), and a vector with itself gives 0.
- **clifford inner** : `(Algebra a, a, a) -> a`. a ⌋ b, the left contraction: e_A ⌋ e_B is e_A e_B when every vector of A is in B, else 0. A vector contracted with a bivector gives the vector in that plane at right angles to it (e₁ ⌋ e₁₂ = e₂); a vector with a vector is their dot product.
- **clifford grade** : `(Algebra a, Float64, a) -> a`. x's grade-k part: only its parts on blades of k vectors. Grade 0 is the scalar, 1 the vector, 2 the bivector.
- **clifford dual** : `(Algebra a, a) -> a`. x's dual by complement: e_A becomes ± e_Ā, the blade of the vectors A doesn't have, signed so that e_A ∧ dual(e_A) is the pseudoscalar. It works in projective geometric algebra, whose pseudoscalar squares to 0.
- **clifford undual** : `(Algebra a, a) -> a`. Undoes clifford dual: clifford undual(algebra, clifford dual(algebra, x)) is x.
- **clifford regressive** : `(Algebra a, a, a) -> a`. a ∨ b, the regressive product, undual(dual(a) ∧ dual(b)): in projective geometric algebra the line through two points, or the point where two lines meet in the plane.
- **clifford part** : `(Algebra a, a, List Float64) -> Float64`. x's part on a blade named by its vectors, numbered from 1 in the order of the algebra's squares: clifford part(algebra, x, [1, 2]) reads e₁₂. In projective geometric algebra ([1, 1, 1, 0]) e₀ is vector 4. Another order flips the sign once per swap ([2, 1] reads −e₁₂), and a vector named twice reads 0.
- **clifford with part** : `(Algebra a, a, List Float64, Float64) -> a`. x with its part on a blade, named by its vectors as clifford part names it, set to `value`, the other parts kept: clifford with part(algebra, zero, [1, 2], 2) is 2e₁₂. Several calls build a multivector by blade.
- **Table entry** (type). One line of an algebra's multiplication table: times(left, right, gives) says left · right is gives, for two basis elements. table product multiplies by a list of them.
- **Algebra** (type). A Clifford algebra built once by clifford algebra(squares, basis): its signature, its basis, each blade beside its basis element, and its multiplication table. The clifford functions take one, so a product, sandwich, reflection or exp doesn't build a table on every call.
- **Mat2** (type). A 2 × 2 matrix of Float64s, in rows: mat2(m11, m12, m21, m22). + and − go part by part, · is the matrix product, and a plain number is that many times the identity, so m + 1 adds 1 down the diagonal.
- **Mat3** (type). A 3 × 3 matrix of Float64s, in rows. + and − go part by part, · is the matrix product, and a plain number is that many times the identity.
- **Mat4** (type). A 4 × 4 matrix of Float64s, in rows, the size of a 3D transform. + and − go part by part, · is the matrix product, and a plain number is that many times the identity.
- **matrix table** : `(List (List a)) -> List (Table entry a)`. The multiplication table of n × n matrices, for table product, from rows of basis elements: E_ij · E_jl = E_il and every other product of two of them is 0. Mat2, Mat3 and Mat4 use it for their ·.
- **Fixed** (type). A fixed-point number: an Int counting steps of 2⁻³², so 1.5 is fixed(6442450944). The same + − · < work on it, with · rounded down to a step, and the answer has the same bits on every machine. A step is 2⁻³² anywhere, so a position far from the origin keeps its precision (FIXED-POINT.md).
- **as fixed** : `(Int) -> Fixed`. A whole number as a Fixed, exactly.
- **fixed as float64** : `(Fixed) -> Float64`. A Fixed as the nearest Float64, for drawing or printing. Past 2⁵³ steps (about 2 million) it drops the last bits; the Fixed keeps them.
- **show fixed** : `(Fixed) -> Text`. A Fixed as text: the shortest decimal that reads back to the same steps, so 0.1 shows as 0.1 and every step shows differently.
- **divide fixed** : `(Fixed, Fixed) -[Choice]-> Fixed`. a ÷ b for Fixed, rounded down to a step; no answer when b is 0.
- **square root fixed** : `(Fixed) -[Choice]-> Fixed`. √x for Fixed, rounded down to a step, the same bits on every machine; no answer below 0.
- **Extended** (type). A number of type a, or −∞ or +∞ around it: minus infinity, finite(value) or plus infinity. Float64 has no infinities of its own, so a bound with no end, the least of no numbers, or a distance not reached yet is an Extended. extended add, subtract and multiply follow the extended reals and have no answer for ∞ − ∞ and 0 · ∞; its order is total.
- **extended less** : `(Extended a, Extended a) -> Bool`. a < b for Extended numbers: −∞ is below every number and +∞ above, so the order is total. compare and sort give the same order.
- **extended add** : `(Extended a, Extended a) -[Choice]-> Extended a`. a + b with ±∞: ∞ + 1 is ∞ and −∞ + −∞ is −∞. ∞ + −∞ has no answer.
- **extended negate** : `(Extended a) -> Extended a`. −a with ±∞: −(+∞) is −∞.
- **extended subtract** : `(Extended a, Extended a) -[Choice]-> Extended a`. a − b with ±∞: ∞ − 1 is ∞. ∞ − ∞ has no answer.
- **extended multiply** : `(Extended a, Extended a) -[Choice]-> Extended a`. a · b with ±∞: −2 · ∞ is −∞ and −∞ · −∞ is ∞. 0 · ∞ has no answer.
- **minimum** : `(List a) -> Extended a`. The smallest of the numbers, as an Extended: +∞ when there are none, so it is minimum's identity and a fold over an empty list still has an answer.
- **maximum** : `(List a) -> Extended a`. The largest of the numbers, as an Extended: −∞ when there are none.
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
- **log** : `(Float64) -[Choice]-> Float64`. The natural logarithm of a Float64 (the debugging effect is Log, a different thing): what Trig's log is at Float64. Not offered on its own: log is.
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
- **starts with** : `(Text, Text) -> Bool`. Whether the text begins with this: starts with("# notes", "#") is true. Every text starts with "".
- **ends with** : `(Text, Text) -> Bool`. Whether the text ends with this: ends with("page.md", ".md") is true. Every text ends with "".
- **is digit** : `(Text) -> Bool`. Whether this is one of the characters 0 to 9.
- **is letter** : `(Text) -> Bool`. Whether this is one of the English letters a to z or A to Z (other alphabets' letters aren't, yet).
- **lowercase** : `(Text) -> Text`. The text with A to Z made a to z, everything else as it was: lowercase("Hello, World") is "hello, world".
- **uppercase** : `(Text) -> Text`. The text with a to z made A to Z, everything else as it was: uppercase("Hello") is "HELLO".

## Lists and pairs

A list is written [1, 2, 3]. There are no loops: map, keep and for each go through a list, and fold (a construct, not a function) walks any data.

- **List** (type). A list: nil (empty), or cons(head, tail), an item in front of a list. [1, 2, 3] is how one is written.
- **Pair** (type). Two values together: pair(fst, snd).
- **Unit** (type). The type with one value, unit: what an action that only does something gives back.
- **Tuple2** (type). 2 values side by side, shown (A, B): the inputs or the results of a function as one value. A function of 2 inputs given one tuple takes it apart, so f(p) is f(x, y) when p is a tuple of them.
- **Tuple3** (type). 3 values side by side, shown (A, B, C): the inputs or the results of a function as one value. A function of 3 inputs given one tuple takes it apart, so f(p) is f(x, y, z) when p is a tuple of them.
- **Tuple4** (type). 4 values side by side, shown (A, B, C, D): the inputs or the results of a function as one value. A function of 4 inputs given one tuple takes it apart, so f(p) is f(x, y, z, u) when p is a tuple of them.
- **Tuple5** (type). 5 values side by side, shown (A, B, C, D, E): the inputs or the results of a function as one value. A function of 5 inputs given one tuple takes it apart, so f(p) is f(x, y, z, u, v) when p is a tuple of them.
- **Tuple6** (type). 6 values side by side, shown (A, B, C, D, E, F): the inputs or the results of a function as one value. A function of 6 inputs given one tuple takes it apart, so f(p) is f(x, y, z, u, v, w) when p is a tuple of them.
- **Tuple7** (type). 7 values side by side, shown (A, B, C, D, E, F, G): the inputs or the results of a function as one value. A function of 7 inputs given one tuple takes it apart, so f(p) is f(x, y, z, u, v, w, s) when p is a tuple of them.
- **Tuple8** (type). 8 values side by side, shown (A, B, C, D, E, F, G, H): the inputs or the results of a function as one value. A function of 8 inputs given one tuple takes it apart, so f(p) is f(x, y, z, u, v, w, s, t) when p is a tuple of them.
- **map** : `(List a, (a) -[e]-> b) -[e]-> List b`. The list of f(item) for each item, in the same order.
- **for each** : `(List a, (a) -[e]-> b) -[e]-> Unit`. Runs the action on each item of the list in turn, for what it does (prints, writes a cell).
- **keep** : `(List a, (a) -[Choice]-> Bool) -> List a`. filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.
- **length** : `(List a) -> Int`. How many items the list has.
- **sum** : `(List a) -> a`. The numbers of the list added up, for every number type as + is (Float64s, Ints, Rationals, …); 0 for an empty list.
- **append** : `(List a, List a) -> List a`. The items of the first list, then the items of the second.
- **reverse** : `(List a) -> List a`. The list back to front.
- **sort** : `(List a) -> List a`. The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.
- **sort by** : `(List a, (a) -[e]-> b) -[e]-> List a`. The list in the order of key(item), by compare: sort by(roads, length of) puts the shortest first, sort by(rows, (r) → −amount of(r)) the largest. Items with the same key keep their order (a stable sort; Python's key=, Haskell's sortOn). n log n steps, each calling key.
- **item at** : `(List a, Float64, a) -> a`. The item at a position, counting from 0, or `otherwise` when the list has none there: item at([a, b, c], 1, z) is b, item at([a], 5, z) is z. n steps.
- **replace at** : `(List a, Float64, a) -> List a`. The list with the item at a position, counting from 0, replaced by `by`; the list as it was when it has no item there. n steps.
- **take** : `(List a, Float64) -> List a`. The first count items: take([a, b, c], 2) is [a, b]; a list with fewer gives them all. count steps.
- **drop** : `(List a, Float64) -> List a`. The items after the first count: drop([a, b, c], 2) is [c]; a list with fewer gives []. count steps.
- **show numbers** : `(List Float64) -> Text`. A fold that prints. Run backwards it unfolds, so it parses.
- **empty array** : `() -> Array a`. An array with no items.
- **array of** : `(List a) -> Array a`. The array of a list's items, in order.
- **items of array** : `(Array a) -> List a`. An array's items as a list, in order: what an array stands for.
- **array length** : `(Array a) -> Int`. How many items an array has, in constant time.
- **item at** : `(Array a, Int) -[Choice]-> a`. The item at a position, counting from 0, in constant time. No answer when the position is outside the array.
- **push** : `(Array a, a) -> Array a`. The array with one more item at the end. A copy: the compiler may add in place when nothing else holds the array.
- **first of array** : `(Array a) -[Choice]-> a`. The array's first item; none of an empty array.
- **rest of array** : `(Array a) -> Array a`. The array without its first item; an empty array stays empty. It shares the items rather than copying them.
- **push front** : `(Array a, a) -> Array a`. The array with one more item at the front. Compiled JS writes into free room before the items when nothing else has taken it.
- **first of array if any** : `(Array a) -> Optional a`. The array's first item as an Option: some(item), or none of an empty array. No Choice, so nothing searches around it.

## Maps and sets

A map is kept sorted by key in compare's order, so two maps with the same entries are equal and print the same, whatever order they were built in. Keys are exact: two Float64 keys are one key only when they are the same Float64.

- **Map** (type). A map from keys to values, kept sorted by key with no key twice. Build one with empty map, as map or put (its constructor map of is private to the library, which keeps the rule); read it with value at.
- **empty map** : `Map a b`. The map with no entries.
- **as map** : `(List (Pair a b)) -> Map a b`. The map of a list of pair(key, value); when a key comes twice, the later pair wins. Keys are kept in compare's order, so a map has one spelling and folds go in key order (Haskell's Data.Map, Rust's BTreeMap).
- **put** : `(Map a b, a, b) -> Map a b`. The map with key holding value, in place of what it held.
- **update at** : `(Map a b, a, b, (b) -[e]-> b) -[e]-> Map a b`. The map with key holding change(what it held), or change(default) when it held nothing: one walk, where put(m, k, change(first(value at(m, k), default))) looks the key up twice. Counting is update at(counts, word, 0, partially(add, 1)). Haskell's Data.Map alter and Rust's entry API are the same job.
- **value at** : `(Map a b, a) -[Choice]-> b`. What key holds; no answer when the map hasn't got it, so first(value at(m, k), else d) gives a default.
- **remove key** : `(Map a b, a) -> Map a b`. The map without key.
- **has key** : `(Map a b, a) -> Bool`. Whether the map holds key.
- **merge maps** : `(Map a b, Map a b) -> Map a b`. The entries of both maps; where both hold a key, the second's value wins.
- **keys of** : `(Map a b) -> List a`. The keys, in order.
- **values of** : `(Map a b) -> List b`. The values, in the order of their keys.
- **entries of** : `(Map a b) -> List (Pair a b)`. The entries as pair(key, value), in key order.
- **map size** : `(Map a b) -> Int`. How many keys the map holds.
- **smallest key** : `(Map a b) -[Choice]-> a`. The map's smallest key, in compare's order; no answer when the map is empty. value at(m, smallest key(m)) is what it holds.
- **largest key** : `(Map a b) -[Choice]-> a`. The map's largest key, in compare's order; no answer when the map is empty.
- **empty table** : `() -> Table a b`. A hash table with no entries: how a map is stored when the compiler sees that every map has one holder (C63b). Programs say Map; the compiler picks this.
- **table put** : `(Table a b, a, b) -> Table a b`. The table with the key's value set. It changes the table itself, so the compiler uses it only where nobody can see the table before the change.
- **table remove** : `(Table a b, a) -> Table a b`. The table without the key, changed in place like put.
- **table has** : `(Table a b, a) -> Bool`. Whether the table has the key.
- **table size** : `(Table a b) -> Int`. How many keys the table has.
- **table value at** : `(Table a b, a) -[Choice]-> b`. The key's value, or no answer when the table doesn't have the key.
- **table entries** : `(Table a b) -> List (Pair a b)`. The table's entries as pairs, in compare's order of their keys: the map it stands for.
- **empty hash set** : `() -> Hash set a`. A hash set with no items: how a set is stored when the compiler sees that every set has one holder (C63d). Programs say Set; the compiler picks this.
- **hash set add** : `(Hash set a, a) -> Hash set a`. The set with the item in it. It changes the set itself, so the compiler uses it only where nobody can see the set before the change.
- **hash set remove** : `(Hash set a, a) -> Hash set a`. The set without the item, changed in place like add.
- **hash set has** : `(Hash set a, a) -> Bool`. Whether the set has the item.
- **hash set size** : `(Hash set a) -> Int`. How many items the set has.
- **hash set items** : `(Hash set a) -> List a`. The set's items in compare's order: the set it stands for.
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
- **smallest item** : `(Set a) -[Choice]-> a`. The set's smallest item, in compare's order; no answer when the set is empty, so first(smallest item(s), else d) gives a default. Nearest first in a set of pair(distance, place).
- **largest item** : `(Set a) -[Choice]-> a`. The set's largest item, in compare's order; no answer when the set is empty.

## Representations

A type can be stored as another type, written as one definition (REPRESENTATIONS.md): what a stored value means, which definitions do the type's jobs, and what each costs. The compiler picks the cheapest for the jobs a program uses; nothing changes where the values are used.

- **Representation** (type). A way to store a type t as another type r, written as one definition: representation(meaning, space, jobs), where meaning says what an r stands for and each job says which definition does one of t's jobs at r, and at what cost. The compiler picks, per program, the representation whose jobs cost least; nothing changes where the values are used. REPRESENTATIONS.md.
- **Cost** (type). What a job of a representation costs, in the size of the value: constant, logarithmic, polylogarithmic (log² n), linear, linearithmic (n log n) or quadratic.
- **job** : `(a, b, Cost) -> Job c d`. One of a representation's jobs: t's constructor or function `of`, done at r by `by`, which has of's type with r for t, at this cost.
- **as written** : `(a, Cost) -> Job b c`. One of a representation's jobs: t's constructor or function, done by its own definition, at this cost.
- **match by** : `(a, Cost) -> Job b c`. A representation's match: by(value, one function per case of t), at this cost.
- **fold by** : `(a, Cost) -> Job b c`. A representation's fold: by(value, one function per case of t, given the folded rest), at this cost.
- **match as written** : `(Cost) -> Job a b`. A representation's match, done as t's own, at this cost.
- **fold as written** : `(Cost) -> Job a b`. A representation's fold, done as t's own, at this cost.
- **equal by** : `((a, a) -> Bool) -> Job b a`. For a representation that isn't one spelling per value (a tree, whose shape depends on the order things went in): how equal sees two of its values, through their meaning.
- **show by** : `((a) -> Text) -> Job b a`. For a representation that isn't one spelling per value: how show prints one of its values, through its meaning.
- **compare by** : `((a, a) -> Order) -> Job b a`. For a representation that isn't one spelling per value: how compare orders two of its values, through their meaning.
- **head by** : `(a, b) -> Job c d`. For t's job that gives a list, a definition giving only its first item, as a list of one or nil, used where only the first item is read.
- **hides** : `(a, Int) -> Job b c`. hides(case, position): that field of t's case isn't kept as a value of t at r (a list's rest, in an array, is the items after a position), so it is made only when an arm reads it, and a fold whose arms don't read it costs only its walk.
- **in place** : `() -> Job a b`. in place(): r changes a value where t's jobs make a changed copy (a hash table's put), so it is chosen only where every value of t has one holder: nobody can see the value before the change.

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
- **Check** (type). An effect for tests: expect(holds, what) says what should hold. A definition that performs it is a test, and lab test runs it on its saved inputs and on small values, reporting every expect that failed with the inputs it failed on.
- **Console** (type). An effect: print, print error, read input and read line. A match with a case for each answers them (a test collects what was printed); with nothing around it, the console answers.
- **Files** (type). An effect: read file, write file, add to file, file exists and list folder. A match with a case for each answers them (a test gives a file of its own); with nothing around it, the file system answers.
- **Network** (type). An effect: fetch text. A match with a fetch text(url) case answers it; with nothing around it, the web answers.
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

## Waiting for several things: Await

A Ticket a is something that will give an a later: a timer, or something the world started. await(ticket) waits for it. start timer(ms) starts one at the world's clock. together runs several actions side by side, each until it awaits, and whichever ticket is ready first goes on; race gives the first to finish, and within gives none if a timer is ready first. Something around it answers await: a test's handler, or the world, which waits on its clock.

- **Ticket** (type). Something that will give an a later: await(ticket) waits for it. A timer(milliseconds, value) gives value after that long; the world's tickets come from what it started, such as start timer; first ready is any of's.
- **Await** (type). Waiting: await(ticket) gives the ticket's value once it is ready. A handler answers it later, at most once: a test's, together's, or the world's.
- **Branch** (type). What together keeps of one action: done with its value, or parked on a ticket with how to go on.
- **ticket id** : `(Ticket a) -> Ticket Unit`. The same ticket with what it gives forgotten (a Ticket Unit), so tickets of different types can go in one list for any of.
- **any of** : `(List (Ticket Unit)) -> Ticket Int`. A ticket for whichever of these tickets is ready first: await(any of(tickets)) gives its position, from 0.
- **together** : `(List (() -[Await]-> a)) -[Diverge, Await]-> List a`. Runs the actions side by side: each runs until it awaits a ticket, and whichever ticket is ready first goes on, until every action has its value. The values come back in the actions' order (as JavaScript's Promise.all).
- **race** : `(List (() -[Await]-> a)) -[Diverge, Await]-> a`. Runs the actions side by side, as together does, and gives the value of the first to finish; the others are dropped where they wait (as JavaScript's Promise.race).
- **within** : `(Float64, () -[Await]-> a) -[Diverge, Await]-> Optional a`. The action's value as some(value) if it finishes within this many milliseconds, or none if the timer is ready first; the action is then dropped where it waits.

## Cells and pages

A page is a value of type Html that main returns. Cells hold what changes; a part of the page that reads a cell is drawn again when the cell changes, and a button's handler writes cells.

- **cell** : `(a) -[Cells]-> Cell a`. A new cell holding a starting value: a value a page can change, and whose readers are redrawn when it does.
- **read** : `(Cell a) -[Cells, Diverge]-> a`. What a cell holds now. A page part that reads it is redrawn when it changes.
- **write** : `(Cell a, a) -[Update]-> Unit`. Puts a new value in a cell. Only event handlers can write.
- **formula** : `(() -[Cells, Diverge]-> a) -[Cells]-> Cell a`. A cell whose value is computed from other cells, and kept up to date when they change.
- **each** : `(Cell (List a), (a) -[Cells, Diverge]-> b) -[Cells]-> Cell (List b)`. A cell holding f of each item of a list cell, where an item that stays keeps what f gave it. After insert at, remove at, move at or an edit inside one item, only that item's row is made or dropped; nothing else runs again.
- **each of** : `(List a, (a) -[Cells, Diverge]-> b) -[Cells]-> Cell (List b)`. each, over a list inside a cell's value as a row has it (its item's steps): after an edit of that list or inside one of its items, only that item's row is made or dropped, and the row the list is in isn't made again. Over a plain list, the list mapped once.
- **path** : `((a) -> b) -> Path a b`. A place inside a cell's value, from a field or a path of fields: path((t) ↦ t.title), or path((t) ↦ t) for the whole value. Edits and read at use it.
- **item path** : `(Path a (List b), Int) -> Path a b`. Item i of the list at a place, counting from 0: item path(path((t) ↦ t), 3) is the fourth item of a cell's list.
- **then path** : `(Path a b, Path b c) -> Path a c`. The second place inside the first: then path(item path(all, 3), path((i) ↦ i.title)) is the fourth item's title.
- **read at** : `(Cell a, Path a b) -[Cells, Diverge, Choice]-> b`. What is at a place in a cell's value. A page part that reads it is redrawn only when that place changes, not when another item does. No answer when the place isn't there (an item past the end).
- **write at** : `(Cell a, Path a b, b) -[Update]-> Unit`. Puts a value at a place in a cell's value; only what read that place, or a place inside or around it, runs again. A place that isn't there changes nothing. Only event handlers can write.
- **insert at** : `(Cell a, Path a (List b), Int, b) -[Update]-> Unit`. Puts an item into the list at a place, before item i (at the end when i is past it).
- **remove at** : `(Cell a, Path a (List b), Int) -[Update]-> Unit`. Takes item i out of the list at a place; nothing when there's no item i.
- **move at** : `(Cell a, Path a (List b), Int, Int) -[Update]-> Unit`. Moves item `from` of the list at a place to position `to`; nothing when either isn't there.
- **Html** (type). A page: elements with attributes and children, text, and parts that are drawn again when what they read changes.
- **Attribute** (type). Something attached to a page element: a property (name and value), an on(event, then) handler, or a sound to play when it's clicked.
- **Event** (type). What a page's handler is given when its event comes: the field's value, the key pressed, where the pointer is (x, y: in a picture's own units inside an SVG, else pixels from the element's top-left; 0, 0 without a pointer). on("frame", …) comes once each time the browser draws, while its element is on the page, and its seconds are the time since the frame before (0 the first time and for other events): a simulation steps there, as far as that time needs.
- **Input** (type). Where a sound's samples come from: the microphone, or a recording at an address.
- **View** (type). A named row: what a page's text, part or attribute value may do. Read cells, the clock and the web, log, and run under a step budget (Cells, Diverge, Time, Network, Log). Not print: a view runs whenever what it reads changes.
- **Handler** (type). A named row: what a page's event handler may do. Everything a view may, and write cells, print, use files, draw random numbers and abort (the page logs the reason).
- **Sound** (type). A named row: what a sound's block function may do on the audio thread. Read and write its cells, draw random numbers (seeded, so a render repeats), and run under a step budget. Nothing that waits or prints.
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
- **button** : `(Text, (Event) -[Handler]-> Unit) -> Html` (html module). A button with this label that runs then when it's clicked.
- **input** : `(List Attribute) -> Html` (html module). An input field: it has attributes and no children.
- **attribute** : `(Text, Text) -> Attribute` (html module). An attribute whose value doesn't change.
- **with** : `(List Attribute, Html) -> Html` (html module). The same element with these attributes added after its own. Text and parts have no attributes, so they come back as they are.
- **styled** : `(Text, Html) -> Html` (html module). The same element with this inline style (CSS declarations, such as color: #777; margin: 0).
- **named** : `(Text, Html) -> Html` (html module). The same element with this id.
- **classed** : `(Text, Html) -> Html` (html module). The same element in this class, for a style sheet's rules to select.
- **for each** : `(Cell (List a), (a) -[Cells, Diverge]-> b, (List b) -[View]-> Html) -[Cells]-> Html` (html module). The items of a cell's list, each drawn by row and all put inside (ul, div, …). An item still there when the list changes keeps its row as it was; only new items get one. Solid's <For> (prior art).
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
- **unit** : `(a) -[Choice]-> a` (vectors module). v scaled to length 1 (normalize on a GPU).
- **mix** : `(a, a, Float64) -> a` (vectors module). a when amount is 0, b when it is 1, and in between, part by part.
- **clamp** : `(a, Float64, Float64) -> a` (vectors module). Every part of v kept between low and high.
- **reflect** : `(a, a) -> a` (vectors module). A ray going this direction, bounced off a surface facing normal (normal of length 1).
