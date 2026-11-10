# A native app tried on an emulator (C199f): started, its views dumped,
# then each tap given as a finger would (adb input tap) and the views
# dumped again, so a run's log shows whether the page answered. Run by the
# "Android check" workflow inside the emulator; args: the app's id, then
# taps (or TAPS, split at |), each a text (the view showing it), "square:N" (a view N dp
# square, as tumble's tiles are; the first one, or the k-th with #k) or "scroll:N" (N dp down).
import os, re, subprocess, sys, time, difflib

def adb(*a):
    r = subprocess.run(["adb", *a], capture_output=True, text=True)
    if r.returncode: print("adb", *a, "failed:", r.stderr.strip())
    return r.stdout

def dump(name):
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    x = adb("shell", "cat", f"/sdcard/{name}.xml")
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", f"{name}.png")
    return x

def nodes(x):
    return [(m.group(1), m.group(2), [int(v) for v in re.findall(r"\d+", m.group(3))]) for m in re.finditer(r'<node [^>]*?text="([^"]*)"[^>]*?class="([^"]*)"[^>]*?bounds="([^"]*)"', x)]

def lines(x):
    return [f"{c.split('.')[-1]} {t!r} {b}" for t, c, b in nodes(x)]

app = sys.argv[1]
taps = sys.argv[2:] or [t for t in os.environ.get("TAPS", "").split("|") if t]
density = int(re.search(r"(\d+)", adb("shell", "wm", "density")).group(1)) / 160
print("density", density)
adb("logcat", "-c")
adb("shell", "am", "start", "-W", "-n", f"{app}/app.ters.page.MainActivity")
time.sleep(6)
before = dump("before")
print(f"started: {len(nodes(before))} views")
# Every view the activity has, shown or not (V visible, G gone, I invisible), with its place.
top = adb("shell", "dumpsys", "activity", "top")
views = [l for l in top.splitlines() if re.search(r"(FrameLayout|TextView|EditText|Picture|ScrollView)\{", l)]
print(f"---- the activity's views ({len(views)})")
print("\n".join(views[:400]))
print("\n".join(lines(before)[:60]))
for i, t in enumerate(taps):
    ns = nodes(before)
    if t.startswith("scroll:"):
        # The page scrolled N dp down, a finger moving up the screen.
        w = adb("shell", "wm", "size"); W, H = [int(v) for v in re.findall(r"(\d+)x(\d+)", w)[-1]]
        adb("shell", "input", "swipe", str(W // 2), str(H * 3 // 4), str(W // 2), str(int(H * 3 // 4 - float(t[7:]) * density)), "800")
        time.sleep(2); before = dump(f"after{i}"); print(f"scrolled {t[7:]} dp"); print("\n".join(lines(before)[:60])); continue
    if t.startswith("square:"):
        size, _, nth = t[7:].partition("#")
        side = float(size) * density
        hit = [b for _, _, b in ns if abs((b[2] - b[0]) - side) <= 2 and abs((b[3] - b[1]) - side) <= 2]
    else:
        hit = [b for text, _, b in ns if text == t]
    k = int(nth) if t.startswith("square:") and nth else 0
    if len(hit) <= k: print(f"tap {t}: no such view"); continue
    b = hit[k]
    x, y = (b[0] + b[2]) // 2, (b[1] + b[3]) // 2
    print(f"tap {t} at {x},{y}")
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(3)
    after = dump(f"after{i}")
    d = list(difflib.unified_diff(lines(before), lines(after), lineterm="", n=0))
    print(f"after tap {t}: {len(d)} lines changed")
    print("\n".join(d[:40]))
    before = after
print("---- the app's log")
print(adb("logcat", "-d", "-v", "brief", "-s", "ters:*")[-8000:])
print("---- crashes")
print(adb("logcat", "-d", "-v", "brief", "-s", "AndroidRuntime:E", "DEBUG:*", "libc:F", "*:F")[-6000:])
