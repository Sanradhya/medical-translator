export type ModelVariant = "e2b" | "e4b";

export type InferenceBackend = "webgpu" | "wasm";

export type WorkerPhase =
  | "downloading"
  | "saving"
  | "initializing"
  | "ready"
  | "generating";

export interface InitCommand {
  type: "init";
  variant: ModelVariant;
  webgpuAvailable: boolean;
}

export interface GenerateCommand {
  type: "generate";
  requestId: string;
  text: string;
}

export interface CancelCommand {
  type: "cancel";
  requestId: string;
}

export interface ResetCommand {
  type: "reset";
}

export interface DisposeCommand {
  type: "dispose";
}

export interface CancelDownloadCommand {
  type: "cancel-download";
}

export type WorkerInbound =
  | InitCommand
  | GenerateCommand
  | CancelCommand
  | ResetCommand
  | DisposeCommand
  | CancelDownloadCommand;

export interface StatusEvent {
  type: "status";
  phase: WorkerPhase;
  message: string;
  bytesReceived?: number;
  bytesTotal?: number;
  backend?: InferenceBackend;
  variant?: ModelVariant;
  fromCache?: boolean;
}

export interface TokenEvent {
  type: "token";
  requestId: string;
  text: string;
}

export interface DoneEvent {
  type: "done";
  requestId: string;
  cancelled?: boolean;
}

export interface ResetCompleteEvent {
  type: "reset-complete";
}

export interface ErrorEvent {
  type: "error";
  message: string;
  requestId?: string;
}

export interface IdleEvent {
  type: "idle";
  message: string;
}

export type WorkerOutbound =
  | StatusEvent
  | TokenEvent
  | DoneEvent
  | ResetCompleteEvent
  | ErrorEvent
  | IdleEvent;
