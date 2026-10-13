"use client";

import { probeHardware, type HardwareReport } from "@/lib/hardware";
import type {
  InferenceBackend,
  ModelVariant,
  WorkerOutbound,
  WorkerPhase,
} from "@/types/worker";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending: boolean;
}

export type AppPhase = "idle" | WorkerPhase | "error";

const MODEL_STORAGE_KEY = "medical-translator.model";

export interface TranslatorState {
  hardware: HardwareReport | null;
  phase: AppPhase;
  statusMessage: string;
  bytesReceived: number | null;
  bytesTotal: number | null;
  backend: InferenceBackend | null;
  variant: ModelVariant | null;
  fromCache: boolean;
  error: string | null;
  messages: ChatMessage[];
  modelReady: boolean;
  start: (variant: ModelVariant) => void;
  translate: (text: string) => void;
  cancel: () => void;
  cancelDownload: () => void;
  reset: () => void;
}

export function useLlmWorker(): TranslatorState {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const modelReadyRef = useRef(false);
  const [hardware, setHardware] = useState<HardwareReport | null>(null);
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("Checking this device");
  const [bytesReceived, setBytesReceived] = useState<number | null>(null);
  const [bytesTotal, setBytesTotal] = useState<number | null>(null);
  const [backend, setBackend] = useState<InferenceBackend | null>(null);
  const [variant, setVariant] = useState<ModelVariant | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelReady, setModelReady] = useState(false);

  const onWorkerMessage = useCallback((event: MessageEvent<WorkerOutbound>) => {
    const message = event.data;
    switch (message.type) {
      case "status":
        setPhase(message.phase);
        setStatusMessage(message.message);
        setBytesReceived(message.bytesReceived ?? null);
        setBytesTotal(message.bytesTotal ?? null);
        if (message.backend) {
          setBackend(message.backend);
        }
        if (message.variant) {
          setVariant(message.variant);
        }
        if (typeof message.fromCache === "boolean") {
          setFromCache(message.fromCache);
        }
        if (message.phase === "ready") {
          modelReadyRef.current = true;
          setModelReady(true);
          setError(null);
        }
        break;
      case "token":
        setMessages((current) =>
          current.map((entry) =>
            entry.id === message.requestId
              ? { ...entry, content: entry.content + message.text }
              : entry,
          ),
        );
        break;
      case "done":
        setMessages((current) =>
          current.map((entry) => {
            if (entry.id !== message.requestId) {
              return entry;
            }
            const content =
              entry.content.trim().length > 0
                ? entry.content
                : message.cancelled
                  ? "Stopped."
                  : "The model finished without any plain-language text. Try a shorter passage.";
            return { ...entry, content, pending: false };
          }),
        );
        if (activeRequestRef.current === message.requestId) {
          activeRequestRef.current = null;
        }
        break;
      case "reset-complete":
        setMessages([]);
        setPhase("ready");
        setStatusMessage("Ready");
        setError(null);
        break;
      case "idle":
        modelReadyRef.current = false;
        setModelReady(false);
        setPhase("idle");
        setStatusMessage(message.message);
        setError(null);
        setBytesReceived(null);
        setBytesTotal(null);
        break;
      case "error":
        setError(message.message);
        if (message.requestId) {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === message.requestId ? { ...entry, pending: false } : entry,
            ),
          );
          if (activeRequestRef.current === message.requestId) {
            activeRequestRef.current = null;
          }
        }
        setPhase(modelReadyRef.current ? "ready" : "error");
        if (modelReadyRef.current) {
          setStatusMessage("Ready");
        }
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const worker = new Worker(new URL("../workers/llm-worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => {
      if (cancelled) {
        return;
      }
      setError("The on-device translator worker failed to start.");
      setPhase("error");
    };

    probeHardware()
      .then((report) => {
        if (!cancelled) {
          setHardware(report);
          setStatusMessage("Choose a model to download once onto this device");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("This browser could not be checked for WebGPU or memory.");
          setStatusMessage("Choose a model to download once onto this device");
        }
      });

    return () => {
      cancelled = true;
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [onWorkerMessage]);

  const start = useCallback(
    (nextVariant: ModelVariant) => {
      const worker = workerRef.current;
      if (!worker) {
        setError("The translator worker is not running.");
        setPhase("error");
        return;
      }
      try {
        window.localStorage.setItem(MODEL_STORAGE_KEY, nextVariant);
      } catch {
        // Private browsing can block storage. The model choice still applies.
      }
      modelReadyRef.current = false;
      setModelReady(false);
      setError(null);
      setVariant(nextVariant);
      setBackend(null);
      setFromCache(false);
      setBytesReceived(0);
      setBytesTotal(null);
      setPhase("downloading");
      setStatusMessage("Preparing the on-device model");
      setMessages([]);
      worker.postMessage({
        type: "init",
        variant: nextVariant,
        webgpuAvailable: hardware?.webgpuAvailable ?? false,
      });
    },
    [hardware?.webgpuAvailable],
  );

  const translate = useCallback((text: string) => {
    const worker = workerRef.current;
    const source = text.trim();
    if (!worker || !modelReadyRef.current || !source || activeRequestRef.current) {
      return;
    }
    const requestId = `turn-${++requestRef.current}`;
    activeRequestRef.current = requestId;
    setError(null);
    setPhase("generating");
    setStatusMessage("Generating...");
    setMessages((current) => [
      ...current,
      { id: `${requestId}-user`, role: "user", content: source, pending: false },
      { id: requestId, role: "assistant", content: "", pending: true },
    ]);
    worker.postMessage({ type: "generate", requestId, text: source });
  }, []);

  const cancel = useCallback(() => {
    const requestId = activeRequestRef.current;
    if (!requestId || !workerRef.current) {
      return;
    }
    workerRef.current.postMessage({ type: "cancel", requestId });
  }, []);

  const cancelDownload = useCallback(() => {
    workerRef.current?.postMessage({ type: "cancel-download" });
  }, []);

  const reset = useCallback(() => {
    if (!workerRef.current || !modelReadyRef.current) {
      return;
    }
    setMessages([]);
    setError(null);
    workerRef.current.postMessage({ type: "reset" });
  }, []);

  return {
    hardware,
    phase,
    statusMessage,
    bytesReceived,
    bytesTotal,
    backend,
    variant,
    fromCache,
    error,
    messages,
    modelReady,
    start,
    translate,
    cancel,
    cancelDownload,
    reset,
  };
}

export function readStoredVariant(): ModelVariant | null {
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    return stored === "e2b" || stored === "e4b" ? stored : null;
  } catch {
    return null;
  }
}
