# Outsider read, 2026-11-03

A new recurring practice (Ersagun, 2026-11-03): a reader that has never
seen the project reads the text a newcomer meets, cold, and marks every
word, name or sentence it can't follow. Marking measures confusion instead
of guessing at it. Rewrites happen afterwards, one area per BACKLOG row
(E234 to E236, L194 to L196, I160), not in this PR.

**How it was run.** A fresh agent with no project context got five files
and was told to read nothing else: README.md, docs/learn/LEARN.md,
TUTORIAL.md and GUIDE.md as of main 377a481, and the editor's screen text.
The screen text was scraped from the built editor in a headless browser:
everything visible and every tooltip on opening, after a click near Run,
after right-clicking a node and the empty canvas, after opening each
example in the picker, and after Run main in three examples. Nobody
explained the project to it. Its marks below are unchanged.

**Two marks that come from the scraping, not the editor** (noted by the
thread, not the reader): "Not kept in this browser: its storage is full"
appeared after opening every example one after another in one page, which
a newcomer could also do, so it's kept as I160 to check. The clinic "no
output appears" mark is because the scrape waited 4 s and copied only the
first lines; it isn't a finding.

---

# What I couldn't follow

## 1-README.md
| Quote | Why I got stuck | Hint (optional) |
|---|---|---|
| "The repo keeps the name language-lab: experiments with new programming language paradigms, each in its own top-level folder with its own README." | The folders listed next (`editor/`, `ters/`, `compiler/`, `invertible/`) all seem to be parts of Ters, not separate experiments. So what are the "experiments", and is there more than one? | Say whether Ters is the only experiment. |
| "It has no packages of its own and borrows `ters/`'s (`npm ci` in `ters/`, then `npm run build-editor`)." | This is build plumbing in the first bullet. "borrows ters/'s" (its packages? its node_modules?) took two reads. | Move build steps to a "Building" section. |
| "the checker, the evaluator, running backwards, the library and the examples" | A list of nouns with no verb. "running backwards" sits in a list of components, and I don't know yet what it means. | |
| "compiles the typed core of `ters/` to JavaScript, guided by its effect types" | "typed core" is never defined. "guided by its effect types" means nothing before effects are explained (lower down). | |
| "its numeric part to WGSL for the GPU" | WGSL isn't expanded, and "numeric part" is vague. | |
| "`invertible/`: the relation solver that arithmetic runs backwards with." | "relation solver" is jargon, and the sentence has to be reread. | |
| "built onto the site by `editor/build.ts` (`lab build-web`, see `docs/design/targets/WEB.md`)" | A file name, a `lab` command that is never introduced, and a doc path, all in one parenthesis. What is `lab`? | Introduce the `lab` CLI once. |
| "(one physics step over Clifford algebras, in 2D and 3D)", "(geometry in projective geometric algebra)", "(relativity and electromagnetism as rotors)" | Specialist maths terms on the front page with no gloss. As a newcomer I can't tell why they matter. | |
| "Names, comments and notation sit in side tables" | "side tables" is shorthand. Tables where: files, a database? | |
| "*Built for arithmetic and search.*" | Search of what? Nothing has said that search is a feature. | |
| "because how data is stored is a separate representation the compiler picks. You never select it yourself." | It's compressed. I can see that `succ`/`zero` become fast numbers, but "representation" is unexplained. | |
| "*Partly built: today on compiled JavaScript only.*" | Only the JS target? Then the "Targets built" claim below seems to contradict it. | |
| "No special node kinds and no special cases: a feature that needs one is rethought instead." | "node kinds" is used before I know that programs are made of nodes. | |
| "run by `lab test`" | `lab` again, never introduced. | |
| "what each lane does next at the top, then each lane's items by theme" | "lane" is internal project-management jargon. | |
| "Unison's hashing", "Gosper's continued-fraction arithmetic", "miniKanren's search" | The credits name prior work, but I don't know what hashing or continued fractions have to do with this language. | |

