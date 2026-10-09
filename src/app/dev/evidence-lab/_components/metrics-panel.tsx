import { GROUP_DIMENSIONS, groupsView, metricsView, METRIC_DEFINITIONS, type Demo } from "@/lib/dev/evidence-lab/model"
import type { MetricValue } from "@/lib/metrics"
import { Badge, Callout, Num, Panel, QLink, Section, Table, Td } from "./ui"
import { href, type LabParams } from "./params"

const HEADLINE = ["netPnl", "grossPnl", "winRate", "profitFactor", "maxDrawdown", "totalR", "maxDrawdownR", "totalPoints"] as const

export function MetricsPanel({ demo, p }: { demo: Demo; p: LabParams }) {
  const view = { pnl: p.pnl, r: p.r }
  const { result, trace } = metricsView(demo, view)
  const mt = trace.metrics[p.metric]
  const def = METRIC_DEFINITIONS.find((d) => d.id === p.metric)
  const groups = p.by ? groupsView(demo, view, p.by) : null
  const val = (m: MetricValue | undefined) => <Num v={m?.value ?? null} />
  return (
    <>
      <Section
        title="Métricas calculadas pelo motor real"
        subtitle={`Resultado de calculateMetricsTraced sobre ${result.population.afterFilters} ciclos sintéticos (${result.engineVersion}). A página só lê o resultado; nenhuma fórmula é reimplementada aqui.`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-400">P&L:</span>
          <QLink href={href(p, { pnl: "NET" })} active={p.pnl === "NET"}>líquido</QLink>
          <QLink href={href(p, { pnl: "GROSS" })} active={p.pnl === "GROSS"}>bruto</QLink>
          <span className="ml-3 text-zinc-400">R:</span>
          <QLink href={href(p, { r: "NET" })} active={p.r === "NET"}>líquido (US$)</QLink>
          <QLink href={href(p, { r: "POINTS" })} active={p.r === "POINTS"}>em pontos</QLink>
        </div>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {HEADLINE.map((id) => {
            const m = result.metrics[id]
            return (
              <Panel key={id} className="!p-3">
                <p className="text-xs text-zinc-400">{METRIC_DEFINITIONS.find((d) => d.id === id)?.label}</p>
                <p className="mt-1 text-lg text-zinc-100">{val(m)} <span className="text-xs text-zinc-500">{m.unit}</span></p>
                <p className="text-[11px] text-zinc-500">n={m.sampleSize} · cobertura {m.coverage.used}/{m.coverage.total}{m.reason ? ` · ${m.reason}` : ""}</p>
              </Panel>
            )
          })}
        </div>
        <Table head={["métrica", "valor", "unidade", "base", "amostra", "cobertura", "motivo se nulo", ""]}>
          {METRIC_DEFINITIONS.map((d) => {
            const m = result.metrics[d.id]
            return (
              <tr key={d.id} className={d.id === p.metric ? "bg-zinc-800/50" : ""}>
                <Td><span title={d.formula}>{d.label}</span> <span className="font-mono text-[11px] text-zinc-500">{d.id}</span></Td>
                <Td>{val(m)}</Td><Td>{m.unit}</Td><Td>{m.basis ?? "—"}</Td><Td mono>{m.sampleSize}</Td><Td mono>{m.coverage.used}/{m.coverage.total}</Td>
                <Td className="text-zinc-400">{m.reason ?? ""}</Td>
                <Td><QLink href={`${href(p, { metric: d.id })}#contribuintes`}>contribuintes</QLink></Td>
              </tr>
            )
          })}
        </Table>
      </Section>
      <Section id="contribuintes" title={`Contribuintes — ${def?.label ?? p.metric}`} subtitle={def ? `Fórmula do catálogo: ${def.formula}. Requer: ${def.requires}.` : undefined}>
        {!mt || !mt.applicable ? (
          <Callout tone="mute">Esta métrica não tem conjunto natural de contribuintes (applicable = false): nenhum papel é inventado.</Callout>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-2">
              {Object.entries(mt.roleCounts).map(([role, n]) => <Badge key={role}>{role} {n}</Badge>)}
              <Badge tone={mt.contributors ? "ok" : "warn"}>{mt.contributors ? "lista completa" : "só âncoras (acima do limite)"}</Badge>
            </div>
            <Table head={["papel", "rank", "trade", "P&L líquido", ""]}>
              {(mt.contributors ?? mt.anchors).map((c, i) => {
                const idx = demo.tradeEvidence.findIndex((t) => t.tradeId === c.tradeId)
                return (
                  <tr key={`${c.role}${c.tradeId}${i}`}>
                    <Td>{c.role}</Td><Td mono>{c.rank ?? ""}</Td><Td>#{idx + 1} <span className="font-mono text-[11px] text-zinc-500">{c.tradeId.slice(0, 14)}…</span></Td>
                    <Td><Num v={demo.tradeEvidence[idx]?.pnl.net} /></Td>
                    <Td><QLink href={href(p, { tab: "trade", trade: idx })}>trilha</QLink></Td>
                  </tr>
                )
              })}
            </Table>
          </>
        )}
      </Section>
      <Section id="grupos" title="Agrupamentos" subtitle="aggregateTradesTraced: a mesma população, particionada. Cada grupo tem seu próprio tradeSetHash e sinalização de amostra (OK ≥ minSample · LOW · TINY).">
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <QLink href={`${href(p, { by: null })}#grupos`} active={!p.by}>nenhum</QLink>
          {GROUP_DIMENSIONS.map((d) => <QLink key={d} href={`${href(p, { by: d })}#grupos`} active={p.by === d}>{d}</QLink>)}
        </div>
        {groups ? (
          <Table head={["grupo", "n", "amostra", "P&L líquido", "win rate", "profit factor", "max drawdown", "R total", "tradeSetHash"]}>
            {groups.result.groups.map((g, i) => (
              <tr key={i}>
                <Td>{g.label}</Td><Td mono>{g.sampleSize}</Td>
                <Td><Badge tone={g.sampleFlag === "OK" ? "ok" : g.sampleFlag === "LOW" ? "warn" : "mute"}>{g.sampleFlag}</Badge></Td>
                <Td>{val(g.metrics.netPnl)}</Td><Td>{val(g.metrics.winRate)}</Td><Td>{val(g.metrics.profitFactor)}</Td><Td>{val(g.metrics.maxDrawdown)}</Td><Td>{val(g.metrics.totalR)}</Td>
                <Td mono>{g.tradeSetHash.slice(0, 12)}…</Td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-zinc-500">Escolha uma dimensão para ver os grupos.</p>}
        {p.by === "strategy" ? <p className="mt-2 text-xs text-amber-300">Estratégia não tem referência na Evidence: o verificador não afirma a associação de trades a grupos por estratégia (ver aba Verificador).</p> : null}
      </Section>
    </>
  )
}
