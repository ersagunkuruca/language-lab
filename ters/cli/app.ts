// A page as an app for phones (WEB.md, "Mobile"): `lab build-app`. The
// page `lab build-web` makes, plus what makes it installable and offline:
// a web app manifest, a service worker that keeps every file, and icons
// (an installable PWA, W3C's Web Application Manifest). The same folder is
// a Capacitor (Ionic) project for an Android or iOS app: its config points
// at www/, where the page is. Nothing mobile enters the language: a page's
// files are already in localStorage (src/lang/browser.ts), which works
// offline.

import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

// The folder, as paths and contents.
export function appFolder(title: string, page: string): Record<string, string | Uint8Array> {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  const hue = parseInt(createHash("sha256").update(title).digest("hex").slice(0, 4), 16) % 360;
  const colour = rgb(hue, 0.45, 0.42), hex = `#${colour.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  const manifest = {
    name: title, short_name: title.length > 12 ? title.slice(0, 12).trim() : title,
    start_url: "./", scope: "./", display: "standalone", background_color: "#ffffff", theme_color: hex,
    icons: [192, 512].map((n) => ({ src: `icon-${n}.png`, sizes: `${n}x${n}`, type: "image/png", purpose: "any maskable" })),
  };
  const head = [
    `<link rel="manifest" href="manifest.webmanifest">`,
    `<meta name="theme-color" content="${hex}">`,
    `<link rel="icon" href="icon-192.png">`,
    `<link rel="apple-touch-icon" href="icon-192.png">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    // A service worker only runs from http(s); a page opened as a file
    // works as it did, without one.
    `<script>if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");</script>`,
  ].join("\n");
  const www: Record<string, string | Uint8Array> = {
    "index.html": page.replace("</head>", `${head}\n</head>`),
    "manifest.webmanifest": JSON.stringify(manifest, null, 2) + "\n",
    "icon-192.png": icon(192, colour), "icon-512.png": icon(512, colour),
  };
  // Named by what it keeps, so a new build replaces the old cache.
  const hash = createHash("sha256");
  for (const x of Object.values(www)) hash.update(x);
  const version = hash.digest("hex").slice(0, 12);
  www["sw.js"] = serviceWorker(`${slug}-${version}`, ["./", ...Object.keys(www)]);
  return {
    ...Object.fromEntries(Object.entries(www).map(([p, x]) => [`www/${p}`, x])),
    "capacitor.config.json": JSON.stringify({ appId: `app.lab.${slug.replace(/-/g, "_").replace(/^(\d)/, "_$1")}`, appName: title, webDir: "www" }, null, 2) + "\n",
    "package.json": JSON.stringify({ name: slug, private: true, description: `${title}, built by lab build-app` }, null, 2) + "\n",
    "README.md": readme(title),
  };
}

// Every file from the cache first, so the app opens with no network; the
// caches of other builds go when this one takes over.
function serviceWorker(cache: string, files: string[]): string {
  return `// The app's files, kept for offline use (lab build-app, ters/cli/app.ts).
const CACHE = ${JSON.stringify(cache)}, FILES = ${JSON.stringify(files)};
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys()
  .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`;
}

function readme(title: string): string {
  return `# ${title}

Built by \`lab build-app\` from a program in the language (docs/design/targets/WEB.md).

- **As a web app (PWA):** put \`www/\` on any HTTPS host. Opened in a phone's
  browser it can be installed ("Add to Home screen"), and it runs offline.
- **As an Android or iOS app (Capacitor):** in this folder,

      npm install @capacitor/core @capacitor/cli @capacitor/android
      npx cap add android
      npx cap run android

  (\`@capacitor/ios\` and \`npx cap add ios\` on a Mac with Xcode). After a new
  \`lab build-app\`, \`npx cap sync\` copies \`www/\` into the app.
`;
}

// A square icon: the program's colour, with a white disc inside the
// middle 40% that every mask keeps.
function icon(n: number, [r, g, b]: number[]): Uint8Array {
  const rows = Buffer.alloc(n * (1 + 3 * n));
  for (let y = 0; y < n; y++) {
    rows[y * (1 + 3 * n)] = 0;
    for (let x = 0; x < n; x++) {
      // Coverage of the disc at this pixel, for a smooth edge.
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) - n * 0.22;
      const a = Math.min(1, Math.max(0, 0.5 - d));
      const at = y * (1 + 3 * n) + 1 + 3 * x;
      rows[at] = Math.round(r + (255 - r) * a); rows[at + 1] = Math.round(g + (255 - g) * a); rows[at + 2] = Math.round(b + (255 - b) * a);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function rgb(h: number, s: number, l: number): number[] {
  const k = (m: number) => (m + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((m) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(m) - 3, 9 - k(m), 1)))));
}
