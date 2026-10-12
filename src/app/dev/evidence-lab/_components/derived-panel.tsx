// Aba "Derivados (E6)": a Evidence dos derivados do E6.2 (ranking, contribuição, comparação) e o V6. Server Component sem estado.
// Tudo que aparece vem das funções reais: o resultado do E6.2 guardado no bundle, os 8 checks do V6 (verifyEvidence) e o E5b (verifyEvidenceSource).
// A página só formata. Unidades TRADE e LEG nunca se misturam; SKIPPED nunca aparece como aprovado; rótulos de origem não são exibidos.
import { CODE_HELP, DERIVED_GROUP_LABEL, DERIVED_SCENARIOS, LIMITATION_HELP, UNIT_HELP, V6_HELP, redactLabels, type DerivedGroup, type DerivedRun } from "@/lib/dev/evidence-lab/derived"
import type { DerivedEvidence, TradeEvidence } from "@/lib/evidence/schema"
import type { VerifyStatus } from "@/lib/evidence/verify"
import { METRIC_CATALOG, type Cell, type Comparison, type ExitReasonAnalysis, type Fraction, type GroupRanking, type LegGroupRanking } from "@/lib/metrics"
import { href, type LabParams } from "./params"
import { Badge, Callout, Hash, Json, Kv, Panel, QLink, Section, Table, Td, checkTone, sourceStatusTone, statusTone, type Tone } from "./ui"
import { ReportSummary } from "./verifier-panel"

const conf = (c: string | null): Tone => (c === "OK" ? "ok" : c === "LIMITED" ? "warn" : c === "UNRELIABLE" ? "bad" : "mute")
const unitTone = (u: string): Tone => (u === "LEG" ? "info" : u === "TRADE" ? "ok" : "warn")

export const VERDICT_EXPLAIN: Record<VerifyStatus, { title: string; tone: Tone; text: string }> = {
  VALID: { title: "Resultado REPRODUZIDO", tone: "ok", text: "A função real do E6.2, rodada de novo sobre os trades do bundle, produz exatamente este resultado, e hashes e referências fecham. Não prova a origem do CSV (E5b), nem que a seleção original foi correta, e o selo não é assinatura. VALID não diz que o resultado é CONFIÁVEL: isso é a confiança e as limitações abaixo." },
  TAMPERED: { title: "Resultado ADULTERADO (inconsistência detectada)", tone: "bad", text: "Pelo menos um check FALHOU: o resultado, o resumo, uma referência ou o selo não correspondem ao recálculo. Algo foi alterado ou gerado de forma incoerente." },
  UNVERIFIABLE: { title: "Resultado NÃO VERIFICÁVEL", tone: "warn", text: "Nada acusou adulteração, mas algo obrigatório não pôde ser recalculado (população acima do limite, versão incompatível, dimensão sem referência). Isso NÃO é aprovação." },
  INVALID_FORMAT: { title: "Formato inválido", tone: "info", text: "O bundle não tem a forma do contrato evidence/1: nada além do formato foi executado." },
}

/** Valor de uma célula do E6.2: número, ou 'indisponível' com o motivo (nunca zero), mais a cobertura. */
function C({ c }: { c: Cell | undefined }) {
  if (!c) return <span className="text-zinc-500">—</span>
  const cov = c.coverage.total > 0 ? ` ${c.coverage.used}/${c.coverage.total}` : ""
  return c.available && c.value !== null ? (
    <span className="font-mono tabular-nums">{c.value}<span className="ml-1 text-[10px] text-zinc-500" title="cobertura: usados/total">{cov}</span></span>
  ) : (
    <span className="font-mono text-xs text-amber-300" title="valor indisponível — não é zero">indisponível{c.reason ? ` (${c.reason})` : ""}</span>
  )
}
function F({ f }: { f: Fraction | undefined }) {
  if (!f) return <span className="text-zinc-500">—</span>
  return f.value === null ? <span className="font-mono text-xs text-amber-300" title="fração indisponível — não é zero">n/d ({f.reason})</span> : <span className="font-mono tabular-nums" title={f.reason ?? undefined}>{f.value}{f.reason ? "*" : ""}</span>
}
const Lims = ({ xs }: { xs: string[] }) => (xs.length === 0 ? <span className="text-zinc-500">nenhuma</span> : <span className="flex flex-wrap gap-1">{xs.map((l) => <Badge key={l} tone="warn" title={LIMITATION_HELP[l] ?? l}>{l}</Badge>)}</span>)
const keyText = (k: { label: string }) => k.label

