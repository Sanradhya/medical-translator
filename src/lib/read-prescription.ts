import type { PDFPageProxy } from "pdfjs-dist";
import type Tesseract from "tesseract.js";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 4;
const MIN_PDF_TEXT = 40;

export type ReadSource = "pdf-text" | "ocr";

export interface PrescriptionRead {
  text: string;
  source: ReadSource;
}

type Reader = Tesseract.Worker;

let readerPromise: Promise<Reader> | null = null;
let workerConfigured = false;

export async function readPrescription(
  file: File,
  onStatus?: (message: string) => void,
): Promise<PrescriptionRead> {
  if (file.size <= 0) {
    throw new Error("That file is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Choose a photo or PDF smaller than 12 MB.");
  }

  const kind = fileKind(file);
  if (kind === "image") {
    onStatus?.("Reading the prescription on this device");
    const text = cleanup(await recognize(file, onStatus));
    if (!text) {
      throw new Error("No text could be read. Try a clearer photo, or type the prescription.");
    }
    return { text, source: "ocr" };
  }
  if (kind === "pdf") {
    return readPdf(file, onStatus);
  }
  throw new Error("Upload a photo (JPG, PNG, or WebP) or a PDF.");
}

async function readPdf(
  file: File,
  onStatus?: (message: string) => void,
): Promise<PrescriptionRead> {
  onStatus?.("Opening the PDF on this device");
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
  const textPages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => (isTextItem(item) ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (line) {
        textPages.push(line);
      }
    }

    const embedded = cleanup(textPages.join("\n\n"));
    if (embedded.replace(/\s/g, "").length >= MIN_PDF_TEXT) {
      if (document.numPages > MAX_PDF_PAGES) {
        return {
          text: `${embedded}\n\n[Only the first ${MAX_PDF_PAGES} pages were read.]`,
          source: "pdf-text",
        };
      }
      return { text: embedded, source: "pdf-text" };
    }

    onStatus?.("This PDF looks like a scan. Reading it on this device");
    const scanned: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onStatus?.(`Reading page ${pageNumber} of ${pageCount} on this device`);
      const page = await document.getPage(pageNumber);
      const image = await renderPage(page);
      const text = cleanup(await recognize(image, onStatus));
      if (text) {
        scanned.push(text);
      }
    }
    const combined = cleanup(scanned.join("\n\n"));
    if (!combined) {
      throw new Error("No text could be read from this PDF. Try a photo of the page, or type it.");
    }
    return { text: combined, source: "ocr" };
  } finally {
    await document.cleanup();
  }
}

async function renderPage(page: PDFPageProxy): Promise<Blob> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    throw new Error("This browser could not prepare the PDF page for reading.");
  }
  return blob;
}

async function recognize(image: Blob, onStatus?: (message: string) => void): Promise<string> {
  const reader = await getReader(onStatus);
  const result = await reader.recognize(image);
  return result.data.text ?? "";
}

function getReader(onStatus?: (message: string) => void): Promise<Reader> {
  if (!readerPromise) {
    onStatus?.("Preparing the on-device reader. This only happens once");
    readerPromise = loadTesseract().then((tesseract) =>
      tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
      workerBlobURL: false,
      logger: (message) => {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          onStatus?.(`Reading the prescription on this device (${Math.round(message.progress * 100)}%)`);
        }
      },
    }),
    ).catch((error: unknown) => {
      readerPromise = null;
      throw error;
    });
  }
  return readerPromise;
}

async function loadTesseract(): Promise<typeof Tesseract> {
  const loaded = await import("tesseract.js");
  return loaded.default;
}

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return pdfjs;
}

function fileKind(file: File): "image" | "pdf" | "other" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    file.type === "image/gif" ||
    /\.(jpe?g|png|webp|gif)$/.test(name)
  ) {
    return "image";
  }
  return "other";
}

function isTextItem(item: unknown): item is { str: string } {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}

function cleanup(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
