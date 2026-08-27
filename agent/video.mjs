// Renders a theory explainer into a silent, caption-style MP4 with ffmpeg.
//
// The video autoplays muted, so the teaching lives entirely on screen. The
// visual language is deliberately editorial rather than "slide deck": a warm
// near-black ground, one tight grotesque, copy set flush left and anchored to
// the top of the frame, and a single gold accent used to pick out the words the
// sentence turns on.
//
// A frame is a stack of blocks (headline, body, kicker, stat, rule) rather than
// one lump of centred text. That is what allows a beat to read as a designed
// layout: a statement, its qualifier, and a punchline at different weights.
//
// Rendering is two-pass. Pass one lays out every frame and collects the exact
// text widths it will need; pass two draws. The split exists because a headline
// can change colour mid-sentence, and each coloured run is a separate drawtext
// positioned at a measured offset. See fontmetrics.mjs for why estimating those
// offsets is not good enough.
//
// The only external dependency is ffmpeg, which the workflow installs.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, copyFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { loadFont, measureText, measureExactBatch, exactWidth } from "./fontmetrics.mjs";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

// Type scale, as a fraction of canvas width, plus which cut and colour each
// block uses. Leading is tight on display sizes and looser on body copy.
const BLOCKS = {
  headline: { scale: 0.082, face: "display", color: "foreground", leading: 1.1, maxLines: 4 },
  body: { scale: 0.043, face: "regular", color: "muted", leading: 1.34 },
  kicker: { scale: 0.039, face: "display", color: "foreground", leading: 1.25 },
  statLabel: { scale: 0.039, face: "regular", color: "muted", leading: 1.25 },
  statValue: { scale: 0.153, face: "display", color: "accent", leading: 1.0 },
  statUnit: { scale: 0.043, face: "display", color: "foreground", leading: 1.0 },
};

// Vertical gap after each block, as a fraction of canvas height.
const GAP_AFTER = {
  headline: 0.038,
  body: 0.03,
  kicker: 0.03,
  stat: 0.035,
  rule: 0.032,
};

function hex(name) {
  const value = config.video[name] ?? config.video.foreground;
  return `0x${String(value).replace(/^#/, "")}`;
}

// Accent markup: *these words* are drawn in the accent colour. Returns the
// plain line text plus the character ranges that should be highlighted.
function parseAccents(raw) {
  let text = "";
  const spans = [];
  const parts = String(raw).split("*");
  for (const [i, part] of parts.entries()) {
    if (i % 2 === 1 && part.length) spans.push([text.length, text.length + part.length]);
    text += part;
  }
  return { text, spans };
}

function isAccented(index, spans) {
  return spans.some(([s, e]) => index >= s && index < e);
}

// Wrap one marked-up string into lines, preserving which characters are
// accented, then split each line into same-colour runs. A run records the
// prefix that precedes it so the renderer can position it exactly.
function layoutRichText(fontPath, fontSize, raw, maxWidth) {
  const font = loadFont(fontPath);
  const out = [];

  // Written line breaks are meaningful (a parallel close, a stacked pair), so
  // each is wrapped independently rather than reflowed into one paragraph.
  for (const paragraph of String(raw).split("\n")) {
    const { text, spans } = parseAccents(paragraph);

    // Tokenise into words, remembering where each sits so accent spans survive
    // wrapping.
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      words.push({ text: m[0], accent: isAccented(m.index, spans) });
    }
    if (!words.length) continue;

    // Greedy wrap on nominal widths. These err very slightly wide, so a line
    // that fits here always fits when drawn.
    const lines = [];
    let current = [];
    for (const word of words) {
      const candidate = [...current, word].map((w) => w.text).join(" ");
      if (current.length && measureText(font, candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = [word];
      } else {
        current.push(word);
      }
    }
    if (current.length) lines.push(current);

    // Group each line's words into runs of a single colour. A run carries the
    // text that precedes it on its line, which is what the renderer measures to
    // place it exactly.
    for (const lineWords of lines) {
      const lineText = lineWords.map((w) => w.text).join(" ");
      const runs = [];
      let cursor = 0;
      for (const word of lineWords) {
        const at = cursor;
        cursor += word.text.length + 1; // +1 for the joining space
        const last = runs.at(-1);
        if (last && last.accent === word.accent) {
          last.text = `${last.text} ${word.text}`;
        } else {
          runs.push({ text: word.text, accent: word.accent, start: at });
        }
      }
      out.push({
        text: lineText,
        runs: runs.map((r) => ({ ...r, prefix: lineText.slice(0, r.start) })),
      });
    }
  }

  return out;
}

