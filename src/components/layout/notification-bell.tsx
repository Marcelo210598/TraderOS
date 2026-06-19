"use client"

import { useEffect, useRef, useState } from "react"
import { Bell, TrendingUp, TrendingDown, Minus, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  type: string
  title: string
  content: string
  read: boolean
  createdAt: string
}

interface TradeAlertPayload {
  result: "WIN" | "LOSS" | "BREAKEVEN"
  pnl: number
  instrument: string
  direction: "LONG" | "SHORT"
  quantity: number
  accountLabel: string
}

interface Toast {
  id: string
  alert: TradeAlertPayload
}

const POLL_MS = 30_000
const LAST_SEEN_KEY = "traderos:lastTradeAlertId"

function parseAlert(content: string): TradeAlertPayload | null {
  try {
    const d = JSON.parse(content)
    if (d && typeof d.pnl === "number" && d.result) return d as TradeAlertPayload
    return null
  } catch {
    return null
  }
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const initialized = useRef(false)

  useEffect(() => {
    let active = true

    async function poll() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" })
        const data = await res.json()
        if (!active || !Array.isArray(data.notifications)) return

        if (typeof data.unreadCount === "number") setUnread(data.unreadCount)

        const notifs = data.notifications as Notification[]
        const newestAlert = notifs.find((n) => n.type === "TRADE_ALERT")
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY)

        if (!initialized.current) {
          // Primeira carga: define o baseline sem disparar toast retroativo
          initialized.current = true
          if (newestAlert) localStorage.setItem(LAST_SEEN_KEY, newestAlert.id)
          return
        }

        // Junta os alertas novos desde o último visto
        if (newestAlert && newestAlert.id !== lastSeen) {
          const fresh: Toast[] = []
          for (const n of notifs) {
            if (n.type !== "TRADE_ALERT") continue
            if (n.id === lastSeen) break
            const alert = parseAlert(n.content)
            if (alert) fresh.push({ id: n.id, alert })
          }
          if (fresh.length > 0) {
            // fresh está em ordem do mais novo pro mais antigo; reverte pra exibir cronológico
            setToasts((prev) => [...fresh.reverse(), ...prev].slice(0, 4))
          }
          localStorage.setItem(LAST_SEEN_KEY, newestAlert.id)
        }
      } catch {
        /* silencioso — tenta de novo no próximo ciclo */
      }
    }

    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <>
      <a
        href="/notificacoes"
        className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className={cn(
            "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-teal text-teal-foreground",
            "text-[9px] font-bold flex items-center justify-center px-0.5 leading-none"
          )}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </a>

      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[300px] max-w-[calc(100vw-2rem)]">
          {toasts.map((t) => (
            <TradeToast key={t.id} alert={t.alert} onClose={() => dismiss(t.id)} />
          ))}
        </div>
      )}
    </>
  )
}

function TradeToast({ alert, onClose }: { alert: TradeAlertPayload; onClose: () => void }) {
  // Auto-dismiss em 7s
  useEffect(() => {
    const t = setTimeout(onClose, 7000)
    return () => clearTimeout(t)
  }, [onClose])

  const isWin = alert.result === "WIN"
  const isLoss = alert.result === "LOSS"
  const Icon = isWin ? TrendingUp : isLoss ? TrendingDown : Minus
  const sign = alert.pnl >= 0 ? "+" : "-"
  const value = Math.abs(alert.pnl).toFixed(0)

  const accent = isWin
    ? "border-profit/40 bg-profit/[0.07]"
    : isLoss
      ? "border-loss/40 bg-loss/[0.07]"
      : "border-border bg-card"
  const iconColor = isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"

  return (
    <a
      href="/notificacoes"
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg",
        "backdrop-blur animate-in slide-in-from-right-4 fade-in duration-300",
        accent
      )}
    >
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-background/60", iconColor)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground leading-none mb-1">
          Novo trade · {alert.accountLabel}
        </p>
        <p className="text-sm font-semibold text-foreground truncate">
          <span className={iconColor}>{sign}${value}</span>
          {" · "}
          {alert.instrument} {alert.direction} ×{alert.quantity}
        </p>
      </div>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Fechar"
      >
        <X className="w-3 h-3" />
      </button>
    </a>
  )
}
