// Exact text measurement, straight from the font file.
//
// The layout needs real advance widths, not an estimate: a headline can mix
// colours mid-sentence, and each coloured run is drawn as its own drawtext at a
// computed x. Guessing widths there would show up immediately as words that
// overlap or drift apart.
//
// So we read the OpenType tables ourselves. Only three are needed:
//   head -> unitsPerEm (the scale everything is expressed in)
//   hhea -> how many entries hmtx holds
//   hmtx -> the advance width of every glyph
//   cmap -> which glyph a character maps to
// Glyph outlines are irrelevant, which is why this works for .otf (CFF) just as
// well as .ttf, and why it needs no native dependency.
//
// Kerning is deliberately ignored: ffmpeg's drawtext advances by plain glyph
// advances without GPOS shaping, so matching that is what keeps our measurements
// and its rendering in agreement.

import { readFileSync } from "node:fs";

const cache = new Map();

function readTableDirectory(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = buf.toString("ascii", p, p + 4);
    tables[tag] = { offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) };
  }
  return tables;
}

// cmap format 4: the standard BMP mapping, stored as sorted segments.
function parseCmap4(buf, off, map) {
  const segCount = buf.readUInt16BE(off + 6) / 2;
  const endBase = off + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;

  for (let s = 0; s < segCount; s++) {
    const end = buf.readUInt16BE(endBase + s * 2);
    const start = buf.readUInt16BE(startBase + s * 2);
    if (start > end) continue;
    const delta = buf.readInt16BE(deltaBase + s * 2);
    const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);

    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid;
      if (rangeOffset === 0) {
        gid = (c + delta) & 0xffff;
      } else {
        const gp = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
        if (gp + 1 >= buf.length) continue;
        gid = buf.readUInt16BE(gp);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid && !map.has(c)) map.set(c, gid);
    }
  }
}

// cmap format 12: full Unicode range, stored as groups.
function parseCmap12(buf, off, map) {
  const nGroups = buf.readUInt32BE(off + 12);
  for (let g = 0; g < nGroups; g++) {
    const p = off + 16 + g * 12;
    const start = buf.readUInt32BE(p);
    const end = buf.readUInt32BE(p + 4);
    const startGid = buf.readUInt32BE(p + 8);
    // Guard against a pathological group claiming the whole codespace.
    for (let c = start; c <= end && c - start < 0x10000; c++) {
      if (!map.has(c)) map.set(c, startGid + (c - start));
    }
  }
}

function parseCmap(buf, table) {
  const base = table.offset;
  const numSubtables = buf.readUInt16BE(base + 2);
  const map = new Map();

  // Prefer a full-Unicode subtable, then the BMP one, then anything usable.
  const candidates = [];
  for (let i = 0; i < numSubtables; i++) {
    const p = base + 4 + i * 8;
    candidates.push({
      platform: buf.readUInt16BE(p),
      encoding: buf.readUInt16BE(p + 2),
      offset: base + buf.readUInt32BE(p + 4),
    });
  }
  const rank = (c) => {
    if (c.platform === 3 && c.encoding === 10) return 0;
    if (c.platform === 0 && c.encoding >= 4) return 1;
    if (c.platform === 3 && c.encoding === 1) return 2;
    if (c.platform === 0) return 3;
    return 4;
  };
  candidates.sort((a, b) => rank(a) - rank(b));

  for (const c of candidates) {
    if (c.offset + 4 > buf.length) continue;
    const format = buf.readUInt16BE(c.offset);
    if (format === 12) parseCmap12(buf, c.offset, map);
    else if (format === 4) parseCmap4(buf, c.offset, map);
    if (map.size) break;
  }
  return map;
}

// Load and index one font file. Results are cached: a render measures the same
// font thousands of times.
export function loadFont(path) {
  if (cache.has(path)) return cache.get(path);

  const buf = readFileSync(path);
  const tables = readTableDirectory(buf);
  for (const required of ["head", "hhea", "hmtx", "cmap"]) {
    if (!tables[required]) {
      throw new Error(`Font ${path} has no '${required}' table; cannot measure text.`);
    }
  }

  const unitsPerEm = buf.readUInt16BE(tables.head.offset + 18);
  const numHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);

  const advances = new Uint16Array(numHMetrics);
  for (let i = 0; i < numHMetrics; i++) {
    advances[i] = buf.readUInt16BE(tables.hmtx.offset + i * 4);
  }

  const font = {
    path,
    unitsPerEm,
    advances,
    cmap: parseCmap(buf, tables.cmap),
    // Ascender/descender drive line height when we want typographic leading.
    ascender: buf.readInt16BE(tables.hhea.offset + 4),
    descender: buf.readInt16BE(tables.hhea.offset + 6),
  };
  cache.set(path, font);
  return font;
}

// Advance width of one code point, in font units. Glyphs past the hmtx array
// all share the final advance, which is how monospaced tails are stored.
function advanceOf(font, codePoint) {
  const gid = font.cmap.get(codePoint) ?? 0;
  if (!font.advances.length) return 0;
  return gid < font.advances.length
    ? font.advances[gid]
    : font.advances[font.advances.length - 1];
}

/** Width of `text` at `fontSize`, in pixels. */
export function measureText(font, text, fontSize) {
  let units = 0;
  for (const ch of String(text)) units += advanceOf(font, ch.codePointAt(0));
  return (units / font.unitsPerEm) * fontSize;
}

/** Greedy word wrap to a pixel width, using real advances. */
export function wrapToWidth(font, text, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measureText(font, candidate, fontSize) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.filter((l) => l.length);
}

