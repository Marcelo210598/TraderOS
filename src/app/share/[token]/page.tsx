import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { TradeExecutionChart } from "@/components/journal/trade-execution-chart"
import type { Metadata } from "next"

interface Props { params: Promise<{ token: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const trade = await prisma.trade.findFirst({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: { shareToken: token } as any,
  })
  if (!trade) return { title: "Trade não encontrado" }
  const pnl = Number(trade.pnl)
  return {
    title: `${trade.instrument} ${trade.direction} ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(0)} | TraderOS`,
    description: `Trade em ${format(trade.date, "dd/MM/yyyy", { locale: ptBR })} via TraderOS`,
  }
}

export default async function SharePage({ params }: Props) {
  const { token } = await params

  const trade = await prisma.trade.findFirst({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: { shareToken: token } as any,
    include: { tags: true, setup: true },
  })
  if (!trade) notFound()

  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnlPoints)
  const isWin = trade.result === "WIN"
  const isLoss = trade.result === "LOSS"

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">TraderOS</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">trade compartilhado</span>
        </div>
        <a
          href="/"
          className="text-xs text-teal hover:text-teal/80 transition-colors"
        >
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
                    "text-xs font-mono font-bold px-1.5 py-0.5 rounded border-0",
                    trade.direction === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
                  )}>
                    {trade.direction}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(trade.date, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={cn("text-2xl font-bold font-mono", isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground")}>
                {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts</p>
            </div>
          </div>

          {(trade.setup || trade.tags.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
              {trade.setup && (
                <span className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded">{trade.setup.name}</span>
              )}
              {trade.tags.map(tag => (
                <span key={tag.id} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{tag.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Dados técnicos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Entrada", value: Number(trade.entryPrice).toFixed(2) },
            { label: "Saída", value: Number(trade.exitPrice).toFixed(2) },
            { label: "Contratos", value: String(trade.quantity) },
            { label: "Sessão", value: trade.sessionType },
          ].map(item => (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-sm font-mono font-semibold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Gráfico de execução */}
        <TradeExecutionChart
          entryPrice={Number(trade.entryPrice)}
          exitPrice={Number(trade.exitPrice)}
          direction={trade.direction}
          pnlPoints={pnlPoints}
          result={trade.result}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mfe={(trade as any).mfe != null ? Number((trade as any).mfe) : null}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mae={(trade as any).mae != null ? Number((trade as any).mae) : null}
          instrument={trade.instrument}
          date={trade.date}
        />

        {/* Notas */}
        {trade.notes && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notas</p>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{trade.notes}</p>
          </div>
        )}

        {/* Análise IA (pública se existir) */}
        {trade.aiAnalysis && (
          <div className="bg-indigo/5 border border-indigo/20 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-indigo uppercase tracking-wider">Análise Vega IA</p>
            <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{trade.aiAnalysis}</p>
          </div>
        )}

        {/* CTA */}
        <div className="bg-card border border-teal/20 rounded-xl p-4 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">Quer análises assim dos seus trades?</p>
          <p className="text-xs text-muted-foreground">TraderOS — journal inteligente para traders de futuros americanos</p>
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
