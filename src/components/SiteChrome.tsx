"use client";

import { AlertTriangle, ShieldCheck, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-transparent">
      <header className="z-30 border-b border-teal-950/10 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-800 text-white shadow-card">
              <Stethoscope aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <p className="font-serif text-xl leading-tight text-teal-950">
                Medical Jargon Translator
              </p>
              <p className="text-sm text-slate-600">Plain language, kept on this device</p>
            </div>
          </div>
          <div className="inline-flex max-w-full items-start gap-2 rounded-2xl bg-teal-800 px-3 py-2 text-sm font-semibold leading-snug text-white shadow-card">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>100% Local Processing - Your data never leaves this device.</span>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      <footer className="z-30 border-t border-amber-300 bg-amber-50 pb-[env(safe-area-inset-bottom)]">
        <p className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 py-3 text-sm font-semibold leading-snug text-amber-950">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This is an AI translation tool, not a doctor. Not medical advice.</span>
        </p>
      </footer>
    </div>
  );
}
