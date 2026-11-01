# notebook

Notes, read from a file, and questions about them. It indexes every note's
words once, prints a summary, and then answers each question from the
index, in the order the file asks them.

```
$ node ters/cli/lab.ts run ters/examples/notebook ters/examples/notebook/notes.txt
6 notes, 58 terms, 48 different terms
most common: tide 6, bay 2, harbour 2, make 2, moon 2
longest: ferries, 12 terms
find tide: lighthouse 3000, moon 3000, ferries 1500, harbour 1500
find tide harbour: harbour 4500
any moon bread: moon 12000, bakery 6000
like harbour: bakery 3000, lighthouse 3000, moon 3000, ferries 1500
seen tide: bay 2, make 2, moon 2, all 1, boat 1
find whale: nothing
```

## The file

One line each, words separated by spaces:

- `note <name> <text…>`: a note and its text.
- `find <words…>`: the notes that have every word, best first.
- `any <words…>`: the notes that have some of the words, best first.
- `like <name>`: the other notes that share the most (and the rarest) words with this one.
- `seen <word>`: the words that come most often in the notes that have this one.
- Blank lines and lines starting with `#` are skipped.

Each answer shows the best five, with their scores. A line that is none of
these, or a second note with a name already used, stops the run with the
line number, on standard error, with exit code 1. So does a `like` naming
no note, after the answers before it have been printed.

## How it works

A word becomes a **term**: small letters, punctuation dropped, a plural's
s taken off (`Cities,` → `city`, `tides` → `tide`), and common words (the,
of, and, …) left out. The index is two maps, built once:

- every note by name, with how many times each of its terms comes in it;
- for each term, the notes it comes in and how many times (an inverted
  index, `Map Text (Map Text Int)`).

A term's **weight** is 1000 × the number of notes ÷ the number of notes
with the term, so a rare term counts for more. This is inverse document
frequency (Karen Spärck Jones, 1972), as a whole-number ratio without its
logarithm (prior art). A note's score is the sum of each term's count in it
times the term's weight. `find` looks only at the notes of its rarest term
and checks the others against them.

It is bigger-program round 6's program (docs/reports/GAPS.md): written to
see what the compiler does with data built once and read many times, and
with maps inside maps. Original, written for that purpose.
