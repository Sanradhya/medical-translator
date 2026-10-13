"use client";

import { readStoredVariant, useLlmWorker } from "@/hooks/useLlmWorker";
import { freeStorageBytes, modelFits } from "@/lib/hardware";
import { MODELS, formatBytes } from "@/lib/models";
import type { ModelVariant } from "@/types/worker";
import {
  AlertTriangle,
  Cpu,
  Download,
  LoaderCircle,
  Plus,
  SendHorizontal,
  Square,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

const EXAMPLES = [
  "Patient has a history of myocardial infarction and takes atorvastatin 40 mg PO QHS.",
  "HbA1c 7.2%. Continue metformin 500 mg BID with meals.",
  "CT shows a 4 mm pulmonary nodule. Correlate clinically.",
];

export function TranslatorApp() {
  const translator = useLlmWorker();
  const [selected, setSelected] = useState<ModelVariant>("e2b");
  const [picked, setPicked] = useState(false);
  const [acceptLargeModel, setAcceptLargeModel] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const stored = readStoredVariant();
    if (stored) {
      setSelected(stored);
      setPicked(true);
      return;
    }
    if (translator.hardware && !picked) {
      setSelected(translator.hardware.recommend);
    }
  }, [translator.hardware, picked]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [translator.messages, translator.phase]);

  const busy =
    translator.phase === "downloading" ||
    translator.phase === "saving" ||
    translator.phase === "initializing" ||
    translator.phase === "generating";
  const chatting = translator.modelReady;
  const lowMemory = translator.hardware?.lowMemory ?? false;
  const needsLargeModelAck = lowMemory && selected === "e4b" && !acceptLargeModel;
  const selectedSpec = MODELS[selected];
  const freeBytes = freeStorageBytes(translator.hardware);
  const selectedFits = modelFits(translator.hardware, selected);
  const progress = useMemo(() => {
    if (!translator.bytesTotal || translator.bytesReceived === null) {
      return null;
    }
    return Math.max(0, Math.min(100, (translator.bytesReceived / translator.bytesTotal) * 100));
  }, [translator.bytesReceived, translator.bytesTotal]);

  function choose(variant: ModelVariant) {
    setSelected(variant);
    setPicked(true);
    if (variant !== "e4b") {
      setAcceptLargeModel(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4">
      {translator.error ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{translator.error}</p>
        </div>
      ) : null}

      {chatting ? (
        <ChatPanel
          draft={draft}
          setDraft={setDraft}
          inputRef={inputRef}
          bottomRef={bottomRef}
          busy={translator.phase === "generating"}
          statusMessage={translator.statusMessage}
          backend={translator.backend}
          messages={translator.messages}
          onTranslate={() => {
            translator.translate(draft);
            setDraft("");
          }}
          onCancel={translator.cancel}
          onReset={translator.reset}
          onExample={(example) => {
            setDraft(example);
            inputRef.current?.focus();
          }}
        />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-card">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <h1 className="font-serif text-3xl leading-tight text-teal-950">
              Translate a chart into everyday words
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              The model downloads once into this browser&apos;s private storage, then reads
              your text on this device. Nothing is sent to a translation server.
            </p>

            <HardwareNote
              ready={translator.hardware !== null}
              memoryGb={translator.hardware?.deviceMemoryGb ?? null}
              webgpu={translator.hardware?.webgpuAvailable ?? false}
              freeBytes={freeBytes}
              lowMemory={lowMemory}
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(Object.keys(MODELS) as ModelVariant[]).map((id) => {
                const spec = MODELS[id];
                const fits = modelFits(translator.hardware, id);
                const active = selected === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={busy || !fits}
                    onClick={() => choose(id)}
                    className={`rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-teal-800 bg-teal-50 ring-2 ring-teal-800"
                        : "border-slate-200 bg-white hover:border-teal-700"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-teal-950">{spec.name}</span>
                      <span className="rounded-full bg-teal-800 px-2 py-0.5 text-xs font-bold text-white">
                        {spec.label}
                      </span>
                    </span>
                    <span className="mt-2 block text-sm leading-5 text-slate-600">
                      {spec.description}
                    </span>
                    <span className="mt-3 block text-sm font-medium text-slate-800">
                      {spec.sizeLabel} download
                      {fits ? "" : ". Needs more free browser storage"}
                    </span>
                  </button>
                );
              })}
            </div>

            {lowMemory && selected === "e4b" ? (
              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-teal-800"
                  checked={acceptLargeModel}
                  onChange={(event) => setAcceptLargeModel(event.target.checked)}
                />
                <span>
                  This device reports under 8 GB of memory. The 2B model is the safer
                  choice. Load the 4B model anyway.
                </span>
              </label>
            ) : null}

          </div>
          <div className="shrink-0 border-t border-slate-100 px-4 py-4 sm:px-6">
            {busy ? (
              <ProgressPanel
                message={translator.statusMessage}
                progress={progress}
                received={translator.bytesReceived}
                total={translator.bytesTotal}
                onCancel={translator.cancelDownload}
              />
            ) : (
              <button
                type="button"
                disabled={!translator.hardware || needsLargeModelAck || !selectedFits}
                onClick={() => translator.start(selected)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-800 px-4 py-3 text-base font-semibold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                {translator.hardware
                  ? `Download ${selectedSpec.name} and start`
                  : "Checking this device"}
              </button>
            )}
            {translator.phase === "idle" && translator.statusMessage.includes("cancelled") ? (
              <p className="mt-3 text-sm text-slate-600">{translator.statusMessage}</p>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

function HardwareNote({
  ready,
  memoryGb,
  webgpu,
  freeBytes,
  lowMemory,
}: {
  ready: boolean;
  memoryGb: number | null;
  webgpu: boolean;
  freeBytes: number | null;
  lowMemory: boolean;
}) {
  if (!ready) {
    return (
      <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
        Checking this device for memory, storage, and WebGPU.
      </div>
    );
  }

  return (
    <div
      className={`mt-4 rounded-2xl px-3 py-3 text-sm leading-6 ${
        lowMemory ? "bg-amber-50 text-amber-950" : "bg-slate-50 text-slate-700"
      }`}
    >
      <p>
        {memoryGb === null
          ? "This browser does not report device memory, so the smaller 2B model is recommended."
          : lowMemory
            ? `This browser reports about ${memoryGb} GB of memory. The 4B model often fails under 8 GB, so the 2B model is recommended.`
            : `This browser reports at least ${memoryGb} GB of memory. The 4B model is recommended.`}
      </p>
      <p className="mt-1">
        {webgpu
          ? "WebGPU is available and will be used first."
          : "WebGPU is unavailable. The translator will use the CPU (WASM) fallback."}
        {freeBytes !== null ? ` About ${formatBytes(freeBytes)} of browser storage is free.` : ""}
      </p>
    </div>
  );
}

function ProgressPanel({
  message,
  progress,
  received,
  total,
  onCancel,
}: {
  message: string;
  progress: number | null;
  received: number | null;
  total: number | null;
  onCancel: () => void;
}) {
  const value = progress === null ? undefined : Math.round(progress);
  return (
    <div className="rounded-2xl bg-teal-50 px-4 py-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold text-teal-950">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        {message}
      </p>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-teal-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={message}
      >
        <div
          className={`h-full rounded-full bg-teal-700 ${progress === null ? "w-1/3 animate-pulse" : ""}`}
          style={progress === null ? undefined : { width: `${progress}%` }}
        />
      </div>
      {received !== null && total ? (
        <p className="mt-2 text-xs font-medium text-teal-900">
          {formatBytes(received)} of {formatBytes(total)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
      >
        <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
        Cancel download
      </button>
    </div>
  );
}

function ChatPanel({
  draft,
  setDraft,
  inputRef,
  bottomRef,
  busy,
  statusMessage,
  backend,
  messages,
  onTranslate,
  onCancel,
  onReset,
  onExample,
}: {
  draft: string;
  setDraft: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  statusMessage: string;
  backend: "webgpu" | "wasm" | null;
  messages: { id: string; role: "user" | "assistant"; content: string; pending: boolean }[];
  onTranslate: () => void;
  onCancel: () => void;
  onReset: () => void;
  onExample: (example: string) => void;
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-teal-900">
          {backend === "wasm" ? (
            <Cpu aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Zap aria-hidden="true" className="h-4 w-4" />
          )}
          {busy ? statusMessage : backend === "wasm" ? "Running on CPU (WASM)" : "Running on WebGPU"}
          {" · saved on this device"}
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          New translation
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-teal-200 bg-white/70 px-4 py-6">
            <p className="font-medium text-teal-950">Try a line from a note</p>
            <div className="mt-3 flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onExample(example)}
                  className="rounded-2xl bg-white px-3 py-3 text-left text-sm leading-6 text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:ring-teal-700"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              aria-live={message.pending ? "polite" : undefined}
              className={`max-w-[95%] rounded-3xl px-4 py-3 text-sm leading-6 sm:text-base ${
                message.role === "user"
                  ? "ml-auto bg-teal-800 text-white"
                  : "bg-white text-slate-800 shadow-card"
              }`}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                {message.role === "user" ? "Chart text" : "Plain language"}
              </p>
              <p className="whitespace-pre-wrap">
                {message.content}
                {message.pending ? (
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-teal-700 align-middle" />
                ) : null}
              </p>
              {message.pending && message.content.length === 0 ? (
                <p className="text-slate-500">Generating...</p>
              ) : null}
            </article>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="mt-3 rounded-3xl border border-slate-200 bg-white p-2 shadow-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) {
            onTranslate();
          }
        }}
      >
        <label htmlFor="medical-text" className="sr-only">
          Medical text to translate
        </label>
        <textarea
          id="medical-text"
          ref={inputRef}
          value={draft}
          rows={3}
          maxLength={6000}
          disabled={busy}
          placeholder="Paste a sentence from a note, result, or prescription"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy) {
                onTranslate();
              }
            }
          }}
          className="w-full resize-none bg-transparent px-3 py-2 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <p className="text-xs text-slate-500">{draft.length}/6000</p>
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <SendHorizontal aria-hidden="true" className="h-4 w-4" />
              Translate
            </button>
          )}
        </div>
      </form>
    </>
  );
}
