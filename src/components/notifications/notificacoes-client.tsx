"use client"

import { useState } from "react"
import { Bell, ChevronDown, ChevronUp, BarChart3, Sparkles, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  type: string
  title: string
  content: string
  read: boolean
  createdAt: string
}

interface Props {
  notifications: Notification[]
  userPlan: string
}

interface TradeAlertPayload {
  result: "WIN" | "LOSS" | "BREAKEVEN"
  pnl: number
  pnlPoints: number
  instrument: string
  direction: "LONG" | "SHORT"
  quantity: number
  accountLabel: string
  session: "AM" | "PM" | "OVERNIGHT"
}

function parseTradeAlert(content: string): TradeAlertPayload | null {
  try {
    const d = JSON.parse(content)
    if (d && typeof d.pnl === "number" && d.result) return d as TradeAlertPayload
    return null
  } catch {
    return null
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const SESSION_LABEL: Record<string, string> = { AM: "Manhã", PM: "Tarde", OVERNIGHT: "Overnight" }

function TradeAlertCard({ notification, alert }: { notification: Notification; alert: TradeAlertPayload }) {
  const isWin = alert.result === "WIN"
  const isLoss = alert.result === "LOSS"
  const Icon = isWin ? TrendingUp : isLoss ? TrendingDown : Minus
  const iconColor = isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground"
  const sign = alert.pnl >= 0 ? "+" : "-"
  const value = Math.abs(alert.pnl).toFixed(0)

  return (
    <div className={cn(
      "bg-card border rounded-xl flex items-center gap-3 px-5 py-4 transition-all",
      notification.read ? "border-border" : isWin ? "border-profit/30" : isLoss ? "border-loss/30" : "border-border"
    )}>
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-background/60", iconColor)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          <span className={iconColor}>{sign}${value}</span>
          {" · "}
          {alert.instrument} {alert.direction} ×{alert.quantity}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {alert.accountLabel} · {SESSION_LABEL[alert.session] ?? alert.session} · {formatDateTime(notification.createdAt)}
        </p>
      </div>
      {!notification.read && <span className="w-2 h-2 rounded-full bg-teal shrink-0" />}
    </div>
  )
}

function NotificationCard({ notification }: { notification: Notification }) {
  const [expanded, setExpanded] = useState(true)

  if (notification.type === "TRADE_ALERT") {
    const alert = parseTradeAlert(notification.content)
    if (alert) return <TradeAlertCard notification={notification} alert={alert} />
  }

  const lines = notification.content.split("\n")

  return (
    <div className={cn(
      "bg-card border rounded-xl overflow-hidden transition-all",
      notification.read ? "border-border" : "border-teal/30"
    )}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-teal/10 flex items-center justify-center shrink-0">
          <BarChart3 className="w-4 h-4 text-teal" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{notification.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(notification.createdAt)}</p>
        </div>
        {!notification.read && (
          <span className="w-2 h-2 rounded-full bg-teal shrink-0" />
        )}
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-border">
          <div className="prose-sm prose-invert max-w-none">
            {lines.map((line, i) => {
              if (line.startsWith("## ")) {
                return (
                  <h2 key={i} className="text-base font-bold text-foreground mt-4 mb-2 first:mt-0">
                    {line.replace("## ", "")}
                  </h2>
                )
              }
              if (line.startsWith("### ")) {
                return (
                  <h3 key={i} className="text-sm font-semibold text-foreground mt-3 mb-1.5">
                    {line.replace("### ", "")}
                  </h3>
                )
              }
              if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
                return (
                  <p key={i} className="text-sm font-semibold text-foreground my-1">
                    {line.replace(/\*\*/g, "")}
                  </p>
                )
              }
              if (line.startsWith("- ") || line.startsWith("* ")) {
                const text = line.slice(2)
                return (
                  <div key={i} className="flex gap-2 text-sm text-foreground/80 my-0.5">
                    <span className="text-teal mt-0.5 shrink-0">·</span>
                    <span dangerouslySetInnerHTML={{ __html: renderInline(text) }} />
                  </div>
                )
              }
              if (line.trim() === "") {
                return <div key={i} className="h-2" />
              }
              return (
                <p
                  key={i}
                  className="text-sm text-foreground/80 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderInline(line) }}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs font-mono">$1</code>')
}

export function NotificacoesClient({ notifications: initial, userPlan }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>(initial)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  async function generateSummary() {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch("/api/notifications/generate-summary", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setGenError(data.error ?? "Erro ao gerar resumo")
        return
      }
      const n = data.notification as Notification
      setNotifications((prev) => [n, ...prev])
    } catch {
      setGenError("Erro de conexão. Tente novamente.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-teal" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Notificações</h2>
            <p className="text-xs text-muted-foreground">{notifications.length} mensagen{notifications.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button
          onClick={generateSummary}
          disabled={generating || userPlan === "FREE"}
          title={userPlan === "FREE" ? "Disponível nos planos Trader e Pro" : "Gerar resumo semanal com Vega IA"}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all",
            userPlan === "FREE"
              ? "border-border text-muted-foreground/50 cursor-not-allowed"
              : "border-teal/30 text-teal bg-teal/5 hover:bg-teal/15"
          )}
        >
          {generating
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />
          }
          {generating ? "Gerando..." : "Gerar resumo"}
        </button>
      </div>

      {genError && (
        <div className="bg-loss/10 border border-loss/20 rounded-xl px-4 py-3 text-sm text-loss">
          {genError}
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
            <Bell className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhuma notificação ainda</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Clique em &quot;Gerar resumo&quot; para uma análise Vega IA dos seus últimos 7 dias.
          </p>
        </div>
      ) : (
        notifications.map((n) => (
          <NotificationCard key={n.id} notification={n} />
        ))
      )}
    </div>
  )
}
