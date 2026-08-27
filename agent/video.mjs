// Renders a theory explainer into a silent, caption-style MP4 with ffmpeg.
//
// The video is deliberately silent and text-driven: LinkedIn autoplays muted,
// so anything that matters has to be readable on screen. Each "frame" is a
// short beat (a title, a definition, one example) rendered as its own segment
// and concatenated, which keeps every beat independently debuggable.
//
// The only external dependency is ffmpeg. The workflow installs it (and the
// DejaVu fonts) explicitly rather than relying on the runner image.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, copyFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

// Typography per beat. `scale` is the starting font size as a fraction of the
// canvas width; the renderer shrinks it further if a beat runs long.
const STYLES = {
  title: { scale: 0.082, bold: true, color: "foreground", align: "center", rule: true },
  hook: { scale: 0.055, bold: false, color: "muted", align: "center" },
  definition: { scale: 0.062, bold: true, color: "foreground", align: "center" },
  bullet: { scale: 0.054, bold: false, color: "foreground", align: "left", marker: true },
  contrast: { scale: 0.056, bold: false, color: "muted", align: "center" },
  // keepLines: the two-line parallel close is the payoff of the post format, so
  // shrink the type until each line holds rather than letting it wrap into four.
  closer: { scale: 0.068, bold: true, color: "accent", align: "center", keepLines: true },
  cta: { scale: 0.052, bold: false, color: "muted", align: "center" },
};

const DEFAULT_STYLE = STYLES.definition;

// ffmpeg wants 0xRRGGBB. Config stores bare hex so it reads like a palette.
function hex(name) {
  const value = config.video[name] || config.video.foreground;
  return `0x${String(value).replace(/^#/, "")}`;
}

// Greedy word wrap. We have no font metrics available without pulling in a
// native dependency, so we budget by average glyph advance. These ratios were
// measured by rendering sample strings and scanning the ink bounding box:
// DejaVu Sans peaks around 0.54 regular / 0.61 bold, Liberation Sans is
// narrower. The values below sit just above the widest measurement so a line
// never overflows the safe area; bold genuinely needs the larger budget, which
// is why this is weight-aware rather than one shared constant.
function wrap(text, fontSize, usableWidth, ratio) {
  const maxChars = Math.max(8, Math.floor(usableWidth / (fontSize * ratio)));
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.filter((l) => l.length);
}

// Fit a beat's text into the safe area, shrinking the font until the wrapped
// block fits vertically. Returns the chosen size and its wrapped lines.
function fitText(text, style, box) {
  let fontSize = Math.round(config.video.width * style.scale);
  const minSize = Math.round(config.video.width * 0.032);
  const ratio = style.bold ? config.video.glyphRatioBold : config.video.glyphRatioRegular;

  // For a keepLines beat, the author's own line breaks carry meaning, so the
  // target is one rendered line per written line.
  const written = String(text).split("\n").filter((p) => p.trim()).length;

  for (;;) {
    const lines = wrap(text, fontSize, box.width, ratio);
    const lineHeight = Math.round(fontSize * 1.42);
    const blockHeight = lines.length * lineHeight;
    const fitsBox = blockHeight <= box.height;
    const holdsLines = !style.keepLines || lines.length <= written;
    if ((fitsBox && holdsLines) || fontSize <= minSize) {
      return { fontSize, lines, lineHeight, blockHeight };
    }
    fontSize -= 2;
  }
}

// Resolve the first font path that actually exists on this machine.
async function pickFont(candidates) {
  for (const path of candidates.filter(Boolean)) {
    try {
      await access(path);
      return path;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    "No usable TrueType font found. Set VIDEO_FONT and VIDEO_FONT_BOLD to " +
      "font files that exist, or install fonts-dejavu-core.",
  );
}

export async function checkFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
  } catch {
    throw new Error(
      "ffmpeg is not installed or not on PATH. It is required to render " +
        "video posts. Install it with: apt-get install ffmpeg (or brew install ffmpeg).",
    );
  }
}

// A sensible on-screen duration when the script does not specify one: long
// enough to read the line at a comfortable pace, with a floor for short beats.
function defaultSeconds(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.min(9, Math.max(2.8, words * 0.36 + 1.4));
}

