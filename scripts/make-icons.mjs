#!/usr/bin/env node
// Draws Flockence's app icons (the white "F" on the blue-to-green square used in the menu) as PNG files in
// public/icons, with no image tools needed. Run again after changing the design: node scripts/make-icons.mjs
// The same design is in public/icons/icon.svg (rounded) and icon-maskable.svg (full square, for Android masks).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FROM = [0x1c, 0x73, 0xae], TO = [0x36, 0xd4, 0x9b];
// The "F", on a 512 x 512 grid: [x, y, width, height, corner radius].
const F = [[176, 128, 64, 256, 10], [176, 128, 176, 60, 10], [176, 232, 136, 54, 10]];

function inRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** RGBA pixels for one icon. rounded: corner radius of the background (0 for a full square). */
function draw(size, rounded) {
  const px = Buffer.alloc(size * size * 4);
  const s = 512 / size, N = 4;   // 4 x 4 samples per pixel for smooth edges
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let bg = 0, fg = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const x = (i + (a + 0.5) / N) * s, y = (j + (b + 0.5) / N) * s;
      if (rounded ? inRoundRect(x, y, [0, 0, 512, 512, rounded]) : true) {
        bg++;
        if (F.some((r) => inRoundRect(x, y, r))) fg++;
      }
    }
    const t = (i + j) / (2 * size), k = (j * size + i) * 4, cover = bg / (N * N), white = bg ? fg / bg : 0;
    for (let c = 0; c < 3; c++) px[k + c] = Math.round((FROM[c] + (TO[c] - FROM[c]) * t) * (1 - white) + 255 * white);
    px[k + 3] = Math.round(255 * cover);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;   // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

{
  mkdirSync("public/icons", { recursive: true });
  for (const [name, size, rounded] of [
    ["icon-192.png", 192, 112], ["icon-512.png", 512, 112],
    ["icon-maskable-512.png", 512, 0],   // Android crops it to its own shape; the F sits inside the safe circle
    ["apple-touch-icon.png", 180, 0],    // iPhones round the corners themselves
    ["favicon-32.png", 32, 112],
  ]) {
    writeFileSync(`public/icons/${name}`, png(size, draw(size, rounded)));
    console.log(`public/icons/${name}`);
  }
}
