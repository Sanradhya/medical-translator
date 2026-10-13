import { SiteChrome } from "@/components/SiteChrome";
import type { Metadata, Viewport } from "next";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Medical Jargon Translator",
  description:
    "Translate medical jargon into plain language on this device. Your text never leaves the browser.",
  applicationName: "Medical Jargon Translator",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Medical Jargon Translator",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#115e59",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} font-sans text-slate-900 antialiased`}>
        <SiteChrome>
          {children}
          <noscript>
            <p className="mx-auto max-w-3xl px-4 py-6 text-sm text-slate-700">
              JavaScript is required to run the on-device model. Medical text is never sent to a
              server.
            </p>
          </noscript>
        </SiteChrome>
      </body>
    </html>
  );
}
