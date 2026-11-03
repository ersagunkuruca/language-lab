# Aspects of a good programming language

## Core semantics

1. **Clear, precise specification**: A written spec (formal or rigorous prose) defines what programs mean, so implementations agree and users can reason without guessing.
2. **Small, orthogonal core**: A few primitives that combine freely keep the language learnable and make features interact predictably.
3. **Consistency**: Similar things look and behave alike, which reduces surprises and the number of special cases to memorize.
4. **Principle of least surprise**: Default behavior matches what a reasonable programmer expects, which cuts down on subtle bugs.
5. **Well-defined evaluation order**: Specifying the order in which arguments and expressions are evaluated removes a whole class of portability and heisenbug problems.
6. **No undefined behavior (or minimal, explicit UB)**: Every program either has a defined meaning or is rejected, so optimizers cannot silently break code.
7. **Lexical scoping**: Names resolve by where they appear in the source, which makes code readable and refactorable.
8. **Immutability by default**: Values that cannot change unless opted in make reasoning, sharing and concurrency safer.
9. **Explicit mutability**: When mutation exists it is visible at the declaration or use site, so readers know what can change.
10. **Value vs. reference semantics clarity**: It is obvious whether assignment copies or aliases, which prevents aliasing bugs.
11. **Expression-oriented design**: Most constructs (if, match, blocks) produce values, which reduces temporary variables and boilerplate.
12. **Deterministic semantics**: Given the same inputs, programs behave the same way (outside explicit nondeterminism), which aids testing and debugging.
13. **Sound equality and identity**: Clear, separate notions of structural equality and identity avoid confusing comparisons.
14. **Well-behaved initialization**: Variables cannot be read before they are initialized, which removes garbage-value bugs.
15. **No implicit null**: Absence is represented explicitly (e.g. Option/Maybe) rather than lurking in every reference, avoiding the "billion-dollar mistake".
16. **Controlled implicit conversions**: Few or no silent coercions between types, so meaning is not changed behind the programmer's back.
17. **Pattern matching**: Destructuring and matching on data shapes makes branching on structured data concise and checkable.
18. **Exhaustiveness checking**: The compiler warns when a match misses cases, so adding a variant surfaces every place that must handle it.

## Syntax and readability

19. **Readable syntax**: Code reads close to its intent, since code is read far more often than it is written.
20. **Unambiguous grammar**: A grammar that parses one way (ideally context-free and LL/LR-friendly) helps both humans and tools.
21. **Low ceremony**: Little boilerplate is needed for common tasks, keeping signal-to-noise high.
22. **Not too terse**: Avoiding cryptic operator soup keeps code accessible to newcomers and reviewers.
23. **Consistent naming conventions**: One community-wide naming style makes any codebase feel familiar.
24. **Meaningful keywords**: Keywords say what they do, which lowers the learning curve.
25. **Good literal syntax**: Convenient literals for numbers, strings, lists, maps, regexes and durations make data easy to write.
26. **Numeric separators and bases**: Underscores in literals and binary/hex/octal forms improve readability of constants.
27. **Multiline and raw strings**: Embedding text, regexes and code snippets without escape hell reduces errors.
28. **String interpolation**: Embedding expressions in strings is clearer and safer than manual concatenation.
29. **Comments and doc comments**: First-class syntax for comments and structured documentation keeps docs next to code.
30. **Whitespace robustness**: Formatting changes do not silently change meaning (or, if significant, the rules are simple and enforced).
31. **Greppability**: Definitions and uses can be found with plain text search, which helps navigation without heavy tools.
32. **Unicode identifiers (with care)**: Allowing non-ASCII names supports non-English speakers, ideally with confusable-character safeguards.
33. **Operator precedence that is simple**: A small, intuitive precedence table avoids misread expressions.
34. **Trailing comma support**: Allowing trailing commas makes diffs cleaner and editing easier.
35. **Named and default arguments**: Call sites become self-documenting and APIs can evolve without breaking callers.

## Type system

