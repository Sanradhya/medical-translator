import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const TEAL = [17, 94, 89];
const PAPER = [244, 247, 246];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function draw(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pad = Math.floor(size * (maskable ? 0.22 : 0.16));
  const radius = size * 0.16;
  const center = size / 2;
  const arm = size * 0.11;
  const span = size * 0.32;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let color = TEAL;
      const inBounds = x >= pad && x < size - pad && y >= pad && y < size - pad;
      if (inBounds) {
        const left = x < pad + radius;
        const right = x >= size - pad - radius;
        const top = y < pad + radius;
        const bottom = y >= size - pad - radius;
        let inside = true;
        if (left && top) {
          inside = (x - (pad + radius)) ** 2 + (y - (pad + radius)) ** 2 <= radius ** 2;
        } else if (right && top) {
          inside = (x - (size - pad - radius)) ** 2 + (y - (pad + radius)) ** 2 <= radius ** 2;
        } else if (right && bottom) {
          inside =
            (x - (size - pad - radius)) ** 2 + (y - (size - pad - radius)) ** 2 <= radius ** 2;
        } else if (left && bottom) {
          inside = (x - (pad + radius)) ** 2 + (y - (size - pad - radius)) ** 2 <= radius ** 2;
        }
        if (inside) {
          const onCross =
            (Math.abs(x - center) <= arm / 2 && Math.abs(y - center) <= span / 2) ||
            (Math.abs(y - center) <= arm / 2 && Math.abs(x - center) <= span / 2);
          color = onCross ? TEAL : PAPER;
        }
      }
      const index = row + 1 + x * 4;
      raw[index] = color[0];
      raw[index + 1] = color[1];
      raw[index + 2] = color[2];
      raw[index + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const directory = path.join(process.cwd(), "public", "icons");
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, "icon-192.png"), draw(192, false));
writeFileSync(path.join(directory, "icon-512.png"), draw(512, false));
writeFileSync(path.join(directory, "maskable-512.png"), draw(512, true));
writeFileSync(path.join(directory, "apple-touch-icon.png"), draw(180, false));
console.log("Wrote PWA icons");
