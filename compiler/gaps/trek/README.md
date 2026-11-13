# trek

This is GAPS.md round 16's program (docs/reports/GAPS.md). It sums up a hiking track from a GPS, and its numbers carry their units: heights and distances in metres, times in seconds, work in joules.

```
ters run compiler/gaps/trek track.txt
```

## The track file

Each line of the track file gives one GPS fix: `seconds latitude longitude height`. Seconds count from any start, latitude and longitude are in degrees, and height is in metres. A `#` starts a comment.

## What it does

1. It reads the fixes and checks them, and says which line is wrong. It needs at least two fixes, in time order.
2. It smooths the heights: each is the mean of the five around it, since GPS heights jump by metres from fix to fix.
3. It makes a leg between each two fixes. A leg's length is the haversine distance on a sphere of the earth's mean radius, 6371 km.
4. It prints:
   - the distance;
   - the ascent and descent, counted only once a height is 3 m from the last one counted, so noise doesn't add up;
   - the time moving and stopped (a leg slower than 0.3 m/s is standing still), and the pace;
   - the highest and lowest points;
   - the time the track should take by Naismith's rule (1892: an hour per 5 km, and an hour more per 600 m up) and by Tobler's hiking function (1993: 6·e^(−3.5·|slope + 0.05|) km/h);
   - the work done lifting a 75 kg walker up the ascent;
   - the biggest climb and the steepest leg;
   - the heights as a profile of forty bars;
   - the fastest and slowest whole kilometres, and each stop of a minute or more;
   - each kilometre's time and rise;
   - the time spent at each speed, by whole km/h, and the distance at each grade, by 5%.

## Exit codes

- A usage error exits with 2.
- A bad track exits with 1 and prints `trek: …` on stderr.

## The sample

`track.txt` is a made-up hike of 400 fixes, 10 s apart, over hills, with a stop of a minute every 16 minutes.
