# wavetable

A tone played from a table (BACKLOG C30): one period of a sine, 256
samples, read by position once a sample. The phase moves on by `phase
step` (in 1/65536ths of a place) each sample, and `sample` reads the
table at its whole places, wrapped round at 256. `power` is the mean of
the samples' squares, 1/2 for a full-scale sine.

Nothing in the program says how `sine table` is stored. It is a List,
and the compiler sees it made once and then only read by position, so it
keeps it as an array (`List as array of List`) on JS, WASM and C.

`power` of a 440 Hz tone over 480,000 samples (10 seconds), the
same answer either way:

| | as a cons list | as an array |
|---|---|---|
| JS | 410 ms | 150 ms |
| WASM | 700 ms | 77 ms |
| C (with process start) | 440 ms | 36 ms |