36. **Static typing (or optional gradual typing)**: Catching type errors before running saves debugging time and documents intent.
37. **Type inference**: Local inference removes redundant annotations while keeping safety.
38. **Soundness**: Well-typed programs do not go wrong at runtime in ways the types claim to prevent, so the types can be trusted.
39. **Algebraic data types**: Sum and product types model domains precisely and make illegal states unrepresentable.
40. **Generics / parametric polymorphism**: Writing code once for many types avoids duplication without losing type safety.
41. **Bounded polymorphism / traits / typeclasses / interfaces**: Constraining generics by capabilities enables reusable, abstract code.
42. **Structural or nominal choice made deliberately**: Clear rules on when types are compatible avoid accidental or overly rigid compatibility.
43. **Newtypes / distinct type aliases**: Zero-cost wrappers stop mixing up values like UserId and OrderId.
44. **Nullability in the type system**: The type says whether a value can be absent, so missing checks become compile errors.
45. **Variance handled correctly**: Covariance and contravariance rules prevent unsound container substitutions.
46. **Type-level constants / const generics**: Parameterizing over values like array lengths enables safer, faster code.
47. **Associated types and higher-kinded abstraction (where justified)**: Expressive abstraction lets libraries capture common patterns once.
48. **Flow-sensitive typing / narrowing**: Types refine after checks, so code does not need redundant casts.
49. **Readable type errors**: Type mismatches are explained in terms the programmer wrote, not internal unification noise.
50. **Escape hatches that are explicit**: Unsafe casts or dynamic types exist but are visibly marked and searchable.
51. **Units of measure or refinement types (optional)**: Encoding physical units or value constraints catches whole categories of domain bugs.
52. **Reasonable compile-time cost of types**: Type checking stays fast and predictable, avoiding exponential blowups.
53. **Runtime type information when needed**: Reflection or type tags are available for serialization and debugging without being mandatory.

## Data and data structures

54. **Rich built-in collections**: Lists, maps, sets, queues and deques are available and efficient out of the box.
55. **Persistent / immutable collections**: Efficient immutable structures make functional styles and sharing practical.
56. **Records / structs with named fields**: Lightweight named aggregates make data self-describing.
57. **Tuples**: Ad-hoc grouping of values is convenient for returns and small aggregates.
58. **Enums with payloads**: Tagged variants carrying data model states and messages cleanly.
59. **Slices and views**: Borrowed windows onto arrays and strings avoid copying.
60. **Iterators and lazy sequences**: Uniform iteration and lazy pipelines handle large or infinite data efficiently.
61. **Comprehensions or pipeline syntax**: Concise transformations of collections improve readability.
62. **Predictable data layout control**: Control over packing, alignment and field order matters for performance and interop.
63. **Serialization support**: Easy, safe conversion to and from JSON, binary formats and others is essential for real systems.
64. **Derivable boilerplate**: Equality, hashing, ordering, printing and cloning can be generated automatically.
65. **Deterministic iteration order options**: Ordered maps or documented ordering avoid flaky outputs.
66. **Date and time types**: Correct, timezone-aware time types prevent notoriously common bugs.

## Functions and abstraction

67. **First-class functions**: Functions as values enable callbacks, higher-order utilities and composition.
68. **Closures**: Capturing surrounding variables lets small functions carry context naturally.
69. **Clear capture semantics**: It is obvious whether closures capture by value or reference, avoiding loop-variable bugs.
70. **Anonymous function syntax that is short**: Lightweight lambdas make functional APIs pleasant.
71. **Multiple return values or tuples**: Returning several results avoids out-parameters.
72. **Variadic functions done safely**: Variable argument lists are type-checked.
73. **Method syntax / uniform call syntax**: Chaining calls on values reads left-to-right.
74. **Composition over inheritance**: Mechanisms like interfaces, traits and delegation avoid fragile class hierarchies.
75. **Encapsulation and visibility control**: Hiding internals lets libraries change without breaking users.
76. **Macros or metaprogramming (hygienic)**: Compile-time code generation removes boilerplate without the pitfalls of textual macros.
77. **Compile-time evaluation**: Running ordinary code at compile time computes constants and tables without separate tools.
78. **Tail calls or guaranteed recursion safety**: Recursive algorithms do not blow the stack unexpectedly.
79. **Overloading discipline**: Overloading, if present, stays limited and resolvable, avoiding ambiguous calls.
80. **Operator overloading with restraint**: Math-like types read naturally without enabling unreadable abuse.
81. **Zero-cost abstractions**: High-level constructs compile to code as efficient as hand-written low-level code.
82. **Purity annotations or inference**: Knowing which functions are pure helps reasoning, caching and parallelization.

