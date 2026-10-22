/**
 * Screenshot + walkthrough capture for the TabGen design prototype.
 * Usage: node scripts/capture.mjs   (expects vite at http://127.0.0.1:5180)
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "captures");
const MEDIA = "/cursor/stores/self/media/ui";
const BASE = process.env.ORIGIN ?? "http://127.0.0.1:5180";
const CHROME = process.env.CHROME ?? "/usr/local/bin/google-chrome";

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MOBILE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

const STILLS = [
  { id: "library", path: "/", coach: true },
  { id: "library-empty", path: "/?empty=1" },
  { id: "add-file", path: "/add?tab=file" },
  { id: "add-youtube", path: "/add?tab=youtube" },
  { id: "add-mic", path: "/add?tab=mic" },
  { id: "processing", path: "/processing/gece-treni?pause=1" },
  { id: "song-chords", path: "/song/sahil-yolu", coach: true },
  { id: "song-coach", path: "/song/sahil-yolu", coach: false },
  { id: "song-tab", path: "/song/sahil-yolu/tab", coach: true },
  { id: "song-play", path: "/song/sahil-yolu/play", coach: true },
  { id: "song-play-live", path: "/song/sahil-yolu/play?live=1", coach: true },
  { id: "song-play-result", path: "/song/sahil-yolu/play?result=1", coach: true },
  { id: "tuner", path: "/tuner" },
  { id: "metronome", path: "/metronome" },
  { id: "settings", path: "/settings" },
  { id: "settings-light", path: "/settings?theme=light" },
  { id: "error-too-long", path: "/states/too_long" },
  { id: "error-mic", path: "/states/micDenied" },
];

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dev server not reachable at ${BASE}`);
}

async function shot(browser, viewport, id, route, { coach } = {}) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setViewport(viewport);
  const dismiss = coach !== false;
  await page.evaluateOnNewDocument((keep) => {
    try {
      if (keep) sessionStorage.setItem("tabgen.coach", "1");
      else sessionStorage.removeItem("tabgen.coach");
    } catch {
      /* empty */
    }
  }, dismiss);
  await page.goto(BASE + route, { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate((keep) => {
    if (keep) sessionStorage.setItem("tabgen.coach", "1");
    else sessionStorage.removeItem("tabgen.coach");
    const el = document.querySelector("[data-coach]");
    if (keep && el) el.remove();
  }, dismiss);
  if (!dismiss) {
    await page.reload({ waitUntil: "networkidle0" });
  }
  await new Promise((r) => setTimeout(r, 280));
  const file = path.join(OUT, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  return file;
}

async function stills(browser) {
  for (const s of STILLS) {
    await shot(browser, DESKTOP, `desktop-${s.id}`, s.path, s);
    await shot(browser, MOBILE, `mobile-${s.id}`, s.path, s);
    console.log("shot", s.id);
  }
}

async function encodeVideo() {
  const sequence = [
    ["desktop-library.png", 2.4],
    ["desktop-library-empty.png", 2.0],
    ["desktop-add-file.png", 2.2],
    ["desktop-add-youtube.png", 2.2],
    ["desktop-add-mic.png", 2.0],
    ["desktop-processing.png", 2.4],
    ["desktop-song-coach.png", 2.6],
    ["desktop-song-chords.png", 3.0],
    ["desktop-song-tab.png", 2.6],
    ["desktop-song-play.png", 2.2],
    ["desktop-song-play-live.png", 2.6],
    ["desktop-song-play-result.png", 2.2],
    ["desktop-tuner.png", 2.0],
    ["desktop-metronome.png", 2.0],
    ["desktop-settings.png", 2.0],
    ["desktop-settings-light.png", 2.0],
    ["mobile-library.png", 2.2],
    ["mobile-song-chords.png", 2.6],
    ["desktop-error-too-long.png", 1.8],
  ];
  const list = path.join(OUT, "concat.txt");
  const lines = [];
  for (const [file, dur] of sequence) {
    lines.push(`file '${path.join(OUT, file)}'`);
    lines.push(`duration ${dur}`);
  }
  lines.push(`file '${path.join(OUT, sequence[sequence.length - 1][0])}'`);
  await writeFile(list, lines.join("\n"));
  const mp4 = path.join(OUT, "walkthrough.mp4");
  await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x16141c,format=yuv420p,fps=30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ],
      { stdio: "inherit" },
    );
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg " + code))));
  });
  return mp4;
}

async function publish() {
  await mkdir(MEDIA, { recursive: true });
  const names = [
    "desktop-library.png",
    "mobile-library.png",
    "desktop-library-empty.png",
    "mobile-library-empty.png",
    "desktop-add-file.png",
    "mobile-add-file.png",
    "desktop-add-youtube.png",
    "mobile-add-youtube.png",
    "desktop-add-mic.png",
    "mobile-add-mic.png",
    "desktop-processing.png",
    "mobile-processing.png",
    "desktop-song-chords.png",
    "mobile-song-chords.png",
    "desktop-song-coach.png",
    "mobile-song-coach.png",
    "desktop-song-tab.png",
    "mobile-song-tab.png",
    "desktop-song-play.png",
    "mobile-song-play.png",
    "desktop-song-play-live.png",
    "mobile-song-play-live.png",
    "desktop-song-play-result.png",
    "mobile-song-play-result.png",
    "desktop-tuner.png",
    "mobile-tuner.png",
    "desktop-metronome.png",
    "mobile-metronome.png",
    "desktop-settings.png",
    "mobile-settings.png",
    "desktop-settings-light.png",
    "mobile-settings-light.png",
    "desktop-error-too-long.png",
    "mobile-error-too-long.png",
    "desktop-error-mic.png",
    "mobile-error-mic.png",
    "walkthrough.mp4",
  ];
  for (const n of names) {
    await copyFile(path.join(OUT, n), path.join(MEDIA, n));
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--font-render-hinting=none"],
  });
  try {
    await stills(browser);
    await encodeVideo();
    await publish();
    console.log("done", MEDIA);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