async function pickFont(candidates, label) {
  for (const path of candidates.filter(Boolean)) {
    try {
      await access(path);
      return path;
    } catch {
      /* next */
    }
  }
  throw new Error(
    `No usable ${label} font found. Install fonts-inter, or set the matching ` +
      "VIDEO_FONT_* variable to a font file that exists.",
  );
}

export async function checkFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
  } catch {
    throw new Error(
      "ffmpeg is not installed or not on PATH. It is required to render video " +
        "posts. Install it with: apt-get install ffmpeg (or brew install ffmpeg).",
    );
  }
}

function defaultSeconds(frame) {
  const words = frame.blocks
    .map((b) => `${b.text || ""} ${b.label || ""} ${b.value || ""} ${b.unit || ""}`)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.min(9, Math.max(2.6, words * 0.34 + 1.5));
}

// Ascent in pixels, used to sit a stat's unit on the same baseline as its
// oversized numeral.
const ascentPx = (font, size) => (font.ascender / font.unitsPerEm) * size;

// ---------------------------------------------------------------------------
// Pass one: lay out every frame, collecting the exact measurements needed
// ---------------------------------------------------------------------------
function planFrames(frames, geo, fonts) {
  const requests = [];
  const planned = [];
  let elapsed = 0;

  for (const [index, frame] of frames.entries()) {
    const blocks = frame.blocks || [];
    const seconds = Number(frame.seconds) > 0 ? Number(frame.seconds) : defaultSeconds({ blocks });
    const drawn = [];
    let y = Math.round(geo.height * geo.topAnchor);

    for (const block of blocks) {
      if (block.type === "rule") {
        drawn.push({ kind: "rule", y });
        y += Math.round(geo.height * GAP_AFTER.rule);
        continue;
      }

      if (block.type === "stat") {
        const labelStyle = BLOCKS.statLabel;
        const valueStyle = BLOCKS.statValue;
        const unitStyle = BLOCKS.statUnit;
        const labelSize = Math.round(geo.width * labelStyle.scale);
        const valueSize = Math.round(geo.width * valueStyle.scale);
        const unitSize = Math.round(geo.width * unitStyle.scale);

        const valueFont = loadFont(fonts[valueStyle.face].path);
        const unitFont = loadFont(fonts[unitStyle.face].path);
        const valueWidth = measureText(valueFont, block.value, valueSize);

        drawn.push({
          kind: "stat",
          y,
          label: block.label,
          labelSize,
          value: block.value,
          valueSize,
          // The unit sits to the right of the numeral, on its baseline.
          unit: block.unit,
          unitSize,
          unitDx: Math.round(valueWidth + geo.width * 0.018),
          unitDy: Math.round(ascentPx(valueFont, valueSize) - ascentPx(unitFont, unitSize)),
          accent: block.accent !== false,
        });

        // Measure the numeral exactly: the unit butts against it.
        requests.push({ fontPath: fonts[valueStyle.face].path, fontSize: valueSize, text: block.value });

        y +=
          Math.round(labelSize * labelStyle.leading) +
          Math.round(valueSize * 1.02) +
          Math.round(geo.height * GAP_AFTER.stat);
        continue;
      }

      const style = BLOCKS[block.type] || BLOCKS.body;
      const fontPath = fonts[style.face].path;

      // Written line breaks are load-bearing: a two-line parallel close only
      // lands if each half holds its own line. So when the copy has explicit
      // breaks, the target is one rendered line per written line, and the type
      // shrinks until that holds. Blocks without breaks just cap their depth so
      // one long beat cannot push the rest of the frame off the bottom.
      const written = String(block.text).split("\n").filter((p) => p.trim()).length;
      const maxLines = written > 1 ? written : style.maxLines || Infinity;
      const minSize = Math.round(geo.width * style.scale * 0.62);

      let fontSize = Math.round(geo.width * style.scale);
      let lines = layoutRichText(fontPath, fontSize, block.text, geo.contentWidth);
      while (lines.length > maxLines && fontSize > minSize) {
        fontSize -= 2;
        lines = layoutRichText(fontPath, fontSize, block.text, geo.contentWidth);
      }

      const lineHeight = Math.round(fontSize * style.leading);

      for (const line of lines) {
        for (const r of line.runs) {
          if (r.prefix) requests.push({ fontPath, fontSize, text: r.prefix });
        }
      }

      drawn.push({ kind: "text", y, lines, fontPath, fontSize, lineHeight, color: style.color });
      y += lines.length * lineHeight + Math.round(geo.height * GAP_AFTER[block.type] ?? 0);
    }

    planned.push({ index, seconds, drawn, elapsed, brand: index === 0 });
    elapsed += seconds;
  }

  return { planned, requests, total: elapsed };
}