## Modules and namespaces

83. **Module system**: Code is organized into units with explicit imports and exports, keeping large programs manageable.
84. **Namespaces that avoid collisions**: Qualified names prevent clashes between libraries.
85. **Explicit imports**: The origin of every name is clear, which helps readers and tools.
86. **No circular-dependency pain**: Cycles are either handled cleanly or reported clearly.
87. **Separate compilation**: Modules compile independently, enabling incremental builds.
88. **Stable module interfaces**: Public APIs can be versioned and checked for breaking changes.
89. **File-to-module mapping that is simple**: It is easy to find which file defines a module.
90. **Re-exports and facades**: Libraries can present a curated public surface.
91. **Conditional compilation**: Platform- or feature-specific code is selected cleanly without preprocessor chaos.

## Error handling

92. **Explicit error handling model**: One clear, idiomatic way to report and handle failures avoids inconsistent styles.
93. **Errors visible in signatures**: Types such as Result, or checked effects, show which functions can fail.
94. **Ergonomic propagation**: Concise operators (like ?) pass errors up without boilerplate.
95. **Rich error context**: Errors can carry causes, messages and backtraces for diagnosis.
96. **Distinction between bugs and expected failures**: Panics or asserts for programmer errors are kept separate from recoverable errors, clarifying intent.
97. **Resource cleanup on failure**: Defer, RAII, finally or using blocks guarantee cleanup on every path.
98. **No silently swallowed errors**: Unused error results trigger warnings.
99. **Stack traces**: Readable traces with source locations speed up debugging.
100. **Assertions and contracts**: Preconditions, postconditions and invariants document and enforce assumptions.

## Effects and side effects

101. **Controlled side effects**: Side effects are visible or tracked, making code easier to reason about and test.
102. **Effect systems or capability passing (optional)**: Tracking I/O, allocation or exceptions in types enables stronger guarantees.
103. **Explicit global state**: Globals are discouraged or clearly marked, reducing hidden coupling.
104. **Dependency injection friendliness**: Effects can be swapped for tests without heavy frameworks.
105. **Deterministic replayability**: Randomness and time can be injected or seeded for reproducible runs.
106. **Async coloring addressed**: The language limits the friction between sync and async code, avoiding ecosystem splits.

## Concurrency and parallelism

107. **First-class concurrency model**: Threads, tasks, actors or CSP channels are built in and coherent.
108. **Data-race freedom**: The type system or runtime prevents unsynchronized shared mutation.
109. **Structured concurrency**: Child tasks are scoped to their parent, preventing leaks and lost errors.
110. **Lightweight tasks / green threads**: Very many concurrent tasks are cheap, enabling scalable servers.
111. **Async/await or equivalent**: Asynchronous code reads sequentially.
112. **Cancellation and timeouts**: Work can be stopped cleanly, which is vital for robust services.
113. **Channels and message passing**: Communicating by messages simplifies coordination.
114. **Synchronization primitives**: Mutexes, atomics, RW locks, condition variables and barriers are available and correct.
115. **Well-defined memory model**: A clear concurrency memory model lets low-level code be correct across hardware.
116. **Data parallelism**: Parallel iterators, SIMD and work stealing exploit multicore hardware easily.
117. **GPU / accelerator access**: Paths to GPU compute matter for ML, graphics and science.
118. **Deadlock and race detection tools**: Sanitizers and analyzers find concurrency bugs.
119. **Thread-safe standard library**: It is documented which types and functions are safe to share.

## Memory and resources

