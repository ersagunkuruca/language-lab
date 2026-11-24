# typeset

This is GAPS.md round 24's program (docs/reports/GAPS.md): paragraphs of made-up words broken into lines, written in Ters through the MCP.

```
ters run compiler/gaps/typeset [paragraphs] [measure]
```

The defaults are 3 paragraphs and a measure of 300 (a letter is 2 to 7 wide, a space 6). The same counts always give the same text.

## How it goes

1. **Words.** Each paragraph is 40 to 99 words from a small vocabulary, some followed by a full stop or a comma, made up by Park and Miller's minimal standard generator.
2. **Hyphenation.** A word may break where a vowel, a consonant and a vowel meet (before the consonant) or where a vowel, two consonants and a vowel meet (between the consonants), at least two letters from either end. These are two plain rules, not Liang's patterns as TeX uses.
3. **Items.** A paragraph becomes Knuth and Plass's boxes (pieces of words), glue (spaces that stretch by 3 and shrink by 2) and penalties (a hyphen's place, at a cost of 50), with infinite glue and a forced break at its end.
4. **Total fit.** Each possible line has an adjustment ratio, a badness and a fitness class. Demerits add a line penalty of 10, a hyphen's cost, 3000 for two hyphenated lines running and 2000 for classes more than one apart. A table of the least demerits for each break and class finds the best way to break the whole paragraph (Knuth and Plass, "Breaking paragraphs into lines", 1981).
5. **First fit.** Beside it, each line takes words while they fit at their natural spaces, no hyphens, and its badness is counted the same way.
6. **The report.** The first paragraph's lines with their ratios, then each paragraph's words, lines, badness, demerits and hyphens, then the totals.

The credits are also in the program's comments and in docs/language/CREDITS.md.
