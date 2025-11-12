import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopLoader } from "@/components/TopLoader";
import Providers from "./providers";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/contexts/AuthContext";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const funnellsans = Funnel_Sans({
  variable: "--font-funnel-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://minidev.fun'),
  title: "Minidev | Vibecode Farcaster Miniapps",
  description: "Create custom mini apps with AI. Generate, preview, and deploy mini apps on Farcaster.",
  keywords: [
    "Minidev", "AI mini app creator", "artificial intelligence", "app development",
    "AI automation", "mini apps", "AI tools", "app generator",
    "Minidev platform", "AI-powered development", "automated app creation",
    "best app creator", "AI for development", "create apps with AI",
    "automated development", "AI development tools", "mini app generator"
  ],
  authors: [{ name: "Minidev Team" }],
  robots: "index, follow",
  alternates: {
    canonical: 'https://minidev.fun',
  },
  openGraph: {
    title: "Minidev | Vibecode Farcaster Miniapps",
    siteName: "Minidev",
    url: "https://minidev.fun",
    type: "website",
    locale: "en_US",
    description: "Create custom mini apps with AI. Generate, preview, and deploy mini apps on Farcaster.",
    images: [
      {
        url: "https://minidev.fun/og-image.png",
        width: 1200,
        height: 630,
        alt: "Minidev Platform Preview",
      },
    ],
  },
  twitter: {
    site: "@minidev_fun",
    creator: "@minidev_fun",
    card: "summary_large_image",
    title: "Minidev | Vibecode Farcaster Miniapps",
    description: "Create custom mini apps with AI. Generate, preview, and deploy mini apps on Farcaster.",
    images: [
      {
        url: "https://minidev.ai/og-image.png",
        alt: "Minidev Platform Preview",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${funnelDisplay.variable} ${funnellsans.variable} antialiased font-funnel-sans`}
        suppressHydrationWarning
      >
        {/* Mobile Warning */}
        <div className="md:hidden fixed inset-0 bg-gradient-to-br from-blue-50 to-indigo-100 z-50 flex items-center justify-center p-6 font-funnel-sans">
          <div className="bg-white rounded-2xl p-8 max-w-sm text-center shadow-xl border border-gray-200">
            <div className="mb-6">
              <div className="w-16 h-16 mx-auto bg-pink rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Desktop Experience</h2>
              <p className="text-gray-600 mb-4 leading-relaxed">
                Minidev is optimized for desktop use to provide the best development experience.
              </p>
              <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Mobile support coming soon!</span>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Content */}
        <div className="hidden md:block">
          <Providers>
            <TopLoader />
            <AuthProvider>
              <ProtectedRoute>
                <NuqsAdapter>{children}</NuqsAdapter>
              </ProtectedRoute>
            </AuthProvider>
          </Providers>
        </div>
      </body>
    </html>
  );
}