120. **Memory safety**: No use-after-free, buffer overflow or double-free in safe code, which eliminates major bug and security classes.
121. **Automatic memory management or ownership**: GC, reference counting or ownership/borrowing frees programmers from manual bookkeeping.
122. **Predictable latency**: Low-pause or no-GC options suit real-time and interactive work.
123. **Deterministic destruction / RAII**: Resources (files, locks, sockets) are released at known points.
124. **Control over allocation**: Custom allocators, arenas and stack allocation are available for performance-critical code.
125. **Memory usage visibility**: Object sizes and allocation behavior are easy to inspect and reason about.
126. **Leak detection**: Tools find leaks and unbounded growth.
127. **Bounds checking**: Array accesses are checked by default, with explicit opt-out when proven safe.
128. **Unsafe subset clearly fenced**: Low-level operations are confined to marked regions that can be audited.

## Performance and compilation

129. **Good baseline performance**: Idiomatic code runs fast enough that rewrites are rarely needed.
130. **Optimizing compiler or JIT**: Mature optimization yields competitive speed.
131. **Fast compile times**: Quick builds keep the edit-compile-run loop tight and developers productive.
132. **Incremental compilation**: Only changed parts are rebuilt.
133. **Predictable performance model**: Programmers can estimate cost from source without hidden expensive operations.
134. **Low startup time**: Fast startup matters for CLIs, serverless and scripts.
135. **Small binaries / deployable artifacts**: Compact outputs ease distribution and embedded use.
136. **Static linking / single-binary deploys**: Shipping one self-contained executable simplifies operations.
137. **Ahead-of-time and JIT options**: Choosing compilation strategy per use case broadens applicability.
138. **SIMD and intrinsics access**: Hardware-specific speedups are reachable when needed.
139. **Link-time and profile-guided optimization**: Extra performance is available for production builds.
140. **Reproducible builds**: The same source yields bit-identical outputs, aiding security and caching.
141. **Debug vs. release modes**: Developer-friendly checks in debug, speed in release.

## Numerics

142. **Well-specified integer semantics**: Overflow behavior (trap, wrap or saturate) is defined and selectable.
143. **Sized integer types**: Exact-width types (i8 to i128, unsigned) suit systems and binary formats.
144. **Arbitrary-precision integers**: Big integers are available for cryptography and exact math.
145. **IEEE 754 floating point compliance**: Standard float behavior gives portable, analyzable numeric results.
146. **Decimal types**: Exact decimal arithmetic is needed for money and finance.
147. **Rationals and complex numbers**: Built-in or library types support scientific computing.
148. **Numeric conversions that are explicit and checked**: Lossy casts are visible and fallible conversions return errors.
149. **Math library breadth**: Trigonometric, special functions, statistics and linear algebra are available.
150. **N-dimensional arrays ecosystem**: Efficient arrays and tensors enable data science and ML.
151. **Deterministic random numbers**: Seedable, high-quality PRNGs plus a cryptographically secure source.

## Text and strings

152. **Unicode-correct strings**: Strings handle all of Unicode properly, avoiding mangling non-English text.
153. **Clear encoding model**: A defined internal encoding (e.g. UTF-8) and explicit byte/string distinction prevent mojibake.
154. **Grapheme, code point and byte APIs**: Text can be iterated at the right granularity for the task.
155. **Efficient string building**: Builders or ropes avoid quadratic concatenation.
156. **Regular expressions**: A safe, fast regex engine (ideally linear-time) is available.
157. **Formatting and parsing utilities**: Robust number/date formatting and parsing exist.
158. **Localization and internationalization**: Locale-aware formatting, collation and message catalogs support global users.
159. **Normalization and case folding**: Correct comparison of text across Unicode forms.

## I/O and the outside world

