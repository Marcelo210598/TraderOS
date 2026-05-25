import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { PwaRegister } from "@/components/pwa-register"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "TraderOS",
    template: "%s | TraderOS",
  },
  description:
    "A plataforma definitiva para traders brasileiros de futuros americanos. Journal, análise, gamificação e cálculo de regras Apex.",
  keywords: ["trading", "futures", "NQ", "ES", "Apex Trader Funding", "prop firm", "journal"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TraderOS",
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
  maximumScale: 1,
  userScalable: false,
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
      </body>
    </html>
  )
}
