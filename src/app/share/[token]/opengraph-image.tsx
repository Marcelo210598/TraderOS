import { ImageResponse } from "next/og"
import { prisma } from "@/lib/prisma"
import { ogImageSize, ogImageContentType } from "@/lib/og-image"
import { signedUsd } from "@/lib/utils"

export const alt = "Trade compartilhado no MeuTrade"
export const size = ogImageSize
export const contentType = ogImageContentType

const PROFIT = "#10B981"
const LOSS = "#F43F5E"
const NEUTRAL = "#9CA8B8"

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const trade = await prisma.trade.findUnique({
    where: { shareToken: token },
    select: {
      instrument: true, direction: true, pnl: true, pnlPoints: true,
      entryPrice: true, exitPrice: true, result: true,
    },
  })

  // Trade não encontrado/revogado — card genérico de marca em vez de quebrar o preview.
  if (!trade) {
    return new ImageResponse(
      (
        <div style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#080C14", fontFamily: "sans-serif",
        }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#FFFFFF" }}>
            Meu<span style={{ color: "#00C2A8" }}>Trade</span>
          </div>
        </div>
      ),
      { ...ogImageSize }
    )
  }

  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnlPoints)
  const entry = Number(trade.entryPrice)
  const exit = Number(trade.exitPrice)
  const isWin = trade.result === "WIN"
  const isLoss = trade.result === "LOSS"
  const color = isWin ? PROFIT : isLoss ? LOSS : NEUTRAL

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: "#080C14", fontFamily: "sans-serif", padding: 64,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: "#00C2A8",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, color: "#080C14",
            }}>
              M
            </div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#FFFFFF" }}>
              Meu<span style={{ color: "#00C2A8" }}>Trade</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: NEUTRAL }}>trade compartilhado</div>
        </div>

        {/* Corpo: instrumento + PnL */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: "#FFFFFF" }}>{trade.instrument}</div>
              <div style={{
                display: "flex", fontSize: 26, fontWeight: 700, padding: "6px 16px", borderRadius: 8,
                background: trade.direction === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
                color: trade.direction === "LONG" ? PROFIT : LOSS,
              }}>
                {trade.direction}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 24, color: NEUTRAL }}>
              {entry.toFixed(2)} → {exit.toFixed(2)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color }}>{signedUsd(pnl, 2)}</div>
            <div style={{ display: "flex", fontSize: 26, color }}>
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts
            </div>
          </div>
        </div>

        {/* Barra de execução (mesma linguagem visual do gráfico do app) */}
        <div style={{
          display: "flex", width: "100%", height: 14, borderRadius: 7,
          background: color, opacity: 0.9,
        }} />
      </div>
    ),
    { ...ogImageSize }
  )
}
