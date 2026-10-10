import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isEvidenceLabEnabled } from "@/lib/dev/evidence-lab/guard"
import { layerViews } from "@/lib/dev/evidence-lab/layers"
import { SCENARIOS, buildBundle, buildDemo, runAllScenarios, runScenario, scenarioContext } from "@/lib/dev/evidence-lab/model"
import { SOURCE_SCENARIOS, runAllSourceScenarios, runSourceScenario, sourceContext } from "@/lib/dev/evidence-lab/source"
import { verifyEvidence } from "@/lib/evidence/verify"
import { BundlePanel, HASH_ONLY_LIMIT } from "./_components/bundle-panel"
import { MetricsPanel } from "./_components/metrics-panel"
import { Overview } from "./_components/overview"
import { TABS, href, parseParams } from "./_components/params"
import { SourcePanel } from "./_components/source-panel"
import { TamperPanel } from "./_components/tamper-panel"
import { TradeTrail } from "./_components/trade-trail"
import { Badge, Callout, QLink, Section } from "./_components/ui"
import { VerifierPanel } from "./_components/verifier-panel"

// O título só existe com o guard aberto: a resposta 404 de produção não revela nem o nome da ferramenta.
export function generateMetadata(): Metadata {
  return isEvidenceLabEnabled() ? { title: "Evidence Lab (dev)", robots: { index: false, follow: false } } : {}
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function EvidenceLabPage({ searchParams }: { searchParams: SearchParams }) {
  // 2 de 4 pontos de guard (a página também recusa sozinha; layout e page renderizam em paralelo)
  if (!isEvidenceLabEnabled()) notFound()
  const p = parseParams(await searchParams)
  const demo = buildDemo()
  const ctx = scenarioContext(demo)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-zinc-50">MeuTrade — Evidence Lab</h1>
          <Badge tone="warn">ferramenta de desenvolvimento</Badge>
          <Badge tone="info">dados 100% sintéticos</Badge>
          <Badge>NODE_ENV=development</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Inspeção visual da fundação de dados, das métricas e da Evidence. Tudo que aparece é calculado agora pelas funções reais do domínio sobre um CSV inventado ({demo.rowsRead} linhas → {demo.cycles} ciclos); a página só formata.
        </p>
      </header>
      <nav className="sticky top-0 z-10 mb-6 flex flex-wrap gap-1 border-b border-zinc-800 bg-zinc-950/95 py-2 backdrop-blur">
        {TABS.map((t) => (
          <QLink key={t.id} href={href(p, { tab: t.id })} active={p.tab === t.id}>{t.label}</QLink>
        ))}
      </nav>
      {p.tab === "overview" ? <Overview layers={layerViews(demo, ctx)} /> : null}
      {p.tab === "trade" ? <TradeTrail demo={demo} p={p} /> : null}
      {p.tab === "metrics" ? <MetricsPanel demo={demo} p={p} /> : null}
      {p.tab === "bundle" ? <BundlePanel demo={demo} p={p} /> : null}
      {p.tab === "verify" ? <VerifyTab demo={demo} ctx={ctx} p={p} /> : null}
      {p.tab === "source" ? <SourceTab demo={demo} p={p} /> : null}
      {p.tab === "tamper" ? <TamperPanel runs={runAllScenarios(ctx)} selected={runScenario(ctx, SCENARIOS.find((s) => s.id === p.scenario) ?? SCENARIOS[0])} p={p} /> : null}
    </div>
  )
}

function VerifyTab({ demo, ctx, p }: { demo: ReturnType<typeof buildDemo>; ctx: ReturnType<typeof scenarioContext>; p: ReturnType<typeof parseParams> }) {
  const useBundle = p.scenario === "bundle"
  const built = useBundle ? buildBundle(demo, { metricId: p.metric, view: { pnl: p.pnl, r: p.r }, tradeIdsLimit: p.mode === "hashonly" ? HASH_ONLY_LIMIT : undefined, by: p.by, group: p.group }) : null
  const picker = (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      <span className="mr-1 text-sm text-zinc-400">bundle:</span>
      <QLink href={href(p, { tab: "verify", scenario: "bundle" })} active={useBundle}>o da aba EvidenceBundle ({p.metric}{p.by ? ` por ${p.by}` : ""}{p.mode === "hashonly" ? ", HASH_ONLY" : ""})</QLink>
      {SCENARIOS.map((s) => <QLink key={s.id} href={href(p, { tab: "verify", scenario: s.id })} active={p.scenario === s.id}>{s.title}</QLink>)}
    </div>
  )
  if (useBundle) {
    if (built && !built.ok) return <Section title="Verificador"><Callout tone="bad" title={`explainMetric recusou: ${built.code}`}>{built.message}</Callout></Section>
    const report = verifyEvidence((built as { bundle: unknown }).bundle)
    return <VerifierPanel title="Relatório do bundle da aba EvidenceBundle" report={report} extra={picker} />
  }
  const run = runScenario(ctx, SCENARIOS.find((s) => s.id === p.scenario) ?? SCENARIOS[0])
  return <VerifierPanel title={`Relatório — ${run.scenario.title}`} report={run.report} extra={picker} />
}

function SourceTab({ demo, p }: { demo: ReturnType<typeof buildDemo>; p: ReturnType<typeof parseParams> }) {
  // só calcula quando a aba está aberta (cada cenário reexecuta a ingestão); tudo sintético, nada é persistido
  const sctx = sourceContext(demo)
  const runs = runAllSourceScenarios(sctx)
  const selected = runSourceScenario(sctx, SOURCE_SCENARIOS.find((s) => s.id === p.src) ?? SOURCE_SCENARIOS[0])
  return <SourcePanel runs={runs} selected={selected} p={p} />
}
