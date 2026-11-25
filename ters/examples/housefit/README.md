# housefit

Fits a house's thermal model to its measured indoor temperatures. The
model is a two-node RC network: the indoor air and the building mass,
stepped every 10 minutes. The house has eight parameters (`Params`):
walls, windows, leaks (worse with wind), the air's and the mass's heat
capacities, the coupling between them, the sun let in, and the heater's
efficiency. Each is a multiple of a usual house's value.

The program makes up days of weather (outdoor temperature, wind,
sunshine, a heating schedule) and a true house. It measures that house's
air with noise, then starts from a house of all ones and runs Adam on the
mean squared misfit.

    ters run examples/housefit          # 3 days, 500 steps
    ters native examples/housefit -o housefit && ./housefit 7 3000

Run as JavaScript, 7 days (1008 steps) overflows the stack on the way
back: a pass back through that many steps of a large frame is deeper
than the core JS's own driver for deep calls allows for.

The gradient is `gradient((q) => loss(q, w))(p)`, taken over a record.
It is reverse mode (L285): one pass back through `misfit`, which calls
itself once per 10-minute step, so 432 steps for 3 days. All eight
slopes come out of the one pass, as a `Params`. Forward mode can't take
this gradient: `misfit` calls itself with a record.

With 7 days and 3000 steps the compiled program (`ters native`) takes
under 0.2 s. The loss falls from 0.81 to about 0.0008, the noise's
floor. The fitted house is close to the true one, apart from what the
data can't tell apart.