160. **File system API**: Portable, safe file and path handling exists.
161. **Path handling that is cross-platform**: Path types handle Windows/Unix differences.
162. **Networking**: TCP, UDP, TLS, HTTP clients and servers are available, ideally in or near the stdlib.
163. **Process management**: Spawning processes, pipes, signals and environment variables are handled safely.
164. **Buffered and streaming I/O**: Efficient streaming handles large data without loading it all.
165. **Async I/O**: Non-blocking I/O integrates with the concurrency model.
166. **Standard data formats**: JSON, CSV, XML, YAML, TOML and protobuf support.
167. **Database access**: Mature drivers and safe query building (parameterized queries).
168. **Logging and tracing**: Structured logs and distributed tracing for observability.
169. **Metrics and telemetry hooks**: Instrumentation for production monitoring.
170. **Command-line argument parsing**: Easy CLI construction.
171. **Configuration handling**: Reading env vars and config files ergonomically.
172. **Time and clocks**: Monotonic and wall clocks distinguished to avoid timing bugs.

## Interop and FFI

173. **C ABI interop**: Calling and being called from C unlocks the world's existing libraries.
174. **Low-overhead FFI**: Foreign calls are cheap, so wrapping native libraries is viable.
175. **Binding generators**: Tools generate bindings from headers or IDLs automatically.
176. **Interop with major platforms**: Integration with the JVM, .NET, JavaScript, Python or Objective-C/Swift where relevant.
177. **Embeddability**: The language can be embedded as a scripting or extension language in host apps.
178. **Exportable libraries**: Code can be compiled as shared or static libraries for other languages.
179. **Gradual migration paths**: Mixing with an existing codebase allows incremental adoption.

## Targets and portability

180. **Cross-platform support**: Linux, macOS and Windows are first-class targets.
181. **Easy cross-compilation**: Building for other OSes and architectures from one machine.
182. **WebAssembly target**: Running in browsers and sandboxed runtimes broadens reach.
183. **Embedded / bare-metal support**: No-std or freestanding modes allow microcontroller use.
184. **Mobile targets**: iOS and Android support for app development.
185. **Multiple architectures**: x86-64, ARM64, RISC-V and more.
186. **Consistent behavior across platforms**: Code behaves the same everywhere unless explicitly platform-specific.
187. **Containers and cloud friendliness**: Small images and fast cold starts.

## Standard library

188. **Batteries included (but curated)**: A broad, high-quality stdlib covers common needs without hunting for packages.
189. **Consistent stdlib API design**: Uniform naming and conventions make the stdlib guessable.
190. **Stable stdlib**: Core APIs rarely break, protecting user code.
191. **Well-documented stdlib**: Every function has docs and examples.
192. **Small optional core for constrained environments**: A minimal subset suits embedded or wasm use.
193. **Cryptography primitives**: Vetted hashing, encryption and secure random generation reduce rolled-your-own crypto.
194. **Compression and archives**: gzip, zstd, zip and tar support.
195. **Testing utilities in the stdlib**: Basic testing works with no extra dependencies.

## Tooling

196. **Excellent compiler error messages**: Clear, located, actionable errors with suggestions save enormous time.
197. **Warnings that matter**: Useful warnings with low false-positive rates and configurable levels.
198. **Official formatter**: One canonical format ends style debates and simplifies reviews.
199. **Linter**: Catches suspicious patterns and anti-idioms beyond the compiler.
200. **Auto-fixes**: Tools can apply suggested fixes and migrations automatically.
201. **Language server (LSP)**: Completion, go-to-definition, rename and hover in any editor.
202. **IDE support**: Rich integration in popular IDEs boosts productivity.
203. **Refactoring tools**: Safe automated renames, extractions and moves.
204. **Debugger**: Source-level debugging with breakpoints, watches and stepping.
205. **Time-travel / record-replay debugging**: Reproducing and rewinding hard bugs.
206. **Profiler**: CPU, memory and allocation profiling to find bottlenecks.
207. **REPL / interactive shell**: Quick experimentation and exploration.
208. **Notebooks / playground**: Online or notebook environments for sharing and teaching.
209. **Hot reload**: Changing code without restarting speeds UI and server development.
210. **Static analyzers and sanitizers**: Deeper analysis for memory, concurrency and undefined behavior.
211. **Code navigation and indexing**: Cross-reference search across large codebases.
212. **Single unified toolchain command**: One tool for build, test, run, format and docs simplifies onboarding.
213. **Toolchain version manager**: Easily installing and switching language versions.
214. **Fast tooling**: Tools themselves are quick, keeping feedback loops short.

