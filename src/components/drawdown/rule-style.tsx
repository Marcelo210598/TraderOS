import type { DrawdownType } from "@/lib/drawdown-engine"

// Identidade visual das 4 regras: cor + FORMA do marcador (não só traço), pra ler no gráfico,
// na legenda e no placar sem depender de padrões de tracejado.
export type Shape = "circle" | "square" | "diamond" | "triangle"

export const RULE_STYLE: Record<DrawdownType, { color: string; short: string; shape: Shape }> = {
  INTRADAY: { color: "#fb923c", short: "Intraday", shape: "circle" },
  END_OF_DAY: { color: "#38bdf8", short: "Fim do dia", shape: "square" },
  END_OF_POSITION: { color: "#f472b6", short: "Fim posição", shape: "diamond" },
  STATIC: { color: "#94a3b8", short: "Estático", shape: "triangle" },
}

export const EQUITY_COLOR = "#2dd4bf"
export const TARGET_COLOR = "#a3e635"

export type ZoneId = "safe" | "watch" | "danger" | "breach"
export interface Zone {
  id: ZoneId
  label: string
  color: string
}

/** Zona de segurança pela fatia do drawdown que ainda sobra: >60% folgado, 30–60% atenção, <30% perigo. */
export function zoneOf(margin: number, maxDrawdown: number, breached: boolean): Zone {
  if (breached) return { id: "breach", label: "Quebrou", color: "#f43f5e" }
  const ratio = maxDrawdown > 0 ? margin / maxDrawdown : 1
  if (ratio >= 0.6) return { id: "safe", label: "Folgado", color: "#34d399" }
  if (ratio >= 0.3) return { id: "watch", label: "Atenção", color: "#facc15" }
  return { id: "danger", label: "Perigo", color: "#f43f5e" }
}

export function Marker({ shape, color, size = 10 }: { shape: Shape; color: string; size?: number }) {
  const s = size
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      {shape === "circle" && <circle cx="5" cy="5" r="4" fill={color} />}
      {shape === "square" && <rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1" fill={color} />}
      {shape === "diamond" && <path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill={color} />}
      {shape === "triangle" && <path d="M5 1 L9.3 9 L0.7 9 Z" fill={color} />}
    </svg>
  )
}