## 2-LEARN.md
| Quote | Why I got stuck | Hint (optional) |
|---|---|---|
| "?[two dice, read-only: click a part to see its type](index.html?embed&readonly&program=dice&def=two%20dice)" | In this text it shows as raw `?[...]` syntax, not a working embed. | |
| "This is the dice program's `two dice`, live." | "the dice program" hasn't been introduced, and "two dice" in backticks reads like a name with a space in it, which is odd. | Say it's a function that rolls two dice. |
| "holes, data and `match`, loops as folds" | These terms are fine as a preview, but "loops as folds" is jargon to a non-FP reader, and this is the section aimed at them. | |
| "For every detail, there's [LANGUAGE.md](../language/LANGUAGE.md)." | A raw file link on a learning page. | |
| "Never written a program?" → "For a five-year-old" | The link label doesn't match the heading's audience. Slightly off-putting, not fatal. | |

## 3-TUTORIAL.md
| Quote | Why I got stuck | Hint (optional) |
|---|---|---|
| "[hands-on guide](GUIDE.md)", "[Learn](LEARN.md)" | LEARN links to `guide.html`/`tutorial.html`, but this page links to `.md` files. Which one is the site? | |
| "This tutorial uses ... and the two shaders." | Which two? The Programs list shows three shaders (ripples, ray marching, Mandelbrot), and only ray marching is used later. | Name them. |
| "Purple is dots. Amber is holes and refusals." | Dots, holes and refusals are all used before they are explained (3.3, 3.5, 3.12). | |
| "`column = one of(range(size))` in the queens program" | The queens program and `one of` are used in Part 2 with no introduction. `one of` is explained only in 3.9. | |
| "queens : (Float64) -[Choice]-> List Float64" | Why is a board size a Float64? And `Unit` in `main : () -[Console]-> Unit` is never explained. | |
| "?[discriminant, ... the blue chips are the values for the example inputs 1, −3, 2]" | "chips" isn't explained until 3.2, and "example inputs" until later. | |
| "names (`names.*.json`), comments (`comments.json`), ... (`layout.json`), ... (`examples.json`)" | A run of file names I'm told about but don't need yet. | |
| "the program's **meaning hash**" | Defined as "a fingerprint of what the program does", but how can a hash capture what a program *does*? Hash of the code tree? | |
| "It can be a function call, an `if`, a `match`, a `fold` or a `solve`." | `solve` is used here and only explained in 3.10. | |
| "Alt-drag moves a dot." | Dots haven't been introduced yet (3.3 comes after). | |
| "On a node: open it, show it inline, put a dot on it, clear it" | "show it inline" is explained only in 3.6. | |
| "On a dot or port: *Show as let and get nodes*" | "port" isn't defined until 3.10. | |
| "[NODE-EDITOR.md](../design/editor/NODE-EDITOR.md) has the reasons." | I'm pointed to a design doc for the reasons behind wire hops, with no need for it. | |
| "A dot that nothing reads is a step done only for what it does, like each `print` in `main`." | Very compressed. I had to reread it to get "a side-effect-only step". | |
| "A node can't leave the frame its inputs come from: if you drag it out, the frame grows to keep it inside." | This is about scope, but it isn't said, so I had to guess. | |
| "values in scope" | "scope" is used for the first time here with no note, even though this section (and Part 2) is aimed at non-FP readers. | |
| "It offers `items`, `tail`, `tail′`, ..." | `tail′` (prime) isn't explained until 3.8. | |
| "A shader shows its comment above its picture." | Shaders and pictures are explained only in 3.13. | |
| "**Credits** in the top bar comes [here](#credits), to the language's own." | Garbled. I can't tell what "comes here, to the language's own" means. | |
| "pick *Tuple2*, then *Int*, then *Text*: `(Int, Text)`" | Tuple2 appears only here, and the notation elsewhere is `(a, b)`. | |
| "An operation of an effect can have its own, fresh at each call, like `await : Ticket a → a`." | Effects, operations, `Ticket` and `await` are all unintroduced, and "its own" (own what?) is unclear. | |
| "A field holding the type itself becomes `Stack a` with it." | I don't understand this sentence. `Stack` appears from nowhere. | |
| "× removes one no field uses." | Too compressed to parse on a first read. | |
| "The palette offers `pages(□)` for a chapter's page count" | A "chapter" type is never shown. | |
| "*Pin this type* ... means edits inside must keep the type." / "published library" / "*Copy into my program*" | Pinning and publishing are explained only in 3.13. | |
| "`set((p) ↦ p.home.city, ada, "Paris")`" | `↦` vs `=>` (used elsewhere), and `ada` is never defined. Two notations for lambdas? | |
| "It's the field read, run backwards, with the rest of the record given." | Relies on "run backwards" (3.10), so I got lost. | |
| "past 2²⁸ it switches to big integers" | Why 2²⁸? It sounds like an internal implementation detail. | |
| "`quotient` by zero gives `Choice` (see 3.9)" | `quotient` vs `÷` is unclear, and Choice is used before it is explained. | |
| "It also works on trees whose children are in a list ... the folded value of the children is the list of their results." | Dense. I didn't get it. | |
| "Ackermann-style orders" | Unexplained jargon. | |
| "`with fuel(100, …)` turns that into `Choice`" | "fuel" is introduced in passing. Choice and effects aren't explained yet. | |
| "Through `knot = wrap(f: knot → Float64)`, a function could call itself without any recursion the checker can see." | Very compressed. I couldn't follow why. | |
| "Whether to drop the first rule is an open question (BACKLOG L107)." | An internal backlog code in user docs. | Drop the code. |
| "`value of(optional)`" in the effects table | Never shown elsewhere. | |
| "at the top, the world's randomness" / "a match (a test's fixed clock)" | "at the top" (top of the program? main?) isn't explained, and "a test's fixed clock" is shorthand. | |
| "`all(() => item = one of(list); if test(item) then item else fail())`" | A `;` syntax that appears nowhere else, and `item =` looks like the assignment Part 2 said doesn't exist. | |
| "something has to handle it before `main`" | What does "before main" mean: inside main, before it returns? | |
| "Anything that acts is an *action*: a function with no inputs, like the `() =>` frames that handlers take." | Compressed. "handlers take" (as arguments?) is unclear. | |
| "can't be touched while a `Choice` is open" | "open" Choice is an undefined state. | |
| "`(List a, (a) -[e]-> b) -[e]-> List b`" | `e` as an effect variable is explained only implicitly, in one parenthesis. | |
| "the way Solid.js does it" | Assumes I know Solid.js. | |
| "A continued fraction whose rest is a formula works out its terms as you ask for them." | A maths aside with no setup. | |
| "LANGUAGE.md, "Cells", has the details." | Another doc pointer. | |
| "a fold becomes an unfold" / "`join text` tries every way to cut the text" | "unfold" is undefined, and `join text` has never been shown. | |
| "`map(square, list) = [4, 9]`, run backwards, gives four lists." | Why four? I had to work out ±2 × ±3 myself. | |
| "comparisons that would have to produce a number" | Unclear. | |
| "Run it with *holds* ticked and set to `true`." | "holds" appears out of nowhere: the result port's name? | Say "the result, called holds". |
| "*The program it derives for this direction*" | A UI label quoted with no context. | |
| "`period` comes out in seconds" | `period` is never shown before. | |
| "make true-or-false functions as expressive as wiring" | I don't get what "as expressive as wiring" means. | |
| "That extra fact gives the solver a way in ... It doesn't count as an extra condition." | Compressed. Why doesn't it? | |
| "it's pure" | "pure" is used without a definition. | |
| "`shade` asks for `unit(gradient((q) ↦ scene(q, time))(p))`" | Ray marcher, `Vec`, `scene` and `shade` are all unintroduced (shaders come in 3.13). | |
| "the checker knows the derivative fails only where the function does, and drops the `Choice`" | Dense. | |
| "name clash, shadowing, capture" / "binders are ids" | "capture" and "binders" are jargon. | |
| "running backwards gives round-trip laws to test against" | Unexplained. | |
| "`equal` needs plain data" | "plain data" is undefined. | |
| "**The relational interpreter**, which runs anything backwards." | How does this differ from "the solver" and "the search" mentioned earlier? Three names for one thing? | |
| "[RUNNING.md](RUNNING.md)" | Yet another doc. | |
| "If a program has a `colour` of `(x, y, time)`, or a `red`, a `green` and a `blue`" | I only got this on a second read: definitions with those names? | |
| "A proof of concept writes `factorial` on counting numbers built from `zero` and `succ` ... through a rewrite the definition never mentions." | Dense, and "rewrite" is unexplained. | |
| "What's still confusing is in [CONFUSING.md]" | An internal doc. | |
| "The screenshots are in `docs/learn/tutorial/`, retaken on 2026-10-31." | A maintainer note in a user page. | |
| "running functions backwards from Prolog and miniKanren, whose search `relate.ts` adapts" | A source file name in the credits. | |
| "fusion from Wadler, and from Gill, Launchbury and Peyton Jones" | "fusion" never appears in the tutorial. | |
| "reroute dots from Blender" | Fine for Blender users, opaque otherwise. | |

