import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = 228;
const SIZE = 192;
const SS = 4;
const HI = SIZE * SS;
const SCALE = BASE / HI;
const RING_CX = 113.5;
const RING_CY = 110.5;
const RING_RX = 90.5;
const RING_RY = 90.5;

const ICONS = {
  cabinet: {
    output: 'icon-192.png',
    polygons: [
      [[66.2, 150.7], [108.2, 78.7], [105.8, 77.3], [63.8, 149.3]],
      [[113.8, 62.7], [161.8, 150.7], [164.2, 149.3], [116.2, 61.3]],
      [[65, 151.4], [163, 151.4], [163, 148.6], [65, 148.6]],
      [[101.2, 109.2], [162.2, 151.2], [163.8, 148.8], [102.8, 106.8]],
    ],
  },

};

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(base, over, alpha) {
  return [
    base[0] * (1 - alpha) + over[0] * alpha,
    base[1] * (1 - alpha) + over[1] * alpha,
    base[2] * (1 - alpha) + over[2] * alpha,
  ];
}

function roundedRectInside(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius + 1e-9;
}

function roundedRectBoundaryDistance(x, y, left, top, right, bottom, radius) {
  const nearestX = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const nearestY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - nearestX;
  const dy = y - nearestY;
  if (nearestX === x || nearestY === y) {
    return Math.min(x - left, right - x, y - top, bottom - y);
  }
  return radius - Math.sqrt(dx * dx + dy * dy);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function samplePixel(x, y, polygons) {
  let color = [0, 0, 0];

  const inTile = roundedRectInside(x, y, 2, 2, 226, 226, 31);
  if (!inTile) return color;

  const diagonal = clamp((x + y) / (BASE * 2), 0, 1);
  const topSheen = Math.exp(-(((x - 54) ** 2) / 9000 + ((y - 18) ** 2) / 900));
  const edgeFade = 1 - diagonal;
  const bg = 3 + 7 * edgeFade + 3 * topSheen;
  color = [bg + 1, bg + 1.5, bg + 2.3];

  const boundary = roundedRectBoundaryDistance(x, y, 2, 2, 226, 226, 31);
  if (boundary >= 0 && boundary < 1.35) {
    const edgeAlpha = 0.75 * (1 - boundary / 1.35) * (0.45 + 0.55 * edgeFade);
    color = mix(color, [91, 94, 100], edgeAlpha);
  }

  const normalized = Math.sqrt(((x - RING_CX) / RING_RX) ** 2 + ((y - RING_CY) / RING_RY) ** 2);
  const ringDistance = Math.abs(normalized - 1) * ((RING_RX + RING_RY) / 2);

  if (ringDistance < 6.5) {
    const glow = Math.exp(-(ringDistance * ringDistance) / 7.5) * 0.24;
    color = mix(color, [213, 154, 0], glow);
  }
  if (ringDistance <= 2.05) {
    const core = clamp(1 - ringDistance / 2.05, 0, 1);
    color = mix(color, [255, 212, 0], 0.88 + 0.12 * core);
  }

  for (const polygon of polygons) {
    if (pointInPolygon(x, y, polygon)) {
      const whiteShade = clamp(255 - Math.max(0, y - 75) * 0.035, 247, 255);
      color = [whiteShade, whiteShade, whiteShade];
      break;
    }
  }

  return color;
}

function render(polygons) {
  const high = new Float32Array(HI * HI * 3);
  let offset = 0;
  for (let py = 0; py < HI; py += 1) {
    const y = (py + 0.5) * SCALE;
    for (let px = 0; px < HI; px += 1) {
      const x = (px + 0.5) * SCALE;
      const [r, g, b] = samplePixel(x, y, polygons);
      high[offset++] = r;
      high[offset++] = g;
      high[offset++] = b;
    }
  }

  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  let out = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[out++] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const hiX = x * SS + sx;
          const hiY = y * SS + sy;
          const index = (hiY * HI + hiX) * 3;
          r += high[index];
          g += high[index + 1];
          b += high[index + 2];
        }
      }
      const divisor = SS * SS;
      raw[out++] = Math.round(clamp(r / divisor));
      raw[out++] = Math.round(clamp(g / divisor));
      raw[out++] = Math.round(clamp(b / divisor));
    }
  }
  return encodePng(SIZE, SIZE, raw);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, raw) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderPwaIcons(siteRoot) {
  for (const icon of Object.values(ICONS)) {
    const output = join(siteRoot, icon.output);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, render(icon.polygons));
  }
}
