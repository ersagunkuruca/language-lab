# Linear maps, geometry and matrices

**Status (2026-10-31).** Partly built. L44a (#570) gave std `Mat2`, `Mat3`
and `Mat4`: records of Float64s in rows that join the one `+ − ·`. Their
`·` is `table product` with the prelude's `matrix table`. Matrix times
vector was the next step (BACKLOG L44). Layer 2 is built (L44b,
2026-10-31): the prelude's `clifford sandwich`, `clifford reflect`,
`clifford project` and `clifford exp` turn, mirror, project and move, for
any signature, with PGA motors moving points (test/clifford.test.ts).
Layer 1 has begun (L44c): src/lang/linear.ts reads a function's matrix
and offset from its graph, or says it isn't affine. The compiler's use of
it began with C30b: in compiled JS a linear function applied to another,
f(g(x)), is one matrix product folded at compile time, written as
multiply-adds, when that is fewer of them (compile.ts `linearCall`). Its
constants round once, so the last bits can differ from the evaluator's.
In WGSL (C30c) a vector whose parts are one other vector's parts times
constants prints as `mat3x3f(…) * v + b`, and a composition is one matrix
there too (wgsl.ts `affine`). Since C65 (stage.ts) a call given its
algebra as data, such as `clifford sandwich([1, 1, 1, 0], basis, motor,
p)`, is worked out when compiled into plain arithmetic, so layer 2 reaches
shaders, and a motor known now moving a point (x, y, z, w) prints as
`mat4x4f(…) * p`: the homogeneous matrix of `vec4(x, y, z, 1)` is the PGA
motor, read off by the compiler. Layer 3 is not built.

Ersagun (2026-10-31) moved the question. A matrix shouldn't be the way a
program says "transform this vector". Geometry has better words for it,
and a large matrix isn't geometry at all. This note splits the work into
three layers, each with its own job.

## Three layers

### 1. Linear maps are functions; a matrix is how the compiler stores one

A program writes a transform as a function on its own records:
`shear = (v) ↦ vec3(v.x + 0.5 · v.y, v.y, v.z)`. When the function is
linear in its input, the compiler can store and run it as a matrix. On a
GPU that is `mat3x3f * v`; elsewhere it is nine multiplies and adds, and
composing two such functions is one matrix product. This is the same rule
as for numbers: the program says what it means, and the compiler chooses
the representation (data/REPRESENTATIONS.md, WAYS.md, and Ersagun's "no
explicit selection").

- Every linear map fits here: shears, skews, non-uniform scales,
  projections onto a plane, and the 4 × 4 projective maps of a camera.
  Perspective is projective, with a divide at the end, written as the
  function it is.
- What the compiler needs: recognising linearity (each output a sum of
  inputs times constants, which `derive.ts` already reads for slopes),
  extracting the coefficients, and a cost that says when the matrix form
  pays off. This is C30's "representation from use", applied to functions.
- `Mat2` to `Mat4` stay as values for programs that hold a matrix as data
  (a camera's matrix sent to a shader). They become the representation's
  vocabulary, not the way to apply a transform.

### 2. Geometry with Clifford algebras, at small sizes

The prelude already has `clifford table` and `clifford reverse`
(ALGEBRA-TABLES.md). In geometric algebra:

| transform | as |
|---|---|
| rotation | a rotor, `R v R̃` |
| reflection in a plane with normal n | `−n v n` |
| uniform scale | a scalar |
| translation, rigid motion | a motor in projective GA (3D PGA, 16 elements) |
| projection onto a line or plane B | `(v · B) B⁻¹` |

Rotors compose by multiplying, interpolate smoothly, and don't drift the
way matrices do. Shears and non-uniform scales aren't elements of the
algebra. They are linear functions (outermorphisms), so they belong in
layer 1. The tables have 2ⁿ elements, so this layer is for n ≤ 4 or 5.
It's not for general dimensions.

### 3. A linear-algebra library for any size

A 1000-by-1000 system isn't geometry. It needs `Vector a` and
`Matrix a`, any size, over any number type, with matrix times vector,
products, solving (LU, least squares) and decompositions.

- Stored as flat arrays (DATA-STRUCTURES.md, IN-PLACE.md). Dense or sparse is the
  compiler's choice from how the matrix is built and used: a
  representation, as Map's tree is.
- A size mismatch is an error. The size isn't in the type yet (that needs
  numbers in types), so it is checked when the program runs, and says
  which sizes didn't match.
- Prior art to credit: BLAS and LAPACK's operations, NumPy's array
  semantics, and Julia's structured matrix types (dispatch on Diagonal,
  Symmetric, Sparse).

## Order

1. Layer 2 first: rotors and reflections written with the existing
   Clifford tables, plus the PGA table for 3D motions. It is all language,
   with no compiler change, and covers what games and shaders do most.
2. Layer 1: the compiler recognises linear functions and stores them as
   matrices. This needs C30's machinery, so it goes with lane C.
3. Layer 3: the library, when a program needs it. A bigger-program round
   (GAPS.md) is the place to find that program.

Ersagun decides. Each step is one or more backlog rows when agreed.
