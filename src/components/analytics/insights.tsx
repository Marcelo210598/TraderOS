import type { ReactNode } from "react"
import { cn, signedUsd } from "@/lib/utils"
import { formatShortDateBR } from "@/lib/date"
import {
  MIN_BUCKET, MIN_SAMPLE, afterLoss, concentration, dailyPnl, entryDiagnosis, exitLeak, hourStats,
  type FollowStat, type InsightTrade,
} from "@/lib/analytics-insights"
import { ExplainButton, type ExplainTopic } from "./explain-modal"
import { DailyPnlChart } from "./daily-pnl-chart"

const pts = (v: number) => `${v.toFixed(1)} pts`
const usd = (v: number) => `$${Math.abs(v).toFixed(0)}`

function Card({ title, subtitle, topic, topicLabel, children }: { title: string; subtitle: string; topic?: ExplainTopic; topicLabel?: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {topic && <ExplainButton topic={topic} label={topicLabel ?? "o que é isso?"} />}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function Verdict({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const styles = {
    good: "bg-profit/5 border-profit/20",
    warn: "bg-yellow-500/5 border-yellow-500/20",
    bad: "bg-loss/5 border-loss/20",
    info: "bg-muted/40 border-border",
  }[tone]
  return <p className={cn("text-xs text-muted-foreground leading-relaxed border rounded-lg px-3 py-2.5", styles)}>{children}</p>
}

const B = ({ children }: { children: ReactNode }) => <strong className="text-foreground font-semibold">{children}</strong>

// ── Banner de amostra ────────────────────────────────────────────────────────
export function SampleBanner({ total }: { total: number }) {
  if (total >= MIN_SAMPLE) return null
  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      <span className="text-yellow-400 font-semibold">Amostra pequena: {total} trades.</span>{" "}
      Os diagnósticos abaixo já funcionam, mas com menos de {MIN_SAMPLE} trades um padrão pode ser coincidência.
      Leia como pista pra investigar, não como veredito.
    </div>
  )
}

// ── 1. Diagnóstico da entrada (MAE) ──────────────────────────────────────────
export function EntryDiagnosisCard({ trades }: { trades: InsightTrade[] }) {
  const d = entryDiagnosis(trades)
  if (!d) return null
  const max = Math.max(d.avgMaeWin, d.avgMaeLoss, 1)

  return (
    <Card
      title="Diagnóstico da entrada"
      subtitle="Quanto o preço andou contra você (MAE) nos trades que deram certo vs nos que deram errado"
      topic="mae"
      topicLabel="o que é MAE?"
    >
      <div className="space-y-3">
        {[
          { label: "Wins", n: d.winCount, v: d.avgMaeWin, color: "bg-profit", text: "text-profit" },
          { label: "Losses", n: d.lossCount, v: d.avgMaeLoss, color: "bg-loss", text: "text-loss" },
        ].map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className={r.text}>{r.label} <span className="text-muted-foreground">({r.n} trades)</span></span>
              <span className={cn("font-mono font-bold", r.text)}>-{pts(r.v)} contra, em média</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full", r.color)} style={{ width: `${(r.v / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {d.verdict === "few" && (
        <Verdict tone="info">Preciso de pelo menos {MIN_BUCKET} wins e {MIN_BUCKET} losses com MAE registrado pra diagnosticar a entrada.</Verdict>
      )}
      {d.verdict === "tight" && (
        <Verdict tone="good">
          <B>Entrada boa.</B> Seus wins quase não sofrem (média de {pts(d.avgMaeWin)} contra), enquanto os losses chegam a {pts(d.avgMaeLoss)}.
          80% dos seus wins nunca passaram de <B>{pts(d.p80MaeWin)}</B>{" "}contra. Isso indica folga no stop: teste um stop mais curto no simulador &quot;E se&quot; mais abaixo.
        </Verdict>
      )}
      {d.verdict === "sufoco" && (
        <Verdict tone="warn">
          <B>Você está ganhando &quot;no sufoco&quot;.</B> Seus wins sofrem {pts(d.avgMaeWin)} contra, quase o mesmo dos losses ({pts(d.avgMaeLoss)}).
          Isso costuma ser entrada antes da confirmação. Vale esperar um pouco mais (pullback, candle de confirmação) antes de clicar.
        </Verdict>
      )}
      {d.verdict === "ok" && (
        <Verdict tone="info">
          Meio-termo: wins sofrem {pts(d.avgMaeWin)} contra e losses {pts(d.avgMaeLoss)}. Nada gritante. O win que mais sofreu chegou a {pts(d.maxMaeWin)}: se seu stop é bem maior que isso, há espaço pra apertá-lo.
        </Verdict>
      )}
    </Card>
  )
}

// ── 2. Lucro deixado na mesa (MFE vs saída) ──────────────────────────────────
export function ExitLeakCard({ trades, totalPnl }: { trades: InsightTrade[]; totalPnl: number }) {
  const l = exitLeak(trades)
  if (!l) return null
  const sharePct = totalPnl > 0 ? Math.round((l.leftOnWinsUsd / totalPnl) * 100) : null

  return (
    <Card
      title="Lucro deixado na mesa"
      subtitle={`Quanto o preço andou a seu favor (MFE) vs onde você saiu — ${l.tradesUsed} trades com MFE registrado`}
      topic="mfe"
      topicLabel="o que é MFE?"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/30 border border-border p-3">
          <p className="text-[10px] text-muted-foreground">Não capturado nos wins</p>
          <p className="text-xl font-bold font-mono text-yellow-400">{usd(l.leftOnWinsUsd)}</p>
          <p className="text-[10px] text-muted-foreground">
            {sharePct != null ? `equivale a ${sharePct}% do seu P&L total` : "lucro que o preço deu e você não pegou"}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-3">
          <p className="text-[10px] text-muted-foreground">Losses que já estiveram no verde</p>
          <p className={cn("text-xl font-bold font-mono", l.lossesWereGreen > 0 ? "text-loss" : "text-foreground")}>{l.lossesWereGreen}</p>
          <p className="text-[10px] text-muted-foreground">andaram ≥ 50% do ganho médio antes de virar loss</p>
        </div>
      </div>

      {l.top.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Onde mais escapou dinheiro</p>
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {l.top.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                <span className="font-mono text-muted-foreground w-12 shrink-0">{formatShortDateBR(r.date)}</span>
                <span className={cn("text-[10px] font-bold w-10 shrink-0", r.result === "WIN" ? "text-profit" : "text-loss")}>{r.result === "WIN" ? "WIN" : "LOSS"}</span>
                <span className="font-mono font-bold text-yellow-400 shrink-0 ml-auto sm:order-last">-{usd(r.leftUsd)}</span>
                <span className="basis-full sm:basis-auto sm:flex-1 text-muted-foreground font-mono text-[11px] sm:text-xs">
                  foi a <span className="text-profit">+{r.mfe.toFixed(0)}</span>, saiu em{" "}
                  <span className={r.exitPts >= 0 ? "text-profit" : "text-loss"}>{r.exitPts >= 0 ? "+" : ""}{r.exitPts.toFixed(0)}</span> pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {l.lossesWereGreen > 0 ? (
        <Verdict tone="bad">
          <B>{l.lossesWereGreen} loss{l.lossesWereGreen > 1 ? "es" : ""} estava{l.lossesWereGreen > 1 ? "m" : ""} bem no lucro antes de virar prejuízo.</B>{" "}
          Isso é o clássico de não ter um plano de saída: parcial, mover o stop pro zero a zero ou alvo fixo. Teste &quot;Alvo&quot; no simulador abaixo.
        </Verdict>
      ) : (
        <Verdict tone="good">Nenhum loss chegou a andar bem a favor antes de virar prejuízo: seus stops estão sendo respeitados no momento certo.</Verdict>
      )}
    </Card>
  )
}

// ── 3. Horário ───────────────────────────────────────────────────────────────
export function TimeOfDayCard({ trades }: { trades: InsightTrade[] }) {
  const hours = hourStats(trades)
  if (hours.length < 2) return null
  const maxAbs = Math.max(...hours.map((h) => Math.abs(h.pnl)), 1)
  const reliable = hours.filter((h) => h.total >= MIN_BUCKET)
  const best = [...reliable].sort((a, b) => b.pnl - a.pnl)[0]
  const worst = [...reliable].sort((a, b) => a.pnl - b.pnl)[0]

  return (
    <Card title="Performance por horário" subtitle="Resultado por hora do dia (horário de Brasília) — onde você opera bem e onde entrega dinheiro">
      <div className="space-y-2">
        {hours.map((h) => (
          <div key={h.key} className={cn("flex items-center gap-3", h.total < MIN_BUCKET && "opacity-60")}>
            <span className="w-9 text-xs font-mono font-semibold text-foreground shrink-0">{String(h.key).padStart(2, "0")}h</span>
            <div className="relative flex-1 h-4">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
              <div
                className={cn("absolute top-0.5 bottom-0.5 rounded-sm", h.pnl >= 0 ? "left-1/2 bg-profit/70" : "right-1/2 bg-loss/70")}
                style={{ width: `${(Math.abs(h.pnl) / maxAbs) * 50}%` }}
              />
            </div>
            <span className={cn("w-16 text-right text-xs font-mono font-bold shrink-0", h.pnl >= 0 ? "text-profit" : "text-loss")}>{signedUsd(h.pnl)}</span>
            <span className="w-14 sm:w-24 text-right text-[10px] text-muted-foreground shrink-0 leading-tight">
              {h.total}<span className="hidden sm:inline"> trade{h.total > 1 ? "s" : ""}</span><span className="sm:hidden">t</span> · {h.winRate}%<span className="hidden sm:inline"> win</span>
            </span>
          </div>
        ))}
      </div>

      {best && worst && best.key !== worst.key ? (
        <Verdict tone="info">
          Melhor faixa: <B>{best.key}h</B> ({signedUsd(best.pnl)} em {best.total} trades, {best.winRate}% win). Pior faixa: <B>{worst.key}h</B> ({signedUsd(worst.pnl)} em {worst.total} trades).
          {worst.pnl < 0 && " Se o padrão se repetir, evitar essa hora já melhora o resultado — simule em “Sem operar às Xh” mais abaixo."}
        </Verdict>
      ) : (
        <Verdict tone="info">Ainda não há trades suficientes por hora ({MIN_BUCKET}+ em cada faixa) pra apontar melhor e pior horário.</Verdict>
      )}
    </Card>
  )
}

// ── 4. Comportamento (pós-loss, revenge, overtrading) ────────────────────────
function FollowRow({ label, hint, s }: { label: string; hint: string; s: FollowStat }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 sm:gap-x-4 px-3 sm:px-4 py-2.5 text-xs">
      <div>
        <p className="text-foreground font-medium">{label}</p>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <span className="font-mono text-muted-foreground w-8 text-right">{s.total}x</span>
      <span className={cn("font-mono w-10 text-right", s.total === 0 ? "text-muted-foreground" : s.winRate >= 50 ? "text-profit" : "text-loss")}>
        {s.total ? `${s.winRate}%` : "—"}
      </span>
      <span className={cn("font-mono font-bold w-16 text-right", s.total === 0 ? "text-muted-foreground" : s.avgPnl >= 0 ? "text-profit" : "text-loss")}>
        {s.total ? signedUsd(s.avgPnl) : "—"}
      </span>
    </div>
  )
}

export function BehaviorCard({ trades }: { trades: InsightTrade[] }) {
  const a = afterLoss(trades)
  if (a.afterLoss.total + a.afterWin.total < 2) return null

  const tilt = a.afterLoss.total >= MIN_BUCKET && a.afterWin.total >= MIN_BUCKET && a.afterLoss.avgPnl < a.afterWin.avgPnl
  const revenge = a.quickAfterLoss.total >= 2 && a.quickAfterLoss.avgPnl < 0

  return (
    <Card title="Comportamento" subtitle="Como você opera depois de ganhar e depois de perder (só trades seguidos no mesmo dia)">
      <div className="border border-border rounded-lg divide-y divide-border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 sm:gap-x-4 px-3 sm:px-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wide">
          <span>Situação</span><span className="w-8 text-right">vezes</span><span className="w-10 text-right">win %</span><span className="w-16 text-right">média</span>
        </div>
        <FollowRow label="Depois de um win" hint="o próximo trade" s={a.afterWin} />
        <FollowRow label="Depois de um loss" hint="o próximo trade" s={a.afterLoss} />
        <FollowRow label="Reentrada ≤ 15 min" hint="após um loss · possível revenge" s={a.quickAfterLoss} />
      </div>

      {tilt ? (
        <Verdict tone="warn">
          Depois de um loss você rende <B>{usd(a.afterWin.avgPnl - a.afterLoss.avgPnl)} a menos por trade</B> do que depois de um win.
          Sinal de que o loss mexe com a sua decisão. Regra prática: após um loss, pare 10 minutos e releia o plano antes da próxima entrada.
        </Verdict>
      ) : a.afterLoss.total >= MIN_BUCKET ? (
        <Verdict tone="good">Depois de um loss você opera tão bem quanto depois de um win. Boa disciplina emocional.</Verdict>
      ) : (
        <Verdict tone="info">Poucos trades seguidos após loss ainda ({a.afterLoss.total}) pra concluir algo sobre tilt.</Verdict>
      )}
      {revenge && (
        <Verdict tone="bad">
          Reentradas rápidas após loss estão perdendo dinheiro: <B>{a.quickAfterLoss.total} vezes, média de {signedUsd(a.quickAfterLoss.avgPnl)}</B>. Cheiro de revenge trade.
        </Verdict>
      )}
      {a.overtradingDays && (
        <Verdict tone={a.overtradingDays.avgDayPnl < a.overtradingDays.otherAvgDayPnl ? "warn" : "info"}>
          Você faz em média <B>{a.avgTradesPerDay.toFixed(1)} trades/dia</B>. Nos {a.overtradingDays.days} {a.overtradingDays.days > 1 ? "dias" : "dia"} com {a.overtradingDays.threshold}+ trades o dia rendeu{" "}
          <B>{signedUsd(a.overtradingDays.avgDayPnl)}</B> em média, contra <B>{signedUsd(a.overtradingDays.otherAvgDayPnl)}</B> nos demais dias.
        </Verdict>
      )}
    </Card>
  )
}

// ── 5. Dias + distribuição ───────────────────────────────────────────────────
export function DaysAndDistributionCard({ trades }: { trades: InsightTrade[] }) {
  const days = dailyPnl(trades)
  if (days.length < 2) return null
  const c = concentration(trades, days)
  const winDays = days.filter((d) => d.pnl > 0)
  const bestDay = days.reduce((a, b) => (b.pnl > a.pnl ? b : a))
  const worstDay = days.reduce((a, b) => (b.pnl < a.pnl ? b : a))
  const maxBin = Math.max(...c.bins.map((b) => b.count), 1)
  const k = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(0)}`

  return (
    <Card title="Dias e distribuição" subtitle="Seu resultado dia a dia e como o P&L se distribui entre os trades">
      <DailyPnlChart days={days} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: "Dias no verde", v: `${Math.round((winDays.length / days.length) * 100)}%`, s: `${winDays.length} de ${days.length} dias` },
          { l: "Melhor dia", v: signedUsd(bestDay.pnl), s: `${bestDay.key.slice(8, 10)}/${bestDay.key.slice(5, 7)}`, c: "text-profit" },
          { l: "Pior dia", v: signedUsd(worstDay.pnl), s: `${worstDay.key.slice(8, 10)}/${worstDay.key.slice(5, 7)}`, c: "text-loss" },
          { l: "Melhor dia / lucro", v: c.bestDayShare != null ? `${c.bestDayShare}%` : "—", s: "do lucro total num só dia" },
        ].map((x) => (
          <div key={x.l} className="rounded-lg bg-muted/30 border border-border p-3">
            <p className="text-[10px] text-muted-foreground">{x.l}</p>
            <p className={cn("text-lg font-bold font-mono", x.c ?? "text-foreground")}>{x.v}</p>
            <p className="text-[10px] text-muted-foreground">{x.s}</p>
          </div>
        ))}
      </div>

      {c.bestDayShare != null && c.bestDayShare >= 40 && (
        <Verdict tone="warn">
          Um único dia respondeu por <B>{c.bestDayShare}%</B> do seu lucro. Mesas proprietárias costumam ter regra de consistência (nenhum dia pode concentrar
          lucro demais — confira o limite da sua). Além disso, resultado que depende de um dia só é frágil.
        </Verdict>
      )}
      {c.bestTradeShare != null && (
        <Verdict tone={c.bestTradeShare >= 50 ? "warn" : "info"}>
          Seu melhor trade é <B>{c.bestTradeShare}%</B> do lucro bruto. Sem ele, o P&L total seria <B>{signedUsd(c.pnlWithoutBest)}</B>.
          {c.bestTradeShare >= 50 ? " Seu resultado depende muito de um trade só — ainda não é consistência." : " O resultado está bem distribuído."}
        </Verdict>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-2">Distribuição do P&L por trade (quantos trades caem em cada faixa)</p>
        <div className="flex items-end gap-1.5 h-24">
          {c.bins.map((b, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${k(b.from)} a ${k(b.to)}: ${b.count} trades`}>
              <span className="text-[10px] font-mono text-muted-foreground">{b.count || ""}</span>
              <div
                className={cn("w-full rounded-t-sm", (b.from + b.to) / 2 >= 0 ? "bg-profit/60" : "bg-loss/60")}
                style={{ height: `${Math.max((b.count / maxBin) * 100, b.count ? 6 : 2)}%`, opacity: b.count ? 1 : 0.25 }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1">
          {c.bins.map((b, i) => (
            <span key={i} className="flex-1 text-center text-[9px] text-muted-foreground font-mono">{k((b.from + b.to) / 2)}</span>
          ))}
        </div>
      </div>
    </Card>
  )
}
