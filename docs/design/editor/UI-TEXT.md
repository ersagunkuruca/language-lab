# UI text

How the editor's own words are written: section heads, labels, buttons, menu
items and statuses. The checklist form is the `ui-text` project skill
(`.claude/skills/ui-text/SKILL.md`); this note has the reasoning and the
words we use.

## The rule

Ersagun, 2026-11-16:

> UI is not somewhere you explain things by default. Instead you section, you
> differentiate by size, spacing, color, and component choice and keep things
> lean. You create jargon but understandable and consistent jargon that
> doesn't usually form full sentences. Explanations should be reserved for
> tooltips, warnings, longer text boxes, help sections, tutorials etc.

He named the failure: "Where it runs" is a question-and-answer head, written
to be understood rather than to name the thing. "Build targets" names it.

So:

1. **Structure carries meaning.** A section is a head, spacing and a group of
   rows. A value is a row with the name on the left and the value on the
   right. A warning is a warning component, an action a button. Size and
   colour say what matters; words don't have to.
2. **Text names.** Heads and labels are noun phrases. Buttons are a verb and
   an object with no article ("Add input"). Statuses are a word or two
   ("Checking…"). No full sentences, no questions answered in the head, no
   asides like "· the compiler's answer".
3. **Jargon, consistent.** One word per thing, the same in the head, the
   button, the tooltip, the Guide and the docs. The list below is the
   source; a new word goes in it.
4. **Explanations have their places:** tooltips (a `title`, or the ⓘ mark
   on a section head), warnings and errors (what's wrong and the fix), the
   Guide, Learn, the tutorial, and help text a person opens. Not grey hint
   paragraphs under every section.

## What's exempt

- **The example pages** (Page:, Shader:, the bigger programs' pages) read as
  interactive posts that explain a concept and let you play with it, so
  their prose stays. If one became a tool, its text would move.
- **The Guide, Learn and the tutorial** are help: they explain.
- **A program's own comments**, which are the program's text, not the
  editor's.

## Why it drifted

The 2026-11-03 outsider read (OUTSIDER-READ-2026-11-03.md) marked terse
labels a newcomer couldn't follow, and its rows rewrote them as plain
sentences in place. That made the UI explain itself everywhere. The fix for
an unfamiliar word is a consistent word with a tooltip and a Guide entry,
not a sentence in the panel.

## Words

| thing | word | not |
|---|---|---|
| where a definition can be compiled to | Build targets | Where it runs, where it can run |
| a target | GPU shader, WebAssembly, C, JavaScript | A shader, on the GPU |
| the compiler working something out | Checking… | Finding out… |
| an implementation's choice of ways | Ways chosen | How each operation is worked out |
| a function's parameters | Inputs | Inputs of f |
| a relation's other solving directions | Directions | Other directions |
| which saved file an edit changes | a small `code` / `layout` tag on the head | "· code.json" after the head |
| an empty slot in the program | hole | gap, blank |
| dragging a number to change it | scrub (tooltip: "Drag sideways to change it") | slide, drag-edit |
| a value lying beside a definition, not wired in | loose part | draft, orphan |

## Writing longer text

Tooltips, warnings and help are prose. Check them with the `unslop` project
skill (`.claude/skills/unslop/`, Lauren Tan's, MIT, see CREDITS.md): no
inflated words, no "not just X but Y", no stacked hedges, no em dashes.

## Rows

The first pass over the editor was E266 to E271 (#2806, #2808, #2810, #2813,
#2815 and E271's PR; DONE.md), one area per row. `head()` and `fileTag()` in
editor/dom.ts are the section head every panel uses. New UI text follows the
`ui-text` skill; a QA pass that finds a sentence where a name belongs files
it as an E row.
