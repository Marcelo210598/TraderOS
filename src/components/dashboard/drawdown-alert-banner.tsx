"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ShieldAlert, X, Shield } from "lucide-react"
import { GUARDIAN_ALERT_KEY, type GuardianAlertData } from "@/components/guardian/apex-calculator"
import { cn } from "@/lib/utils"

const MAX_AGE_MS = 8 * 60 * 60 * 1000 // 8 horas — alerta expira no fim do dia

export function DrawdownAlertBanner() {
  const [alert, setAlert] = useState<GuardianAlertData | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem(GUARDIAN_ALERT_KEY)
    if (!raw) return
    try {
      const data: GuardianAlertData = JSON.parse(raw)
      const age = Date.now() - data.savedAt
      if (age > MAX_AGE_MS) return
      if (data.level === "safe") return
      setAlert(data)
    } catch {}
  }, [])

  if (!alert || dismissed) return null

  const isDanger = alert.level === "danger"
  const pct = Math.round((alert.safetyMargin / alert.drawdownMax) * 100)

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-xl border px-4 py-3.5 pr-10",
        isDanger
          ? "bg-loss/8 border-loss/30"
          : "bg-yellow-500/8 border-yellow-500/30"
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
          isDanger ? "bg-loss/15" : "bg-yellow-500/15"
        )}
      >
        {isDanger
          ? <ShieldAlert className="w-4.5 h-4.5 text-loss" />
          : <AlertTriangle className="w-4.5 h-4.5 text-yellow-400" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn(
            "text-sm font-semibold",
            isDanger ? "text-loss" : "text-yellow-400"
          )}>
            {isDanger ? "⚠ Zona de perigo — Drawdown Apex" : "Atenção — Drawdown Apex"}
          </p>
          <span className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">
            {alert.accountLabel}
          </span>
        </div>

        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Margem restante:{" "}
          <span className={cn("font-mono font-semibold", isDanger ? "text-loss" : "text-yellow-400")}>
            ${alert.safetyMargin.toFixed(0)}
          </span>{" "}
          de ${alert.drawdownMax.toLocaleString()} ({pct}% disponível).{" "}
          {isDanger
            ? "Reduza o tamanho das posições imediatamente."
            : "Opere com cautela e evite losses consecutivos."}
        </p>

        {/* Barra de progresso do drawdown */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isDanger ? "bg-loss" : "bg-yellow-400"
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <Link
            href="/guardian"
            className={cn(
              "text-[10px] font-semibold shrink-0 hover:underline",
              isDanger ? "text-loss" : "text-yellow-400"
            )}
          >
            Ver Guardian →
          </Link>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        aria-label="Fechar alerta"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
