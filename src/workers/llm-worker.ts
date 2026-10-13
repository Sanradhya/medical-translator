import { MODELS, SYSTEM_PROMPT, WASM_RUNTIME_URL } from "@/lib/models";
import type { ModelSpec } from "@/lib/models";
import type {
  InferenceBackend,
  ModelVariant,
  WorkerInbound,
  WorkerOutbound,
} from "@/types/worker";
import {
  Backend,
  Engine,
  SamplerType,
  loadLiteRtLm,
  type Conversation,
  type EngineSettings,
} from "@litert-lm/core";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerInbound>) => void) | null;
  postMessage: (message: WorkerOutbound) => void;
  navigator: Navigator;
}

const scope = self as unknown as WorkerScope;

interface CacheMeta {
  bytes: number;
  url: string;
  fileName: string;
}

interface FileHandleWithMove extends FileSystemFileHandle {
  move?: (name: string) => Promise<void>;
}

let engine: Engine | null = null;
let conversation: Conversation | null = null;
let runtimeLoaded = false;
let activeBackend: InferenceBackend | null = null;
let activeVariant: ModelVariant | null = null;
let downloadAbort: AbortController | null = null;
let activeRequestId: string | null = null;
let cancelRequested = false;
let initGeneration = 0;

scope.onmessage = (event) => {
  void handleMessage(event.data);
};

async function handleMessage(message: WorkerInbound): Promise<void> {
  try {
    switch (message.type) {
      case "init":
        await initialize(message.variant, message.webgpuAvailable);
        break;
      case "generate":
        await generate(message.requestId, message.text);
        break;
      case "cancel":
        cancelGeneration(message.requestId);
        break;
      case "reset":
        await resetConversation();
        break;
      case "dispose":
        await dispose();
        break;
      case "cancel-download":
        initGeneration += 1;
        downloadAbort?.abort();
        post({ type: "idle", message: "Setup cancelled. You can choose a model again." });
        break;
      default:
        break;
    }
  } catch (error) {
    post({
      type: "error",
      message: errorText(error),
      requestId: activeRequestId ?? undefined,
    });
  }
}

async function initialize(variant: ModelVariant, webgpuAvailable: boolean): Promise<void> {
  const generation = ++initGeneration;
  try {
    await loadSelectedModel(generation, variant, webgpuAvailable);
  } catch (error) {
    if (generation !== initGeneration) {
      return;
    }
    if (isAbort(error)) {
      post({ type: "idle", message: "Setup cancelled. You can choose a model again." });
      return;
    }
    throw error;
  }
}

async function loadSelectedModel(
  generation: number,
  variant: ModelVariant,
  webgpuAvailable: boolean,
): Promise<void> {
  downloadAbort?.abort();
  cancelGeneration(activeRequestId);
  await releaseEngine();

  const spec = MODELS[variant];
  const cached = await ensureCachedModel(spec, generation);
  if (generation !== initGeneration) {
    return;
  }

  if (!runtimeLoaded) {
    await loadLiteRtLm(WASM_RUNTIME_URL);
    runtimeLoaded = true;
  }
  if (generation !== initGeneration) {
    return;
  }

  const started = await startEngine(
    cached.file,
    variant,
    webgpuAvailable,
    cached.fromCache,
  );
  if (generation !== initGeneration) {
    await releaseEngine();
    return;
  }

  activeBackend = started.backend;
  activeVariant = variant;
  conversation = await engine!.createConversation({
    preface: {
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      extra_context: { enable_thinking: false },
    },
    sessionConfig: {
      maxOutputTokens: 768,
      samplerParams: {
        type: SamplerType.TOP_P,
        temperature: 0.2,
        p: 0.9,
        k: 40,
      },
    },
    prefillPrefaceOnInit: true,
    filterChannelContentFromKvCache: true,
  });

  post({
    type: "status",
    phase: "ready",
    message: "Ready",
    backend: started.backend,
    variant,
    fromCache: started.fromCache,
  });
}

async function startEngine(
  file: Blob,
  variant: ModelVariant,
  webgpuAvailable: boolean,
  fromCache: boolean,
): Promise<{ backend: InferenceBackend; fromCache: boolean }> {
  if (webgpuAvailable) {
    post({
      type: "status",
      phase: "initializing",
      message: "Initializing WebGPU",
      variant,
      backend: "webgpu",
      fromCache,
    });
    try {
      engine = await Engine.create(engineSettings(file, Backend.GPU_ARTISAN));
      return { backend: "webgpu", fromCache };
    } catch (error) {
      await releaseEngine();
      post({
        type: "status",
        phase: "initializing",
        message: "WebGPU failed. Initializing CPU (WASM)",
        variant,
        backend: "wasm",
        fromCache,
      });
      try {
        engine = await Engine.create(engineSettings(file, Backend.CPU));
        return { backend: "wasm", fromCache };
      } catch (cpuError) {
        throw new Error(
          `Could not start the on-device model. WebGPU: ${errorText(error)} CPU: ${errorText(cpuError)}`,
        );
      }
    }
  }

  post({
    type: "status",
    phase: "initializing",
    message: "Initializing CPU (WASM)",
    variant,
    backend: "wasm",
    fromCache,
  });
  try {
    engine = await Engine.create(engineSettings(file, Backend.CPU));
    return { backend: "wasm", fromCache };
  } catch (error) {
    throw new Error(
      `WebGPU is unavailable and the CPU fallback could not start this model. ${errorText(error)}`,
    );
  }
}