function GroupRows({ r }: { r: GroupRanking }) {
  return (
    <Table head={["posição", "grupo", "amostra (trades)", "flag", `${r.metric.label} (${r.metric.unit})`, "líquido", "contrib. total", "contrib. recorte", "% dos trades", "saída (trades UNKNOWN · MIXED)", "reconc. perna×trade", "confiança", "limitações"]}>
      {r.rows.map((x, i) => (
        <tr key={i}>
          <Td mono>{x.rank ?? <span className="text-zinc-500" title="sem posição: amostra minúscula ou valor indisponível (listado, não descartado)">—</span>}{x.tiedWithPrevious ? " =" : ""}</Td>
          <Td>{keyText(x.key)}{x.unknownGroup ? <Badge tone="warn"> desconhecido</Badge> : null}</Td>
          <Td mono>{x.sampleSize}</Td>
          <Td><Badge tone={x.sampleFlag === "OK" ? "ok" : x.sampleFlag === "LOW" ? "warn" : "bad"}>{x.sampleFlag}</Badge></Td>
          <Td><C c={x.value} /></Td>
          <Td><C c={x.net} /></Td>
          <Td><F f={x.contributionToTotal} /></Td>
          <Td><F f={x.contributionToSubset} /></Td>
          <Td><F f={x.shareOfTrades} /></Td>
          <Td mono>{x.exit.tradesByBucket.UNKNOWN} · {x.exit.tradesByBucket.MIXED}</Td>
          <Td><Badge tone={x.exit.reconciliation.status === "DIVERGENT" ? "bad" : x.exit.reconciliation.status === "FULL" ? "ok" : "warn"}>{x.exit.reconciliation.status}</Badge></Td>
          <Td><Badge tone={conf(x.confidence)}>{x.confidence}</Badge></Td>
          <Td><Lims xs={x.limitations} /></Td>
        </tr>
      ))}
    </Table>
  )
}

