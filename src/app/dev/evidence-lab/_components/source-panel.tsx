// Aba "Origem (E5b)": a ligação do bundle ao CSV original, em 9 passos. Server Component sem estado.
// Os estados e cada PASS/FAIL/SKIPPED vêm de `verifyEvidenceSource` (e `verifyEvidence`); as tabelas só alinham valores que o pipeline real
// produziu ("declarado" × "reingestão"). Nada aqui verifica nada por conta própria e nenhum byte de CSV é impresso.
import type { SourceRun } from "@/lib/dev/evidence-lab/source"
import { SOURCE_SCENARIOS } from "@/lib/dev/evidence-lab/source"
import { SOURCE_CHECK_CATALOG, type SourceCheck, type SourceStatus, type SourceVerifyReport } from "@/lib/evidence/verify-source"
import { href, type LabParams } from "./params"
import { Badge, Callout, Hash, Json, Kv, Panel, QLink, SoloVerdictCallout, Section, Table, Td, checkTone, statusTone, sourceStatusTone } from "./ui"
import { ReportSummary } from "./verifier-panel"

export const SOURCE_STATUS_EXPLAIN: Record<SourceStatus, { title: string; text: string }> = {
  SOURCE_VERIFIED: {
    title: "Origem conferida",
    text: "Tudo o que está no bundle confere com o arquivo (SHA-256, importId, rowHash, tradeId e valores derivados do arquivo) e TODA população declarada está listada. Não prova a seleção original, a ordem original da sequência nem o R/stop do usuário.",
  },
  SOURCE_VERIFIED_PARTIAL: {
    title: "Origem conferida — só o que está presente",
    text: "As referências que ESTÃO no bundle (por exemplo, as âncoras de uma população HASH_ONLY) conferem com o arquivo. A população completa NÃO está no bundle e NÃO foi conferida: este estado nunca significa 'toda a população verificada'.",
  },
  SOURCE_MISMATCH: {
    title: "Divergência de origem",
    text: "Algo que o bundle afirma contradiz o arquivo (ou o arquivo entregue não é o do import): SHA-256, importId, rowHash, tradeId ou valores. Pelo menos um check FALHOU.",
  },
  UNVERIFIABLE: {
    title: "Não verificável",
    text: "Nada acusou divergência, mas faltou o que é preciso para conferir: arquivo não fornecido, versão ou contexto incompatível, sal ausente, encoding. Indisponibilidade de dados NÃO é adulteração e NÃO é sucesso.",
  },
  INVALID_FORMAT: {
    title: "Formato inválido",
    text: "A entrada não é um EvidenceBundle evidence/1 legível: nem dá para saber a que arquivo ele se refere.",
  },
}

const TITLES = new Map(SOURCE_CHECK_CATALOG.map((c) => [c.id, c.title]))
const checkOf = (r: SourceVerifyReport, id: string): SourceCheck => r.checks.find((c) => c.id === id) as SourceCheck
const short = (h: string | null | undefined) => (h ? `${h.slice(0, 12)}…` : "—")

