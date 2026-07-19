import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { PwaRegister } from "@/components/pwa-register"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { TrackingScripts } from "@/components/analytics/tracking-scripts"
import { Toaster } from "@/components/ui/toast"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const SITE_URL = "https://meutrade.app"
const SITE_DESCRIPTION =
  "O app do trader brasileiro. Journal, análise e evolução — pra futuros, forex e o que você operar."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MeuTrade",
    template: "%s | MeuTrade",
  },
  description: SITE_DESCRIPTION,
  keywords: ["trading", "trader", "journal", "forex", "futures", "MetaTrader 5", "NinjaTrader", "análise"],
  manifest: "/manifest.json",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: "MeuTrade",
    title: "MeuTrade — O app do trader brasileiro",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "MeuTrade — O app do trader brasileiro",
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MeuTrade",
  },
  icons: {
    icon: [
      { url: "/icon-32.png",  sizes: "32x32",   type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icon-192.png", sizes: "192x192" },
  },
}

export const viewport: Viewport = {
  themeColor: "#00C2A8",
  width: "device-width",
  initialScale: 1,
  // Zoom liberado de propósito: bloquear pinch-zoom viola WCAG 1.4.4 (acessibilidade).
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PwaRegister />
        {children}
        <Toaster />
        <TrackingScripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
