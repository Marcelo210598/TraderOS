import { ImageResponse } from "next/og"

export const ogImageSize = { width: 1200, height: 630 }
export const ogImageContentType = "image/png"

// Gerada em código (sem asset de design) — mantém a mesma paleta do app
// (fundo escuro quase-preto + teal de marca).
export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#080C14",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#00C2A8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
              color: "#080C14",
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#FFFFFF" }}>
            Meu<span style={{ color: "#00C2A8" }}>Trade</span>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#9CA8B8", textAlign: "center", maxWidth: 900 }}>
          O app do trader brasileiro — journal, análise e evolução
        </div>
      </div>
    ),
    { ...ogImageSize }
  )
}