function engineSettings(file: Blob, backend: number): EngineSettings {
  return {
    model: file,
    backend,
    mainExecutorSettings: {
      maxNumTokens: backend === Backend.CPU ? 2048 : 4096,
    },
  };
}

async function ensureCachedModel(
  spec: ModelSpec,
  generation: number,
): Promise<{ file: Blob; fromCache: boolean }> {
  const root = await openModelDirectory();
  const cached = await readCachedModel(root, spec);
  if (cached) {
    post({
      type: "status",
      phase: "initializing",
      message: "Model already saved on this device",
      variant: spec.id,
      fromCache: true,
      bytesReceived: cached.size,
      bytesTotal: cached.size,
    });
    return { file: cached, fromCache: true };
  }

  downloadAbort = new AbortController();
  const signal = downloadAbort.signal;
  const response = await fetchFirstOk(spec.urls, signal);
  const bytesTotal = Number(response.headers.get("content-length")) || spec.approxBytes;
  const partialName = `${spec.fileName}.partial`;

  await removeIfPresent(root, partialName);
  const partialHandle = (await root.getFileHandle(partialName, {
    create: true,
  })) as FileHandleWithMove;
  const writable = await partialHandle.createWritable();
  const reader = response.body?.getReader();
  if (!reader) {
    await writable.abort();
    throw new Error("The model download did not include a readable body.");
  }

  let bytesReceived = 0;
  let lastPosted = 0;
  try {
    while (true) {
      if (generation !== initGeneration || signal.aborted) {
        throw new DOMException("The download was cancelled.", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      await writable.write(value);
      bytesReceived += value.byteLength;
      const now = Date.now();
      if (now - lastPosted > 200 || bytesReceived >= bytesTotal) {
        lastPosted = now;
        post({
          type: "status",
          phase: "downloading",
          message: `Downloading Model (${spec.sizeLabel}) - This only happens once`,
          bytesReceived,
          bytesTotal,
          variant: spec.id,
          fromCache: false,
        });
      }
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // The stream may already be closed.
    }
    await removeIfPresent(root, partialName);
    throw error;
  }

  post({
    type: "status",
    phase: "saving",
    message: "Saving model on this device",
    bytesReceived,
    bytesTotal,
    variant: spec.id,
    fromCache: false,
  });

  if (partialHandle.move) {
    await removeIfPresent(root, spec.fileName);
    await partialHandle.move(spec.fileName);
  } else {
    const partialFile = await partialHandle.getFile();
    const finalHandle = await root.getFileHandle(spec.fileName, { create: true });
    const finalWritable = await finalHandle.createWritable();
    await partialFile.stream().pipeTo(finalWritable);
    await removeIfPresent(root, partialName);
  }

  const saved = await (await root.getFileHandle(spec.fileName)).getFile();
  await writeMeta(root, spec, saved.size, response.url || spec.urls[0]);
  return { file: saved, fromCache: false };
}

async function openModelDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!scope.navigator.storage?.getDirectory) {
    throw new Error(
      "This browser cannot store the model locally. Origin Private File System is unavailable.",
    );
  }
  try {
    return await scope.navigator.storage.getDirectory();
  } catch (error) {
    throw new Error(`Could not open private storage on this device. ${errorText(error)}`);
  }
}

async function readCachedModel(
  root: FileSystemDirectoryHandle,
  spec: ModelSpec,
): Promise<File | null> {
  try {
    const metaHandle = await root.getFileHandle(`${spec.fileName}.meta.json`);
    const meta = JSON.parse(await (await metaHandle.getFile()).text()) as CacheMeta;
    const file = await (await root.getFileHandle(spec.fileName)).getFile();
    if (meta.fileName === spec.fileName && meta.bytes > 0 && file.size === meta.bytes) {
      return file;
    }
  } catch {
    return null;
  }
  return null;
}

async function writeMeta(
  root: FileSystemDirectoryHandle,
  spec: ModelSpec,
  bytes: number,
  url: string,
): Promise<void> {
  const handle = await root.getFileHandle(`${spec.fileName}.meta.json`, { create: true });
  const writable = await handle.createWritable();
  const meta: CacheMeta = { bytes, url, fileName: spec.fileName };
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

async function fetchFirstOk(urls: readonly string[], signal: AbortSignal): Promise<Response> {
  let lastStatus = "no response";
  for (const url of urls) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (response.ok && response.body) {
      return response;
    }
    lastStatus = `${response.status} ${response.statusText}`.trim();
    await response.body?.cancel();
  }
  throw new Error(`Could not download the model (${lastStatus}).`);
}

