# depot

This is GAPS.md round 17's program (docs/reports/GAPS.md). It simulates a day of a bike-share network: riders come to stations at random, take a bike if there is one, ride to another station and dock it if there is room. A truck moves bikes from full stations to empty ones every half hour.

```
ters run compiler/gaps/depot city.txt [hours] [seed]
```

The defaults are 24 hours from midnight and seed 1. The same file, hours and seed always give the same day.

## The city file

Each line is one of:

- `station name docks bikes x y`: a docking station, how many docks it has, how many bikes stand in them at midnight, and where it is, in km east and north of the map's corner.
- `demand from to riders`: riders an hour who ride from one station to another, at the busiest hour.
- `profile` and 24 numbers: how busy each hour of the day is, from midnight, as a share of the busiest (0 to 1). Without one, every hour is as busy as the busiest.

A `#` starts a comment.

## How the day goes

1. **Riders come.** At each station they come at random, as a Poisson process at the busiest hour's rate. Each one is kept with the chance of the hour's share. This is Lewis and Shedler's thinning ("Simulation of nonhomogeneous Poisson processes by thinning", 1979).
2. **A rider takes a bike** if the station has one, and picks where to ride at random by the demands' rates. A ride takes the crow-flies distance at 4 m/s, plus a minute to unlock and dock.
3. **A rider who finds no bike** walks to the closest station with one, if it is within 900 m (at 1.4 m/s), and tries there once. Otherwise they go without.
4. **A rider who finds the station full** rides on to the closest station with a free dock.
5. **The truck** goes round every half hour. It carries up to 10 bikes from the station with the most bikes over half its docks to the one with the most under.
6. **Fares.** A ride is free for ten minutes, then costs 1.00 for each ten minutes begun.

The random numbers come from the Lehmer generator with Park, Miller and Stockmeyer's multiplier 48271 ("Technical correspondence", CACM 36(7), 1993).

## What it prints

- The day's totals: rides, riders who went without a bike and who walked on, rides that found a station full, the mean and longest ride, the fares, the bikes the truck moved, and the hour the most riders went without.
- A table of the stations: docks, bikes at the end, bikes out and in, riders who found none or found it full, and how long it stood empty and full.
- The ride times by five minutes, as bars.
- Each station's bikes hour by hour, one character an hour: `·` empty, then `░▒▓` up to a quarter, half and three quarters, and `█` full.

## Exit codes

- A usage error exits with 2.
- A city file that doesn't make sense exits with 1 and prints `depot: …` on stderr.

## The sample

`city.txt` is a made-up town of eight stations: homes up the hill, work by the harbour, and the railway station and the market between. Its profile has two rush hours, at 8:00 and 17:00.
