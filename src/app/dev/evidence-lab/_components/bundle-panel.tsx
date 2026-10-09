import { GROUP_DIMENSIONS, buildBundle, groupsView, type Demo } from "@/lib/dev/evidence-lab/model"
import { verifyEvidence } from "@/lib/evidence/verify"
import { METRIC_CATALOG } from "@/lib/metrics"
import { Badge, Callout, Json, Kv, Num, Panel, QLink, Section, Table, Td, statusTone } from "./ui"
import { href, type LabParams } from "./params"

export const HASH_ONLY_LIMIT = 3

export function BundlePanel({ demo, p }: { demo: Demo; p: LabParams }) {
  const built = buildBundle(demo, { metricId: p.metric, view: { pnl: p.pnl, r: p.r }, tradeIdsLimit: p.mode === "hashonly" ? HASH_ONLY_LIMIT : undefined, by: p.by, group: p.group })
  const groups = p.by ? groupsView(demo, { pnl: p.pnl, r: p.r }, p.by) : null
  return (
    <Section
      title="EvidenceBundle"
      subtitle="claim → MetricEvidence → TradeEvidence → SourceRowRef → ImportRef, selado com evidenceHash (SHA-256 do JSON canônico). Gerado agora por explainMetric + metricEvidenceBundle."
    >
      <form action="/dev/evidence-lab" method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
        <input type="hidden" name="tab" value="bundle" />
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          métrica
          <select name="metric" defaultValue={p.metric} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100">
            {METRIC_CATALOG.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.id})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          agrupar por
          <select name="by" defaultValue={p.by ?? ""} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100">
            <option value="">(população total)</option>
            {GROUP_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {groups ? (
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            grupo
            <select name="group" defaultValue={String(p.group)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100">
              {groups.result.groups.map((g, i) => <option key={i} value={i}>{g.label} (n={g.sampleSize})</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          população
          <select name="mode" defaultValue={p.mode} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100">
            <option value="full">completa (FULL)</option>
            <option value="hashonly">acima do limite (HASH_ONLY, limite {HASH_ONLY_LIMIT})</option>
          </select>
        </label>
        <input type="hidden" name="pnl" value={p.pnl} />
        <input type="hidden" name="r" value={p.r} />
        <button type="submit" className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white">gerar bundle</button>
      </form>
      {!built.ok ? (
        <Callout tone="bad" title={`explainMetric recusou: ${built.code}`}>{built.message}</Callout>
      ) : (
        (() => {
          const b = built.bundle
          const m = b.evidence.metrics[0]
          const report = verifyEvidence(b)
          return (
            <div className="space-y-4">
              <Panel>
                <Kv
                  rows={[
                    ["schema", b.schema],
                    ["evidenceHash (selo)", <span key="a" className="break-all font-mono text-xs">{b.evidenceHash}</span>],
                    ["claim · subject", `${b.claim.kind} · ${b.subject.type} "${b.subject.id}"`],
                    ["verificação deste bundle", <span key="b" className="flex items-center gap-2"><Badge tone={statusTone(report.status)}>{report.status}</Badge><QLink href={href(p, { tab: "verify", scenario: "bundle" })}>ver os checks</QLink></span>],
                    ["conteúdo", `${b.evidence.imports.length} ImportRef · ${b.evidence.trades.length} TradeEvidence · ${b.evidence.metrics.length} MetricEvidence`],
                  ]}
                />
              </Panel>
              <Section title="MetricEvidence">
                <Panel>
                  <Kv
                    rows={[
                      ["métrica", `${m.metricId} (definição v${m.definitionVersion} · motor ${m.engineVersion})`],
                      ["escopo", m.scope === "TOTAL" ? "TOTAL" : `GROUP ${JSON.stringify(m.query.groupBy)} = ${JSON.stringify(m.query.groupKey)} · amostra ${m.sampleFlag}`],
                      ["valor", <span key="v"><Num v={m.value} /> <span className="text-xs text-zinc-500">{m.unit}{m.basis ? ` · base ${m.basis}` : ""}</span></span>],
                      ["amostra · cobertura", `${m.sampleSize} · ${m.coverage.used}/${m.coverage.total} (${m.coverage.ratio})${m.reason ? ` · motivo ${m.reason}` : ""}`],
                      ["tradeSetHash", <span key="h" className="break-all font-mono text-xs">{m.population.tradeSetHash}</span>],
                      ["verificabilidade", <span key="f" className="flex items-center gap-2"><Badge tone={m.verifiability === "FULL" ? "ok" : "warn"}>{m.verifiability}</Badge><span className="text-xs text-zinc-400">{m.verifiability === "FULL" ? "a população está listada: dá para refazer hash e métrica" : "acima do limite: só o hash da população e as âncoras — V3/V4 ficam SKIPPED"}</span></span>],
                      ["população", `${m.population.inputTrades} de entrada → ${m.population.afterFilters} após filtros · ids listados: ${m.population.tradeIds ? m.population.tradeIds.length : "null (HASH_ONLY)"}`],
                      ["proveniência", `${m.population.provenance.withIdentity} com identidade · ${m.population.provenance.withoutIdentity} sem`],
                      ["contribuintes", `applicable ${String(m.contributors.applicable)} · complete ${String(m.contributors.complete)} · ${m.contributors.items.length} item(ns) · roleCounts ${JSON.stringify(m.contributors.roleCounts)}`],
                      ["consulta", `fuso ${m.query.timeZone} · âncora ${String(m.query.options.timeAnchor)} · P&L ${String(m.query.options.pnlBasis)} · R ${String(m.query.options.rBasis)} · filtros ${JSON.stringify(m.query.filters)}`],
                      ["período", m.period ? `${m.period.fromLocalDate} → ${m.period.toLocalDate}` : "null (grupo: o motor só calcula para o total)"],
                    ]}
                  />
                </Panel>
                {m.warnings.length > 0 ? (
                  <div className="mt-3">
                    <Table head={["aviso", "severidade", "mensagem"]}>
                      {m.warnings.map((w, i) => <tr key={i}><Td mono>{w.code}</Td><Td><Badge tone={w.severity === "WARNING" ? "warn" : "mute"}>{w.severity}</Badge></Td><Td className="text-zinc-300">{w.message}</Td></tr>)}
                    </Table>
                  </div>
                ) : null}
              </Section>
              <Section title="Trades e imports no bundle">
                <Table head={["#", "tradeId", "direção", "P&L líquido", "proveniência", "linhas", ""]}>
                  {b.evidence.trades.map((t) => {
                    const idx = demo.tradeEvidence.findIndex((x) => x.tradeId === t.tradeId)
                    return (
                      <tr key={t.tradeId}>
                        <Td mono>{idx + 1}</Td><Td mono>{t.tradeId.slice(0, 20)}…</Td><Td>{t.direction}</Td><Td><Num v={t.pnl.net} /></Td>
                        <Td><Badge tone={t.provenance === "COMPLETE" ? "ok" : "warn"}>{t.provenance}</Badge></Td><Td mono>{t.sourceRows.map((r) => r.rowNo).join(",")}</Td>
                        <Td><QLink href={href(p, { tab: "trade", trade: idx })}>trilha</QLink></Td>
                      </tr>
                    )
                  })}
                </Table>
                <p className="mt-2 text-xs text-zinc-500">imports: {b.evidence.imports.map((i) => i.importId.slice(0, 20)).join(", ")}…</p>
              </Section>
              <div className="space-y-2">
                <Json value={m} label="MetricEvidence (JSON)" />
                <Json value={b.evidence.trades} label="TradeEvidence[] (JSON)" />
                <Json value={b.evidence.imports} label="ImportRef[] (JSON)" />
                <Json value={b} label="EvidenceBundle completo (JSON)" />
              </div>
            </div>
          )
        })()
      )}
    </Section>
  )
}