function StatusLegend({ current }: { current: SourceStatus }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {(Object.keys(SOURCE_STATUS_EXPLAIN) as SourceStatus[]).map((s) => (
        <Panel key={s} className={`!p-3 ${s === current ? "ring-1 ring-zinc-300" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={sourceStatusTone(s)}>{s}</Badge>
            <span className="text-xs text-zinc-400">{SOURCE_STATUS_EXPLAIN[s].title}</span>
            {s === current ? <Badge tone="info">estado deste cenário</Badge> : null}
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">{SOURCE_STATUS_EXPLAIN[s].text}</p>
        </Panel>
      ))}
    </div>
  )
}

function Step({ n, title, check, children }: { n: number; title: string; check?: SourceCheck; children: React.ReactNode }) {
  return (
    <Panel>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-zinc-500">passo {n}</span>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {check ? <Badge tone={checkTone(check.status)}>{check.id} · {check.status}{check.code ? ` · ${check.code}` : ""}</Badge> : null}
      </div>
      {children}
      {check ? <p className="mt-2 text-xs text-zinc-400">{check.detail}</p> : null}
    </Panel>
  )
}

const Eq = ({ ok }: { ok: boolean }) => (ok ? <span className="text-emerald-400">=</span> : <span className="text-rose-400">≠</span>)

export function SourceDetail({ run }: { run: SourceRun }) {
  const { report, bundle, file, reingestion: re } = run
  const b = bundle as { evidenceHash?: string; subject?: { id: string }; evidence?: { imports: Array<Record<string, unknown>>; trades: Array<{ tradeId: string; granularity: string; sourceRows: Array<{ rowNo: number; rowHash: string | null }> }>; metrics: Array<{ verifiability: string; metricId: string; population: { afterFilters: number } }> } }
  const imp = b.evidence?.imports?.[0] as { importId?: string; fileSha256?: string; fileBytes?: number; hasBom?: boolean; lineEnding?: string; parserId?: string; parserVersion?: string; rowsRead?: number; rowsAccepted?: number; reproducibility?: unknown } | undefined
  const trades = b.evidence?.trades ?? []
  const metrics = b.evidence?.metrics ?? []
  const rowRefs = trades.flatMap((t) => t.sourceRows.map((r) => ({ tradeId: t.tradeId, ...r })))
  const hashOnly = metrics.some((m) => m.verifiability === "HASH_ONLY")
  const cov = report.coverage

  return (
    <div className="space-y-4">
      <Step n={1} title="EvidenceBundle selecionado">
        <Kv
          rows={[
            ["assunto", <span key="a" className="font-mono text-xs">{b.subject?.id ?? "—"}</span>],
            ["evidenceHash (selo)", <Hash key="b" value={b.evidenceHash} n={20} />],
            ["imports / trades / métricas", `${b.evidence?.imports?.length ?? 0} / ${trades.length} / ${metrics.length}`],
            ["população", metrics.length === 0 ? "—" : hashOnly ? <span key="c"><Badge tone="warn">HASH_ONLY</Badge> só o tradeSetHash e as âncoras estão no bundle</span> : <span key="c"><Badge tone="ok">FULL</Badge> {metrics[0]?.population.afterFilters} trade(s) listados</span>],
            ["contexto reproduzível no ImportRef", imp ? (imp.reproducibility ? <Badge key="d" tone="ok">registrado</Badge> : <Badge key="d" tone="warn">import anterior ao registro</Badge>) : "—"],
            ["verifyEvidence (V0–V4), independente", <span key="e"><Badge tone={statusTone(run.verify.status)}>{run.verify.status}</Badge> <span className="text-xs text-zinc-500">consistência interna e métricas; não lê o arquivo</span></span>],
          ]}
        />
      </Step>

      <Step n={2} title="Arquivo de origem sintético (só metadados; os bytes nunca são exibidos)">
        {file.provided && file.facts ? (
          <Kv
            rows={[
              ["tamanho", `${file.facts.bytes} bytes`],
              ["SHA-256 dos bytes", <Hash key="a" value={file.facts.sha256} n={20} />],
              ["BOM", file.facts.hasBom ? "sim" : "não"],
              ["quebra de linha", file.facts.lineEnding],
            ]}
          />
        ) : file.provided ? (
          <span className="text-sm text-amber-300">arquivo entregue, mas não é UTF-8 válido</span>
        ) : (
          <span className="text-sm text-amber-300">nenhum arquivo foi entregue ao verificador</span>
        )}
      </Step>

      <Step n={3} title="Verificação do SHA-256" check={checkOf(report, "V5.file")}>
        <Table head={["", "registrado no bundle", "calculado dos bytes", ""]}>
          {[
            ["SHA-256", short(imp?.fileSha256), short(file.facts?.sha256), imp?.fileSha256 === file.facts?.sha256],
            ["tamanho (bytes)", String(imp?.fileBytes ?? "—"), String(file.facts?.bytes ?? "—"), imp?.fileBytes === file.facts?.bytes],
            ["BOM", String(imp?.hasBom ?? "—"), String(file.facts?.hasBom ?? "—"), imp?.hasBom === file.facts?.hasBom],
            ["quebra de linha", String(imp?.lineEnding ?? "—"), String(file.facts?.lineEnding ?? "—"), imp?.lineEnding === file.facts?.lineEnding],
          ].map(([k, a, c, ok]) => (
            <tr key={String(k)}><Td>{String(k)}</Td><Td mono>{String(a)}</Td><Td mono>{String(c)}</Td><Td>{file.facts ? <Eq ok={Boolean(ok)} /> : "—"}</Td></tr>
          ))}
        </Table>
      </Step>

      <Step n={4} title="Reexecução da ingestão (o MESMO pipeline, com o contexto registrado no ImportRef)" check={checkOf(report, "V5.context")}>
        {re ? (
          <Kv
            rows={[
              ["parser", re.parser],
              ["linhas lidas / aceitas / rejeitadas", `${re.rowsRead} / ${re.rowsAccepted} / ${re.rowsRejected}`],
              ["trades produzidos (ciclos)", String(re.tradesProduced)],
              ["registrado no bundle", imp ? `${imp.parserId}@${imp.parserVersion} · ${imp.rowsRead} lidas / ${imp.rowsAccepted} aceitas` : "—"],
            ]}
          />
        ) : (
          <span className="text-sm text-amber-300">a reingestão não foi executada neste cenário (ver o motivo abaixo)</span>
        )}
      </Step>

      <Step n={5} title="Comparação de importId" check={checkOf(report, "V5.import-id")}>
        {re ? (
          <Table head={["", "importId", ""]}>
            <tr><Td>declarado no bundle</Td><Td mono><Hash value={imp?.importId} n={24} /></Td><Td /></tr>
            <tr><Td>reconstruído pela reingestão</Td><Td mono><Hash value={re.importId} n={24} /></Td><Td><Eq ok={re.importId === imp?.importId} /></Td></tr>
          </Table>
        ) : <span className="text-sm text-zinc-500">sem reingestão para comparar</span>}
      </Step>

      <Step n={6} title="Comparação de rowHash" check={checkOf(report, "V5.rows")}>
        {re && rowRefs.length > 0 ? (
          <Table head={["linha", "trade", "rowHash declarado", "rowHash reingerido", ""]}>
            {rowRefs.slice(0, 40).map((r, i) => {
              const have = re.rowHashes[r.rowNo]
              return (
                <tr key={`${r.tradeId}-${r.rowNo}-${i}`}>
                  <Td mono>{r.rowNo}</Td>
                  <Td><Hash value={r.tradeId} n={14} /></Td>
                  <Td mono>{short(r.rowHash)}</Td>
                  <Td mono>{have ? short(have) : "linha inexistente"}</Td>
                  <Td><Eq ok={!!have && have === r.rowHash} /></Td>
                </tr>
              )
            })}
          </Table>
        ) : <span className="text-sm text-zinc-500">{re ? "o bundle não cita linhas" : "sem reingestão para comparar"}</span>}
        {rowRefs.length > 40 ? <p className="mt-1 text-xs text-zinc-500">mostrando 40 de {rowRefs.length} referências</p> : null}
      </Step>

      <Step n={7} title="Comparação de tradeId (SOURCE_ROW e ciclos)" check={checkOf(report, "V5.trades")}>
        {re && trades.length > 0 ? (
          <Table head={["tradeId declarado", "granularidade", "linhas de origem", "produzido pela reingestão?"]}>
            {trades.map((t) => (
              <tr key={t.tradeId}>
                <Td><Hash value={t.tradeId} n={20} /></Td>
                <Td mono>{t.granularity}</Td>
                <Td mono>{t.sourceRows.map((r) => r.rowNo).join(", ")}</Td>
                <Td>{re.tradeIds.includes(t.tradeId) ? <span className="text-emerald-400">sim</span> : <span className="text-rose-400">não</span>}</Td>
              </tr>
            ))}
          </Table>
        ) : <span className="text-sm text-zinc-500">{re ? "o bundle não traz trades" : "sem reingestão para comparar"}</span>}
      </Step>

      <Step n={8} title="Valores derivados da origem (instrumento, preços, horários, P&L, pernas, linhas)" check={checkOf(report, "V5.values")}>
        <p className="text-xs text-zinc-400">A comparação usa a mesma projeção do explainTrade sobre a reingestão. R, risco, issues e fieldProvenance ficam fora (podem ser acrescentados depois da importação). O relatório lista só os NOMES dos campos que divergem, nunca os valores.</p>
      </Step>

      <Step n={9} title="Resultado final">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={sourceStatusTone(report.status)}>{report.status}</Badge>
          <span className="text-sm text-zinc-300">{SOURCE_STATUS_EXPLAIN[report.status].title}</span>
          {run.matchesContract ? <span className="text-xs text-emerald-400" title="igual ao previsto pelo contrato">✓ conforme o contrato</span> : <span className="text-xs text-rose-400">⚠ DIFERENTE do previsto ({run.scenario.expected})</span>}
        </div>
        {report.status === "SOURCE_VERIFIED_PARTIAL" ? (
          <Callout tone="warn" title="Parcial não é completo">
            Só as referências presentes foram conferidas ({cov?.trades.verified}/{cov?.trades.referenced} trade(s), {cov?.rows.verified}/{cov?.rows.referenced} linha(s)). A população completa não está no bundle e não foi verificada contra o arquivo.
          </Callout>
        ) : null}
        {cov ? (
          <Kv
            rows={[
              ["imports (declarados · arquivo entregue · arquivo conferido · reingeridos)", `${cov.imports.declared} · ${cov.imports.sourceProvided} · ${cov.imports.fileVerified} · ${cov.imports.reingested}`],
              ["linhas citadas (conferidas)", `${cov.rows.verified}/${cov.rows.referenced}`],
              ["trades citados (conferidos)", `${cov.trades.verified}/${cov.trades.referenced}`],
              ["populações (FULL · HASH_ONLY)", `${cov.populations.full} · ${cov.populations.hashOnly}${cov.populations.complete ? " — completa" : " — NÃO completa"}`],
              ["seleção original · ordem original · R/stop do usuário", `${cov.selection} · ${cov.originalSequenceOrder} · ${cov.userEnrichment}`],
            ]}
          />
        ) : null}
        <div className="mt-3"><SourceCheckTable report={report} /></div>
        <Callout tone="mute" title="O que nem SOURCE_VERIFIED afirma (limitations do relatório)">
          <ul className="list-disc space-y-1 pl-5">{report.limitations.map((l) => <li key={l.code}><span className="font-mono text-xs">{l.code}</span> — {l.text}</li>)}</ul>
        </Callout>
      </Step>
    </div>
  )
}

export function SourceCheckTable({ report }: { report: SourceVerifyReport }) {
  return (
    <Table head={["check", "status", "código", "explicação"]}>
      {report.checks.map((c) => (
        <tr key={c.id} className={c.status === "FAIL" ? "bg-rose-500/5" : ""}>
          <Td><span className="font-mono text-xs text-zinc-100">{c.id}</span><span className="block text-[11px] text-zinc-500">{TITLES.get(c.id)}</span></Td>
          <Td><Badge tone={checkTone(c.status)}>{c.status}</Badge></Td>
          <Td mono>{c.code ?? "—"}</Td>
          <Td className="max-w-xl text-zinc-300">{c.detail}</Td>
        </tr>
      ))}
    </Table>
  )
}

export function SourcePanel({ runs, selected, p }: { runs: SourceRun[]; selected: SourceRun; p: LabParams }) {
  const s = selected.scenario
  const failing = selected.report.checks.filter((c) => c.status === "FAIL").map((c) => c.id)
  const blocking = selected.report.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE" && c.code !== "S_POPULATION_PARTIAL").map((c) => `${c.id}·${c.code}`)
  return (
    <>
      <Section
        title="Origem (E5b) — o bundle liga ao arquivo original?"
        subtitle="verifyEvidence (V0–V4) prova consistência interna e reprodução matemática; verifyEvidenceSource liga o bundle aos BYTES do CSV: SHA-256 → reexecução da ingestão → importId, rowHash, tradeId e valores. Cada linha abaixo executa as duas funções reais agora, sobre dados sintéticos; o estado mostrado é o devolvido por elas."
      >
        <Table head={["cenário", "verifyEvidence (V0–V4)", "verifyEvidenceSource (E5b)", "previsto", "o que acusou / pulou", ""]}>
          {runs.map((r) => (
            <tr key={r.scenario.id} className={r.scenario.id === s.id ? "bg-zinc-800/50" : ""}>
              <Td>{r.scenario.title}</Td>
              <Td><Badge tone={statusTone(r.verify.status)}>{r.verify.status}</Badge></Td>
              <Td>
                <Badge tone={sourceStatusTone(r.report.status)}>{r.report.status}</Badge>{" "}
                {r.matchesContract ? <span className="text-xs text-emerald-400" title="igual ao previsto pelo contrato">✓</span> : <span className="text-xs text-rose-400" title="DIFERENTE do previsto pelo contrato">⚠ divergente</span>}
              </Td>
              <Td><Badge tone="mute">{r.scenario.expected}</Badge></Td>
              <Td className="font-mono text-[11px] text-zinc-400">
                {r.report.checks.filter((c) => c.status === "FAIL").map((c) => c.id).join(", ") ||
                  r.report.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE").slice(0, 2).map((c) => `${c.id}·${c.code}`).join(", ") ||
                  "—"}
              </Td>
              <Td><QLink href={`${href(p, { tab: "source", src: r.scenario.id })}#detalhe`} active={r.scenario.id === s.id}>detalhar</QLink></Td>
            </tr>
          ))}
        </Table>
      </Section>
      <Section title="Os estados possíveis do E5b" subtitle="O que cada um significa. Parcial NUNCA quer dizer 'toda a população foi conferida'.">
        <div className="mb-3"><SoloVerdictCallout /></div>
        <StatusLegend current={selected.report.status} />
      </Section>
      <Section id="detalhe" title={s.title} subtitle={s.what}>
        <div className="mb-4 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm text-zinc-400">cenário:</span>
          {SOURCE_SCENARIOS.map((x) => <QLink key={x.id} href={`${href(p, { tab: "source", src: x.id })}#detalhe`} active={x.id === s.id}>{x.title}</QLink>)}
        </div>
        <Panel className="mb-4">
          <Kv
            rows={[
              ["estado real (E5b)", <Badge key="a" tone={sourceStatusTone(selected.report.status)}>{selected.report.status}</Badge>],
              ["previsto pelo contrato", <span key="b"><Badge tone="mute">{s.expected}</Badge> <span className="text-sm text-zinc-300">{s.expectedNote}</span></span>],
              ["checks que falharam", failing.length ? failing.join(", ") : "nenhum"],
              ["pulados bloqueantes", blocking.length ? blocking.join(", ") : "nenhum"],
            ]}
          />
        </Panel>
        {s.id === "forged" ? (
          <Callout tone="warn" title="Por que este é o caso que justifica o E5b">
            O bundle forjado passa em verifyEvidence ({selected.verify.status}): tudo fecha por dentro, e o rowHash e o tradeId ainda são os do CSV. Só reexecutar a ingestão sobre o arquivo original mostra que o P&L declarado não é o que o arquivo produz.
          </Callout>
        ) : null}
        {s.id === "hash" ? (
          <Callout tone="info" title="verifyEvidence não olha o arquivo">
            Trocar o fileSha256 do ImportRef e refazer o selo não é pego pelo V0–V4 ({selected.verify.status}); o E5b recalcula o SHA-256 dos bytes e acusa.
          </Callout>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-400">verifyEvidence (V0–V4) sobre o mesmo bundle:</span><ReportSummary report={{ ...selected.verify }} /></div>
        <SourceDetail run={selected} />
        <div className="mt-4"><Json value={selected.bundle} label="Bundle usado neste cenário (JSON; sem o CSV)" /></div>
      </Section>
    </>
  )
}
