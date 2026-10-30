# Small matrices: what's left

**Status (2026-10-30).** Partly built. L44a (#570) gave std `Mat2`, `Mat3`
and `Mat4`: records of Float64s in rows that join the one `+ − ·`. Their
`·` is `table product` with the prelude's `matrix table`. Left in BACKLOG
L44: matrix times vector, and `mat4x4f` on the GPU (with lane C, L41).
This note is the choice matrix times vector needs.

## The problem

A vector is any record of Float64s, such as a program's own `Vec3` or
`Colour` (the vectors module). Matrix times vector has to give back the
same record type, with part i equal to Σ_j m_ij · v_j. The parts builtins
are `map parts`, `zip parts` and `total`. None of them knows a part's
position, so they can't pair m's row i with v, or build a record of v's
type from computed numbers. Without one more thing in the language,
matrix times vector can't be written.

## Two ways

1. **Std vectors.** Add `Vec2`, `Vec3` and `Vec4` (x, y, z, w) to std
   beside the matrices. `Mat3 · Vec3` is then an ordinary prelude
   definition, and on a GPU it is `mat3x3f * vec3f`.
   - Cost: a program's own `Vec3` doesn't get it. Programs would move to
     std's, and the vectors module's "any record of Float64s" stays for
     everything else.
2. **Parts by position.** One builtin, `parts with place(f, v)`, a
   `map parts` whose f is also given the part's place (0, 1, …), and one
   more, `part(v, i)`. Then `m · v` is written once for any record of the
   right size: part i of the result is `total` of row i times v.
   - Cost: two builtins in every target, and a size the checker can't see
     (a 3 × 3 matrix times a 2-part record fails when it runs, unless the
     type of a record says how many parts it has).

## Recommendation

Way 1. It keeps everything checked by type, needs no new builtin, and
matches what shaders have (GLSL and WGSL have the same `vecN` and `matN`).
Way 2 is more general, but the size check it loses is the one mistake
matrix code makes most. Ersagun decides.