// ---------------------------------------------------------------------------
// Exact measurement
// ---------------------------------------------------------------------------
//
// The hmtx advances above are accurate to well under a percent, which is plenty
// for wrapping (and errs wide, so a line never overflows). It is not enough to
// butt two coloured runs together on one line: FreeType grid-fits each glyph as
// it rasterises, so what ffmpeg draws is consistently a touch narrower than the
// nominal advances, and at a 1500px prefix that drift becomes a visibly wrong
// word space.
//
// Rather than model the rasteriser, ask it. Every string we need is drawn onto
// one tall canvas, one per band, and the ink extents are read back. Bracketing
// each string with 'X' cancels the side bearings, so ink(XsX) - ink(XX) is
// exactly the advance ffmpeg will use. One render measures a whole video.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runFf = promisify(execFile);
const exactCache = new Map();

const cacheKey = (r) => `${r.fontPath}|${r.fontSize}|${r.text}`;

/**
 * Exact rendered advance width, in pixels, for each request.
 *
 * @param {{fontPath:string, fontSize:number, text:string}[]} requests
 * @returns {Promise<Map<string, number>>} keyed by `${fontPath}|${fontSize}|${text}`
 */
export async function measureExactBatch(requests) {
  const pending = [];
  const seen = new Set();
  for (const r of requests) {
    const key = cacheKey(r);
    if (exactCache.has(key) || seen.has(key)) continue;
    seen.add(key);
    pending.push({ ...r, key });
  }

  // Each (font, size) pair needs its own 'XX' baseline to subtract.
  const baselines = new Map();
  for (const r of pending) {
    const bk = `${r.fontPath}|${r.fontSize}`;
    if (!baselines.has(bk)) {
      baselines.set(bk, { fontPath: r.fontPath, fontSize: r.fontSize, text: "", key: `__base__${bk}` });
    }
  }

  const bands = [
    ...[...baselines.values()].map((b) => ({ ...b, probe: "XX" })),
    ...pending.map((r) => ({ ...r, probe: `X${r.text}X` })),
  ];
  if (!bands.length) return exactCache;

  // Size the canvas from the nominal widths, with generous headroom so nothing
  // clips (a clipped band would silently measure short).
  let width = 512;
  let y = 0;
  for (const b of bands) {
    const font = loadFont(b.fontPath);
    width = Math.max(width, Math.ceil(measureText(font, b.probe, b.fontSize) * 1.25) + 200);
    b.bandTop = y;
    b.bandHeight = Math.ceil(b.fontSize * 2);
    y += b.bandHeight;
  }
  // Both dimensions must be even. ffmpeg quietly rounds an odd-sized canvas
  // down, and a width one pixel narrower than assumed shifts every row of the
  // raw buffer by a byte, smearing the bands into each other.
  width += width % 2;
  const height = y + (y % 2);

  const work = await mkdtemp(join(tmpdir(), "li-measure-"));
  try {
    // Copy each font in under a bare name: ffmpeg's filter syntax treats ':' as
    // a separator, and a relative filename sidesteps escaping the path.
    const fontFiles = new Map();
    for (const b of bands) {
      if (!fontFiles.has(b.fontPath)) {
        const name = `f${fontFiles.size}.font`;
        await copyFile(b.fontPath, join(work, name));
        fontFiles.set(b.fontPath, name);
      }
    }

    const filters = [];
    for (const [i, b] of bands.entries()) {
      const file = `m${i}.txt`;
      await writeFile(join(work, file), b.probe);
      filters.push(
        `drawtext=fontfile=${fontFiles.get(b.fontPath)}:textfile=${file}:expansion=none:` +
          `fontcolor=white:fontsize=${b.fontSize}:x=40:y=${b.bandTop + Math.round(b.fontSize * 0.4)}`,
      );
    }

    const { stdout } = await runFf(
      "ffmpeg",
      [
        "-v", "error",
        "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=1`,
        "-vf", filters.join(","),
        "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
      ],
      { cwd: work, maxBuffer: 1 << 30, encoding: "buffer" },
    );

    const inkWidth = (b) => {
      let min = width, max = -1;
      const end = Math.min(height, b.bandTop + b.bandHeight);
      for (let row = b.bandTop; row < end; row++) {
        const base = row * width;
        for (let x = 0; x < width; x++) {
          if (stdout[base + x] > 40) {
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
      }
      return max < 0 ? 0 : max - min + 1;
    };

    if (process.env.MEASURE_DEBUG) {
      console.error(`[measure] canvas ${width}x${height} bytes=${stdout.length} expected=${width * height}`);
      for (const [i, b] of bands.entries()) {
        console.error(
          `[measure] band ${i} top=${b.bandTop} h=${b.bandHeight} fs=${b.fontSize} ` +
            `ink=${inkWidth(b)} probe="${b.probe.slice(0, 30)}"`,
        );
      }
    }

    const baseWidths = new Map();
    for (const b of bands) {
      if (b.key.startsWith("__base__")) baseWidths.set(`${b.fontPath}|${b.fontSize}`, inkWidth(b));
    }
    for (const b of bands) {
      if (b.key.startsWith("__base__")) continue;
      const base = baseWidths.get(`${b.fontPath}|${b.fontSize}`) ?? 0;
      exactCache.set(b.key, Math.max(0, inkWidth(b) - base));
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  return exactCache;
}

/** Read a previously batched measurement, falling back to the nominal advance. */
export function exactWidth(fontPath, fontSize, text, fallbackFont) {
  const key = `${fontPath}|${fontSize}|${text}`;
  if (exactCache.has(key)) return exactCache.get(key);
  return measureText(fallbackFont ?? loadFont(fontPath), text, fontSize);
}
