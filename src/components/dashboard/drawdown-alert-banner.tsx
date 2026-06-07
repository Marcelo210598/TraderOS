"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ShieldAlert, X, Zap, PencilLine } from "lucide-react"
import { GUARDIAN_ALERT_KEY, type GuardianAlertData } from "@/components/guardian/apex-calculator"
import { ACCOUNTS, simulate, type AccountKey } from "@/lib/guardian"
import { cn } from "@/lib/utils"

const MAX_AGE_MS = 8 * 60 * 60 * 1000 // 8h

export interface DayPnl {
  date: string
  pnl: number
}

interface Props {
  // trades do servidor, agrupados por accountLabel → dias
  tradesByAccount: Record<string, DayPnl[]>
}

export function DrawdownAlertBanner({ tradesByAccount }: Props) {
  const [alert, setAlert] = useState<(GuardianAlertData & { source: "manual" | "auto" }) | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // --- Modo automático: usa conta salva + trades do journal ---
    const savedAccountKey = localStorage.getItem("traderos_guardian_account") as AccountKey | null
    if (savedAccountKey && ACCOUNTS[savedAccountKey]) {
      const account = ACCOUNTS[savedAccountKey]
      const days = tradesByAccount[savedAccountKey] ?? []

      if (days.length > 0) {
        const result = simulate(account, days)
        const level =
          result.safetyMargin < account.drawdown * 0.3 ? "danger"
          : result.safetyMargin < account.drawdown * 0.6 ? "warning"
          : "safe"

        if (level !== "safe") {
          setAlert({
            accountLabel: account.label,
            safetyMargin: result.safetyMargin,
            drawdownMax: account.drawdown,
            balance: result.balance,
            floor: result.floor,
            level,
            savedAt: Date.now(),
            source: "auto",
          })
          return
        }
      }
    }

    // --- Modo manual: fallback para dados digitados no Guardian ---
    const raw = localStorage.getItem(GUARDIAN_ALERT_KEY)
    if (!raw) return
    try {
      const data: GuardianAlertData = JSON.parse(raw)
      if (Date.now() - data.savedAt > MAX_AGE_MS) return
      if (data.level === "safe") return
      setAlert(data)
    } catch {}
  }, [tradesByAccount])

  if (!alert || dismissed) return null

  const isDanger = alert.level === "danger"
  const pct = Math.round((alert.safetyMargin / alert.drawdownMax) * 100)

  return (
    <div className={cn(
      "relative flex items-start gap-3 rounded-xl border px-4 py-3.5 pr-10",
      isDanger ? "bg-loss/8 border-loss/30" : "bg-yellow-500/8 border-yellow-500/30"
    )}>
      <div className={cn(
        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
        isDanger ? "bg-loss/15" : "bg-yellow-500/15"
      )}>
        {isDanger
          ? <ShieldAlert className="w-[18px] h-[18px] text-loss" />
          : <AlertTriangle className="w-[18px] h-[18px] text-yellow-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p className={cn("text-sm font-semibold", isDanger ? "text-loss" : "text-yellow-400")}>
            {isDanger ? "⚠ Zona de perigo — Drawdown Apex" : "Atenção — Drawdown Apex"}
          </p>
          <span className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">
            {alert.accountLabel}
          </span>
          {/* Badge de fonte */}
          <span className={cn(
            "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium",
            alert.source === "auto"
              ? "bg-teal/10 text-teal border border-teal/20"
              : "bg-muted/30 text-muted-foreground border border-border"
          )}>
            {alert.source === "auto"
              ? <><Zap className="w-2.5 h-2.5" />automático</>
              : <><PencilLine className="w-2.5 h-2.5" />manual</>}
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Margem restante:{" "}
          <span className={cn("font-mono font-semibold", isDanger ? "text-loss" : "text-yellow-400")}>
            ${alert.safetyMargin.toFixed(0)}
          </span>{" "}
          de ${alert.drawdownMax.toLocaleString()} ({pct}% disponível).{" "}
          {isDanger
            ? "Reduza o tamanho das posições imediatamente."
            : "Opere com cautela e evite losses consecutivos."}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", isDanger ? "bg-loss" : "bg-yellow-400")}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <Link
            href="/guardian"
            className={cn("text-[10px] font-semibold shrink-0 hover:underline", isDanger ? "text-loss" : "text-yellow-400")}
          >
            Ver Guardian →
          </Link>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