## Testing

215. **Built-in test framework**: Writing and running tests is trivial and conventional.
216. **Unit, integration and doc tests**: Different test levels, including executable examples in docs.
217. **Property-based testing**: Generated inputs find edge cases humans miss.
218. **Fuzzing support**: Integrated fuzzers find crashes and security bugs.
219. **Mocking and fakes**: Isolating units from dependencies.
220. **Code coverage tools**: Showing what tests exercise.
221. **Benchmarking harness**: Statistically sound microbenchmarks.
222. **Snapshot / golden testing**: Easy regression testing of outputs.
223. **Parallel and deterministic test runs**: Fast, non-flaky test suites.
224. **Formal verification options**: Provers or model checkers for critical code.
225. **Mutation testing**: Assessing test suite quality.

## Build and packages

226. **Official package manager**: A standard way to find, install and publish libraries.
227. **Central package registry**: A discoverable hub with search, docs and metadata.
228. **Semantic versioning culture**: Version numbers communicate compatibility.
229. **Lockfiles**: Exact dependency pinning for reproducible builds.
230. **Dependency resolution that is fast and sound**: Conflicts are resolved or explained clearly.
231. **Multiple versions or isolation**: Avoiding dependency hell via isolation or side-by-side versions.
232. **Workspaces / monorepo support**: Managing many packages together.
233. **Declarative build configuration**: Builds are described in simple config rather than imperative scripts where possible.
234. **Build caching**: Local and remote caches speed up CI and teams.
235. **Feature flags for packages**: Optional functionality without bloat.
236. **Private registries and mirrors**: Enterprise and offline use.
237. **Vendoring support**: Copying dependencies in for hermetic builds.
238. **Easy project scaffolding**: Templates for starting new projects.
239. **CI integration**: Smooth use in common CI systems.

## Security and safety

240. **Safe defaults**: The easy path is the secure path (e.g. parameterized queries, escaped output).
241. **Supply chain security**: Signed packages, provenance and audit tooling guard against malicious dependencies.
242. **Vulnerability advisories database**: Known vulnerable versions are flagged automatically.
243. **Sandboxing and capabilities**: Limiting what code can access (filesystem, network).
244. **Taint tracking or injection resistance**: Preventing untrusted input from reaching dangerous sinks.
245. **Secure memory handling for secrets**: Zeroization and constant-time operations for crypto.
246. **Integer overflow protection**: Avoiding overflow-based exploits.
247. **Minimal unsafe usage auditing**: Tools report where unsafe code lives in dependencies.
248. **Security response process**: Clear channels and timely fixes for language and stdlib vulnerabilities.
249. **Safety certification paths**: Suitability for regulated domains (automotive, aerospace, medical).

## Evolution and versioning

250. **Backward compatibility**: Old code keeps working, protecting investments.
251. **Editions or opt-in breaking changes**: The language can evolve without splitting the ecosystem.
252. **Automated migration tools**: Upgrades are mechanized rather than manual.
253. **Deprecation process**: Warnings and timelines before removal.
254. **Predictable release cadence**: Regular releases let users plan.
255. **Long-term support versions**: Stable versions for enterprises.
256. **Transparent feature proposal process**: RFCs or PEPs explain and debate changes publicly.
257. **Experimental / nightly features**: Trying features before stabilization.
258. **Multiple implementations (optional)**: Independent implementations keep the spec honest and reduce vendor lock-in.

## Documentation and learning

