# fit

This is GAPS.md round 15's program (docs/reports/GAPS.md). It fits curves to measurements, and each model it tries is a function chosen at run time and asked for its gradient.

```
ters run compiler/gaps/fit data.txt
```

## The data file

Each line of the data file gives one measurement: `x y`. A `#` starts a comment.

## What it does

1. It reads the data and checks it, and says which line is wrong. It needs at least three points.
2. It fits four models, each with two parameters, a and b:
   - `a + b·x`
   - `a·e^(b·x)`
   - `a·x^b`
   - `a / (1 + e^(−b·x))`

   Each model is picked by name as a function of its parameters, `value at(model, x)`. Its slopes along a and b are `gradient` of that function.

   The fit uses Gauss-Newton (Gauss, 1809). Each step solves (JᵀJ) δ = Jᵀr by Cramer's rule. If a step doesn't lower the squared residuals, it is halved until it does (Hartley, 1961). The fit stops when a step barely helps, or after 100 steps.

3. It prints each fit, with its parameters, the root mean square of its residuals and the steps taken. A model that can't be fitted says so: `a·x^b` can't be fitted where some x is 0 or less.
4. It names the best fit, the one with the smallest rms.

## Exit codes

- A usage error exits with 2.
- Bad data, or no fit at all, exits with 1 and prints `fit: …` on stderr.

## The sample

`data.txt` is 20 made-up readings of a growing culture: 2.5·e^(0.4·x) with up to 2% noise.
