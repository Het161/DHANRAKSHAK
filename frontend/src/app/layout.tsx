import type { Metadata, Viewport } from "next";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import { I18nProvider } from "@/i18n/I18nProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "DhanRakshak — check before you trust",
  description:
    "Check a suspicious SMS, link, screenshot or call recording for scams, explained in Gujarati, Hindi or English.",
  manifest: "/manifest.webmanifest",
  applicationName: "DhanRakshak",
  appleWebApp: { capable: true, title: "DhanRakshak", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#faf8f4",
  width: "device-width",
  initialScale: 1,
  // Elders pinch to zoom. Never take that away.
  maximumScale: 5,
};

// Runs before the first paint, reading localStorage synchronously, so a
// first-time visitor is sent to onboarding without ever flashing the analyzer.
// It only fires on the home route and never on a client navigation.
const FIRST_RUN_REDIRECT = `try{if(location.pathname==='/'&&localStorage.getItem('dr.onboarded')!=='1'){location.replace('/welcome')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: FIRST_RUN_REDIRECT }} />
      </head>
      <body className="min-h-dvh">
        <I18nProvider>
          <a
            href="#main"
            className="focus-ring sr-only rounded-xl bg-surface px-4 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
          >
            Skip to main content
          </a>
          <Header />
          <main id="main" className="mx-auto max-w-3xl px-4 py-6">
            {children}
          </main>
          <Footer />
          <ServiceWorker />
        </I18nProvider>
      </body>
    </html>
  );
}
