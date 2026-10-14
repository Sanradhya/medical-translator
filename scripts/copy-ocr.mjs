import { cp, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const require = createRequire(import.meta.url);
const tesseractRoot = path.dirname(require.resolve("tesseract.js/package.json"));
const coreRoot = path.dirname(require.resolve("tesseract.js-core/package.json"));
const pdfWorker = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");

const publicDir = path.join(process.cwd(), "public");
const ocrDir = path.join(publicDir, "ocr");
const coreDir = path.join(ocrDir, "core");
const langDir = path.join(ocrDir, "lang");
const langFile = path.join(langDir, "eng.traineddata.gz");
const langUrl = "https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0/eng.traineddata.gz";

const coreFiles = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
];

await mkdir(coreDir, { recursive: true });
await mkdir(langDir, { recursive: true });

await cp(path.join(tesseractRoot, "dist", "worker.min.js"), path.join(ocrDir, "worker.min.js"));
await cp(pdfWorker, path.join(publicDir, "pdf.worker.min.mjs"));

for (const fileName of coreFiles) {
  await cp(path.join(coreRoot, fileName), path.join(coreDir, fileName));
}

let langReady = false;
try {
  const info = await stat(langFile);
  langReady = info.size > 1_000_000;
} catch {
  langReady = false;
}

if (!langReady) {
  const response = await fetch(langUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the English reading data (${response.status}).`);
  }
  const write = createWriteStream(langFile);
  await pipeline(Readable.fromWeb(response.body), write);
}

console.log("Copied the on-device prescription reader");
