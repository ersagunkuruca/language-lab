---
name: ui-text
description: >-
  Write or review text that appears in the editor's UI: section heads, labels, buttons,
  menu items, statuses. Use with every change that adds or edits UI text in editor/.
  Not for docs, the Guide, or example pages written as interactive posts.
---

# UI text

The rule is Ersagun's (2026-11-16). docs/design/editor/UI-TEXT.md has the reasoning and
the vocabulary; this is the checklist.

UI is not where you explain things. Structure carries the meaning: sections, size,
spacing, colour and the choice of component. Text names things.

## Write

- **Names, not sentences.** A head or label is a noun phrase: "Build targets",
  "Inputs", "Cost". No question-and-answer heads ("Where it runs", "How each
  operation is worked out"), no "· the compiler's answer" asides.
- **Buttons are a verb and an object, no article:** "Add input", "Collapse call",
  "Clear". Not "Add the input".
- **Statuses are short and say the state:** "Checking…", "Not on GPU", "3 steps".
  Not "Finding out where it can run…".
- **Jargon is fine when it is consistent.** Pick one word for one thing and use it
  everywhere: the same word in the head, the button, the tooltip and the Guide. The
  vocabulary list in UI-TEXT.md is the source.
- **Values over prose.** "yes" / "no: holds a List" in a row beats a paragraph.

## Where explanations go

Only in: a tooltip (`title`, or the ⓘ mark on a section head), a warning or error
(say what's wrong and the fix, still short), the Guide, help sections, tutorials,
and the example pages, which read as interactive posts.

An inline grey hint paragraph is an explanation in the wrong place. Move it into the
section head's tooltip, or cut it.

## Review

Before a PR with UI text merges, read each new string and ask:

1. Is it a sentence? Make it a name or a value, or move it to a tooltip.
2. Is it a question and its answer? Name the thing instead.
3. Does another place call this thing something else? Use the same word.
4. Run the unslop skill's patterns over any longer text (tooltips, warnings, help).