259. **Official tutorial / book**: A high-quality, free introduction.
260. **Reference documentation**: Complete, precise reference for every feature.
261. **API docs generator**: Generating browsable docs from source comments.
262. **Centralized hosted docs for packages**: Every published library gets docs automatically.
263. **Examples and cookbooks**: Task-oriented recipes speed real work.
264. **Gentle learning curve**: Beginners can be productive quickly while depth remains.
265. **Teaching friendliness**: Suitable for education, with simple subsets.
266. **Translated documentation**: Reaching non-English speakers.
267. **Style guide and idioms**: Shared conventions for idiomatic code.
268. **Migration guides from other languages**: Lowering adoption barriers.
269. **Searchable error index**: Each error code links to an explanation.

## Community and governance

270. **Welcoming community**: Inclusive, helpful spaces attract and retain users.
271. **Code of conduct**: Clear expectations for behavior.
272. **Transparent governance**: Known decision-makers and processes.
273. **Sustainable funding**: Foundations or sponsors ensure long-term maintenance.
274. **Not dependent on one company's whim**: Reduces risk of abandonment or hostile changes.
275. **Open-source implementation**: Inspectable, forkable, community-contributable.
276. **Permissive licensing**: The toolchain and stdlib license allows commercial use.
277. **Active maintenance**: Bugs are fixed and issues are triaged.
278. **Q&A and forums**: Places to get help (forums, chat, Stack Overflow).
279. **Conferences and meetups**: Knowledge sharing and community building.
280. **Hiring pool and industry adoption**: Employers and developers can find each other.
281. **Healthy library ecosystem**: Many maintained libraries across domains.
282. **Library quality signals**: Downloads, maintenance status and reviews help choose dependencies.

## Domains and application areas

283. **Web backend frameworks**: Mature HTTP frameworks, routing, middleware and ORMs.
284. **Web frontend story**: Compiling to JS/wasm or UI frameworks for browsers.
285. **GUI toolkits**: Native or cross-platform desktop UI libraries.
286. **Mobile app development**: Frameworks and tooling for phone apps.
287. **Graphics APIs**: Bindings to Vulkan, Metal, DirectX, OpenGL and WebGPU.
288. **Game development**: Engines, ECS libraries and real-time performance.
289. **Audio**: Low-latency audio I/O, DSP and synthesis libraries.
290. **Image and video processing**: Codecs and processing libraries.
291. **Data science and ML**: Dataframes, plotting, ML frameworks and notebooks.
292. **Scientific and HPC computing**: MPI, BLAS/LAPACK and distributed computing.
293. **Systems programming**: OS kernels, drivers and low-level tools.
294. **Scripting and automation**: Quick scripts with shebang support and easy deployment.
295. **Distributed systems**: RPC, serialization, consensus and service frameworks.
296. **Embedded and IoT**: HALs, RTOS integration and tiny footprints.
297. **Blockchain / smart contracts (where relevant)**: Verifiable, deterministic execution.
298. **Domain-specific language embedding**: Building internal DSLs elegantly.

## Accessibility, ergonomics and human factors

299. **Low cognitive load**: Few concepts must be held in mind to understand code.
300. **Local reasoning**: Code can be understood without reading the whole program.
301. **Good defaults over configuration**: Sensible defaults reduce decisions.
302. **One obvious way to do common things**: Reduces bikeshedding and inconsistent codebases.
303. **Accessible tooling**: Screen-reader-friendly output and colorblind-safe diagnostics.
304. **Error messages free of jargon**: Novices understand what went wrong.
305. **Scales from scripts to large systems**: Useful for quick hacks and million-line codebases alike.
306. **Team-friendly**: Supports code review, ownership boundaries and onboarding.
307. **Joy and expressiveness**: Pleasant to write, which sustains motivation and community.

## Operations and production

308. **Observability built in**: Runtime introspection, health metrics and debug endpoints.
309. **Crash reporting**: Core dumps and symbolicated traces from production.
310. **Graceful shutdown and signal handling**: Clean termination in orchestrated environments.
311. **Runtime tunability**: GC, thread pools and heap settings can be adjusted.
312. **Live inspection / attach**: Attaching debuggers or profilers to running processes.
313. **Hot code upgrade (optional)**: Updating running systems without downtime.
314. **Licensing compliance tools**: Reporting dependency licenses for legal review.
315. **SBOM generation**: Software bills of materials for compliance and security.
