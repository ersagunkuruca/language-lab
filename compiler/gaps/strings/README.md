# strings

This is GAPS.md round 20's program (docs/reports/GAPS.md), the bigger-program round on the instrument app (C262). It plucks a guitar's six open strings, hears each one three ways, and records all six onto a loop.

```
ters run compiler/gaps/strings [blocks]
```

The default is 8 blocks. The same count always gives the same sound.

## How it goes

1. **The strings.** Each string is a Karplus-Strong string (Kevin Karplus and Alex Strong, "Digital synthesis of plucked-string and drum timbres", 1983). A queue one period long starts as a burst of noise drawn by a linear congruential generator (the C standard's example `rand`). Each sample leaves the front, and the mean of it and the one before, a little quieter, goes in at the back.
2. **Listening.** A fifth of a second in, when the burst has softened, each string is cut into blocks of 2048 samples, 1024 apart. Each block is heard three ways:
   - by YIN (Alain de Cheveigné and Hideki Kawahara, 2002): the difference at each lag, normalized by its running mean, and the first dip under 0.15;
   - by the McLeod pitch method (Philip McLeod and Geoff Wyvill, 2005), as the tuner example finds it, on the library's autocorrelation by FFT;
   - by the loudest partial of the block's Hann-windowed spectrum.
3. **The tuner.** YIN's pitch is read off 12-TET with A4 at 440 Hz.
4. **The looper.** All six strings are overdubbed onto a loop of 12000 samples a block. The last is undone and then redone, and the report says how far the redone loop is from the first.

The credits are also the program's own comment, shown in the editor's Program tab, and in docs/language/CREDITS.md.
