import { MODELS } from "@/lib/models";
import type { ModelVariant } from "@/types/worker";

export interface HardwareReport {
  deviceMemoryGb: number | null;
  webgpuAvailable: boolean;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
  lowMemory: boolean;
  recommend: ModelVariant;
}

interface GpuAdapterProbe {
  requestAdapter: () => Promise<unknown>;
}

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
  gpu?: GpuAdapterProbe;
};

export async function probeHardware(): Promise<HardwareReport> {
  const nav = navigator as NavigatorWithMemory;
  const deviceMemoryGb =
    typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;

  let webgpuAvailable = false;
  if (nav.gpu) {
    try {
      const adapter = await withTimeout(nav.gpu.requestAdapter(), 2500);
      webgpuAvailable = adapter !== null;
    } catch {
      webgpuAvailable = false;
    }
  }

  let storageQuotaBytes: number | null = null;
  let storageUsageBytes: number | null = null;
  try {
    const estimate = await withTimeout(Promise.resolve(nav.storage?.estimate?.() ?? null), 2500);
    storageQuotaBytes = estimate?.quota ?? null;
    storageUsageBytes = estimate?.usage ?? null;
  } catch {
    storageQuotaBytes = null;
    storageUsageBytes = null;
  }

  const lowMemory = deviceMemoryGb !== null && deviceMemoryGb < 8;
  const recommend: ModelVariant = lowMemory || deviceMemoryGb === null ? "e2b" : "e4b";

  return {
    deviceMemoryGb,
    webgpuAvailable,
    storageQuotaBytes,
    storageUsageBytes,
    lowMemory,
    recommend,
  };
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("hardware probe failed"));
      },
    );
  });
}

export function freeStorageBytes(report: HardwareReport | null): number | null {
  if (!report || report.storageQuotaBytes === null || report.storageUsageBytes === null) {
    return null;
  }
  return Math.max(0, report.storageQuotaBytes - report.storageUsageBytes);
}

export function modelFits(report: HardwareReport | null, variant: ModelVariant): boolean {
  const free = freeStorageBytes(report);
  if (free === null) {
    return true;
  }
  return free > MODELS[variant].approxBytes + 256 * 1024 * 1024;
}