// ---------------------------------------------------------------------------
// Pass two: build the filter chain for one frame
// ---------------------------------------------------------------------------
function buildFilters(frame, geo, fonts, assets, total) {
  const filters = [];

  for (const item of frame.drawn) {
    if (item.kind === "rule") {
      filters.push(
        `drawbox=x=${geo.margin}:y=${item.y}:w=${geo.contentWidth}:h=2:` +
          `color=${hex("rule")}:t=fill`,
      );
      continue;
    }

    if (item.kind === "stat") {
      const labelY = item.y;
      const valueY = labelY + Math.round(item.labelSize * BLOCKS.statLabel.leading);
      filters.push(
        `drawtext=fontfile=${fonts.regular.file}:textfile=${item.labelFile}:` +
          `expansion=none:y_align=font:fontcolor=${hex("muted")}:fontsize=${item.labelSize}:` +
          `x=${geo.margin}:y=${labelY}`,
      );
      filters.push(
        `drawtext=fontfile=${fonts.display.file}:textfile=${item.valueFile}:` +
          `expansion=none:y_align=font:fontcolor=${hex(item.accent ? "accent" : "dim")}:` +
          `fontsize=${item.valueSize}:x=${geo.margin}:y=${valueY}`,
      );
      if (item.unit) {
        filters.push(
          `drawtext=fontfile=${fonts.display.file}:textfile=${item.unitFile}:` +
            `expansion=none:y_align=font:fontcolor=${hex("foreground")}:fontsize=${item.unitSize}:` +
            `x=${geo.margin + item.unitDx}:y=${valueY + item.unitDy}`,
        );
      }
      continue;
    }

    const face = item.fontPath === fonts.display.path ? fonts.display : fonts.regular;
    for (const [li, line] of item.lines.entries()) {
      const y = item.y + li * item.lineHeight;
      for (const r of line.runs) {
        const dx = r.prefix ? Math.round(exactWidth(item.fontPath, item.fontSize, r.prefix)) : 0;
        filters.push(
          `drawtext=fontfile=${face.file}:textfile=${r.file}:expansion=none:y_align=font:` +
            `fontcolor=${hex(r.accent ? "accent" : item.color)}:fontsize=${item.fontSize}:` +
            `x=${geo.margin + dx}:y=${y}`,
        );
      }
    }
  }

  // Brand mark, on the opening frame only. It sits above the watermark rather
  // than on top of it.
  if (frame.brand) {
    const y = Math.round(geo.height * (config.video.watermark ? 0.86 : 0.9));
    const dot = Math.round(geo.width * 0.013);
    filters.push(
      `drawbox=x=${geo.margin}:y=${y + Math.round(dot * 0.55)}:w=${dot}:h=${dot}:` +
        `color=${hex("accent")}:t=fill`,
    );
    filters.push(
      `drawtext=fontfile=${fonts.display.file}:textfile=${assets.brand}:` +
        `expansion=none:y_align=font:fontcolor=${hex("foreground")}:fontsize=${Math.round(geo.width * 0.029)}:` +
        `x=${geo.margin + Math.round(dot * 2.2)}:y=${y}`,
    );
  }

  // Watermark: every frame, bottom left, clear of the progress bar. Quiet
  // enough to ignore while reading, legible if you look for it.
  if (assets.watermark) {
    const size = Math.round(geo.width * 0.026);
    const y = geo.height - Math.round(geo.height * 0.062);
    let x = geo.margin;

    if (assets.badge) {
      const box = Math.round(size * 1.25);
      // Centre the badge on the text's optical middle rather than its box top.
      const boxY = y + Math.round(size * 0.5 - box * 0.5);
      filters.push(
        `drawbox=x=${x}:y=${boxY}:w=${box}:h=${box}:color=${hex("muted")}:t=fill`,
      );
      const inSize = Math.round(box * 0.62);
      const inFont = loadFont(fonts.display.path);
      const inX = x + Math.round((box - measureText(inFont, "in", inSize)) / 2);
      filters.push(
        `drawtext=fontfile=${fonts.display.file}:textfile=${assets.badge}:` +
          `expansion=none:y_align=font:fontcolor=${hex("background")}:fontsize=${inSize}:` +
          `x=${inX}:y=${boxY + Math.round(box * 0.5 - inSize * 0.5)}`,
      );
      x += box + Math.round(size * 0.55);
    }

    filters.push(
      `drawtext=fontfile=${fonts.regular.file}:textfile=${assets.watermark}:` +
        `expansion=none:y_align=font:fontcolor=${hex("muted")}:fontsize=${size}:` +
        `x=${x}:y=${y}`,
    );
  }

  // Progress bar. `t` is the time within this segment, so the bar keeps
  // advancing across the cut rather than restarting each beat.
  const barH = Math.max(3, Math.round(geo.height * 0.005));
  filters.push(
    `drawbox=x=0:y=${geo.height - barH}:h=${barH}:` +
      `w='(${frame.elapsed.toFixed(3)}+t)/${total.toFixed(3)}*${geo.width}':` +
      `color=${hex("accent")}:t=fill`,
  );

  const fade = Math.min(geo.fadeSeconds, frame.seconds / 3);
  filters.push(`fade=t=in:st=0:d=${fade.toFixed(2)}`);
  filters.push(`fade=t=out:st=${(frame.seconds - fade).toFixed(2)}:d=${fade.toFixed(2)}`);

  return filters.join(",");
}

