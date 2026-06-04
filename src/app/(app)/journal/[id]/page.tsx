import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Header } from "@/components/layout/header"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { TrendingUp, TrendingDown, Minus, ArrowLeft, Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AiAnalysis } from "@/components/journal/ai-analysis"
import { DeleteTradeButton } from "@/components/journal/delete-trade-button"
import { TradeExecutionChart } from "@/components/journal/trade-execution-chart"

export const metadata: Metadata = { title: "Detalhe do Trade" }

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const user = session!.user
  const { id } = await params

  const trade = await prisma.trade.findFirst({
    where: { id, userId: user.id },
    include: { tags: true, setup: true, screenshots: true },
  })

  if (!trade) notFound()

  const pnl = Number(trade.pnl)
  const pnlPoints = Number(trade.pnlPoints)
  const isWin = trade.result === "WIN"
  const isLoss = trade.result === "LOSS"

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Detalhe do Trade"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-4">
        {/* Nav */}
        <div className="flex items-center justify-between">
          <Link href="/journal" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Journal
          </Link>
          <div className="flex items-center gap-2">
            <DeleteTradeButton tradeId={trade.id} />
            <a
              href={`/journal/${trade.id}/editar`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </a>
          </div>
        </div>

        {/* Hero do trade */}
        <div className={cn(
          "bg-card border rounded-xl p-6",
          isWin ? "border-profit/30" : isLoss ? "border-loss/30" : "border-border"
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center",
                isWin ? "bg-profit/10" : isLoss ? "bg-loss/10" : "bg-muted"
              )}>
                {isWin ? <TrendingUp className="w-6 h-6 text-profit" /> :
                 isLoss ? <TrendingDown className="w-6 h-6 text-loss" /> :
                 <Minus className="w-6 h-6 text-muted-foreground" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold font-mono text-foreground">{trade.instrument}</span>
                  <Badge className={cn(
                    "text-xs border-0 font-mono",
                    trade.direction === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
                  )}>
                    {trade.direction}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {format(trade.date, "EEEE, dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>

            <div className="text-right">
              <p className={cn("text-3xl font-bold font-mono", isWin ? "text-profit" : isLoss ? "text-loss" : "text-muted-foreground")}>
                {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground font-mono">
                {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts
              </p>
            </div>
          </div>

          {/* Setup e tags */}
          {(trade.setup || trade.tags.length > 0) && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
              {trade.setup && (
                <Badge className="text-xs bg-accent border-0 text-teal">{trade.setup.name}</Badge>
              )}
              {trade.tags.map((tag) => (
                <span key={tag.id} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Dados técnicos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Entrada", value: Number(trade.entryPrice).toFixed(2) },
            { label: "Saída", value: Number(trade.exitPrice).toFixed(2) },
            { label: "Contratos", value: String(trade.quantity) },
            { label: "Comissão", value: `$${Number(trade.commission).toFixed(2)}` },
          ].map((item) => (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-base font-mono font-semibold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* MFE / MAE */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {((trade as any).mfe != null || (trade as any).mae != null) && (
          <div className="grid grid-cols-2 gap-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(trade as any).mfe != null && (
              <div className="bg-card border border-profit/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">MFE <span className="opacity-60">(máx. a favor)</span></p>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <p className="text-base font-mono font-semibold text-profit mt-1">+{Number((trade as any).mfe).toFixed(2)} pts</p>
                {pnlPoints > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    capturou {((pnlPoints / Number((trade as any).mfe)) * 100).toFixed(0)}% do potencial
                  </p>
                )}
              </div>
            )}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(trade as any).mae != null && (
              <div className="bg-card border border-loss/20 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">MAE <span className="opacity-60">(máx. contra)</span></p>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <p className="text-base font-mono font-semibold text-loss mt-1">-{Number((trade as any).mae).toFixed(2)} pts</p>
              </div>
            )}
          </div>
        )}

        {/* Screenshots */}
        {trade.screenshots.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Screenshots</h3>
            <div className="grid grid-cols-2 gap-3">
              {trade.screenshots.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">
                  <img src={s.url} alt={s.label ?? "Screenshot"} className="w-full rounded-lg border border-border hover:opacity-90 transition-opacity" />
                  {s.label && <p className="text-xs text-muted-foreground mt-1">{s.label}</p>}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Notas */}
        {trade.notes && (
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Notas</h3>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{trade.notes}</p>
          </div>
        )}

        {/* Gráfico de Execução */}
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

        {/* Análise IA (plano Pro) */}
        <AiAnalysis
          tradeId={trade.id}
          initial={trade.aiAnalysis ?? null}
          isPro={user.plan === "PRO"}
        />
      </div>
    </div>
  )
}