// Build the -vf filter chain for one beat.
function buildFilters(frame, style, fit, geo, fonts) {
  const { width, height, fadeSeconds } = geo;
  const filters = [];

  // Vertically centre the text block, nudged up slightly so it sits on the
  // optical centre rather than the mathematical one.
  const top = Math.round((height - fit.blockHeight) / 2 - height * 0.02);
  const fontfile = style.bold ? fonts.bold : fonts.regular;

  const indent = geo.indent;

  fit.lines.forEach((line, i) => {
    const y = top + i * fit.lineHeight;
    const x = style.align === "left" ? `${geo.margin + indent}` : "(w-text_w)/2";
    filters.push(
      [
        `drawtext=fontfile=${fontfile}`,
        `textfile=${frame.files[i]}`,
        // Without this, drawtext treats '%{...}' as an expression to expand and
        // silently drops any line containing a bare '%' (e.g. "50% uptime").
        "expansion=none",
        `fontcolor=${hex(style.color)}`,
        `fontsize=${fit.fontSize}`,
        `x=${x}`,
        `y=${y}`,
      ].join(":"),
    );
  });

  // A short gold rule under a title beat, and a bullet marker beside examples.
  if (style.rule) {
    const ruleW = Math.round(width * 0.16);
    const ruleY = top + fit.blockHeight + Math.round(height * 0.035);
    filters.push(
      `drawbox=x=${Math.round((width - ruleW) / 2)}:y=${ruleY}:w=${ruleW}:` +
        `h=${Math.max(3, Math.round(height * 0.006))}:color=${hex("accent")}:t=fill`,
    );
  }
  if (style.marker) {
    const dot = Math.round(fit.fontSize * 0.26);
    filters.push(
      `drawbox=x=${geo.margin}:y=${top + Math.round(fit.fontSize * 0.45)}:` +
        `w=${dot}:h=${dot}:color=${hex("accent")}:t=fill`,
    );
  }

  // Fade each beat in and out so the cuts feel intentional rather than jumpy.
  const fade = Math.min(fadeSeconds, frame.seconds / 3);
  filters.push(`fade=t=in:st=0:d=${fade.toFixed(2)}`);
  filters.push(`fade=t=out:st=${(frame.seconds - fade).toFixed(2)}:d=${fade.toFixed(2)}`);

  return filters.join(",");
}

/**
 * Render a script into an MP4.
 *
 * @param {{kind:string, text:string, seconds?:number}[]} frames
 * @param {string} outPath  where to write the finished file
 * @returns {Promise<{path:string, seconds:number, frames:number}>}
 */
export async function renderVideo(frames, outPath) {
  if (!frames?.length) throw new Error("Cannot render a video with no frames.");
  await checkFfmpeg();

  const geo = {
    width: config.video.width,
    height: config.video.height,
    fps: config.video.fps,
    margin: config.video.margin,
    fadeSeconds: config.video.fadeSeconds,
  };
  const box = {
    width: geo.width - geo.margin * 2,
    height: geo.height - geo.margin * 2,
  };

  const work = await mkdtemp(join(tmpdir(), "li-video-"));
  try {
    // Copy the fonts into the working directory. ffmpeg's filter syntax treats
    // ':' as a separator, so referencing fonts by a bare relative filename (with
    // ffmpeg's cwd set to the working dir) avoids escaping the path entirely.
    const [regularSrc, boldSrc] = await Promise.all([
      pickFont(config.video.fontCandidates),
      pickFont(config.video.fontBoldCandidates),
    ]);
    await Promise.all([
      copyFile(regularSrc, join(work, "font.ttf")),
      copyFile(boldSrc, join(work, "fontb.ttf")),
    ]);
    const fonts = { regular: "font.ttf", bold: "fontb.ttf" };

    const segments = [];
    let totalSeconds = 0;

    for (const [index, raw] of frames.entries()) {
      const style = STYLES[raw.kind] || DEFAULT_STYLE;
      const seconds = Number(raw.seconds) > 0 ? Number(raw.seconds) : defaultSeconds(raw.text);

      // Bulleted beats get a hanging indent: the marker sits on the margin and
      // the copy is inset to its right. Reserve that width up front (from the
      // style's nominal size) so wrapping accounts for it, and reuse the same
      // value when drawing so the two can't disagree.
      const indent = style.marker ? Math.round(geo.width * style.scale * 0.75) : 0;
      const fit = fitText(raw.text, style, { ...box, width: box.width - indent });

      // Each wrapped line goes to its own textfile and its own drawtext, so
      // every line is individually centred rather than left-aligned inside a
      // centred block. Writing the text to a file (instead of inlining it)
      // means quotes, colons and percent signs in the copy need no escaping.
      const files = [];
      for (const [i, line] of fit.lines.entries()) {
        const name = `t${String(index).padStart(3, "0")}_${String(i).padStart(2, "0")}.txt`;
        await writeFile(join(work, name), line);
        files.push(name);
      }

      const frame = { ...raw, seconds, files };
      const segment = `seg${String(index).padStart(3, "0")}.mp4`;

      await run(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          "-f", "lavfi",
          "-i", `color=c=${hex("background")}:s=${geo.width}x${geo.height}:r=${geo.fps}:d=${seconds}`,
          "-vf", buildFilters(frame, style, fit, { ...geo, indent }, fonts),
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-profile:v", "high",
          "-preset", "veryfast",
          "-crf", "20",
          segment,
        ],
        { cwd: work },
      );

      segments.push(segment);
      totalSeconds += seconds;
    }

    // Concatenate. All segments share encoder settings, so the video stream is
    // copied rather than re-encoded. A silent AAC track is added because some
    // players (and LinkedIn's own transcoder) are happier with an audio stream
    // present than with none at all.
    await writeFile(join(work, "list.txt"), segments.map((s) => `file '${s}'`).join("\n"));

    const finalPath = resolve(outPath);
    await mkdir(dirname(finalPath), { recursive: true });

    await run(
      "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", "list.txt",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        finalPath,
      ],
      { cwd: work },
    );

    return { path: finalPath, seconds: totalSeconds, frames: frames.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Convenience for the CLI: the default output path for a given theory.
export function defaultOutPath(theoryName) {
  const slug = theoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return join(here, config.video.outDir, `${slug || "post"}.mp4`);
}