function ComparisonView({ r }: { r: Comparison }) {
  return (
    <>
      <div className="mb-3 grid gap-2 md:grid-cols-2">
        {([["A", r.a], ["B", r.b]] as const).map(([k, s]) => (
          <Panel key={k} className="!p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">lado {k}</Badge>
              <span className="text-sm text-zinc-100">{s.key ? s.key.label : s.period ? `${s.period.from} → ${s.period.to}` : "—"}</span>
              <Badge tone={s.sampleFlag === "OK" ? "ok" : s.sampleFlag === "LOW" ? "warn" : "bad"}>{s.sampleFlag}</Badge>
              <span className="text-xs text-zinc-400">amostra {s.sampleSize} ({r.unit === "LEG" ? "pernas" : "trades"})</span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">tradeSetHash <Hash value={s.tradeSetHash} /></div>
          </Panel>
        ))}
      </div>
      <Table head={["métrica", "A", "B", "delta (B − A)", "razão (B ÷ A)", "comparável", "conclusivo*"]}>
        {r.metrics.map((m) => (
          <tr key={m.metric}>
            <Td mono>{m.metric}</Td>
            <Td><C c={m.a} /></Td>
            <Td><C c={m.b} /></Td>
            <Td mono>{m.delta ?? <span className="text-amber-300">n/d</span>}</Td>
            <Td mono>{m.ratio ?? <span className="text-amber-300" title={m.reason ?? undefined}>n/d{m.reason ? ` (${m.reason})` : ""}</span>}</Td>
            <Td>{m.comparable ? <Badge tone="ok">sim</Badge> : <Badge tone="warn" title={m.reason ?? undefined}>{m.reason ?? "não"}</Badge>}</Td>
            <Td>{m.conclusive ? <Badge tone="ok">sim</Badge> : <Badge tone="mute">não</Badge>}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-zinc-500">* “conclusivo” = amostra OK e cobertura completa nos dois lados. É descritivo: <b>não é significância estatística</b> (sem p-valor).</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><Badge tone={conf(r.confidence)}>{r.confidence}</Badge><Lims xs={r.limitations} /></div>
    </>
  )
}

function AnalysisView({ r }: { r: ExitReasonAnalysis }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="info">UNIDADE: PERNA (LEG)</Badge><span className="text-xs text-zinc-400">{UNIT_HELP.LEG} {r.legs.total.legs} perna(s) no total. MIXED não existe por perna.</span></div>
        <Table head={["posição", "motivo", "pernas", "contratos", "flag", "líquido (pernas)", "bruto", "comissão", "contrib. ao líquido das pernas", "UNKNOWN? limitações", "confiança"]}>
          {r.legs.rows.map((x) => (
            <tr key={x.reason}>
              <Td mono>{x.rank ?? "—"}</Td>
              <Td>{x.label}</Td>
              <Td mono>{x.legs}</Td>
              <Td mono>{x.quantity}</Td>
              <Td><Badge tone={x.sampleFlag === "OK" ? "ok" : x.sampleFlag === "LOW" ? "warn" : "bad"}>{x.sampleFlag}</Badge></Td>
              <Td><C c={x.net} /></Td>
              <Td><C c={x.gross} /></Td>
              <Td><C c={x.commission} /></Td>
              <Td><F f={x.contributionToLegNet} /></Td>
              <Td><Lims xs={x.limitations} /></Td>
              <Td><Badge tone={conf(x.confidence)}>{x.confidence}</Badge></Td>
            </tr>
          ))}
        </Table>
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="ok">UNIDADE: TRADE COMPLETO</Badge><span className="text-xs text-zinc-400">{UNIT_HELP.TRADE} Cinco buckets sempre presentes; o P&L de um trade MIXED fica em MIXED, nunca num motivo de perna.</span></div>
        <Table head={["bucket", "trades", "flag", "líquido (trade)", "R total", "R médio", "contrib. ao líquido", "confiança", "limitações"]}>
          {r.trades.rows.map((x) => (
            <tr key={x.bucket}>
              <Td>{x.label}</Td>
              <Td mono>{x.trades}</Td>
              <Td><Badge tone={x.sampleFlag === "OK" ? "ok" : x.sampleFlag === "LOW" ? "warn" : "bad"}>{x.sampleFlag}</Badge></Td>
              <Td><C c={x.net} /></Td>
              <Td><C c={x.totalR} /></Td>
              <Td><C c={x.averageR} /></Td>
              <Td><F f={x.contributionToTotalNet} /></Td>
              <Td><Badge tone={conf(x.confidence)}>{x.confidence}</Badge></Td>
              <Td><Lims xs={x.limitations} /></Td>
            </tr>
          ))}
        </Table>
      </div>
      <Panel className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-300">Reconciliação perna × trade (líquido):</span>
          <Badge tone={r.reconciliation.status === "DIVERGENT" ? "bad" : r.reconciliation.status === "FULL" ? "ok" : "warn"}>{r.reconciliation.status}</Badge>
          <span className="text-xs text-zinc-400">conciliados {r.reconciliation.net.reconciled} · divergentes {r.reconciliation.net.divergent} · não comparáveis {r.reconciliation.net.notComparable} · pernas UNKNOWN {r.reconciliation.unknownLegs} ({r.reconciliation.unknownLegsShare ?? "n/d"}) · trades sem pernas {r.reconciliation.tradesWithoutLegs}</span>
        </div>
        {r.reconciliation.status === "DIVERGENT" ? <p className="mt-1 text-xs text-rose-300">Existe divergência: nenhum resultado por motivo de saída deve ser lido como plenamente reconciliado.</p> : null}
      </Panel>
    </div>
  )
}

function LegRankView({ r }: { r: LegGroupRanking }) {
  return (
    <>
      <p className="mb-1 text-xs text-zinc-400">Pernas de motivo <b>{r.reason}</b> por grupo — {r.reasonTotal.legs} perna(s); ordem {r.order === "ASC" ? "da maior perda para a menor" : "do maior ganho para o menor"}.</p>
      <Table head={["posição", "grupo", "pernas do motivo", "pernas do grupo", "flag", "líquido (pernas)", "contrib. ao motivo", "UNKNOWN no grupo", "reconc. perna×trade", "confiança", "limitações"]}>
        {r.rows.map((x, i) => (
          <tr key={i}>
            <Td mono>{x.rank ?? "—"}{x.tiedWithPrevious ? " =" : ""}</Td>
            <Td>{keyText(x.key)}</Td>
            <Td mono>{x.legs}</Td>
            <Td mono>{x.groupLegs}</Td>
            <Td><Badge tone={x.sampleFlag === "OK" ? "ok" : x.sampleFlag === "LOW" ? "warn" : "bad"}>{x.sampleFlag}</Badge></Td>
            <Td><C c={x.net} /></Td>
            <Td><F f={x.contributionToReasonNet} /></Td>
            <Td mono>{x.unknownLegsShareInGroup ?? "n/d"}</Td>
            <Td><Badge tone={x.reconciliation.status === "DIVERGENT" ? "bad" : x.reconciliation.status === "FULL" ? "ok" : "warn"}>{x.reconciliation.status}</Badge></Td>
            <Td><Badge tone={conf(x.confidence)}>{x.confidence}</Badge></Td>
            <Td><Lims xs={x.limitations} /></Td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function ResultView({ d }: { d: DerivedEvidence }) {
  const r = d.result as unknown
  switch (d.analysis.op) {
    case "GROUP_RANKING": return <GroupRows r={r as GroupRanking} />
    case "GROUP_COMPARISON":
    case "PERIOD_COMPARISON":
    case "EXIT_REASON_COMPARISON_LEGS":
    case "EXIT_REASON_COMPARISON_TRADES": return <ComparisonView r={r as Comparison} />
    case "EXIT_REASON_ANALYSIS": return <AnalysisView r={r as ExitReasonAnalysis} />
    case "LEG_GROUP_RANKING": return <LegRankView r={r as LegGroupRanking} />
  }
}

const legSummary = (t: TradeEvidence) => {
  const m = new Map<string, number>()
  for (const l of t.exitLegs ?? []) m.set(l.reason, (m.get(l.reason) ?? 0) + 1)
  return m.size === 0 ? "sem pernas (trade-linha)" : [...m].map(([k, n]) => `${k}×${n}`).join(" ")
}

function Origin({ run, p }: { run: DerivedRun; p: LabParams }) {
  const b = run.parsed
  const d = b?.evidence.derived?.[0]
  if (!b || !d) return null
  const trades = b.evidence.trades
  const open = p.dvt >= 0 && p.dvt < trades.length ? trades[p.dvt] : null
  const metricIds = [...new Set([...(typeof d.query.args.metric === "string" ? [d.query.args.metric] : []), ...(Array.isArray(d.query.args.metrics) ? (d.query.args.metrics as string[]) : []), ...(d.analysis.op === "EXIT_REASON_ANALYSIS" ? ["netPnl", "grossPnl", "totalR", "averageR"] : [])])]
  return (
    <Section title="Do derivado até as evidências de origem" subtitle="Os trades abaixo são os TradeEvidence que sustentam a população do derivado (o V6 refaz o cálculo a partir deles). Abra um para ver suas pernas, linhas de origem e valores. Rótulos de origem não são exibidos.">
      {metricIds.length > 0 ? (
        <p className="mb-2 text-xs text-zinc-400">Métricas utilizadas: {metricIds.map((id) => { const m = METRIC_CATALOG.find((x) => x.id === id); return <span key={id} className="mr-2" title={m ? `${m.formula} — requer: ${m.requires}` : undefined}><Badge>{id}</Badge> {m?.label}</span> })}</p>
      ) : null}
      {d.verifiability === "HASH_ONLY" ? (
        <Callout tone="warn" title="HASH_ONLY: nenhum trade no bundle">A população foi sumarizada só pelo tradeSetHash <Hash value={d.population.tradeSetHash} />. Não há trades nem pernas para navegar — e o verificador não finge que há.</Callout>
      ) : (
        <>
          <Table head={["#", "tradeId", "conta (ref)", "granularidade", "direção", "qtd", "pernas de saída (motivo×n)", "líquido do trade", "linhas de origem", ""]}>
            {trades.map((t, i) => (
              <tr key={t.tradeId} className={i === p.dvt ? "bg-zinc-800/60" : ""}>
                <Td mono>{i}</Td>
                <Td><Hash value={t.tradeId} n={16} /></Td>
                <Td><Hash value={t.accountRef} n={14} /></Td>
                <Td mono>{t.granularity}</Td>
                <Td mono>{t.direction}</Td>
                <Td mono>{t.quantity}</Td>
                <Td mono>{legSummary(t)}</Td>
                <Td mono>{t.pnl.net ?? "null"}</Td>
                <Td mono>{t.sourceRows.map((r) => r.rowNo).join(",")}</Td>
                <Td><QLink href={href(p, { tab: "derived", dvt: i === p.dvt ? -1 : i })} active={i === p.dvt}>{i === p.dvt ? "fechar" : "abrir"}</QLink></Td>
              </tr>
            ))}
          </Table>
          {open ? (
            <div className="mt-3 space-y-2">
              {(open.exitLegs ?? []).length > 0 ? (
                <Table head={["perna", "papel", "qtd", "motivo", "regra", "líquido (perna)", "bruto (perna)", "linhas"]}>
                  {(open.exitLegs ?? []).map((l, i) => (
                    <tr key={i}>
                      <Td mono>{i}</Td><Td mono>{l.role}</Td><Td mono>{l.quantity}</Td>
                      <Td><Badge tone={l.reason === "UNKNOWN" ? "warn" : "info"}>{l.reason}</Badge></Td>
                      <Td mono>{l.reasonRule}</Td><Td mono>{l.pnl.net ?? "null"}</Td><Td mono>{l.pnl.gross ?? "null"}</Td><Td mono>{l.rowRefs.join(",")}</Td>
                    </tr>
                  ))}
                </Table>
              ) : null}
              <Json value={redactLabels(open)} label={`TradeEvidence #${p.dvt} (JSON; rótulos de origem omitidos)`} />
            </div>
          ) : null}
        </>
      )}
      {d.refs.legs.applicable ? (
        <p className="mt-2 text-xs text-zinc-400">Pernas citadas pelo derivado: {d.refs.legs.items === null ? "acima do limite (vale o legSetHash do resultado)" : `${d.refs.legs.items.length} (tradeId · índice · linhas) — conferidas no V6.refs`}.</p>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Esta operação é só de trades: não cita pernas.</p>
      )}
    </Section>
  )
}

export function DerivedPanel({ runs, selected, p, cycles, rows }: { runs: DerivedRun[]; selected: DerivedRun; p: LabParams; cycles: number; rows: number }) {
  const s = selected
  const d = s.parsed?.evidence.derived?.[0]
  const v = VERDICT_EXPLAIN[s.report.status]
  const v6 = s.report.checks.filter((c) => c.level === "V6")
  const groups: DerivedGroup[] = ["integro", "adulteracao", "limite"]
  return (
    <>
      <Section title="Derivados de análise (E6) — Evidence e verificação V6" subtitle={`Cada cenário gera um bundle de DerivedEvidence com as funções reais (E6.2 + explainDerived + selo) sobre um CSV sintético próprio (${rows} linhas → ${cycles} ciclos, com saídas de alvo, stop, manual, mistas e de rótulo desconhecido) e o verifica de verdade (V0–V6 e E5b). Nada é JSON estático; nenhuma fixture real.`}>
        <Callout tone="mute" title="Como ler">
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li><b>Reproduzido</b> (VALID) ≠ <b>confiável</b>: a confiança (OK / LIMITED / UNRELIABLE) e as limitações dizem se a AMOSTRA e a COBERTURA sustentam uma leitura. Nenhuma delas é significância estatística.</li>
            <li><b>Adulterado</b> (TAMPERED) = inconsistência detectada. <b>Não verificável</b> (UNVERIFIABLE) = faltou o que recalcular; nunca é aprovação.</li>
            <li>A verificação de origem (E5b) é independente: liga os trades ao CSV, não o resultado do derivado.</li>
          </ul>
        </Callout>
        <div className="mt-3 space-y-2">
          {groups.map((g) => (
            <div key={g} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 w-56 text-xs uppercase tracking-wide text-zinc-500">{DERIVED_GROUP_LABEL[g]}</span>
              {DERIVED_SCENARIOS.filter((x) => x.group === g).map((x) => {
                const run = runs.find((r) => r.scenario.id === x.id)
                return <QLink key={x.id} href={href(p, { tab: "derived", dv: x.id, dvt: -1 })} active={p.dv === x.id}>{x.title}{run && !run.matchesContract ? " ⚠" : ""}</QLink>
              })}
            </div>
          ))}
        </div>
      </Section>

      <Section title={s.scenario.title} subtitle={s.scenario.what}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(s.report.status)}>{s.report.status}</Badge>
          <span className="text-sm text-zinc-200">{v.title}</span>
          <Badge tone={s.matchesContract ? "ok" : "bad"} title="O veredito mostrado é o devolvido por verifyEvidence; aqui só se confere com o que o contrato prevê.">{s.matchesContract ? `previsto: ${s.scenario.expected}` : `DIVERGE do contrato (previsto ${s.scenario.expected})`}</Badge>
          {d ? <Badge tone="info">E5b: {s.source.status}</Badge> : null}
        </div>
        <Callout tone={v.tone} title={v.title}>{v.text}</Callout>
        <p className="mt-2 text-xs text-zinc-400">{s.scenario.expectedNote}</p>
      </Section>

      {d ? (
        <>
          <Section title="Identidade e consulta" subtitle="O que foi perguntado, sobre qual população e com que versões.">
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel>
                <Kv rows={[
                  ["operação", <span key="o" className="font-mono">{d.analysis.op}</span>],
                  ["unidade", <span key="u"><Badge tone={unitTone(d.analysis.unit)}>{d.analysis.unit}</Badge> <span className="text-xs text-zinc-400">{UNIT_HELP[d.analysis.unit]}</span></span>],
                  ["derivedId", <Hash key="i" value={d.derivedId} n={20} />],
                  ["evidenceHash (selo)", <Hash key="h" value={s.parsed?.evidenceHash} n={16} />],
                  ["tradeSetHash (população)", <Hash key="t" value={d.population.tradeSetHash} n={16} />],
                  ["contrato / motor", `${d.analysis.schema} v${d.analysis.definitionVersion} · ${d.analysis.engineVersion}`],
                  ["verificabilidade", <Badge key="v" tone={d.verifiability === "FULL" ? "ok" : "warn"}>{d.verifiability}</Badge>],
                  ["população declarada", `${d.population.afterFilters} trade(s)${d.population.tradeIds ? ` (${d.population.tradeIds.length} listados)` : " — só o hash"}`],
                ]} />
              </Panel>
              <Panel>
                <Kv rows={[
                  ["dimensões / argumentos", <span key="a" className="font-mono text-xs">{JSON.stringify(d.query.args)}</span>],
                  ["filtros (refs, nunca nomes)", <span key="f" className="font-mono text-xs">{JSON.stringify(d.query.filters)}</span>],
                  ["opções", <span key="op" className="font-mono text-xs">{JSON.stringify(d.query.options)}</span>],
                  ["período", d.analysis.op === "PERIOD_COMPARISON" ? <span key="p" className="font-mono text-xs">{JSON.stringify({ A: d.query.args.a, B: d.query.args.b })}</span> : "toda a população declarada"],
                ]} />
              </Panel>
            </div>
          </Section>

          <Section title="Resultado" subtitle="Exatamente o que o E6.2 produziu (e que o V6 recalcula). Valor indisponível aparece como 'indisponível' com o motivo — nunca como zero. Posição só existe para grupo com valor e amostra suficiente; os demais ficam listados.">
            <ResultView d={d} />
          </Section>

          <Section title="Confiança, cobertura e limitações (do resumo declarado)" subtitle="Isto descreve se a amostra e a cobertura sustentam uma leitura. É independente de o resultado ter sido reproduzido.">
            <Panel>
              <Kv rows={[
                ["confiança (pior caso)", d.summary.confidence ? <Badge key="c" tone={conf(d.summary.confidence)}>{d.summary.confidence}</Badge> : "—"],
                ["reconciliação perna × trade", d.summary.reconciliation ? <Badge key="r" tone={d.summary.reconciliation === "DIVERGENT" ? "bad" : d.summary.reconciliation === "FULL" ? "ok" : "warn"}>{d.summary.reconciliation}</Badge> : "não se aplica (só trades)"],
                ["inferência", <Badge key="i" tone="mute">{d.summary.inference}</Badge>],
                ["limitações", d.summary.limitations.length === 0 ? "nenhuma" : <ul key="l" className="space-y-0.5 text-xs">{d.summary.limitations.map((l) => <li key={l}><Badge tone="warn">{l}</Badge> {LIMITATION_HELP[l] ?? ""}</li>)}</ul>],
              ]} />
              <p className="mt-2 text-xs text-zinc-500">UNRELIABLE = sem base para conclusão comparativa confiável (não quer dizer que os dados de origem sejam falsos). OK não é significância estatística.</p>
            </Panel>
          </Section>

          <Origin run={s} p={p} />
        </>
      ) : (
        <Callout tone="bad" title="Bundle fora do schema evidence/1">O bundle deste cenário não passa no schema estrito; o V0 acusa. Veja o relatório abaixo.</Callout>
      )}

      <Section title="V6 — verificação dos derivados" subtitle="Os 8 checks do V6 sobre este bundle (verifyEvidence). O V6 reexecuta a função real do E6.2 sobre os TradeEvidence do bundle e compara. SKIPPED nunca é aprovação.">
        <div className="mb-3"><ReportSummary report={s.report} /></div>
        <Table head={["check", "o que confere", "status", "código", "explicação do relatório"]}>
          {v6.map((c) => (
            <tr key={c.id} className={c.status === "FAIL" ? "bg-rose-500/5" : ""}>
              <Td><span className="font-mono text-xs text-zinc-100">{c.id}</span></Td>
              <Td className="max-w-xs text-xs text-zinc-400">{V6_HELP[c.id]}</Td>
              <Td><Badge tone={checkTone(c.status)}>{c.status === "SKIPPED" ? "SKIPPED (não verificado)" : c.status}</Badge></Td>
              <Td><span className="font-mono text-xs">{c.code ?? "—"}</span>{c.code && CODE_HELP[c.code] ? <span className="block max-w-xs text-[11px] text-zinc-500">{CODE_HELP[c.code]}</span> : null}</Td>
              <Td className="max-w-xl text-zinc-300">{c.detail}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-zinc-500">Os checks V0–V4 do mesmo relatório ficam na aba Verificador; aqui só os do V6.</p>
        <Callout tone="mute" title="O que nem VALID afirma (limitations do relatório)">
          <ul className="list-disc space-y-1 pl-5">{s.report.limitations.map((l) => <li key={l.code}><span className="font-mono text-xs">{l.code}</span> — {l.text}</li>)}</ul>
        </Callout>
      </Section>

      <Section title="Origem (E5b) deste derivado" subtitle="verifyEvidenceSource sobre o MESMO bundle e o CSV sintético (que fica no servidor). Verifica os trades DECLARADOS contra o arquivo; não prova a seleção original nem que a população é a importação inteira.">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={sourceStatusTone(s.source.status)}>{s.source.status}</Badge>
          {s.source.coverage ? <span className="text-xs text-zinc-400">trades declarados {s.source.coverage.derived.trades.declared} · no bundle {s.source.coverage.derived.trades.inBundle} · conferidos {s.source.coverage.derived.trades.verified} · pernas citadas conferidas {s.source.coverage.derived.legRefs.verified}/{s.source.coverage.derived.legRefs.declared} · população {s.source.coverage.populations.complete ? "declarada completa" : "NÃO completa"}</span> : null}
        </div>
        <Table head={["check", "status", "código", "explicação"]}>
          {s.source.checks.map((c) => (
            <tr key={c.id}>
              <Td mono>{c.id}</Td>
              <Td><Badge tone={checkTone(c.status)}>{c.status === "SKIPPED" ? "SKIPPED (não verificado)" : c.status}</Badge></Td>
              <Td mono>{c.code ?? "—"}</Td>
              <Td className="max-w-xl text-zinc-300">{c.detail}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="JSON" subtitle="Rótulos de origem (sourceLabel, entryLabel, exitLabel) omitidos nesta tela; o bundle real os mantém nos TradeEvidence porque o E5b depende deles (pendência registrada antes de qualquer integração com o agente).">
        <Json value={redactLabels(s.parsed ?? s.bundle)} label="Bundle completo (JSON, rótulos omitidos)" />
      </Section>
    </>
  )
}