## 4-GUIDE.md
| Quote | Why I got stuck | Hint (optional) |
|---|---|---|
| "This one has `die`, `two dice`, ... `credits` and `main`." | The screen also shows `styles`, so the list doesn't match. | |
| "The window has four parts" | The tutorial says five panes. Small, but it made me wonder whether I was on the same screen. | |
| "Click **Roll 100 with seed 7** twice." | "seed" isn't explained until section 5. | |
| "The green bars grow toward the red ticks, which show what fair dice give on average." | Fine, though "red ticks" makes me hunt. | |
| "`write(rolls, append(‹a hundred rolls›(7), read(rolls)))`" | `write`, `read` and `rolls` (cells) appear in section 3 but are explained only in section 8. | |
| "so you get one of six different hundreds" | Compressed. I had to reread it. | |
| "`first(queens(8), else nil)`" | The `else` inside a call is a new syntax that isn't explained. | |
| "If a queen there could be taken" | Assumes I know the eight-queens puzzle. | |
| "**Try it:** run `magnitude` backwards from `5`." | `magnitude` is never introduced in the guide. | |
| "Click the `(` right after `named` on the `"hundred"` button, and press Ctrl+C." | A baffling instruction: why click a parenthesis to select a button? | |
| "the inspector says *Item 5 of 5 in the list*" | Which list? | |
| "the editor **holds** that definition's type until the hole is filled" | Clear enough, but "Let it loosen" is an odd label. | |
| "The seeded rolls are xoshiro128** by ..." | A PRNG name with no gloss. Fine for credits. | |

