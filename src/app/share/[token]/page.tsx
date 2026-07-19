import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn, signedUsd } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { TradeExecutionChart } from "@/components/journal/trade-execution-chart"
import type { Metadata } from "next"

interface Props { params: Promise<{ token: string }> }

interface RawTrade {
  id: string; user_id: string; date: Date; instrument: string
  direction: "LONG" | "SHORT"; entry_price: string; exit_price: string
  quantity: number; pnl: string; pnl_points: string; commission: string
  result: "WIN" | "LOSS" | "BREAKEVEN"; session_type: string
  notes: string | null; ai_analysis: string | null
  mfe: string | null; mae: string | null
}

interface RawTag { trade_id: string; name: string }
interface RawSetup { id: string; name: string }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const rows = await prisma.$queryRaw<RawTrade[]>`
    SELECT id, pnl, instrument, direction, date FROM trades WHERE share_token = ${token} LIMIT 1
  `
  if (rows.length === 0) return { title: "Trade não encontrado" }
  const t = rows[0]
  const pnl = Number(t.pnl)
  return {
    title: `${t.instrument} ${t.direction} ${signedUsd(pnl)} | MeuTrade`,
    description: `Trade em ${format(new Date(t.date), "dd/MM/yyyy", { locale: ptBR })} via MeuTrade`,
  }
}

export default async function SharePage({ params }: Props) {
  const { token } = await params

  const rows = await prisma.$queryRaw<RawTrade[]>`
    SELECT t.id, t.user_id, t.date, t.instrument, t.direction, t.entry_price, t.exit_price,
           t.quantity, t.pnl, t.pnl_points, t.commission, t.result, t.session_type,
           t.notes, t.ai_analysis, t.mfe, t.mae
    FROM trades t WHERE t.share_token = ${token} LIMIT 1
  `
  if (rows.length === 0) notFound()

  const trade = rows[0]
  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnl_points)
  const isWin = trade.result === "WIN"
  const isLoss = trade.result === "LOSS"

  const [tagRows, setupRow] = await Promise.all([
    prisma.$queryRaw<RawTag[]>`
      SELECT trade_id, name FROM trade_tags WHERE trade_id = ${trade.id}
    `,
    prisma.$queryRaw<RawSetup[]>`
      SELECT s.id, s.name FROM setups s
      JOIN trades t ON t.setup_id = s.id
      WHERE t.id = ${trade.id} LIMIT 1
    `,
  ])

  const tags = tagRows
  const setupName = setupRow[0]?.name ?? null

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">MeuTrade</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">trade compartilhado</span>
        </div>
        <a href="/" className="text-xs text-teal hover:text-teal/80 transition-colors">
          Criar conta grátis →
        </a>
      </div>

      <div className="flex-1 p-4 max-w-lg mx-auto w-full space-y-4 py-6">
        {/* Hero */}
        <div className={cn(
          "bg-card border rounded-xl p-5",
          isWin ? "border-profit/30" : isLoss ? "border-loss/30" : "border-border"
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-11 h-11 rounded-xl flex items-center justify-center",
                isWin ? "bg-profit/10" : isLoss ? "bg-loss/10" : "bg-muted"
              )}>
                {isWin ? <TrendingUp className="w-5 h-5 text-profit" /> :
                 isLoss ? <TrendingDown className="w-5 h-5 text-loss" /> :
                 <Minus className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold font-mono text-foreground">{trade.instrument}</span>
                  <span className={cn(
                    "text-xs font-mono font-bold px-1.5 py-0.5 rounded",
                    trade.direction === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
                  )}>
                    {trade.direction}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(new Date(trade.date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={cn("text-2xl font-bold font-mono", isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground")}>
                {signedUsd(pnl, 2)}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts</p>
            </div>
          </div>

          {(setupName || tags.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
              {setupName && (
                <span className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded">{setupName}</span>
              )}
              {tags.map((tag, i) => (
                <span key={i} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{tag.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Dados técnicos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Entrada", value: Number(trade.entry_price).toFixed(2) },
            { label: "Saída", value: Number(trade.exit_price).toFixed(2) },
            { label: "Contratos", value: String(trade.quantity) },
            { label: "Sessão", value: trade.session_type },
          ].map(item => (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-sm font-mono font-semibold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Gráfico de execução */}
        <TradeExecutionChart
          entryPrice={Number(trade.entry_price)}
          exitPrice={Number(trade.exit_price)}
          direction={trade.direction}
          pnlPoints={pnlPoints}
          result={trade.result}
          mfe={trade.mfe != null ? Number(trade.mfe) : null}
          mae={trade.mae != null ? Number(trade.mae) : null}
          instrument={trade.instrument}
          date={new Date(trade.date)}
        />

        {trade.notes && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notas</p>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{trade.notes}</p>
          </div>
        )}

        {trade.ai_analysis && (
          <div className="bg-indigo/5 border border-indigo/20 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-indigo uppercase tracking-wider">Análise Vega IA</p>
            <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{trade.ai_analysis}</p>
          </div>
        )}

        {/* CTA */}
        <div className="bg-card border border-teal/20 rounded-xl p-4 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">Quer análises assim dos seus trades?</p>
          <p className="text-xs text-muted-foreground">MeuTrade — journal inteligente para traders de futuros americanos</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal text-teal-foreground text-sm font-medium hover:bg-teal/90 transition-colors"
          >
            Começar grátis
          </a>
        </div>
      </div>
    </div>
  )
}
