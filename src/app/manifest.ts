import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeuTrade",
    short_name: "MeuTrade",
    description: "O app do trader: journal, análise e evolução — futuros, forex e mais",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#080C14",
    theme_color: "#00C2A8",
    orientation: "portrait-primary",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon-32.png",  sizes: "32x32",   type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Novo Trade",
        short_name: "Trade",
        description: "Registrar um novo trade",
        url: "/journal/novo",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Dashboard",
        short_name: "Dashboard",
        url: "/dashboard",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  }
}
