import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Sportem",
  description: "Interni operativni sistem za Sportem",
  // PWA (Korak 0.7): manifest + iOS standalone. app/manifest.ts → /manifest.webmanifest.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sportem",
    statusBarStyle: "default",
  },
};

// Next 16: themeColor ide u viewport export (ne u metadata). Brend zelena.
export const viewport: Viewport = {
  themeColor: "#1B7A45",
  // PWA/iOS standalone: rasteže sadržaj ispod safe-area (home-indikator), da bottom nav
  // može da doda env(safe-area-inset-bottom) razmak i ne bude „isečen".
  viewportFit: "cover",
  // App-like: bez pinch-zoom-a i bez iOS auto-zoom-a na fokus inputa.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="bg-paper text-ink flex min-h-full flex-col font-sans">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