async function removeIfPresent(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    await root.removeEntry(name);
  } catch {
    // The file is not there.
  }
}

async function generate(requestId: string, text: string): Promise<void> {
  if (!conversation || !engine) {
    throw new Error("Load a model before translating.");
  }
  const source = text.trim();
  if (!source) {
    throw new Error("Enter medical text to translate.");
  }

  cancelRequested = false;
  activeRequestId = requestId;
  post({
    type: "status",
    phase: "generating",
    message: "Generating...",
    backend: activeBackend ?? undefined,
    variant: activeVariant ?? undefined,
  });

  const stream = conversation.sendMessageStreaming(
    `Translate the medical text below into plain language.\n\n${source}`,
  );
  const reader = stream.getReader();
  const words = new WordBuffer((word) => {
    if (activeRequestId === requestId && !cancelRequested) {
      post({ type: "token", requestId, text: word });
    }
  });
  let accumulated = "";

  try {
    while (!cancelRequested && activeRequestId === requestId) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const delta = deltaFromChunk(accumulated, readChunkText(value));
      accumulated += delta;
      words.push(delta);
    }
    if (!cancelRequested && activeRequestId === requestId) {
      words.flush();
      post({ type: "done", requestId });
      post({
        type: "status",
        phase: "ready",
        message: "Ready",
        backend: activeBackend ?? undefined,
        variant: activeVariant ?? undefined,
      });
    }
  } catch (error) {
    if (!cancelRequested) {
      throw error;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // cancel() may already have released the reader.
    }
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
  }
}

function cancelGeneration(requestId: string | null): void {
  if (requestId && activeRequestId && requestId !== activeRequestId) {
    return;
  }
  cancelRequested = true;
  try {
    conversation?.cancel();
  } catch {
    // The conversation may already be idle.
  }
  if (requestId && activeRequestId === requestId) {
    post({ type: "done", requestId, cancelled: true });
    post({
      type: "status",
      phase: "ready",
      message: "Ready",
      backend: activeBackend ?? undefined,
      variant: activeVariant ?? undefined,
    });
    activeRequestId = null;
  }
}

async function resetConversation(): Promise<void> {
  if (!engine) {
    throw new Error("Load a model before starting a new translation.");
  }
  cancelGeneration(activeRequestId);
  if (conversation) {
    await conversation.delete();
    conversation = null;
  }
  conversation = await engine.createConversation({
    preface: {
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      extra_context: { enable_thinking: false },
    },
    sessionConfig: {
      maxOutputTokens: 768,
      samplerParams: {
        type: SamplerType.TOP_P,
        temperature: 0.2,
        p: 0.9,
        k: 40,
      },
    },
    prefillPrefaceOnInit: true,
    filterChannelContentFromKvCache: true,
  });
  post({ type: "reset-complete" });
}

async function dispose(): Promise<void> {
  initGeneration += 1;
  downloadAbort?.abort();
  cancelGeneration(activeRequestId);
  await releaseEngine();
}

async function releaseEngine(): Promise<void> {
  const currentConversation = conversation;
  const currentEngine = engine;
  conversation = null;
  engine = null;
  activeBackend = null;
  try {
    currentConversation?.cancel();
  } catch {
    // Already stopped.
  }
  try {
    await currentConversation?.delete();
  } catch {
    // The engine may already own this cleanup.
  }
  try {
    await currentEngine?.delete();
  } catch {
    // Ignore shutdown errors.
  }
}

class WordBuffer {
  private pending = "";

  constructor(private readonly emit: (word: string) => void) {}

  push(delta: string): void {
    if (!delta) {
      return;
    }
    this.pending += delta;
    const lastSpace = Math.max(
      this.pending.lastIndexOf(" "),
      this.pending.lastIndexOf("\n"),
      this.pending.lastIndexOf("\t"),
    );
    if (lastSpace >= 0) {
      const ready = this.pending.slice(0, lastSpace + 1);
      this.pending = this.pending.slice(lastSpace + 1);
      if (ready) {
        this.emit(ready);
      }
    }
  }

  flush(): void {
    if (this.pending) {
      this.emit(this.pending);
      this.pending = "";
    }
  }
}

function deltaFromChunk(accumulated: string, chunkText: string): string {
  if (!chunkText) {
    return "";
  }
  if (chunkText.startsWith(accumulated)) {
    return chunkText.slice(accumulated.length);
  }
  return chunkText;
}

function readChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }
  const content = (chunk as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      text += candidate.text;
    }
  }
  return text;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function post(message: WorkerOutbound): void {
  scope.postMessage(message);
}

function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The model download was cancelled.";
  }
  if (error instanceof Error && error.name === "QuotaExceededError") {
    return "This device does not have enough free storage for the model.";
  }
  if (error instanceof Error) {
    return error.message || "Something went wrong while running the on-device model.";
  }
  return "Something went wrong while running the on-device model.";
}