## 5-EDITOR-SCREEN-TEXT.txt
| Quote | Why I got stuck | Hint (optional) |
|---|---|---|
| (Editor on opening) "the program is the tree" | A cryptic subtitle under "Ters". | |
| (Editor on opening) "a · b / a * b / (* a b)" | Three unlabelled toggles. Without the tutorial I wouldn't know they change notation. | |
| (Editor on opening) "Cells" top-bar button, [tooltip] "Reactivity and values on demand, through the Cells effect" | Jargon in the main toolbar for a first-time user. | |
| (Editor on opening) "[tooltip] layer", "[tooltip] style" | Tooltips that tell me nothing. | |
| (Editor on opening) "rotate, show ×2, ++", "solve rotate, show ×2, …", "polar, for some", "▸" | Collapsed-node labels that read like shorthand. The first thing I see is `for some` and polar maths. | |
| (Editor on opening) "handles Choice" | A badge with no context on the very first screen. | |
| (Editor on opening) "Map" | Unexplained button (the tooltip later says map of the whole graph). | |
| (Editor on opening) "60%" | Fine. | |
| (Editor on opening) Guide panel: "Replace with… does both in one step." | Both what? | |
| (Editor on opening) "in the graph, the + under a node's inputs adds one at the end" | Hard to picture. | |
| (Editor on opening) "Run, above, runs main, or the definition you're looking at backwards" | Reads as "runs main backwards". Ambiguous. | |
| (Editor on opening) "add", "a", "(x) =>", "□", "Choice", "fail" as lone lines in Guide | Stray icon labels mixed into the glossary. | |
| (Editor on opening) "you give it some of its ports (inputs, left) and it works out the rest (dots, right)" | "dots, right" contradicts the earlier "dots are inputs on the left". | |
| (Editor on opening) "kept, loose, in a dashed frame ... as _1, _2, … saved in drafts.json, not code.json" | Internal file names in user help. | |
| (Editor on opening) "Drag a node to move it (that only changes layout.json)" | A file name where "only changes the layout" would do. | |
| (Editor on opening) "[tooltip] (() -[Choice]-> a, () -[e]-> a) -[e]-> a here: (() -> Text, () -> Text) -> Text" | "here:" format and `e` are never explained, and it's long. | |
| (Opening "Countdown numbers") "Countdown numbers", "▤ Op", "▤ Expr" | The name assumes I know the TV game. `▤` means "data type" only via a tooltip. | |
| (Opening "Countdown numbers") "main : () -[Console, Diverge]-> Unit" | Fine given the tutorial. | |
| (Opening "Conjugation") "-- Each edit done in another space and brought back, beside the same edit done in place." | I don't know what this example is about. "Conjugation" isn't explained. | |
| (Opening "Conjugation") "linear light", "softer highs", "multiband" | Audio/colour jargon. | |
| (Opening "Lockstep: a cart on a spring") "position in steps of 2⁻³² ... so two machines can compare", "Fixed" | "Lockstep" and the Fixed type are never explained. | |
| (Opening "Shader: ripples") "Accept this answer to check it from now on." / [tooltip] "lab test checks it from now on" | `lab test` again, unexplained in the app. | |
| (Opening "Shader: ripples") "Drawn as WebAssembly on the CPU (no GPU here) ... Click it to pause and sharpen." | "sharpen" is unclear. | |
| (Opening "Shader: ray marching") "▤ Pga", "pga basis", "halo motor" | Jargon (PGA, motor). | |
| (Opening "Shader: ray marching") "?" and "Looking for an answer… Stop" | A bare "?" with no meaning. | |
| (Opening "Shader: ray marching") "No values on the wires: it runs longer than the 200 ms the graph waits" | OK, but "values on the wires" depends on "Show values". | |
| (Opening "Shader: Mandelbrot set") "HSI colour space, from his hsi-playground repository", "Rec. 709", "vec2f" | Insider references. | |
| (Opening "Page: two dice") "Cells · Diverge" badge on `read` | Why might reading a cell not finish? Surprising, and not explained. | |
| (Opening "Page: two dice") "Outline updates", "Save page" | Unexplained buttons. | |
| (Opening "Page: Pig") "() -[Say, Cells, Console, Diverge, Files, Network, Update, Abort, Log, Random, Time]-> Float64" | Huge effect rows. And `View`, `Handler` and `Sound` effects show up in tooltips but aren't in either effects table. | |
| (Opening "Page: Pig") "▤ Decide", "▤ Say", "quietly", "written into", "recorded into" | Decipherable only by reading the long tooltips. | |
| (Opening "Page: nested to-do outline") "each", "formula", "path((all) => all)", "Path a b" | Path is never documented. | |
| (Opening "Page: unit converter") "main : () -[Cells, Files, Abort]-> Html" | Why does a unit converter read files and abort? | |
| (Opening "Page: unit converter") "built with lab build-web" | `lab` again. | |
| (Opening "Page: guitar pedal") "Overdrive in saturation space, on the slow band of Haar's split" | Signal-processing jargon. | |
| (Opening "Page: guitar pedal") "Interpreted: a page with sound plays from the interpreter in the editor ... Open in a tab runs it compiled." | "interpreter" vs "evaluator" (tutorial) — the same thing? | |
| (Opening "Page: bounce") "Cl(2, 0)", "Multivectors", "clifford sandwich", "clifford exp", "signatures, [1, 1]" | Heavy maths jargon. "(clifford sandwich)" reads like an internal function name. | |
| (Opening "Page: spacetime") "rapidity", "boost", "pseudoscalar part" | Physics jargon. Fine for a demo, opaque otherwise. | |
| (Opening "sheet") "-> a where a is a Number" | "where a is a Number" (a type-class constraint?) is never mentioned in any doc. | |
| (Opening "sheet") "As lab run gives it: budget.txt." | Compressed, and `lab run` is unexplained. | |
| (Opening "machine") "read d a a", "make outc", "make jeq", "▤ Hot" | Cryptic definition names. | |
| (Opening "notebook") "[path, more, ..others]" | List-pattern syntax that no doc covers. | |
| (Opening "notebook") "Not kept in this browser: its storage is full." | Appears just from browsing examples. Alarming, and I didn't do anything to fill storage. | |
| (Opening "notebook") [tooltip] "The same in 2 places: changing it changes every one" | No idea what "it" refers to. | |
| (Opening "routes") "cons(path, _)" | `_` wildcard is unexplained. | |
| (Opening "calc") `split(‹read input›(), "…" · 2 lines)` | A collapsed text literal rendered as `"…" · 2 lines` looks like code (`·` is multiply). | |
| (Opening "calc") "session(b, errors) = end" | Destructuring syntax that isn't documented. | |
| (Opening "clinic") "new m2", "▤ Discipline", "▤ Pick" | Cryptic names. | |
| (After "Run main" in "clinic") only definition names re-listed | No output appears. Did it run? | |
| (Right-click menu on a node) "Add a value before this… first among the steps this is in, so this and all of them can use it." | Garbled. | |
| (Right-click menu on a node) "Insert a node after it… this feeds one of its inputs, and it gives on what this gave" | Garbled pronouns. I can't parse "gives on what this gave". | |
| (Right-click menu on a node) "Make it a function: This node ...: a function, part, of what comes in, called right here. Name it, fold it, reuse it." | Garbled. "fold it" clashes with the fold concept. | |
| (Right-click menu on a node) "(Reingold–Tilford tidy trees)" | An algorithm name in a menu tooltip. | |
| (Right-click menu on a node) "Group into one box ... a frame around them, folded, naming what it holds" | "frame" here clashes with frame = function. | |
| (Right-click menu on a node) "Pick: Mark it, to move and tidy it together..." | "Pick" vs "Select" vs "picked" — overloaded. | |

