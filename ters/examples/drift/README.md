# drift

Motes, each a record of nine fields (where it is, how fast it
goes, its mass, its colour and its name), moved by its velocity a hundred
times. Each step reads and writes two fields of every mote (x and y) and
reads two more (vx and vy): the other five ride along unread.

    ters run examples/drift 200
    ters compile examples/drift -o drift.mjs && node drift.mjs 100000

The argument is how many motes (1000 when there is none); it prints the
sum of their x after the hundred steps.

It is the program BACKLOG C60 waited for: a loop that reads few fields of
many records, where storing the list as columns (an array per field)
would pay. Measured 2026-11-10 at 100,000 motes, a hundred steps, on one
machine: compiled, 3.3 s; by hand in JavaScript (compiler/gaps/
drift.ideal.js), records rebuilt each step 2.6 s, changed in place 0.14 s,
as columns 0.08 s. The compiled program stores the motes as an array, but
`map` makes a new array and a new record for each mote every step; written
in place (the map's array and the motes have one holder), 0.33 s by hand.
Each mote is now changed in place in the map: compiled 0.47 to 0.63 s.
Since C60's columns step the motes are an array per field, and a step
reads vx and vy and writes x and y, nothing else (compiler/src/columns.ts).
On C (`ters native`) the map writes into its array (c2a) and the loop
reads and writes each mote's fields where they sit (c2b): 0.28 s CPU at
300,000 motes, against 0.10 s for hand-written C changing records in place.
Since then a column read lends its array (c2c, 0.15 s) and the buffer
holds the motes as columns (c2d, 0.12 s).