/**
 * Render a script into an MP4.
 *
 * A frame is `{ blocks: [...], seconds? }`. Blocks are:
 *   { type: "headline"|"body"|"kicker", text }   text may use *accent* markup
 *   { type: "stat", label, value, unit, accent }
 *   { type: "rule" }
 */
export async function renderVideo(frames, outPath) {
  if (!frames?.length) throw new Error("Cannot render a video with no frames.");
  await checkFfmpeg();

  const v = config.video;
  const geo = {
    width: v.width,
    height: v.height,
    fps: v.fps,
    margin: v.margin,
    contentWidth: v.width - v.margin * 2,
    topAnchor: v.topAnchor,
    fadeSeconds: v.fadeSeconds,
  };

  const fonts = {
    display: { path: await pickFont(v.fontDisplayCandidates, "display") },
    regular: { path: await pickFont(v.fontRegularCandidates, "regular") },
  };

  const { planned, requests, total } = planFrames(frames, geo, fonts);
  await measureExactBatch(requests);

  const work = await mkdtemp(join(tmpdir(), "li-video-"));
  try {
    await copyFile(fonts.display.path, join(work, "display.font"));
    await copyFile(fonts.regular.path, join(work, "regular.font"));
    fonts.display.file = "display.font";
    fonts.regular.file = "regular.font";

    // Every string goes to its own file, so copy containing quotes, colons or
    // percent signs needs no filter escaping at all.
    let n = 0;
    const put = async (text) => {
      const name = `t${String(n++).padStart(4, "0")}.txt`;
      await writeFile(join(work, name), text);
      return name;
    };
    const assets = { brand: await put(v.brand) };
    if (v.watermark) {
      assets.watermark = await put(v.watermark);
      if (v.watermarkBadge) assets.badge = await put("in");
    }

    for (const frame of planned) {
      for (const item of frame.drawn) {
        if (item.kind === "stat") {
          item.labelFile = await put(item.label || "");
          item.valueFile = await put(item.value || "");
          if (item.unit) item.unitFile = await put(item.unit);
        } else if (item.kind === "text") {
          for (const line of item.lines) {
            for (const r of line.runs) r.file = await put(r.text);
          }
        }
      }
    }

    const segments = [];
    for (const frame of planned) {
      const segment = `seg${String(frame.index).padStart(3, "0")}.mp4`;
      await run(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          "-f", "lavfi",
          "-i", `color=c=${hex("background")}:s=${geo.width}x${geo.height}:r=${geo.fps}:d=${frame.seconds}`,
          "-vf", buildFilters(frame, geo, fonts, assets, total),
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
    }

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

    return { path: finalPath, seconds: total, frames: frames.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function defaultOutPath(theoryName) {
  const slug = theoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return join(here, config.video.outDir, `${slug || "post"}.mp4`);
}