## The five worst
1. README: "`lab build-web`", "`lab test`" (and on screen "As lab run gives it", "lab test checks it"): the `lab` tool is used everywhere and never introduced.
2. Tutorial 3.6: "An operation of an effect can have its own, fresh at each call, like `await : Ticket a → a`... A field holding the type itself becomes `Stack a` with it": unintroduced names inside sentences I couldn't parse.
3. Screen, node right-click menu: "A call from the palette goes on the wire out of this node: this feeds one of its inputs, and it gives on what this gave": the in-app help itself is garbled.
4. Tutorial 3.8: "Whether to drop the first rule is an open question (BACKLOG L107).": an internal ticket code in learning material, after an already opaque `knot = wrap(...)` argument.
5. Screen, on opening: the default view is Numbers & physics `main`, full of `for some`, `polar`, "solve rotate, show ×2, …" and "handles Choice". The first screen shows the hardest concepts with no context.

## What it seems to be about
Ters seems to be an experimental functional language with no text syntax. You edit programs as a typed graph or tree in a browser editor, names live outside the code, effects (randomness, I/O, search via `Choice`) show up in types and are answered by handlers, and any function can, in principle, be run backwards like a relation. It also compiles to JS, WebAssembly, C and GPU shaders, and ships many example programs and web pages. What I still don't know: what the `lab` tool is and how I'd run anything outside the browser; how the evaluator, the "relational interpreter", the "solver" and the "search" relate; how far "runs backwards" really goes beyond the curated examples; and whether "language-lab" holds anything besides Ters.
